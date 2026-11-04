import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AREA_LABELS, CONSOLE_DESTINATIONS, PRIMARY_AREAS, canOpenDestination,
  getAreaDestinations, getAreaLabel, getAreaTaskDestinations, getAreaAnalysisDestinations,
  isAnalysisDestination, getDestination, resolveDestination,
} from '../src/features/teacher-console/model/navigation';
import { buildTodayOverview } from '../src/features/teacher-console/model/todayOverview';
import { createDashboardStudent } from '../src/features/students/model/createDashboardStudent';
import type { ClassData } from '../src/store/types';

const owner = { readOnly: false, canAdministerWorkspace: true };
const teacher = { readOnly: false, canAdministerWorkspace: false };
const viewer = { readOnly: true, canAdministerWorkspace: false };

test('four task areas are primary and administrator settings stays secondary, preserving every destination', () => {
  assert.deepEqual(PRIMARY_AREAS.map((area) => AREA_LABELS[area]), ['Today', 'Class', 'Learning', 'Activities']);
  assert.deepEqual(PRIMARY_AREAS.map((area) => getAreaLabel(area, 'zh')), ['首頁', '班級', '教學', '活動']);
  assert.equal(getAreaLabel('settings', 'zh'), '管理設定');
  assert.equal(getAreaLabel('settings', 'en'), 'Settings');
  assert.equal(getDestination('points').label.zh, '加減分');
  assert.equal(CONSOLE_DESTINATIONS.length, 23);
  assert.equal(new Set(CONSOLE_DESTINATIONS.map((item) => item.id)).size, CONSOLE_DESTINATIONS.length);
  const mapping = {
    class: ['students', 'groups', 'points', 'comments', 'records', 'student-insights', 'class-insights'],
    learning: ['evidence', 'exams', 'goals', 'reports', 'trends'],
    activities: ['pets', 'boss', 'battle', 'activity-rewards', 'leaderboard'],
    settings: ['rules', 'reward-settings', 'workspace', 'security', 'governance'],
  } as const;
  for (const area of Object.keys(mapping) as (keyof typeof mapping)[]) {
    assert.deepEqual(getAreaDestinations(area, owner).map((item) => item.id), mapping[area]);
  }
  for (const item of CONSOLE_DESTINATIONS) {
    assert.ok(item.label.zh && item.label.en);
    assert.equal(getDestination(item.id), item);
  }
});

test('analysis entries are scoped to their workflow without duplicating work destinations or changing identity', () => {
  assert.deepEqual(getAreaTaskDestinations('class', owner).map((item) => item.id), ['students', 'groups', 'points', 'comments', 'records']);
  assert.deepEqual(getAreaAnalysisDestinations('class', owner).map((item) => item.id), ['student-insights', 'class-insights']);
  assert.deepEqual(getAreaTaskDestinations('learning', owner).map((item) => item.id), ['evidence', 'exams', 'goals', 'reports']);
  assert.deepEqual(getAreaAnalysisDestinations('learning', owner).map((item) => item.id), ['trends']);
  for (const area of PRIMARY_AREAS) {
    const work = getAreaTaskDestinations(area, owner);
    const analysis = getAreaAnalysisDestinations(area, owner);
    assert.deepEqual([...work, ...analysis], getAreaDestinations(area, owner));
    assert.ok(work.every((item) => !isAnalysisDestination(item.id)));
    assert.ok(analysis.every((item) => isAnalysisDestination(item.id)));
  }
});

test('navigation capability filtering never exposes write or administrator destinations to viewers', () => {
  assert.deepEqual(getAreaDestinations('class', viewer).map((item) => item.id), ['records', 'student-insights', 'class-insights']);
  assert.deepEqual(getAreaDestinations('learning', viewer).map((item) => item.id), ['exams', 'reports', 'trends']);
  assert.deepEqual(getAreaTaskDestinations('class', viewer).map((item) => item.id), ['records']);
  assert.deepEqual(getAreaAnalysisDestinations('class', viewer).map((item) => item.id), ['student-insights', 'class-insights']);
  assert.equal(getAreaDestinations('activities', viewer).length, 0);
  assert.equal(getAreaDestinations('settings', viewer).length, 0);
  assert.equal(getAreaDestinations('settings', teacher).length, 0);
  assert.equal(getAreaDestinations('activities', teacher).length, 5);
  assert.equal(resolveDestination('rules', teacher), 'today');
  assert.equal(resolveDestination('comments', viewer), 'today');
  assert.equal(resolveDestination('student-insights', viewer), 'student-insights');
  assert.equal(canOpenDestination('governance', { readOnly: true, canAdministerWorkspace: true }), false);
});

test('Today uses school timezone and canonical mentor feedback rather than student self-reflection', () => {
  const ada = createDashboardStudent('Synthetic Ada', 'ada');
  const grace = createDashboardStudent('Synthetic Grace', 'grace');
  ada.dailyProgress = { streak: 0, reflections: [{ id: 'mentor', date: '2026-10-02', createdAt: 1, competency: 'participation', author: 'mentor' }] };
  grace.dailyProgress = { streak: 0, reflections: [{ id: 'self', date: '2026-10-02', createdAt: 2, competency: 'participation', author: 'student' }] };
  const classroom: ClassData = { id: 'class', name: 'Synthetic class', students: [ada, grace] };
  const now = Date.parse('2026-10-01T18:00:00Z');
  assert.equal(buildTodayOverview(classroom, now, 'Asia/Taipei').feedbackPending, 1);
  assert.equal(buildTodayOverview(classroom, now, 'UTC').feedbackPending, 2);
  classroom.dailyTaskCalendar = { schoolTimeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 0 };
  assert.equal(buildTodayOverview(classroom, now, 'UTC').feedbackPending, 1);
});

test('Today merges bounded recent activity without student PII or mutation and respects active boss state', () => {
  const student = createDashboardStudent('Synthetic private name', 'student');
  student.pointAdjustmentRecords = Array.from({ length: 8 }, (_, index) => ({ id: `point-${index}`, createdAt: index, amount: 1, source: 'manual' }));
  const classroom: ClassData = {
    id: 'class', name: 'Synthetic class', students: [student],
    activeBoss: { id: 'boss', name: 'Synthetic boss', maxHp: 100, currentHp: 50, rewardTiers: [], contributions: {}, isActive: true },
    examRecords: [{ id: 'exam', title: 'Synthetic exam', examDate: '2026-10-02', items: [], results: [], createdAt: 8, updatedAt: 10 }],
  };
  const before = structuredClone(classroom);
  const overview = buildTodayOverview(classroom, Date.parse('2026-10-02T00:00:00Z'));
  assert.equal(overview.activeBoss, true);
  assert.equal(overview.recentActivity.length, 5);
  assert.equal(overview.recentActivity[0]?.kind, 'exam');
  assert.deepEqual(overview.recentActivity.map((item) => item.createdAt), [10, 7, 6, 5, 4]);
  assert.equal(JSON.stringify(overview).includes(student.name), false);
  assert.deepEqual(classroom, before);
  classroom.activeBoss!.isActive = false;
  assert.equal(buildTodayOverview(classroom, 1).activeBoss, false);
  const empty = buildTodayOverview(undefined, 1);
  assert.equal(empty.studentCount, 0);
  assert.equal(empty.feedbackPending, 0);
  assert.deepEqual(empty.recentActivity, []);
});

test('Today weekly goals retain global calendar while class daily feedback uses its own calendar', () => {
  const classroom: ClassData = {
    id: 'class', name: 'Synthetic class', students: [],
    dailyTaskCalendar: { schoolTimeZone: 'Asia/Taipei', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 0 },
    classGoals: [{ id: 'goal', title: 'Synthetic goal', competency: 'participation', targetCount: 2, createdAt: 1, weekStartDate: '2026-09-28' }],
  };
  // Sunday UTC, Monday in the class calendar: the existing goal editor still uses UTC here.
  const now = Date.parse('2026-10-04T18:00:00Z');
  assert.equal(buildTodayOverview(classroom, now, 'UTC').activeGoalCount, 1);
  assert.equal(buildTodayOverview(classroom, now, 'Asia/Taipei').activeGoalCount, 0);
});
