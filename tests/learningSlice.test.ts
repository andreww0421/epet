import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { configureAnalytics, type AnalyticsEvent } from '../src/analytics';
import { configureProductWorkflows, setProductWorkflowScope } from '../src/analytics/workflows';
import { captureProductWorkflowSave } from '../src/services/productWorkflowPersistence';
import { getActiveLearningEvidence } from '../shared/education';
import type { ProductAnalyticsWorkflowEvent } from '../shared/productAnalytics/schema';
import type { AppData, ClassDailyTaskCalendar, ExamRecord, LearningEvidenceInput } from '../src/store/types';
import { normalizeAppData } from '../src/store/utils';
import { getStoreSessionGeneration, resetStoreForSession, useStore } from '../src/store/useStore';

const NOW = Date.parse('2026-11-17T02:00:00Z');
const originalToast = useStore.getState().showToast;
const calendar: ClassDailyTaskCalendar = {
  schoolTimeZone: 'UTC', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 7,
};
const evidence: LearningEvidenceInput = {
  competency: 'growth', level: 'progressing', evidenceType: 'observation',
  title: 'Synthetic observation', note: 'Synthetic private learning note',
};
const exam = (id = 'exam-one'): ExamRecord => ({
  id, title: `Synthetic ${id}`, examDate: '2026-11-17',
  items: [{ id: 'reading', name: 'Reading', maxScore: 100 }],
  results: [{ studentId: '100', scores: { reading: 73 }, mentorComment: 'Synthetic feedback', updatedAt: NOW - 1 }],
  createdAt: NOW - 1, updatedAt: NOW - 1,
});
const fixture = (): AppData => normalizeAppData({
  lastOpened: NOW, currentClassId: 'A',
  settings: { language: 'en', schoolTimeZone: 'UTC', decayAmount: 0,
    pointGuardrailsEnabled: false, participationSupportEnabled: false },
  classes: ['A', 'B', 'archived'].map((id, index) => ({
    id, name: `Synthetic class ${id}`, ...(id === 'archived' ? { archivedAt: NOW - 100 } : {}),
    students: [{ id: '100', name: index === 0 ? 'Synthetic Alice' : 'Synthetic Bob',
      points: 200 + index, rankPoints: 40 + index,
      pet: { type: 'cat', level: 3, fullness: 90, happiness: 85 },
      stats: { wins: 2, losses: 1 },
      dailyProgress: { streak: 4, excusedDates: ['2026-11-17'] } }],
    dailyTaskCalendar: calendar, classGoals: [], examRecords: [], learningEvidenceRecords: [],
  })),
}, NOW);

const setup = (t: TestContext) => {
  t.mock.method(Date, 'now', () => NOW);
  resetStoreForSession(NOW);
  useStore.setState({ data: fixture(), showToast: () => undefined });
  const dataChanges: AppData[] = [];
  const stop = useStore.subscribe((next, previous) => {
    if (next.data !== previous.data) dataChanges.push(next.data);
  });
  t.after(() => {
    stop();
    resetStoreForSession(NOW);
    useStore.setState({ showToast: originalToast });
  });
  return dataChanges;
};

test('learning actions retain the public root surface and the single data-only persist boundary', (t) => {
  setup(t);
  const state = useStore.getState();
  for (const key of ['updateClassDailyTaskCalendar', 'setClassGoal', 'saveExamRecord', 'deleteExamRecord',
    'setDailyTaskExcusedDate', 'saveMentorDailyFeedback', 'addLearningEvidence'] as const) {
    assert.equal(typeof state[key], 'function', key);
  }
  const options = useStore.persist.getOptions();
  assert.equal(options.skipHydration, true);
  assert.deepEqual(Object.keys(options.partialize!(state)), ['data']);
  assert.equal((options.partialize!(state) as { data: AppData }).data, state.data);
  const action = state.addLearningEvidence;
  const generation = getStoreSessionGeneration();
  resetStoreForSession(NOW);
  assert.equal(getStoreSessionGeneration(), generation + 1);
  assert.equal(useStore.getState().addLearningEvidence, action);
});

test('missing and archived targets remain exact no-ops for every extracted action', (t) => {
  const dataChanges = setup(t);
  for (const selected of ['missing', 'archived']) {
    useStore.setState({ data: { ...fixture(), currentClassId: selected } });
    dataChanges.length = 0;
    const before = useStore.getState().data;
    const state = useStore.getState();
    state.updateClassDailyTaskCalendar(selected, { ...calendar, schoolWeekdays: [1] });
    state.setClassGoal({ title: 'Synthetic goal', competency: 'growth', targetCount: 3 });
    state.saveExamRecord(exam());
    state.deleteExamRecord('exam-one');
    state.setDailyTaskExcusedDate('100', '2026-11-18', true);
    state.saveMentorDailyFeedback('100', { text: 'Synthetic feedback', competency: 'growth', assessment: 'progressing' });
    state.addLearningEvidence('100', evidence);
    assert.equal(useStore.getState().data, before, selected);
    assert.equal(dataChanges.length, 0, 'no-op must not queue Autosave');
  }
});

test('invalid inputs and unchanged excused dates do not create data notifications', (t) => {
  const dataChanges = setup(t);
  const before = useStore.getState().data;
  const state = useStore.getState();
  state.addLearningEvidence('missing', evidence);
  state.addLearningEvidence('100', { ...evidence, title: '  ' });
  state.saveMentorDailyFeedback('100', { text: ' ', competency: 'growth', assessment: 'progressing' });
  state.saveMentorDailyFeedback('missing', { text: 'Synthetic feedback', competency: 'growth', assessment: 'progressing' });
  state.saveExamRecord({ ...exam(), items: [] });
  state.deleteExamRecord('missing');
  state.setDailyTaskExcusedDate('100', 'not-a-date', true);
  state.setDailyTaskExcusedDate('missing', '2026-11-18', true);
  state.setDailyTaskExcusedDate('100', '2026-11-17', true);
  assert.equal(useStore.getState().data, before);
  assert.equal(dataChanges.length, 0);
});

test('learning writes retain unrelated class and student identity despite repeated Student IDs', (t) => {
  const dataChanges = setup(t);
  const before = useStore.getState().data;
  const student = before.classes[0].students[0];
  useStore.getState().addLearningEvidence('100', evidence);
  const after = useStore.getState().data;
  assert.equal(dataChanges.length, 1, 'one accepted change is one data notification');
  assert.notEqual(after, before);
  assert.notEqual(after.classes[0], before.classes[0]);
  assert.equal(after.classes[0].students[0], student);
  assert.equal(after.classes[1], before.classes[1]);
  assert.equal(after.classes[2], before.classes[2]);
  assert.equal(after.classes[0].learningEvidenceRecords?.[0].classId, 'A');
  assert.equal(after.classes[1].learningEvidenceRecords?.length, 0);
  assert.equal(after.classes[0].students[0].points, 200);
});

test('daily feedback retains immutable evidence revisions and does not change game state or Class B', (t) => {
  const dataChanges = setup(t);
  const before = useStore.getState().data;
  useStore.getState().saveMentorDailyFeedback('100', {
    text: 'Synthetic first feedback', competency: 'growth', assessment: 'progressing',
  });
  const first = useStore.getState().data.classes[0];
  const originalEvidence = first.learningEvidenceRecords![0];
  const originalJson = JSON.stringify(originalEvidence);
  useStore.getState().saveMentorDailyFeedback('100', {
    text: 'Synthetic updated feedback', competency: 'growth', assessment: 'confident',
  });
  const after = useStore.getState().data;
  const records = after.classes[0].learningEvidenceRecords!;
  assert.equal(dataChanges.length, 2);
  assert.equal(records.length, 2);
  assert.equal(records[0].revision, 2);
  assert.equal(records[1], originalEvidence);
  assert.equal(JSON.stringify(records[1]), originalJson);
  assert.equal(records[0].sourceId, records[1].sourceId);
  assert.equal(getActiveLearningEvidence(records).length, 1);
  assert.equal(after.classes[0].students[0].dailyProgress?.reflections?.length, 1);
  assert.equal(after.classes[0].students[0].dailyProgress?.reflections?.[0].text, 'Synthetic updated feedback');
  assert.equal(after.classes[0].students[0].pet, before.classes[0].students[0].pet);
  assert.equal(after.classes[0].students[0].points, before.classes[0].students[0].points);
  assert.equal(after.classes[1], before.classes[1]);
});

test('explicit calendar updates target their class while goal limits and progress semantics remain unchanged', (t) => {
  const dataChanges = setup(t);
  const initial = useStore.getState().data;
  useStore.getState().updateClassDailyTaskCalendar('B', { ...calendar, schoolWeekdays: [2, 4] });
  assert.equal(useStore.getState().data.classes[0], initial.classes[0]);
  assert.deepEqual(useStore.getState().data.classes[1].dailyTaskCalendar?.schoolWeekdays, [2, 4]);
  const other = useStore.getState().data.classes[1];
  useStore.getState().setClassGoal({ title: ' First goal ', competency: 'growth', targetCount: 2 });
  const first = useStore.getState().data.classes[0].classGoals![0];
  assert.equal(first.title, 'First goal');
  useStore.getState().setClassGoal({ title: 'Renamed goal', competency: 'growth', targetCount: 3 }, first.id);
  const updated = useStore.getState().data.classes[0].classGoals![0];
  assert.equal(updated.id, first.id);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.weekStartDate, first.weekStartDate);
  useStore.getState().setClassGoal({ title: 'Second goal', competency: 'participation', targetCount: 2 });
  useStore.getState().setClassGoal({ title: 'Third goal', competency: 'selfManagement', targetCount: 2 });
  const atLimit = useStore.getState().data;
  const notifications = dataChanges.length;
  useStore.getState().setClassGoal({ title: 'Rejected fourth goal', competency: 'growth', targetCount: 2 });
  assert.equal(useStore.getState().data, atLimit);
  assert.equal(dataChanges.length, notifications);
  assert.equal(useStore.getState().data.classes[1], other);
});

test('exam normalization, sorting and deletion stay class-scoped and exclude unknown students', (t) => {
  const dataChanges = setup(t);
  const initial = useStore.getState().data;
  useStore.getState().saveExamRecord({ ...exam('older'), examDate: '2026-11-16',
    results: [...exam().results, { studentId: 'not-enrolled', scores: { reading: 100 }, updatedAt: NOW }] });
  useStore.getState().saveExamRecord(exam('newer'));
  const exams = useStore.getState().data.classes[0].examRecords!;
  assert.deepEqual(exams.map(record => record.id), ['newer', 'older']);
  assert.deepEqual(exams[1].results.map(result => result.studentId), ['100']);
  assert.equal(exams[0].updatedAt, NOW);
  assert.equal(useStore.getState().data.classes[1], initial.classes[1]);
  useStore.getState().deleteExamRecord('older');
  assert.equal(dataChanges.length, 3);
  assert.deepEqual(useStore.getState().data.classes[0].examRecords?.map(record => record.id), ['newer']);
});

test('exam and evidence completion follow commit; persistence acknowledgement stays separate and deduplicated', (t) => {
  setup(t);
  const usage: AnalyticsEvent[] = [];
  const workflows: ProductAnalyticsWorkflowEvent[] = [];
  const stopUsage = configureAnalytics({ enabled: true, environment: 'development', sink: event => {
    if (event.name === 'exam_created') assert.equal(useStore.getState().data.classes[0].examRecords?.length, 1);
    if (event.name === 'learning_evidence_created') assert.equal(useStore.getState().data.classes[0].learningEvidenceRecords?.length, 1);
    usage.push(event);
  } });
  const stopWorkflows = configureProductWorkflows({ enabled: true, emit: event => {
    if (event.stage === 'started') assert.equal(useStore.getState().data.classes[0].examRecords?.length, 0);
    if (event.stage === 'local_completed') assert.equal(useStore.getState().data.classes[0].examRecords?.length, 1);
    workflows.push(event);
  } });
  setProductWorkflowScope('synthetic-learning-slice-scope');
  t.after(() => { stopUsage(); stopWorkflows(); });
  useStore.getState().saveExamRecord(exam());
  useStore.getState().saveExamRecord({ ...exam(), title: 'Synthetic edit' });
  useStore.getState().addLearningEvidence('100', evidence);
  useStore.getState().addLearningEvidence('missing', evidence);
  assert.deepEqual(usage.map(event => event.name), ['exam_created', 'learning_evidence_created']);
  assert.deepEqual(workflows.map(event => event.stage), ['started', 'local_completed']);
  const receipt = captureProductWorkflowSave(useStore.getState().data);
  receipt.acknowledge(); receipt.acknowledge();
  assert.deepEqual(workflows.map(event => event.stage), ['started', 'local_completed', 'backend_acknowledged']);
  assert.ok(!JSON.stringify([...usage, ...workflows]).includes('Synthetic private learning note'));
});

test('root transient feedback does not notify the data-based autosave subscription', (t) => {
  const dataChanges = setup(t);
  const before = useStore.getState().data;
  useStore.setState({ showToast: originalToast });
  useStore.getState().showToast('Synthetic toast');
  useStore.getState().setUpgradeReward(null);
  assert.equal(useStore.getState().data, before);
  assert.equal(dataChanges.length, 0);
});
