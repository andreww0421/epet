import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTodayOverview } from '../src/features/teacher-console/model/todayOverview';
import { TODAY_QUICK_ACTIONS } from '../src/features/teacher-console/model/todayActions';
import { createDashboardStudent } from '../src/features/students/model/createDashboardStudent';
import type { ClassData } from '../src/store/types';
import type { LearningEvidenceRecord } from '../shared/education';

const now = Date.parse('2026-10-03T02:00:00Z');
const evidence = (id: string, studentId: string, createdAt: number, level: LearningEvidenceRecord['level'] = 'needsSupport'): LearningEvidenceRecord => ({
  id, classId: 'class', studentId, createdAt, level, competency: 'participation', evidenceType: 'observation',
  title: 'Synthetic evidence', source: 'manual', actor: 'mentor', rubricVersion: 'v1', revision: 1,
});

test('Today has six actionable entries, not a full analytics navigation menu', () => {
  assert.deepEqual(TODAY_QUICK_ACTIONS.map((item) => item.id), ['give-points', 'deduct-points', 'comment', 'evidence', 'exam', 'activity']);
  assert.equal(new Set(TODAY_QUICK_ACTIONS.map((item) => item.id)).size, 6);
});

test('Today counts active evidence and exam updates in the class calendar, excluding revisions, orphans and future activity', () => {
  const student = createDashboardStudent('Synthetic private learner', 'student');
  const oldEvidence = { ...evidence('old', student.id, now - 1_000), sourceId: 'observation-1' };
  const latestEvidence = { ...evidence('latest', student.id, now - 500, 'mastered'), sourceId: 'observation-1', revision: 2 };
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [student],
    dailyTaskCalendar: { schoolTimeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 0 },
    learningEvidenceRecords: [oldEvidence, latestEvidence, evidence('yesterday', student.id, Date.parse('2026-10-02T12:00:00Z')), evidence('orphan', 'missing', now), evidence('future', student.id, now + 1)],
    examRecords: [
      { id: 'exam', title: 'Synthetic exam', examDate: '2026-10-01', items: [], results: [], createdAt: now - 1_000, updatedAt: now },
      { id: 'future-exam', title: 'Future exam', examDate: '2026-10-04', items: [], results: [], createdAt: now + 1, updatedAt: now + 1 },
    ],
  };
  const overview = buildTodayOverview(classroom, now, 'UTC');
  assert.equal(overview.evidenceTodayCount, 1);
  assert.equal(overview.examTodayCount, 1);
  assert.equal(overview.attentionCount, 1); // Yesterday's support record is a recent, transparent reminder.
  assert.deepEqual(overview.attentionStudents[0]?.reasons, ['learning-support']);
  assert.equal(overview.recentActivity.some((item) => item.id === 'evidence-old' || item.id.includes('future') || item.id === 'evidence-orphan'), false);
});

test('Today attention reasons are deduplicated, name-free, immutable and do not diagnose low scores or pet state', () => {
  const student = createDashboardStudent('Synthetic private learner', 'student');
  const unflagged = createDashboardStudent('Synthetic second learner', 'second');
  student.pointAdjustmentRecords = [{ id: 'negative', amount: -5, source: 'manual', createdAt: now }];
  student.dailyProgress = { streak: 0, reflections: [{ id: 'mentor', author: 'mentor', date: '2026-10-03', createdAt: now, competency: 'participation', mentorAssessment: 'needsSupport' }] };
  unflagged.pet.fullness = 0;
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [student, unflagged], learningEvidenceRecords: [evidence('support', student.id, now)] };
  const original = structuredClone(classroom);
  const overview = buildTodayOverview(classroom, now, 'Asia/Taipei');
  assert.equal(overview.attentionCount, 1);
  assert.deepEqual(overview.attentionStudents[0], { studentId: student.id, reasons: ['learning-support', 'mentor-support', 'negative-feedback'] });
  assert.equal(JSON.stringify(overview).includes(student.name), false);
  assert.deepEqual(classroom, original);
  assert.equal(overview.negativeFeedbackAlert, null); // One event is not a concentration alert.
});

test('negative concentration uses the existing teacher feedback ratio and excludes automated task and support rewards', () => {
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.pointAdjustmentRecords = Array.from({ length: 3 }, (_, index) => ({ id: `negative-${index}`, amount: -1, source: 'manual' as const, createdAt: now }));
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [student] };
  const concentrated = buildTodayOverview(classroom, now, 'Asia/Taipei');
  assert.deepEqual(concentrated.negativeFeedbackAlert?.concentratedStudents, [{ studentId: student.id, count: 3 }]);
  student.pointAdjustmentRecords.push({ id: 'task', amount: 100, source: 'dailyTask', createdAt: now });
  student.pointAdjustmentRecords.push({ id: 'support', amount: 10, source: 'participationTopUp', createdAt: now });
  const ignored = buildTodayOverview(classroom, now, 'Asia/Taipei');
  assert.equal(ignored.negativeFeedbackAlert?.negativeCount, 3);
  assert.equal(ignored.negativeFeedbackAlert?.positiveCount, 0);
  for (let index = 0; index < 3; index += 1) student.pointAdjustmentRecords.push({ id: `positive-${index}`, amount: 1, source: 'manual', createdAt: now });
  assert.equal(buildTodayOverview(classroom, now, 'Asia/Taipei').negativeFeedbackAlert !== null, true);
  const settings = { decayAmount: 2, decayType: 'hourly' as const, positiveFeedbackRatioTarget: 1 };
  assert.equal(buildTodayOverview(classroom, now, 'Asia/Taipei', settings).negativeFeedbackAlert, null);
});

test('negative feedback distributed across learners does not imply concentration', () => {
  const students = Array.from({ length: 4 }, (_, index) => {
    const student = createDashboardStudent('Synthetic learner', `student-${index}`);
    student.pointAdjustmentRecords = [{ id: `negative-${index}`, amount: -1, source: 'manual', createdAt: now }];
    return student;
  });
  const overview = buildTodayOverview({ id: 'class', name: 'Synthetic class', students }, now, 'Asia/Taipei');
  assert.equal(overview.attentionCount, 4);
  assert.equal(overview.negativeFeedbackAlert, null);
});

test('future, stale and student-authored support reflections do not create mentor attention alerts', () => {
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.dailyProgress = { streak: 0, reflections: [
    { id: 'future', author: 'mentor', date: '2026-10-03', createdAt: now + 1, competency: 'participation', mentorAssessment: 'needsSupport' },
    { id: 'stale', author: 'mentor', date: '2026-09-01', createdAt: now - 8 * 86_400_000, competency: 'participation', mentorAssessment: 'needsSupport' },
    { id: 'self', author: 'student', date: '2026-10-03', createdAt: now, competency: 'participation', selfAssessment: 'needsSupport' },
  ] };
  const overview = buildTodayOverview({ id: 'class', name: 'Synthetic class', students: [student] }, now);
  assert.equal(overview.attentionCount, 0);
  assert.equal(overview.feedbackPending, 1);
});

test('future teacher point records cannot create a present attention or concentration alert', () => {
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.pointAdjustmentRecords = Array.from({ length: 3 }, (_, index) => ({ id: `future-${index}`, source: 'manual', amount: -1, createdAt: now + 1 }));
  const overview = buildTodayOverview({ id: 'class', name: 'Synthetic class', students: [student] }, now, 'Asia/Taipei');
  assert.equal(overview.attentionCount, 0);
  assert.equal(overview.negativeFeedbackAlert, null);
  assert.deepEqual(overview.recentActivity, []);
});

test('Today includes penalties in the five newest activities without mutating existing records', () => {
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.disciplineRecords = [
    { id: 'older-warning', type: 'warning', createdAt: now - 600 },
    { id: 'latest-penalty', type: 'discipline', createdAt: now - 10 },
  ];
  student.pointAdjustmentRecords = [20, 30, 40].map((age) => ({
    id: `point-${age}`, source: 'manual' as const, amount: 1, createdAt: now - age,
  }));
  student.dailyProgress = { streak: 0, reflections: [{
    id: 'comment', author: 'mentor', date: '2026-10-03', createdAt: now - 50,
    competency: 'participation', mentorAssessment: 'progressing',
  }] };
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [student],
    learningEvidenceRecords: [evidence('older-evidence', student.id, now - 60, 'progressing')],
  };
  const original = structuredClone(classroom);
  const overview = buildTodayOverview(classroom, now, 'Asia/Taipei');
  assert.deepEqual(overview.recentActivity.map((activity) => activity.id), [
    'discipline-latest-penalty', 'points-point-20', 'points-point-30', 'points-point-40', 'feedback-comment',
  ]);
  assert.deepEqual(overview.recentActivity[0], {
    id: 'discipline-latest-penalty', createdAt: now - 10, kind: 'discipline', destination: 'records',
  });
  assert.equal(overview.recentActivity.length, 5);
  assert.deepEqual(classroom, original);
});

test('Today keeps global fairness dates separate from the class daily calendar across a timezone boundary', () => {
  const boundaryNow = Date.parse('2026-10-03T01:00:00Z');
  const previousUtcDay = Date.parse('2026-10-02T23:30:00Z');
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.pointAdjustmentRecords = Array.from({ length: 3 }, (_, index) => ({
    id: `previous-utc-negative-${index}`, source: 'manual' as const, amount: -1, createdAt: previousUtcDay,
  }));
  student.dailyProgress = { streak: 0, reflections: [{
    id: 'class-calendar-comment', author: 'mentor', date: '2026-10-03', createdAt: previousUtcDay,
    competency: 'participation', mentorAssessment: 'progressing',
  }] };
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [student],
    dailyTaskCalendar: { schoolTimeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 0 },
    learningEvidenceRecords: [evidence('class-calendar-evidence', student.id, previousUtcDay, 'mastered')],
    examRecords: [{ id: 'class-calendar-exam', title: 'Synthetic exam', examDate: '2026-10-03',
      items: [], results: [], createdAt: previousUtcDay, updatedAt: previousUtcDay }],
  };
  const globalUtc = buildTodayOverview(classroom, boundaryNow, 'UTC');
  assert.equal(globalUtc.evidenceTodayCount, 1);
  assert.equal(globalUtc.examTodayCount, 1);
  assert.equal(globalUtc.feedbackPending, 0);
  assert.equal(globalUtc.attentionCount, 0);
  assert.equal(globalUtc.negativeFeedbackAlert, null);

  student.pointAdjustmentRecords.push(...Array.from({ length: 3 }, (_, index) => ({
    id: `current-utc-negative-${index}`, source: 'manual' as const, amount: -1, createdAt: boundaryNow - 1_000,
  })));
  assert.equal(buildTodayOverview(classroom, boundaryNow, 'UTC').negativeFeedbackAlert?.negativeCount, 3);
  assert.equal(buildTodayOverview(classroom, boundaryNow, 'Asia/Taipei').negativeFeedbackAlert?.negativeCount, 6);
});

test('a refreshed Today cutoff immediately includes newly saved points, comments, evidence and exams', () => {
  const student = createDashboardStudent('Synthetic learner', 'student');
  student.pointAdjustmentRecords = [{ id: 'new-point', source: 'manual', amount: -1, createdAt: now + 1_000 }];
  student.dailyProgress = { streak: 0, reflections: [{
    id: 'new-comment', author: 'mentor', date: '2026-10-03', createdAt: now + 2_000,
    competency: 'participation', mentorAssessment: 'progressing',
  }] };
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [student],
    learningEvidenceRecords: [evidence('new-evidence', student.id, now + 3_000)],
    examRecords: [{ id: 'new-exam', title: 'Synthetic exam', examDate: '2026-10-03', items: [], results: [],
      createdAt: now + 4_000, updatedAt: now + 4_000 }],
  };
  const beforeSave = buildTodayOverview(classroom, now, 'Asia/Taipei');
  assert.equal(beforeSave.evidenceTodayCount, 0);
  assert.equal(beforeSave.examTodayCount, 0);
  assert.equal(beforeSave.feedbackPending, 1);
  assert.equal(beforeSave.attentionCount, 0);
  assert.deepEqual(beforeSave.recentActivity, []);

  const afterSave = buildTodayOverview(classroom, now + 5_000, 'Asia/Taipei');
  assert.equal(afterSave.evidenceTodayCount, 1);
  assert.equal(afterSave.examTodayCount, 1);
  assert.equal(afterSave.feedbackPending, 0);
  assert.deepEqual(afterSave.attentionStudents, [{ studentId: student.id, reasons: ['learning-support', 'negative-feedback'] }]);
  assert.deepEqual(afterSave.recentActivity.map((activity) => activity.id), [
    'exam-new-exam', 'evidence-new-evidence', 'feedback-new-comment', 'points-new-point',
  ]);
});
