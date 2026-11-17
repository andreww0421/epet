import type { StateCreator } from 'zustand';
import type { ClassGoal, DailyReflection, LearningEvidenceRecord } from '../types';
import type { StoreState } from '../storeTypes';
import { normalizeClassDailyTaskCalendar } from '../utils';
import { translations } from '../constants';
import { normalizeExamRecords } from '../../examAnalytics';
import { createLearningEvidenceRecord, createMentorFeedbackEvidenceRecord } from '../../../shared/education';
import { findActiveClassIndex } from '../../../shared/domain/classArchive';
import { getActiveClassGoals, getWeekStartDate, toFiniteNumber, isDateKey, normalizeDateKeyList,
  saveMentorDailyFeedbackForStudent, getDateKey } from '../../gameRules';
import { beginProductWorkflow } from '../../analytics/workflows';
import { recordProductWorkflowCommandResult } from '../../services/productWorkflowPersistence';
import { trackAnalytics } from '../../analytics';

export type LearningSlice = Pick<StoreState,
  | 'updateClassDailyTaskCalendar' | 'setClassGoal' | 'saveExamRecord' | 'deleteExamRecord'
  | 'setDailyTaskExcusedDate' | 'saveMentorDailyFeedback' | 'addLearningEvidence'>;

const MAX_LEARNING_EVIDENCE_RECORDS = 2000;

const syncMentorFeedbackEvidence = (
  records: LearningEvidenceRecord[],
  classId: string,
  studentId: string,
  reflection: DailyReflection,
) => [
  createMentorFeedbackEvidenceRecord(
    classId,
    studentId,
    {
      id: reflection.id,
      competency: reflection.competency,
      assessment: reflection.mentorAssessment,
      text: reflection.text,
      createdAt: reflection.createdAt,
    },
    records,
  ),
  ...records,
].slice(0, MAX_LEARNING_EVIDENCE_RECORDS);

/** Learning actions share the root data reference and persistence boundary.
 * Domain calculations and analytics ordering are preserved by this composition.
 */
export const createLearningSlice: StateCreator<StoreState, [], [], LearningSlice> = (set, get) => ({
  updateClassDailyTaskCalendar: (classId, calendar) => set((state) => {
    const currentClassIndex = findActiveClassIndex(state.data, classId);
    if (currentClassIndex === -1) return state;
    const nextClasses = [...state.data.classes];
    nextClasses[currentClassIndex] = {
      ...nextClasses[currentClassIndex],
      dailyTaskCalendar: normalizeClassDailyTaskCalendar(
        calendar,
        state.data.settings,
      ),
    };
    return { data: { ...state.data, classes: nextClasses } };
  }),

  setClassGoal: (goal, goalId) => set((state) => {
    const currentClassIndex = findActiveClassIndex(state.data);
    if (currentClassIndex === -1) return state;

    const now = Date.now();
    const nextClasses = [...state.data.classes];
    const currentGoals = nextClasses[currentClassIndex].classGoals ?? [];
    const schoolTimeZone = state.data.settings?.schoolTimeZone;
    const currentWeekStart = getWeekStartDate(now, schoolTimeZone);
    const activeGoals = getActiveClassGoals(currentGoals, now, schoolTimeZone);
    const currentGoal = goalId
      ? currentGoals.find((existingGoal) => existingGoal.id === goalId)
      : undefined;
    const canKeepProgress = currentGoal?.competency === goal?.competency;
    let nextGoals: ClassGoal[];

    if (!goal) {
      nextGoals = goalId
        ? currentGoals.filter((existingGoal) => existingGoal.id !== goalId)
        : currentGoals.filter((existingGoal) => !activeGoals.includes(existingGoal));
    } else {
      const nextGoal: ClassGoal = {
        id: currentGoal?.id ?? `goal-${now}-${currentGoals.length}`,
        title: goal.title.trim(),
        competency: goal.competency,
        targetCount: Math.max(1, Math.floor(toFiniteNumber(goal.targetCount, 10))),
        createdAt: canKeepProgress && currentGoal ? currentGoal.createdAt : now,
        weekStartDate: currentGoal?.weekStartDate ?? currentWeekStart,
      };

      if (currentGoal) {
        nextGoals = currentGoals.map((existingGoal) =>
          existingGoal.id === currentGoal.id ? nextGoal : existingGoal,
        );
      } else {
        if (activeGoals.length >= 3) {
          get().showToast(
            translations[state.data.settings?.language || 'zh'].classGoalLimitReached,
            'error',
          );
          return state;
        }
        nextGoals = [...currentGoals, nextGoal].slice(-156);
      }
    }

    nextClasses[currentClassIndex] = {
      ...nextClasses[currentClassIndex],
      classGoals: nextGoals,
    };
    const tLang = translations[state.data.settings?.language || 'zh'];
    get().showToast(goal ? tLang.classGoalSaved : tLang.classGoalCleared, 'success');
    return { data: { ...state.data, classes: nextClasses } };
  }),

  saveExamRecord: (exam) => {
    const workflowBefore = get().data;
    const existingExam = workflowBefore.classes.find((item) => item.id === workflowBefore.currentClassId)
      ?.examRecords?.some((item) => item.id === exam.id);
    const workflow = existingExam ? null : beginProductWorkflow('exam_create');
    let created = false;
    set((state) => {
      const currentClassIndex = findActiveClassIndex(state.data);
      if (currentClassIndex === -1) return state;
      const currentClass = state.data.classes[currentClassIndex];
      const now = Date.now();
      const normalizedExam = normalizeExamRecords(
        [{ ...exam, updatedAt: now }],
        new Set(currentClass.students.map((student) => student.id)),
        now,
      )[0];
      if (!normalizedExam || normalizedExam.items.length === 0) return state;
      created = !(currentClass.examRecords ?? []).some(
        (candidate) => candidate.id === normalizedExam.id,
      );

      const nextClasses = [...state.data.classes];
      nextClasses[currentClassIndex] = {
        ...currentClass,
        examRecords: [
          normalizedExam,
          ...(currentClass.examRecords ?? []).filter(
            (candidate) => candidate.id !== normalizedExam.id,
          ),
        ].sort(
          (left, right) =>
            right.examDate.localeCompare(left.examDate) ||
            right.createdAt - left.createdAt,
        ),
      };
      const lang = state.data.settings?.language || 'zh';
      get().showToast(
        lang === 'en' ? 'Assessment saved.' : '考試成績已保存。',
        'success',
      );
      return { data: { ...state.data, classes: nextClasses } };
    });
    if (workflow) recordProductWorkflowCommandResult(workflow, workflowBefore, get().data, created);
    if (created) trackAnalytics('exam_created', {});
  },

  deleteExamRecord: (examId) => set((state) => {
    const currentClassIndex = findActiveClassIndex(state.data);
    if (currentClassIndex === -1) return state;
    const currentClass = state.data.classes[currentClassIndex];
    if (!(currentClass.examRecords ?? []).some((exam) => exam.id === examId)) {
      return state;
    }
    const nextClasses = [...state.data.classes];
    nextClasses[currentClassIndex] = {
      ...currentClass,
      examRecords: (currentClass.examRecords ?? []).filter(
        (exam) => exam.id !== examId,
      ),
    };
    const lang = state.data.settings?.language || 'zh';
    get().showToast(
      lang === 'en' ? 'Assessment deleted.' : '考試紀錄已刪除。',
      'success',
    );
    return { data: { ...state.data, classes: nextClasses } };
  }),

  setDailyTaskExcusedDate: (studentId, date, excused) => set((state) => {
    if (!isDateKey(date)) return state;
    const currentClassIndex = findActiveClassIndex(state.data);
    if (currentClassIndex === -1) return state;
    const nextClasses = [...state.data.classes];
    let changed = false;
    nextClasses[currentClassIndex] = {
      ...nextClasses[currentClassIndex],
      students: nextClasses[currentClassIndex].students.map((student) => {
        if (student.id !== studentId) return student;
        const currentDates = normalizeDateKeyList(student.dailyProgress?.excusedDates, 120);
        const nextDates = excused
          ? normalizeDateKeyList([...currentDates, date], 120)
          : currentDates.filter((item) => item !== date);
        if (nextDates.length === currentDates.length &&
            nextDates.every((item, index) => item === currentDates[index])) {
          return student;
        }
        changed = true;
        return {
          ...student,
          dailyProgress: {
            lastClaimDate: student.dailyProgress?.lastClaimDate,
            streak: student.dailyProgress?.streak ?? 0,
            reflections: student.dailyProgress?.reflections,
            excusedDates: nextDates,
          },
        };
      }),
    };
    if (!changed) return state;
    const tLang = translations[state.data.settings?.language || 'zh'];
    get().showToast(tLang.dailyTaskExcusedUpdated ?? '學生請假日已更新', 'success');
    return { data: { ...state.data, classes: nextClasses } };
  }),

  saveMentorDailyFeedback: (studentId, feedback) => set((state) => {
    const currentClassIndex = findActiveClassIndex(state.data);
    if (currentClassIndex === -1) return state;
    const currentClass = state.data.classes[currentClassIndex];
    const targetStudent = currentClass.students.find((student) => student.id === studentId);
    if (!targetStudent) return state;

    const now = Date.now();
    const timeZone = currentClass.dailyTaskCalendar?.schoolTimeZone ??
      state.data.settings?.schoolTimeZone;
    const result = saveMentorDailyFeedbackForStudent(
      targetStudent,
      feedback,
      now,
      timeZone,
    );
    if (!result.saved) return state;
    const savedReflection = result.student.dailyProgress?.reflections?.find(
      (reflection) =>
        reflection.author === 'mentor' &&
        reflection.date === getDateKey(now, timeZone),
    );
    const currentEvidence = currentClass.learningEvidenceRecords ?? [];

    const nextClasses = [...state.data.classes];
    nextClasses[currentClassIndex] = {
      ...currentClass,
      students: currentClass.students.map((student) =>
        student.id === studentId ? result.student : student,
      ),
      learningEvidenceRecords: savedReflection
        ? syncMentorFeedbackEvidence(
            currentEvidence,
            currentClass.id,
            studentId,
            savedReflection,
          )
        : currentEvidence,
    };
    const tLang = translations[state.data.settings?.language || 'zh'];
    get().showToast(
      result.updated ? tLang.dailyFeedbackUpdated : tLang.dailyFeedbackSaved,
      'success',
    );
    return { data: { ...state.data, classes: nextClasses } };
  }),

  addLearningEvidence: (studentId, evidence) => {
    let created = false;
    set((state) => {
      const currentClassIndex = findActiveClassIndex(state.data);
      if (currentClassIndex === -1 || !evidence.title.trim()) return state;
      const currentClass = state.data.classes[currentClassIndex];
      const targetStudent = currentClass.students.find((student) => student.id === studentId);
      if (!targetStudent) return state;

      const now = Date.now();
      const record = createLearningEvidenceRecord(
        currentClass.id,
        studentId,
        {
          ...evidence,
          actor: 'mentor',
          source: 'manual',
          rubricVersion: evidence.rubricVersion ?? '1.0',
        },
        now,
      );
      const nextClasses = [...state.data.classes];
      nextClasses[currentClassIndex] = {
        ...currentClass,
        learningEvidenceRecords: [
          record,
          ...(currentClass.learningEvidenceRecords ?? []),
        ].slice(0, MAX_LEARNING_EVIDENCE_RECORDS),
      };
      const lang = state.data.settings?.language || 'zh';
      get().showToast(translations[lang].learningEvidenceSaved, 'success');
      created = true;
      return { data: { ...state.data, classes: nextClasses } };
    });
    if (created) trackAnalytics('learning_evidence_created', {});
  },
});
