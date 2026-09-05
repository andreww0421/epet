import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';

import {
  MAX_ROSTER_FILE_BYTES,
  createRosterCsvTemplate,
  previewRosterImport,
  type RosterImportPreview,
  type TabularImportIssue,
} from '../../imports/tabularImport';
import type { Language, Student } from '../../store/types';

type RosterImportPanelProps = {
  lang: Language;
  students: readonly Pick<Student, 'name'>[];
  onImport: (names: string[]) => number;
};

const MAX_VISIBLE_ISSUES = 10;
const MAX_VISIBLE_NAMES = 12;

const downloadTextFile = (content: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([content], {
    type: 'text/csv;charset=utf-8',
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const RosterImportPanel: React.FC<RosterImportPanelProps> = ({
  lang,
  students,
  onImport,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readSequenceRef = useRef(0);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<RosterImportPreview | null>(null);
  const [fileError, setFileError] = useState('');

  const copy = lang === 'en'
    ? {
        title: 'Import class roster',
        hint: 'Upload a CSV or TSV file, review every row, then add the new learners in one step. Existing learners are never overwritten or deleted.',
        choose: 'Choose CSV / TSV',
        download: 'Download CSV template',
        confirm: 'Add {count} learners',
        clear: 'Clear preview',
        noFile: 'Choose a CSV or TSV file to begin.',
        invalidFile: 'Only .csv and .tsv text files are accepted.',
        fileTooLarge: 'The file is larger than 256 KiB. Split the roster and try again.',
        readFailed: 'The file could not be read. Save it as UTF-8 CSV or TSV and try again.',
        summary: '{rows} rows reviewed · {additions} new · {warnings} skipped · {errors} errors',
        safe: 'Ready to add. No existing learner data will be changed.',
        blocked: 'Nothing has been imported. Fix every error and preview the file again.',
        additions: 'Learners to add',
        moreNames: '+ {count} more',
        moreIssues: '+ {count} more issues',
        issue: {
          'file-too-large': 'The file exceeds the 256 KiB limit.',
          'missing-name-header': 'Add a “Student Name” or “Name” column header.',
          'duplicate-name-header': 'Keep only one supported name column.',
          'parse-error': 'This row could not be parsed as CSV or TSV.',
          'too-many-students': 'A single import can contain at most 200 learners.',
          'empty-name': 'The learner name is blank.',
          'name-too-long': 'The learner name is longer than 80 characters.',
          'formula-risk': 'Names beginning like spreadsheet formulas are not accepted.',
          'existing-student': 'This learner already exists and will be skipped.',
          'duplicate-student': 'This name is repeated in the file and will be skipped.',
          'no-new-students': 'The file contains no new learners to add.',
        },
      }
    : {
        title: '匯入全班名冊',
        hint: '上傳 CSV 或 TSV，逐列預覽後再一次新增。現有學生不會被覆寫或刪除。',
        choose: '選擇 CSV／TSV',
        download: '下載 CSV 範本',
        confirm: '新增 {count} 位學生',
        clear: '清除預覽',
        noFile: '請先選擇 CSV 或 TSV 名冊。',
        invalidFile: '僅接受 .csv 與 .tsv 文字檔。',
        fileTooLarge: '檔案超過 256 KiB，請拆分名冊後再試。',
        readFailed: '無法讀取檔案，請另存為 UTF-8 CSV 或 TSV 後再試。',
        summary: '已檢查 {rows} 列 · 新增 {additions} 位 · 略過 {warnings} 位 · {errors} 個錯誤',
        safe: '可以匯入；現有學生資料不會被更動。',
        blocked: '目前尚未寫入任何資料；請修正所有錯誤後重新預覽。',
        additions: '即將新增',
        moreNames: '另有 {count} 位',
        moreIssues: '另有 {count} 個問題',
        issue: {
          'file-too-large': '檔案超過 256 KiB 上限。',
          'missing-name-header': '請加入「姓名」或「學生姓名」欄位標題。',
          'duplicate-name-header': '名冊只能保留一個姓名欄位。',
          'parse-error': '這一列無法解析為 CSV 或 TSV。',
          'too-many-students': '單次最多匯入 200 位學生。',
          'empty-name': '學生姓名不可空白。',
          'name-too-long': '學生姓名超過 80 個字元。',
          'formula-risk': '姓名不可使用類似試算表公式的開頭。',
          'existing-student': '班級已有同名學生，本列會略過。',
          'duplicate-student': '檔案內姓名重複，本列會略過。',
          'no-new-students': '檔案內沒有可新增的學生。',
        },
      };

  const resetPreview = () => {
    readSequenceRef.current += 1;
    setFilename('');
    setPreview(null);
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatIssue = (issue: TabularImportIssue) => {
    const issueMessage = copy.issue[issue.code as keyof typeof copy.issue] ?? issue.code;
    if (issue.row == null) return issueMessage;
    return lang === 'en'
      ? `Row ${issue.row}: ${issueMessage}`
      : `第 ${issue.row} 列：${issueMessage}`;
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const readSequence = ++readSequenceRef.current;
    setPreview(null);
    setFileError('');
    setFilename(file?.name ?? '');
    if (!file) return;

    if (!/\.(csv|tsv)$/i.test(file.name)) {
      setFileError(copy.invalidFile);
      return;
    }
    if (file.size > MAX_ROSTER_FILE_BYTES) {
      setFileError(copy.fileTooLarge);
      return;
    }

    try {
      const source = await file.text();
      if (readSequence !== readSequenceRef.current) return;
      setPreview(previewRosterImport(source, students));
    } catch {
      if (readSequence === readSequenceRef.current) setFileError(copy.readFailed);
    }
  };

  const handleImport = () => {
    if (!preview?.canApply || preview.additions.length === 0) return;
    const added = onImport(preview.additions);
    if (added > 0) resetPreview();
  };

  const errorCount = preview?.issues.filter((issue) => issue.severity === 'error').length ?? 0;
  const warningCount = preview?.issues.filter((issue) => issue.severity === 'warning').length ?? 0;
  const summary = preview
    ? copy.summary
        .replace('{rows}', preview.rows.length.toString())
        .replace('{additions}', preview.additions.length.toString())
        .replace('{warnings}', warningCount.toString())
        .replace('{errors}', errorCount.toString())
    : '';

  return (
    <section className="mt-5 border-t border-slate-200 pt-5" aria-labelledby="roster-import-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h3 id="roster-import-title" className="flex items-center text-sm font-black text-slate-900">
            <FileSpreadsheet className="mr-2 h-4 w-4 text-teal-700" aria-hidden="true" />
            {copy.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">{copy.hint}</p>
        </div>
        <button
          type="button"
          onClick={() => downloadTextFile(
            createRosterCsvTemplate(lang),
            lang === 'en' ? 'epet-roster-template.csv' : 'epet-學生名冊範本.csv',
          )}
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-50"
        >
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {copy.download}
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 focus-within:ring-2 focus-within:ring-teal-400 focus-within:ring-offset-2">
          <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
          {copy.choose}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>
        <span className="min-w-0 truncate text-xs text-slate-500">
          {filename || copy.noFile}
        </span>
        {(filename || preview || fileError) && (
          <button
            type="button"
            onClick={resetPreview}
            className="inline-flex items-center self-start rounded px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:self-auto"
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {copy.clear}
          </button>
        )}
      </div>

      {fileError && (
        <p className="mt-3 flex items-start border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800" role="alert">
          <AlertTriangle className="mr-2 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {fileError}
        </p>
      )}

      {preview && (
        <div className={`mt-3 border-l-4 px-4 py-3 ${
          errorCount > 0 ? 'border-rose-500 bg-rose-50' : 'border-teal-500 bg-teal-50'
        }`} aria-live="polite">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-black text-slate-900">{summary}</p>
              <p className={`mt-1 text-xs font-bold ${
                errorCount > 0 ? 'text-rose-800' : 'text-teal-800'
              }`}>
                {errorCount > 0 ? copy.blocked : copy.safe}
              </p>
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={!preview.canApply || preview.additions.length === 0}
              className="inline-flex shrink-0 items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {copy.confirm.replace('{count}', preview.additions.length.toString())}
            </button>
          </div>

          {preview.additions.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                {copy.additions}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {preview.additions.slice(0, MAX_VISIBLE_NAMES).map((name, index) => (
                  <span key={`${name}-${index}`} className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-700 shadow-sm">
                    {name}
                  </span>
                ))}
                {preview.additions.length > MAX_VISIBLE_NAMES && (
                  <span className="px-2 py-1 text-xs font-bold text-slate-500">
                    {copy.moreNames.replace(
                      '{count}',
                      (preview.additions.length - MAX_VISIBLE_NAMES).toString(),
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {preview.issues.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto border-t border-slate-200 pt-2">
              <ul className="space-y-1 text-xs">
                {preview.issues.slice(0, MAX_VISIBLE_ISSUES).map((issue, index) => (
                  <li
                    key={`${issue.code}-${issue.row ?? 'all'}-${index}`}
                    className={issue.severity === 'error'
                      ? 'font-bold text-rose-800'
                      : 'text-amber-800'}
                  >
                    {issue.severity === 'error' ? '•' : '△'} {formatIssue(issue)}
                  </li>
                ))}
              </ul>
              {preview.issues.length > MAX_VISIBLE_ISSUES && (
                <p className="mt-2 text-xs font-bold text-slate-500">
                  {copy.moreIssues.replace(
                    '{count}',
                    (preview.issues.length - MAX_VISIBLE_ISSUES).toString(),
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
