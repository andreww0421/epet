import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { trackAnalytics } from '../../../analytics';
import { beginProductWorkflow, completeLocalProductWorkflow, rejectProductWorkflow } from '../../../analytics/workflows';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FilePlus2,
  FileText,
  Minus,
  Plus,
  Printer,
  Save,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  MAX_EXAM_COMMENT_LENGTH,
  MAX_EXAM_ITEMS,
} from '../../../examAnalytics';
import {
  createExamReportHtml,
  type ExamReportCommentRange,
  type ExamReportScoreRange,
} from '../../../examReport';
import {
  applyExamScorePaste,
  createExamCsvTemplate,
  previewExamScorePaste,
} from '../../../imports/tabularImport';
import type { ExamRecord } from '../../../store/types';
import { getStoreSessionGeneration, useStore } from '../../../store/useStore';
import type { LearningStudentSelection } from '../../learning/model/learningWorkflow';
import { useScopedLearningDraft } from '../../learning/hooks/useScopedLearningDraft';
import { createExamAssessmentContextSelector } from '../model/examAssessmentContext';
import { getExamAssessmentCopy } from '../model/examAssessmentCopy';
import { buildExamAssessmentModel, buildExamReportModel } from '../model/examAssessmentModel';
import {
  cloneExam,
  createExamDraft,
  createExamEntityId,
  createSafeExamFilenameSegment,
  formatExamDelta,
  formatExamPercent,
  getStudentResult,
  hasExamScore,
  upsertStudentResult,
} from '../model/examDraft';

type ExamAssessmentPanelProps = {
  classId?: string;
  readOnly?: boolean;
  studentSelection?: LearningStudentSelection;
  reportRequestId?: number;
  visible?: boolean;
};

export const ExamAssessmentPanel = React.memo(function ExamAssessmentPanel({
  classId,
  readOnly = false,
  studentSelection,
  reportRequestId,
  visible = true,
}: ExamAssessmentPanelProps) {
  const selectContext = useMemo(() => createExamAssessmentContextSelector(classId), [classId]);
  const {
    currentClass,
    lang,
    saveExamRecord,
    deleteExamRecord,
    showToast,
  } = useStore(
    useShallow((state) => ({
      currentClass: selectContext(state.data, getStoreSessionGeneration()),
      lang: state.data.settings?.language || 'zh',
      saveExamRecord: state.saveExamRecord,
      deleteExamRecord: state.deleteExamRecord,
      showToast: state.showToast,
    })),
  );
  const copy = useMemo(() => getExamAssessmentCopy(lang), [lang]);
  const students = useMemo(
    () => currentClass?.students ?? [],
    [currentClass?.students],
  );
  const exams = useMemo(
    () => currentClass?.examRecords ?? [],
    [currentClass?.examRecords],
  );
  const [editor, setEditor] = useScopedLearningDraft<{ draft: ExamRecord; isDirty: boolean }>(
    JSON.stringify(['exam', currentClass?.id]),
    () => ({
      draft: exams[0] ? cloneExam(exams[0]) : createExamDraft(lang, exams.length + 1),
      isDirty: false,
    }),
  );
  const { draft, isDirty } = editor;
  const setDraft = (update: React.SetStateAction<ExamRecord>) => setEditor((current) => ({
    ...current,
    draft: typeof update === 'function' ? update(current.draft) : update,
  }));
  const setIsDirty = (update: React.SetStateAction<boolean>) => setEditor((current) => ({
    ...current,
    isDirty: typeof update === 'function' ? update(current.isDirty) : update,
  }));
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const reportControlsRef = useRef<HTMLDivElement>(null);
  const handledReportRequestId = useRef<number | undefined>(undefined);
  const reportControlsId = useId();
  const [reportScoreRange, setReportScoreRange] =
    useState<ExamReportScoreRange>('current');
  const [reportCommentRange, setReportCommentRange] =
    useState<ExamReportCommentRange>('current');
  const [excludedReportItemIds, setExcludedReportItemIds] = useState<string[]>([]);
  const [scorePastePreview, setScorePastePreview] = useState<
    ReturnType<typeof previewExamScorePaste> | null
  >(null);

  useEffect(() => {
    if (!studentSelection) setSelectedStudentId(students[0]?.id ?? '');
    setScorePastePreview(null);
    setExcludedReportItemIds([]);
    setReportScoreRange('current');
    setReportCommentRange('current');
  }, [currentClass?.id]);

  useEffect(() => {
    if (!studentSelection && !students.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(students[0]?.id ?? '');
    }
  }, [selectedStudentId, studentSelection, students]);

  useEffect(() => {
    if (!visible || !reportRequestId || !currentClass || !students.length ||
        handledReportRequestId.current === reportRequestId) return;
    const frame = requestAnimationFrame(() => {
      const controls = reportControlsRef.current;
      if (!controls || controls.getClientRects().length === 0) return;
      handledReportRequestId.current = reportRequestId;
      controls.focus({ preventScroll: true });
      controls.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentClass?.id, reportRequestId, students.length, visible]);

  useEffect(() => {
    if (isDirty) return;
    const currentStoredExam = exams.find((exam) => exam.id === draft.id);
    if (
      currentStoredExam &&
      currentStoredExam.updatedAt !== draft.updatedAt
    ) {
      setDraft(cloneExam(currentStoredExam));
      setScorePastePreview(null);
      return;
    }
    if (!currentStoredExam && exams[0]) {
      setDraft(cloneExam(exams[0]));
      setScorePastePreview(null);
    }
  }, [exams]);

  const effectiveStudentId = studentSelection?.studentId ?? selectedStudentId;
  const assessment = useMemo(() => buildExamAssessmentModel({
    draft, exams, students, selectedStudentId: effectiveStudentId, isDirty, readOnly,
  }), [draft, exams, students, effectiveStudentId, isDirty, readOnly]);
  const { storedExam, isPendingSave, hasDuplicateItemNames, canSave, canPrint,
    allExamsForAnalysis, selectedStudent, analysis, studentAnalyses,
    enteredScoreCount, totalScoreCount, completedStudentCount } = assessment;
  const { reportSelection, reportCommentCount, selectedReportItemIds } = useMemo(() => buildExamReportModel({
    draft, assessment, scoreRange: reportScoreRange, commentRange: reportCommentRange,
    excludedItemIds: excludedReportItemIds,
  }), [draft, assessment, reportScoreRange, reportCommentRange, excludedReportItemIds]);

  if (!currentClass) return null;

  const selectStudent = (studentId: string) => {
    if (!students.some((student) => student.id === studentId)) return;
    if (studentSelection) studentSelection.onStudentChange(studentId);
    else setSelectedStudentId(studentId);
  };
  const trendIcon =
    analysis?.trend === 'improving'
      ? TrendingUp
      : analysis?.trend === 'declining'
        ? TrendingDown
        : Minus;
  const TrendIcon = trendIcon;
  const trendTone =
    analysis?.trend === 'improving'
      ? 'text-emerald-700'
      : analysis?.trend === 'declining'
        ? 'text-rose-700'
        : 'text-slate-700';
  const scorePasteHasErrors = scorePastePreview?.issues.some(
    (issue) => issue.severity === 'error',
  ) ?? false;
  const scorePasteErrorCount = scorePastePreview?.issues.filter(
    (issue) => issue.severity === 'error',
  ).length ?? 0;
  const scorePasteWarningCount = scorePastePreview?.issues.filter(
    (issue) => issue.severity === 'warning',
  ).length ?? 0;
  const canApplyScorePaste = Boolean(
    scorePastePreview?.canApply &&
    !scorePasteHasErrors &&
    scorePastePreview.patches.length > 0,
  );
  const pastedStudentCount = scorePastePreview
    ? new Set(scorePastePreview.patches.map((patch) => patch.studentId)).size
    : 0;

  const markDirty = (next: ExamRecord) => {
    if (readOnly) return;
    setEditor({ draft: next, isDirty: true });
    setScorePastePreview(null);
  };

  const chooseExam = (examId: string) => {
    if (examId === draft.id ||
        (examId !== '__new__' && !exams.some((exam) => exam.id === examId))) return;
    if (isDirty && !window.confirm(copy.discardDraft)) return;
    if (examId === '__new__') {
      setEditor({ draft: createExamDraft(lang, exams.length + 1), isDirty: false });
    } else {
      const exam = exams.find((candidate) => candidate.id === examId);
      if (!exam) return;
      setEditor({ draft: cloneExam(exam), isDirty: false });
    }
    if (!studentSelection) setSelectedStudentId(students[0]?.id ?? '');
    setScorePastePreview(null);
    setExcludedReportItemIds([]);
  };

  const saveDraft = () => {
    const workflow = storedExam ? null : beginProductWorkflow('exam_create');
    if (readOnly) { rejectProductWorkflow(workflow); return; }
    if (!canSave) {
      rejectProductWorkflow(workflow);
      showToast(copy.completeRequired, 'error');
      return;
    }
    const before = useStore.getState().data;
    if (before.currentClassId !== currentClass.id) {
      rejectProductWorkflow(workflow);
      showToast(copy.saveFailed, 'error');
      return;
    }
    const previousExam = before.classes.find((classData) => classData.id === currentClass.id)
      ?.examRecords?.find((exam) => exam.id === draft.id);
    saveExamRecord({
      ...draft,
      title: draft.title.trim(),
      updatedAt: Date.now(),
    });
    const after = useStore.getState().data;
    const savedExam = after.classes.find((classData) => classData.id === currentClass.id)
      ?.examRecords?.find((exam) => exam.id === draft.id);
    if (after.currentClassId !== currentClass.id || !savedExam || savedExam === previousExam) {
      rejectProductWorkflow(workflow);
      showToast(copy.saveFailed, 'error');
      return;
    }
    setIsDirty(false);
  };

  const updateScore = (
    studentId: string,
    itemId: string,
    value: string,
    maxScore: number,
  ) => {
    markDirty(
      upsertStudentResult(draft, studentId, (result) => {
        const scores = { ...result.scores };
        if (value === '') {
          delete scores[itemId];
        } else {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            scores[itemId] = Math.min(maxScore, Math.max(0, parsed));
          }
        }
        return { ...result, scores, updatedAt: Date.now() };
      }),
    );
  };

  const downloadScoreTemplate = () => {
    if (readOnly || !canSave) return;
    try {
      const generatedCsv = createExamCsvTemplate(draft, students, lang);
      const csv = generatedCsv.startsWith('\uFEFF')
        ? generatedCsv
        : `\uFEFF${generatedCsv}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const className = createSafeExamFilenameSegment(currentClass.name, 'class');
      const examName = createSafeExamFilenameSegment(draft.title, 'assessment');
      anchor.href = objectUrl;
      anchor.download = `${className}_${examName}_${draft.examDate}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      showToast(copy.templateFailed, 'error');
    }
  };

  const handleScorePaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    studentIndex: number,
    itemIndex: number,
  ) => {
    if (readOnly) return;
    const source = event.clipboardData.getData('text/plain');
    if (!/[\t\r\n]/.test(source)) return;
    event.preventDefault();
    setScorePastePreview(
      previewExamScorePaste(source, {
        exam: draft,
        students,
        startStudentIndex: studentIndex,
        startItemIndex: itemIndex,
      }),
    );
  };

  const applyScorePaste = () => {
    if (!scorePastePreview || !canApplyScorePaste || scorePasteHasErrors) return;
    const preview = scorePastePreview;
    const patchCount = preview.patches.length;
    markDirty(applyExamScorePaste(draft, preview, Date.now()));
    showToast(
      copy.pasteApplied.replace('{count}', patchCount.toString()),
      'success',
    );
  };

  const focusScoreCell = (studentIndex: number, itemIndex: number) => {
    const target = document.querySelector<HTMLInputElement>(
      `input[data-score-row="${studentIndex}"][data-score-column="${itemIndex}"]`,
    );
    if (!target) return false;
    target.focus();
    target.select();
    return true;
  };

  const handleScoreKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    studentIndex: number,
    itemIndex: number,
  ) => {
    if (
      readOnly ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.key !== 'Enter' && event.key !== 'Tab')
    ) {
      return;
    }
    let nextStudentIndex = studentIndex;
    let nextItemIndex = itemIndex;
    if (event.key === 'Enter') {
      nextStudentIndex += event.shiftKey ? -1 : 1;
    } else {
      const nextLinearIndex =
        studentIndex * draft.items.length +
        itemIndex +
        (event.shiftKey ? -1 : 1);
      if (
        nextLinearIndex < 0 ||
        nextLinearIndex >= students.length * draft.items.length
      ) {
        return;
      }
      nextStudentIndex = Math.floor(nextLinearIndex / draft.items.length);
      nextItemIndex = nextLinearIndex % draft.items.length;
    }
    if (!focusScoreCell(nextStudentIndex, nextItemIndex)) return;
    event.preventDefault();
  };

  const formatScorePasteIssue = (
    issue: ReturnType<typeof previewExamScorePaste>['issues'][number],
  ) => {
    const label = copy.pasteIssueMessages[
      issue.code as keyof typeof copy.pasteIssueMessages
    ] ?? issue.code;
    const locationParts = [
      issue.row == null
        ? null
        : lang === 'en'
          ? `row ${issue.row}`
          : `第 ${issue.row} 列`,
      issue.column == null
        ? null
        : lang === 'en'
          ? `column ${issue.column}`
          : `第 ${issue.column} 欄`,
    ].filter((part): part is string => Boolean(part));
    const locationLabel = locationParts.length > 0
      ? `${locationParts.join(lang === 'en' ? ', ' : '、')}：${label}`
      : label;
    const studentName = typeof issue.details?.studentName === 'string'
      ? issue.details.studentName
      : '';
    const itemName = typeof issue.details?.itemName === 'string'
      ? issue.details.itemName
      : '';
    const maximumScore = typeof issue.details?.maximumScore === 'number'
      ? issue.details.maximumScore
      : null;
    if (!studentName && !itemName && maximumScore == null) return locationLabel;
    const targetLabel = [studentName, itemName].filter(Boolean).join(' / ');
    const maximumLabel = maximumScore == null
      ? ''
      : lang === 'en'
        ? `maximum ${maximumScore}`
        : `滿分 ${maximumScore}`;
    const detailsLabel = [targetLabel, maximumLabel]
      .filter(Boolean)
      .join(lang === 'en' ? ', ' : '，');
    return lang === 'en'
      ? `${locationLabel} (${detailsLabel})`
      : `${locationLabel}（${detailsLabel}）`;
  };

  const updateComment = (studentId: string, mentorComment: string) => {
    markDirty(
      upsertStudentResult(draft, studentId, (result) => ({
        ...result,
        mentorComment: mentorComment.slice(0, MAX_EXAM_COMMENT_LENGTH),
        updatedAt: Date.now(),
      })),
    );
  };

  const printReport = () => {
    const workflow = beginProductWorkflow('report_exam');
    if (!selectedStudent || !analysis || !canPrint) {
      rejectProductWorkflow(workflow);
      showToast(copy.completeRequired, 'error');
      return;
    }
    const reportWindow = window.open('', '_blank', 'width=920,height=1180');
    if (!reportWindow) {
      rejectProductWorkflow(workflow);
      showToast(copy.popupBlocked, 'error');
      return;
    }
    try {
      if (!readOnly) saveDraft();
      reportWindow.opener = null;
      reportWindow.document.open();
      reportWindow.document.write(
        createExamReportHtml({
          className: currentClass.name,
          studentName: selectedStudent.name,
          exam: draft,
          exams: allExamsForAnalysis,
          analysis,
          lang,
          scoreRange: reportScoreRange,
          commentRange: reportCommentRange,
          itemIds: selectedReportItemIds,
        }),
      );
      reportWindow.document.close();
      completeLocalProductWorkflow(workflow);
      trackAnalytics('report_generated', { report_type: 'exam_summary', format: 'print' });
      reportWindow.focus();
      reportWindow.setTimeout(() => reportWindow.print(), 250);
    } catch (error) { rejectProductWorkflow(workflow); throw error; }
  };

  const renderItemTags = (
    items: Array<{ itemId: string; name: string; percent: number | null }>,
    tone: 'emerald' | 'amber' | 'slate',
  ) => {
    if (items.length === 0) {
      return <span className="text-xs italic text-slate-600">{copy.none}</span>;
    }
    const classes = {
      emerald: 'border-emerald-300 bg-emerald-50 text-emerald-800',
      amber: 'border-amber-300 bg-amber-50 text-amber-900',
      slate: 'border-slate-300 bg-slate-50 text-slate-600',
    };
    return items.map((item) => (
      <span
        key={item.itemId}
        className={`inline-flex border-l-2 px-2 py-1 text-xs font-bold ${classes[tone]}`}
      >
        {item.name}{item.percent == null ? '' : ` ${Math.round(item.percent)}%`}
      </span>
    ));
  };

  return (
    <section className="mt-6 overflow-hidden border border-teal-200 bg-[#fffdf8] shadow-sm">
      <header className="relative overflow-hidden border-b border-teal-200 bg-teal-950 px-5 py-5 text-white">
        <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full border-[28px] border-teal-800/50" />
        <div className="relative">
          <h2 className="flex items-center text-lg font-black tracking-tight">
            <ClipboardList className="mr-2 h-5 w-5 text-amber-300" />
            {copy.title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-teal-100">{copy.hint}</p>
          <div className="mt-4 grid max-w-3xl grid-cols-3 gap-px overflow-hidden rounded-md bg-teal-700/70 text-center text-[11px] font-bold sm:text-xs">
            <div className="bg-teal-900/80 px-2 py-2">{copy.stepOne}</div>
            <div className="bg-teal-900/80 px-2 py-2">{copy.stepTwo}</div>
            <div className="bg-teal-900/80 px-2 py-2">{copy.stepThree}</div>
          </div>
        </div>
      </header>

      {students.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-slate-600">
          {copy.noStudents}
        </div>
      ) : (
        <>
          <div className="grid gap-4 border-b border-slate-200 bg-white px-5 py-4 lg:grid-cols-[minmax(220px,1fr)_minmax(200px,1.2fr)_170px_auto] lg:items-end">
            <label className="text-xs font-bold text-slate-600">
              {copy.assessmentHistory}
              <select
                value={storedExam ? draft.id : '__new__'}
                onChange={(event) => chooseExam(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
              >
                {!storedExam && (
                  <option value="__new__">{copy.unsavedAssessment}</option>
                )}
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.examDate} - {exam.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              {copy.assessmentTitle}
              <input
                value={draft.title}
                maxLength={100}
                readOnly={readOnly}
                onChange={(event) =>
                  markDirty({ ...draft, title: event.target.value })
                }
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              {copy.assessmentDate}
              <input
                type="date"
                value={draft.examDate}
                readOnly={readOnly}
                onChange={(event) =>
                  markDirty({ ...draft, examDate: event.target.value })
                }
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </label>
            {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => chooseExam('__new__')}
                className="inline-flex min-h-11 items-center rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
              >
                <FilePlus2 className="mr-1.5 h-4 w-4" />
                {copy.newAssessment}
              </button>
              {storedExam && (
                <button
                  type="button"
                  onClick={() => {
                    if (readOnly) return;
                    if (!window.confirm(copy.deleteConfirm)) return;
                    deleteExamRecord(draft.id);
                    const remaining = exams.filter((exam) => exam.id !== draft.id);
                    setEditor({
                      draft: remaining[0]
                        ? cloneExam(remaining[0])
                        : createExamDraft(lang, 1),
                      isDirty: false,
                    });
                  }}
                  className="inline-flex min-h-11 items-center rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {copy.delete}
                </button>
              )}
            </div>
            )}
          </div>

          <div className="border-b border-slate-200 bg-[#f8f4ea] px-5 py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">{copy.itemSettings}</h3>
                <p className="mt-1 text-xs text-slate-600">{copy.itemSettingsHint}</p>
              </div>
              {!readOnly && (
              <button
                type="button"
                disabled={draft.items.length >= MAX_EXAM_ITEMS}
                onClick={() =>
                  markDirty({
                    ...draft,
                    items: [
                      ...draft.items,
                      {
                        id: createExamEntityId('exam-item'),
                        name: lang === 'en'
                          ? `Item ${draft.items.length + 1}`
                          : `項目 ${draft.items.length + 1}`,
                        maxScore: 100,
                      },
                    ],
                  })
                }
                className="inline-flex min-h-11 items-center self-start rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {copy.addItem}
              </button>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {draft.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_76px_auto] gap-2 border-l-4 border-amber-400 bg-white p-3 shadow-sm"
                >
                  <label className="text-[11px] font-bold text-slate-600">
                    {copy.itemName}
                    <input
                      value={item.name}
                      maxLength={80}
                      readOnly={readOnly}
                      onChange={(event) =>
                        markDirty({
                          ...draft,
                          items: draft.items.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, name: event.target.value }
                              : candidate
                          ),
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded border border-slate-300 p-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-[11px] font-bold text-slate-600">
                    {copy.maximum}
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="0.5"
                      value={item.maxScore}
                      readOnly={readOnly}
                      onChange={(event) => {
                        const nextMax = Math.min(
                          1000,
                          Math.max(1, Number(event.target.value) || 1),
                        );
                        markDirty({
                          ...draft,
                          items: draft.items.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, maxScore: nextMax }
                              : candidate
                          ),
                          results: draft.results.map((result) => ({
                            ...result,
                            scores: hasExamScore(result.scores[item.id])
                              ? {
                                  ...result.scores,
                                  [item.id]: Math.min(
                                    nextMax,
                                    result.scores[item.id],
                                  ),
                                }
                              : result.scores,
                          })),
                        });
                      }}
                      className="mt-1 min-h-11 w-full rounded border border-slate-300 p-1.5 text-sm text-slate-900"
                    />
                  </label>
                  {!readOnly && (
                  <button
                    type="button"
                    disabled={draft.items.length <= 1}
                    aria-label={`${copy.delete} ${item.name || itemIndex + 1}`}
                    onClick={() =>
                      markDirty({
                        ...draft,
                        items: draft.items.filter(
                          (candidate) => candidate.id !== item.id,
                        ),
                        results: draft.results.map((result) => {
                          const scores = { ...result.scores };
                          delete scores[item.id];
                          return { ...result, scores };
                        }),
                      })
                    }
                    className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  )}
                </div>
              ))}
            </div>
            {hasDuplicateItemNames && (
              <p className="mt-2 flex items-center text-xs font-bold text-rose-700">
                <AlertTriangle className="mr-1.5 h-4 w-4" />
                {copy.duplicateItems}
              </p>
            )}
          </div>

          <div className="px-5 py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">{copy.classScores}</h3>
                <p className="mt-1 text-xs text-slate-600">{copy.classScoresHint}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
                {!readOnly && (
                  <button
                    type="button"
                    onClick={downloadScoreTemplate}
                    disabled={!canSave}
                    className="inline-flex min-h-11 items-center rounded-md border border-teal-300 bg-white px-3 py-2 font-bold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {copy.downloadScoreTemplate}
                  </button>
                )}
                <span className="font-bold text-slate-600">
                  {enteredScoreCount} / {totalScoreCount} {copy.entered}
                </span>
                <span className="inline-flex items-center border-l-2 border-teal-500 bg-teal-50 px-2 py-1 font-bold text-teal-800">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  {completedStudentCount} / {students.length}
                </span>
              </div>
            </div>
            {scorePastePreview && (
              <div
                className={`mt-3 border-l-4 px-4 py-3 ${
                  scorePasteHasErrors
                    ? 'border-rose-500 bg-rose-50'
                    : 'border-teal-500 bg-teal-50'
                }`}
                role="region"
                aria-live="polite"
                aria-label={copy.pastePreview}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className={`text-sm font-black ${
                      scorePasteHasErrors ? 'text-rose-950' : 'text-teal-950'
                    }`}>
                      {copy.pastePreview}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-700">
                      {lang === 'en'
                        ? `${scorePastePreview.rowCount} rows × ${scorePastePreview.columnCount} columns; ${scorePastePreview.patches.length} score changes across ${pastedStudentCount} learners. ${scorePasteErrorCount} errors, ${scorePasteWarningCount} warnings.`
                        : `${scorePastePreview.rowCount} 列 × ${scorePastePreview.columnCount} 欄；共 ${scorePastePreview.patches.length} 筆成績異動、${pastedStudentCount} 位學生。${scorePasteErrorCount} 個錯誤、${scorePasteWarningCount} 個提醒。`}
                    </p>
                    {scorePasteHasErrors && (
                      <p className="mt-1 text-xs font-bold text-rose-800">
                        {copy.pasteBlocked}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setScorePastePreview(null)}
                      className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      {copy.pasteCancel}
                    </button>
                    <button
                      type="button"
                      onClick={applyScorePaste}
                      disabled={!canApplyScorePaste}
                      className="min-h-11 rounded-md bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {copy.pasteConfirm}
                    </button>
                  </div>
                </div>
                {scorePastePreview.issues.length > 0 && (
                  <div className="mt-3 max-h-40 overflow-y-auto border-t border-slate-200 pt-2">
                    <ul className="space-y-1 text-xs text-slate-700">
                      {scorePastePreview.issues.slice(0, 12).map((issue, issueIndex) => (
                        <li
                          key={`${issue.code}-${issue.row ?? 'all'}-${issue.column ?? 'all'}-${issueIndex}`}
                          className={issue.severity === 'error'
                            ? 'font-bold text-rose-800'
                            : 'text-amber-800'}
                        >
                          {issue.severity === 'error' ? '•' : '△'}{' '}
                          {formatScorePasteIssue(issue)}
                        </li>
                      ))}
                    </ul>
                    {scorePastePreview.issues.length > 12 && (
                      <p className="mt-2 text-xs font-bold text-slate-600">
                        {copy.pasteMoreIssues.replace(
                          '{count}',
                          (scorePastePreview.issues.length - 12).toString(),
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 overflow-x-auto border border-slate-200">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-900 text-left text-xs text-white">
                    <th className="sticky left-0 z-10 min-w-36 border-r border-slate-700 bg-slate-900 px-3 py-2">
                      {copy.learner}
                    </th>
                    {draft.items.map((item) => (
                      <th key={item.id} className="min-w-32 border-r border-slate-700 px-3 py-2">
                        <span className="block">{item.name || copy.itemName}</span>
                        <span className="font-normal text-slate-300">/ {item.maxScore}</span>
                      </th>
                    ))}
                    <th className="min-w-24 px-3 py-2 text-right">{copy.overall}</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, studentIndex) => {
                    const result = getStudentResult(draft, student.id);
                    const studentAnalysis = studentAnalyses.get(student.id)!;
                    const isSelected = selectedStudent?.id === student.id;
                    return (
                      <tr
                        key={student.id}
                        onClick={() => selectStudent(student.id)}
                        className={`cursor-pointer border-t border-slate-200 ${
                          isSelected
                            ? 'bg-amber-50'
                            : studentIndex % 2 === 0
                              ? 'bg-white'
                              : 'bg-slate-50/70'
                        }`}
                      >
                        <th
                          scope="row"
                          className={`sticky left-0 z-[1] border-r border-slate-200 px-3 py-2 text-left font-bold ${
                            isSelected
                              ? 'bg-amber-50 text-amber-950'
                              : studentIndex % 2 === 0
                                ? 'bg-white text-slate-800'
                                : 'bg-slate-50 text-slate-800'
                          }`}
                        >
                          {student.name}
                        </th>
                        {draft.items.map((item, itemIndex) => (
                          <td key={item.id} className="border-r border-slate-200 px-2 py-1.5">
                            <input
                              type="number"
                              data-score-row={studentIndex}
                              data-score-column={itemIndex}
                              min="0"
                              max={item.maxScore}
                              step="0.5"
                              value={result?.scores[item.id] ?? ''}
                              readOnly={readOnly}
                              onFocus={() => selectStudent(student.id)}
                              onPaste={(event) =>
                                handleScorePaste(event, studentIndex, itemIndex)
                              }
                              onKeyDown={(event) =>
                                handleScoreKeyDown(event, studentIndex, itemIndex)
                              }
                              onChange={(event) =>
                                updateScore(
                                  student.id,
                                  item.id,
                                  event.target.value,
                                  item.maxScore,
                                )
                              }
                              aria-label={`${student.name} ${item.name} ${copy.score}`}
                              className="min-h-11 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-right font-semibold tabular-nums focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-black tabular-nums text-slate-800">
                          {formatExamPercent(studentAnalysis?.overallPercent ?? null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedStudent && analysis && (
            <div className="grid border-t border-slate-200 bg-white xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.75fr)]">
              <div className="min-w-0 border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[.14em] text-teal-700">
                      {copy.individualAnalysis}
                    </p>
                    <h3 className="mt-1 text-xl font-black text-slate-950">
                      {selectedStudent.name}
                    </h3>
                  </div>
                  <select
                    value={selectedStudent.id}
                    onChange={(event) => selectStudent(event.target.value)}
                    className="min-h-11 rounded-md border border-slate-300 bg-white p-2 text-sm"
                    aria-label={copy.selectedLearner}
                  >
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>{student.name}</option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-px bg-slate-200">
                  <div className="bg-[#f8f4ea] px-3 py-3">
                    <p className="text-xs text-slate-600">{copy.overall}</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">
                      {formatExamPercent(analysis.overallPercent)}
                    </p>
                  </div>
                  <div className="bg-[#f8f4ea] px-3 py-3">
                    <p className="text-xs text-slate-600">{copy.classAverage}</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">
                      {formatExamPercent(analysis.classAveragePercent)}
                    </p>
                  </div>
                  <div className="bg-[#f8f4ea] px-3 py-3">
                    <p className="text-xs text-slate-600">{copy.trend}</p>
                    <p className={`mt-1 flex items-center text-base font-black ${trendTone}`}>
                      <TrendIcon className="mr-1.5 h-4 w-4" />
                      {copy[analysis.trend]}
                    </p>
                    <p className="mt-1 text-xs font-bold tabular-nums text-slate-600">
                      {formatExamDelta(analysis.trendDelta)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto border border-slate-200" role="region" aria-label={copy.itemComparison} tabIndex={0}>
                  <div className="min-w-[390px]">
                  <div className="grid grid-cols-[minmax(120px,1fr)_90px_90px_90px] bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                    <span>{copy.itemName}</span>
                    <span className="text-right">{copy.score}</span>
                    <span className="text-right">{copy.classComparison}</span>
                    <span className="text-right">{copy.itemTrend}</span>
                  </div>
                  {analysis.itemAnalyses.map((item) => (
                    <div
                      key={item.itemId}
                      className="grid grid-cols-[minmax(120px,1fr)_90px_90px_90px] border-t border-slate-100 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium text-slate-800">{item.name}</span>
                      <span className="text-right font-bold tabular-nums">
                        {formatExamPercent(item.percent)}
                      </span>
                      <span className="text-right tabular-nums text-slate-600">
                        {formatExamPercent(item.classAveragePercent)}
                      </span>
                      <span className={`text-right font-bold tabular-nums ${
                        item.trendDelta != null && item.trendDelta < -3
                          ? 'text-rose-700'
                          : item.trendDelta != null && item.trendDelta >= 3
                            ? 'text-emerald-700'
                            : 'text-slate-600'
                      }`}>
                        {formatExamDelta(item.trendDelta)}
                      </span>
                    </div>
                  ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="border-l-2 border-emerald-400 bg-emerald-50/60 p-3">
                    <p className="text-xs font-black text-emerald-900">{copy.strengths}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {renderItemTags(analysis.strengthItems, 'emerald')}
                    </div>
                  </div>
                  <div className="border-l-2 border-amber-400 bg-amber-50/60 p-3">
                    <p className="text-xs font-black text-amber-950">{copy.focusAreas}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {renderItemTags(analysis.weaknessItems, 'amber')}
                    </div>
                  </div>
                  <div className="border-l-2 border-slate-300 bg-slate-50 p-3">
                    <p className="text-xs font-black text-slate-700">{copy.missingScores}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {renderItemTags(analysis.missingItems, 'slate')}
                    </div>
                  </div>
                </div>
              </div>

              <div ref={reportControlsRef} id={reportControlsId} role="region" aria-labelledby={`${reportControlsId}-heading`} tabIndex={-1}
                className="min-w-0 bg-[#f8f4ea] p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
                <h3 className="flex items-center text-sm font-black text-slate-900">
                  <FileText className="mr-2 h-4 w-4 text-teal-700" />
                  {copy.mentorComment}
                </h3>
                  <textarea
                  value={
                    getStudentResult(draft, selectedStudent.id)?.mentorComment ?? ''
                  }
                  maxLength={MAX_EXAM_COMMENT_LENGTH}
                    rows={8}
                    readOnly={readOnly}
                  onChange={(event) =>
                    updateComment(selectedStudent.id, event.target.value)
                  }
                  placeholder={copy.commentPlaceholder}
                  className="mt-3 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                />
                <div className="mt-4 border-l-4 border-teal-600 bg-white px-4 py-4 shadow-sm ring-1 ring-slate-200">
                  <div>
                    <p id={`${reportControlsId}-heading`} className="text-sm font-black text-slate-900">{copy.reportScope}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {copy.reportScopeHint}
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-bold text-slate-700">
                      {copy.scoreRange}
                      <select
                        value={reportScoreRange}
                        onChange={(event) =>
                          setReportScoreRange(event.target.value as ExamReportScoreRange)
                        }
                        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-[#fffdf8] px-2 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"
                      >
                        <option value="current">{copy.rangeCurrentScore}</option>
                        <option value="recent3">{copy.rangeRecentScore}</option>
                        <option value="all">{copy.rangeAllScore}</option>
                      </select>
                    </label>
                    <label className="block text-xs font-bold text-slate-700">
                      {copy.commentRange}
                      <select
                        value={reportCommentRange}
                        onChange={(event) =>
                          setReportCommentRange(event.target.value as ExamReportCommentRange)
                        }
                        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-[#fffdf8] px-2 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"
                      >
                        <option value="current">{copy.rangeCurrentComment}</option>
                        <option value="recent3">{copy.rangeRecentComment}</option>
                        <option value="all">{copy.rangeAllComment}</option>
                        <option value="none">{copy.rangeNoComment}</option>
                      </select>
                    </label>
                  </div>
                  <fieldset className="mt-4 border-t border-slate-200 pt-3">
                    <legend className="sr-only">{copy.itemRows}</legend>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-700">
                        {copy.itemRows}
                      </p>
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setExcludedReportItemIds([])}
                          disabled={selectedReportItemIds.length === draft.items.length}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center text-teal-700 hover:text-teal-900 disabled:cursor-default disabled:text-slate-300"
                        >
                          {copy.selectAllItems}
                        </button>
                        <span className="text-slate-300" aria-hidden="true">/</span>
                        <button
                          type="button"
                          onClick={() => setExcludedReportItemIds(draft.items.map((item) => item.id))}
                          disabled={selectedReportItemIds.length === 0}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center text-teal-700 hover:text-teal-900 disabled:cursor-default disabled:text-slate-300"
                        >
                          {copy.clearAllItems}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {draft.items.map((item) => {
                        const isSelected = !excludedReportItemIds.includes(item.id);
                        return (
                          <label
                            key={item.id}
                            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                              isSelected
                                ? 'border-teal-300 bg-teal-50 text-teal-950'
                                : 'border-slate-200 bg-[#fffdf8] text-slate-600'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) =>
                                setExcludedReportItemIds((current) =>
                                  event.target.checked
                                    ? current.filter((id) => id !== item.id)
                                    : [...new Set([...current, item.id])]
                                )
                              }
                              className="h-4 w-4 accent-teal-700"
                            />
                            <span className="truncate">{item.name || copy.itemName}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <p className="mt-3 border-t border-slate-100 pt-2 text-xs font-bold text-teal-800">
                    {copy.reportScopeSummary
                      .replace('{scores}', String(reportSelection?.scoreEntries.length ?? 0))
                      .replace('{comments}', String(reportCommentCount))
                      .replace('{items}', String(selectedReportItemIds.length))}
                  </p>
                </div>
                <div className="mt-4 grid gap-2">
                  {!readOnly && (
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={!canSave}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {copy.save}
                  </button>
                  )}
                  <button
                    type="button"
                    onClick={printReport}
                    disabled={!canPrint}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-teal-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-600 disabled:bg-slate-300"
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    {copy.printA4}
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{copy.printHint}</p>
                <div role="status" aria-live="polite" className={`mt-4 flex items-center text-xs font-bold ${
                  isPendingSave ? 'text-amber-700' : 'text-emerald-700'
                }`}>
                  {isPendingSave
                    ? <AlertTriangle className="mr-1.5 h-4 w-4" />
                    : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  {isPendingSave ? copy.unsaved : copy.saved}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{copy.syncHint}</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
});
