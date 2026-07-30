import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
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
  computeExamStudentAnalysis,
} from '../../examAnalytics';
import { createExamReportHtml } from '../../examReport';
import type {
  ExamRecord,
  ExamStudentResult,
  Language,
  Student,
} from '../../store/types';
import { useStore } from '../../store/useStore';

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getLocalDateKey = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const cloneExam = (exam: ExamRecord): ExamRecord => ({
  ...exam,
  items: exam.items.map((item) => ({ ...item })),
  results: exam.results.map((result) => ({
    ...result,
    scores: { ...result.scores },
  })),
});

const createExamDraft = (lang: Language, sequence: number): ExamRecord => {
  const now = Date.now();
  return {
    id: createId('exam'),
    title: lang === 'en' ? `Assessment ${sequence}` : `第 ${sequence} 次考試`,
    examDate: getLocalDateKey(),
    items: [{
      id: createId('exam-item'),
      name: lang === 'en' ? 'Item 1' : '項目 1',
      maxScore: 100,
    }],
    results: [],
    createdAt: now,
    updatedAt: now,
  };
};

const getStudentResult = (exam: ExamRecord, studentId: string) =>
  exam.results.find((result) => result.studentId === studentId);

const upsertStudentResult = (
  exam: ExamRecord,
  studentId: string,
  update: (result: ExamStudentResult) => ExamStudentResult,
) => {
  const existing = getStudentResult(exam, studentId) ?? {
    studentId,
    scores: {},
    updatedAt: Date.now(),
  };
  const nextResult = update(existing);
  const hasExisting = exam.results.some((result) => result.studentId === studentId);
  return {
    ...exam,
    updatedAt: Date.now(),
    results: hasExisting
      ? exam.results.map((result) =>
          result.studentId === studentId ? nextResult : result
        )
      : [...exam.results, nextResult],
  };
};

const formatPercent = (value: number | null) =>
  value == null ? '-' : `${Math.round(value)}%`;

const formatDelta = (value: number | null) =>
  value == null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

const hasScore = (value: number | undefined) => Number.isFinite(value);

export const ExamAssessmentPanel: React.FC = () => {
  const {
    currentClass,
    lang,
    saveExamRecord,
    deleteExamRecord,
    showToast,
  } = useStore(
    useShallow((state) => ({
      currentClass: state.data.classes.find(
        (classData) => classData.id === state.data.currentClassId,
      ),
      lang: state.data.settings?.language || 'zh',
      saveExamRecord: state.saveExamRecord,
      deleteExamRecord: state.deleteExamRecord,
      showToast: state.showToast,
    })),
  );
  const copy = lang === 'en'
    ? {
        title: 'Assessment Trends & Individual Reports',
        hint: 'Enter one class assessment, review each learner’s trend and focus areas, add a comment, then print an individual A4 PDF.',
        stepOne: '1. Enter class scores',
        stepTwo: '2. Review trends',
        stepThree: '3. Comment & PDF',
        assessmentHistory: 'Assessment',
        unsavedAssessment: 'New unsaved assessment',
        newAssessment: 'New assessment',
        assessmentTitle: 'Assessment title',
        assessmentDate: 'Date',
        save: 'Save assessment',
        saved: 'Saved',
        unsaved: 'Unsaved changes',
        delete: 'Delete',
        deleteConfirm: 'Delete this assessment and every entered score?',
        itemSettings: 'Assessment items',
        itemSettingsHint: 'Each item can have a different maximum. Matching names are used for item-level trends.',
        itemName: 'Item name',
        maximum: 'Maximum',
        addItem: 'Add item',
        duplicateItems: 'Item names must be unique.',
        classScores: 'Class score sheet',
        classScoresHint: 'Click a learner row to open the individual analysis below.',
        learner: 'Learner',
        completion: 'Completion',
        entered: 'scores entered',
        noStudents: 'Add students before entering an assessment.',
        individualAnalysis: 'Individual trend',
        selectedLearner: 'Selected learner',
        overall: 'Overall',
        classAverage: 'Class average',
        trend: 'Trend',
        improving: 'Improving',
        declining: 'Needs attention',
        stable: 'Stable',
        first: 'First record',
        strengths: 'Strengths',
        focusAreas: 'Focus areas',
        missingScores: 'Missing scores',
        none: 'None identified',
        mentorComment: 'Teacher comment',
        commentPlaceholder: 'Add specific, actionable feedback for the learner and family...',
        printA4: 'Generate individual A4 PDF',
        printHint: 'Opens the system print dialog. Choose “Save as PDF”; the page size is preset to A4.',
        popupBlocked: 'The report window was blocked. Allow pop-ups and try again.',
        completeRequired: 'Add an assessment title and at least one unique item before saving.',
        itemTrend: 'vs. previous',
        classComparison: 'class',
        score: 'Score',
      }
    : {
        title: '考試趨勢與個別報告',
        hint: '一次輸入全班考試成績，自動查看每位學生的趨勢與弱項，補上導師評語後產生個別 A4 PDF。',
        stepOne: '1. 輸入全班成績',
        stepTwo: '2. 查看趨勢弱項',
        stepThree: '3. 補評語與 PDF',
        assessmentHistory: '考試紀錄',
        unsavedAssessment: '尚未保存的新考試',
        newAssessment: '新增考試',
        assessmentTitle: '考試名稱',
        assessmentDate: '考試日期',
        save: '保存考試',
        saved: '已保存',
        unsaved: '有尚未保存的變更',
        delete: '刪除',
        deleteConfirm: '確定刪除此考試及所有已輸入成績？',
        itemSettings: '考試項目',
        itemSettingsHint: '每個項目可設定不同滿分；歷次同名項目會用來計算項目趨勢。',
        itemName: '項目名稱',
        maximum: '滿分',
        addItem: '新增項目',
        duplicateItems: '項目名稱不可重複。',
        classScores: '全班成績表',
        classScoresHint: '點選學生列，即可在下方查看個別分析。',
        learner: '學生',
        completion: '輸入進度',
        entered: '筆成績已輸入',
        noStudents: '請先新增學生，再輸入考試成績。',
        individualAnalysis: '個別趨勢分析',
        selectedLearner: '目前學生',
        overall: '整體得分率',
        classAverage: '班級平均',
        trend: '學習趨勢',
        improving: '進步中',
        declining: '需要關注',
        stable: '大致持平',
        first: '首次紀錄',
        strengths: '優勢項目',
        focusAreas: '優先加強',
        missingScores: '尚待補登',
        none: '目前未辨識',
        mentorComment: '導師評語',
        commentPlaceholder: '補上具體、可行動，且適合學生與家長閱讀的回饋...',
        printA4: '產生個別 A4 PDF',
        printHint: '會開啟系統列印視窗；選擇「另存為 PDF」即可，紙張已預設為 A4。',
        popupBlocked: '報告視窗遭瀏覽器阻擋，請允許彈出式視窗後重試。',
        completeRequired: '請填寫考試名稱，並保留至少一個名稱不重複的項目。',
        itemTrend: '較上次',
        classComparison: '班平均',
        score: '成績',
      };
  const students = useMemo(
    () => currentClass?.students ?? [],
    [currentClass?.students],
  );
  const exams = useMemo(
    () => currentClass?.examRecords ?? [],
    [currentClass?.examRecords],
  );
  const [draft, setDraft] = useState<ExamRecord>(() => createExamDraft(lang, 1));
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const firstExam = exams[0];
    setDraft(firstExam ? cloneExam(firstExam) : createExamDraft(lang, exams.length + 1));
    setSelectedStudentId(students[0]?.id ?? '');
    setIsDirty(false);
  }, [currentClass?.id]);

  useEffect(() => {
    if (!students.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(students[0]?.id ?? '');
    }
  }, [selectedStudentId, students]);

  useEffect(() => {
    if (isDirty) return;
    const currentStoredExam = exams.find((exam) => exam.id === draft.id);
    if (
      currentStoredExam &&
      currentStoredExam.updatedAt !== draft.updatedAt
    ) {
      setDraft(cloneExam(currentStoredExam));
      return;
    }
    if (!currentStoredExam && exams[0]) {
      setDraft(cloneExam(exams[0]));
    }
  }, [exams]);

  if (!currentClass) return null;

  const storedExam = exams.find((exam) => exam.id === draft.id);
  const isPendingSave = isDirty || !storedExam;
  const normalizedItemNames = draft.items.map((item) =>
    item.name.trim().toLocaleLowerCase()
  );
  const hasDuplicateItemNames =
    new Set(normalizedItemNames.filter(Boolean)).size !==
    normalizedItemNames.filter(Boolean).length;
  const canSave =
    Boolean(draft.title.trim()) &&
    draft.items.length > 0 &&
    draft.items.every((item) => item.name.trim() && item.maxScore > 0) &&
    !hasDuplicateItemNames;
  const allExamsForAnalysis = [
    draft,
    ...exams.filter((exam) => exam.id !== draft.id),
  ];
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ?? students[0];
  const analysis = selectedStudent
    ? computeExamStudentAnalysis(
        allExamsForAnalysis,
        draft.id,
        selectedStudent.id,
      )
    : null;
  const enteredScoreCount = students.reduce((total, student) => {
    const result = getStudentResult(draft, student.id);
    return total + draft.items.filter((item) => hasScore(result?.scores[item.id])).length;
  }, 0);
  const totalScoreCount = students.length * draft.items.length;
  const completedStudentCount = students.filter((student) => {
    const result = getStudentResult(draft, student.id);
    return draft.items.length > 0 &&
      draft.items.every((item) => hasScore(result?.scores[item.id]));
  }).length;
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

  const markDirty = (next: ExamRecord) => {
    setDraft(next);
    setIsDirty(true);
  };

  const chooseExam = (examId: string) => {
    if (examId === '__new__') {
      setDraft(createExamDraft(lang, exams.length + 1));
    } else {
      const exam = exams.find((candidate) => candidate.id === examId);
      if (!exam) return;
      setDraft(cloneExam(exam));
    }
    setSelectedStudentId(students[0]?.id ?? '');
    setIsDirty(false);
  };

  const saveDraft = () => {
    if (!canSave) {
      showToast(copy.completeRequired, 'error');
      return;
    }
    saveExamRecord({
      ...draft,
      title: draft.title.trim(),
      updatedAt: Date.now(),
    });
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
    if (!selectedStudent || !analysis || !canSave) {
      showToast(copy.completeRequired, 'error');
      return;
    }
    const reportWindow = window.open('', '_blank', 'width=920,height=1180');
    if (!reportWindow) {
      showToast(copy.popupBlocked, 'error');
      return;
    }
    saveDraft();
    reportWindow.opener = null;
    reportWindow.document.open();
    reportWindow.document.write(
      createExamReportHtml({
        className: currentClass.name,
        studentName: selectedStudent.name,
        exam: draft,
        analysis,
        lang,
      }),
    );
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.setTimeout(() => reportWindow.print(), 250);
  };

  const renderItemTags = (
    items: Array<{ itemId: string; name: string; percent: number | null }>,
    tone: 'emerald' | 'amber' | 'slate',
  ) => {
    if (items.length === 0) {
      return <span className="text-xs italic text-slate-400">{copy.none}</span>;
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
        <div className="px-5 py-14 text-center text-sm text-slate-500">
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
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
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
                onChange={(event) =>
                  markDirty({ ...draft, title: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              {copy.assessmentDate}
              <input
                type="date"
                value={draft.examDate}
                onChange={(event) =>
                  markDirty({ ...draft, examDate: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => chooseExam('__new__')}
                className="inline-flex items-center rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
              >
                <FilePlus2 className="mr-1.5 h-4 w-4" />
                {copy.newAssessment}
              </button>
              {storedExam && (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(copy.deleteConfirm)) return;
                    deleteExamRecord(draft.id);
                    const remaining = exams.filter((exam) => exam.id !== draft.id);
                    setDraft(
                      remaining[0]
                        ? cloneExam(remaining[0])
                        : createExamDraft(lang, 1),
                    );
                    setIsDirty(false);
                  }}
                  className="inline-flex items-center rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {copy.delete}
                </button>
              )}
            </div>
          </div>

          <div className="border-b border-slate-200 bg-[#f8f4ea] px-5 py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">{copy.itemSettings}</h3>
                <p className="mt-1 text-xs text-slate-500">{copy.itemSettingsHint}</p>
              </div>
              <button
                type="button"
                disabled={draft.items.length >= MAX_EXAM_ITEMS}
                onClick={() =>
                  markDirty({
                    ...draft,
                    items: [
                      ...draft.items,
                      {
                        id: createId('exam-item'),
                        name: lang === 'en'
                          ? `Item ${draft.items.length + 1}`
                          : `項目 ${draft.items.length + 1}`,
                        maxScore: 100,
                      },
                    ],
                  })
                }
                className="inline-flex items-center self-start rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {copy.addItem}
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {draft.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_76px_auto] gap-2 border-l-4 border-amber-400 bg-white p-3 shadow-sm"
                >
                  <label className="text-[11px] font-bold text-slate-500">
                    {copy.itemName}
                    <input
                      value={item.name}
                      maxLength={80}
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
                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-[11px] font-bold text-slate-500">
                    {copy.maximum}
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="0.5"
                      value={item.maxScore}
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
                            scores: hasScore(result.scores[item.id])
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
                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-sm text-slate-900"
                    />
                  </label>
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
                    className="mt-5 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25"
                  >
                    <X className="h-4 w-4" />
                  </button>
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
                <p className="mt-1 text-xs text-slate-500">{copy.classScoresHint}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-bold text-slate-600">
                  {enteredScoreCount} / {totalScoreCount} {copy.entered}
                </span>
                <span className="inline-flex items-center border-l-2 border-teal-500 bg-teal-50 px-2 py-1 font-bold text-teal-800">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  {completedStudentCount} / {students.length}
                </span>
              </div>
            </div>
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
                        <span className="font-normal text-slate-400">/ {item.maxScore}</span>
                      </th>
                    ))}
                    <th className="min-w-24 px-3 py-2 text-right">{copy.overall}</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, studentIndex) => {
                    const result = getStudentResult(draft, student.id);
                    const studentAnalysis = computeExamStudentAnalysis(
                      allExamsForAnalysis,
                      draft.id,
                      student.id,
                    );
                    const isSelected = selectedStudent?.id === student.id;
                    return (
                      <tr
                        key={student.id}
                        onClick={() => setSelectedStudentId(student.id)}
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
                        {draft.items.map((item) => (
                          <td key={item.id} className="border-r border-slate-200 px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              max={item.maxScore}
                              step="0.5"
                              value={result?.scores[item.id] ?? ''}
                              onFocus={() => setSelectedStudentId(student.id)}
                              onChange={(event) =>
                                updateScore(
                                  student.id,
                                  item.id,
                                  event.target.value,
                                  item.maxScore,
                                )
                              }
                              aria-label={`${student.name} ${item.name} ${copy.score}`}
                              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-right font-semibold tabular-nums focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-black tabular-nums text-slate-800">
                          {formatPercent(studentAnalysis?.overallPercent ?? null)}
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
              <div className="border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
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
                    onChange={(event) => setSelectedStudentId(event.target.value)}
                    className="rounded-md border border-slate-300 bg-white p-2 text-sm"
                    aria-label={copy.selectedLearner}
                  >
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>{student.name}</option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-px bg-slate-200">
                  <div className="bg-[#f8f4ea] px-3 py-3">
                    <p className="text-xs text-slate-500">{copy.overall}</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">
                      {formatPercent(analysis.overallPercent)}
                    </p>
                  </div>
                  <div className="bg-[#f8f4ea] px-3 py-3">
                    <p className="text-xs text-slate-500">{copy.classAverage}</p>
                    <p className="mt-1 text-2xl font-black text-slate-950">
                      {formatPercent(analysis.classAveragePercent)}
                    </p>
                  </div>
                  <div className="bg-[#f8f4ea] px-3 py-3">
                    <p className="text-xs text-slate-500">{copy.trend}</p>
                    <p className={`mt-1 flex items-center text-base font-black ${trendTone}`}>
                      <TrendIcon className="mr-1.5 h-4 w-4" />
                      {copy[analysis.trend]}
                    </p>
                    <p className="mt-1 text-xs font-bold tabular-nums text-slate-500">
                      {formatDelta(analysis.trendDelta)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden border border-slate-200">
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
                        {formatPercent(item.percent)}
                      </span>
                      <span className="text-right tabular-nums text-slate-500">
                        {formatPercent(item.classAveragePercent)}
                      </span>
                      <span className={`text-right font-bold tabular-nums ${
                        item.trendDelta != null && item.trendDelta < -3
                          ? 'text-rose-700'
                          : item.trendDelta != null && item.trendDelta >= 3
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                      }`}>
                        {formatDelta(item.trendDelta)}
                      </span>
                    </div>
                  ))}
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

              <div className="bg-[#f8f4ea] p-5">
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
                  onChange={(event) =>
                    updateComment(selectedStudent.id, event.target.value)
                  }
                  placeholder={copy.commentPlaceholder}
                  className="mt-3 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                />
                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={!canSave}
                    className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {copy.save}
                  </button>
                  <button
                    type="button"
                    onClick={printReport}
                    disabled={!canSave}
                    className="inline-flex items-center justify-center rounded-md bg-teal-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-600 disabled:bg-slate-300"
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    {copy.printA4}
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">{copy.printHint}</p>
                <div className={`mt-4 flex items-center text-xs font-bold ${
                  isPendingSave ? 'text-amber-700' : 'text-emerald-700'
                }`}>
                  {isPendingSave
                    ? <AlertTriangle className="mr-1.5 h-4 w-4" />
                    : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  {isPendingSave ? copy.unsaved : copy.saved}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
