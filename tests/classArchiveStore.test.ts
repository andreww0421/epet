import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { configureAnalytics, type AnalyticsEvent } from '../src/analytics';
import { applyFeedToStudent, applyPlayWithPet, attackWorldBoss } from '../src/gameRules';
import { resetStoreForSession, useStore } from '../src/store/useStore';
import { applyDecay } from '../src/store/utils';
import type { AppData, ClassDailyTaskCalendar, ExamRecord, Student } from '../src/store/types';

const now = Date.parse('2026-10-14T08:00:00Z');
const archivedClassId = 'synthetic-archived';
const activeClassId = 'synthetic-active';
const firstStudentId = 'synthetic-one';
const secondStudentId = 'synthetic-two';
const originalShowToast = useStore.getState().showToast;
const originalAnimation = useStore.getState().triggerPetAnimation;

const calendar: ClassDailyTaskCalendar = {
  schoolTimeZone: 'UTC', schoolWeekdays: [1, 2, 3, 4, 5], schoolHolidayDates: [], dailyTaskMakeupWindowDays: 7,
};
const exam = (): ExamRecord => ({
  id: 'retained-exam', title: 'Synthetic historical assessment', examDate: '2026-10-14',
  items: [{ id: 'item-one', name: 'Synthetic item', maxScore: 100 }],
  results: [{ studentId: firstStudentId, scores: { 'item-one': 80 }, mentorComment: 'Synthetic exam feedback', updatedAt: now }],
  createdAt: now, updatedAt: now,
});

const student = (id: string): Student => ({
  id, name: `Synthetic learner ${id}`, points: 500, rankPoints: 100,
  pet: { type: 'cat', level: 4, fullness: 100, happiness: 100 },
  stats: { wins: 2, losses: 1 }, warningPoints: 1, activeWarningTimestamps: [now - 1],
  nextUpgradeGachaLevel: 5,
  pointAdjustmentRecords: [{ id: `retained-points-${id}`, source: 'manual', amount: 5, createdAt: now - 2 }],
  disciplineRecords: [{ id: `retained-warning-${id}`, type: 'warning', createdAt: now - 1 }],
  dailyProgress: { streak: 2, reflections: [{ id: `retained-comment-${id}`, date: '2026-10-13',
    competency: 'participation', author: 'mentor', text: 'Synthetic retained feedback', createdAt: now - 100 }] },
  bossRecovery: { startedAt: now - 1, recoverAt: now + 1000, impact: 20 },
});

const fixture = (archived = true): AppData => ({
  lastOpened: now - 3_600_000, currentClassId: archivedClassId,
  settings: { language: 'en', inclusiveMode: false, decayAmount: 2, decayType: 'hourly',
    pauseDecayOnWeekends: false, petCareMode: 'death', schoolTimeZone: 'UTC', schoolWeekdays: [1, 2, 3, 4, 5],
    schoolHolidayDates: [], maxPoints: 700, feedCost: 10, feedGain: 20, playCost: 5, playGain: 15,
    pointGuardrailsEnabled: false, participationSupportEnabled: false, battleEnabled: true, battleMode: 'solo' },
  classes: [{
    id: archivedClassId, name: 'Synthetic archived class', ...(archived ? { archivedAt: now - 1000 } : {}),
    students: [student(firstStudentId), student(secondStudentId)], dailyTaskCalendar: calendar,
    classGoals: [{ id: 'retained-goal', title: 'Synthetic retained goal', competency: 'growth', targetCount: 5, createdAt: now - 1 }],
    learningEvidenceRecords: [{ id: 'retained-evidence', classId: archivedClassId, studentId: firstStudentId,
      competency: 'growth', level: 'progressing', evidenceType: 'project', title: 'Synthetic retained evidence',
      actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 1, createdAt: now - 1 }],
    examRecords: [exam()],
    activeBoss: { id: 'retained-boss', name: 'Synthetic boss', isActive: true, currentHp: 1000, maxHp: 1000,
      rewardTiers: [], contributions: { [firstStudentId]: 10 }, attackCounts: { [firstStudentId]: 1 } },
  }, { id: activeClassId, name: 'Synthetic active class', students: [student('active-one'), student('active-two')] }],
});

const setup = (t: TestContext, archived = true) => {
  t.mock.method(Date, 'now', () => now);
  resetStoreForSession(now);
  useStore.setState({ data: fixture(archived), showToast: () => undefined, triggerPetAnimation: () => undefined });
  t.after(() => {
    resetStoreForSession(now);
    useStore.setState({ showToast: originalShowToast, triggerPetAnimation: originalAnimation });
  });
};

type StoreActions = ReturnType<typeof useStore.getState>;
const attemptedMutations: Array<[string, (state: StoreActions) => unknown]> = [
  ['single points', (state) => state.addPoints(firstStudentId, 8, 'manual', { label: 'Synthetic reason' })],
  ['batch points', (state) => state.adjustPointsForStudents([firstStudentId, secondStudentId], -3)],
  ['class airdrop', (state) => state.airdropPoints(10)],
  ['student creation', (state) => state.addStudent(student('new-student'))],
  ['student import', (state) => state.addStudentsByName(['New synthetic learner'])],
  ['student deletion', (state) => state.deleteStudent(firstStudentId)],
  ['student rename', (state) => state.editStudentName(firstStudentId, 'Renamed synthetic learner')],
  ['feeding', (state) => state.feedPet(firstStudentId)],
  ['playing', (state) => state.playWithPet(firstStudentId)],
  ['pet upgrade', (state) => state.upgradePet(firstStudentId)],
  ['pet recovery', (state) => state.revivePet(firstStudentId)],
  ['pet draw', (state) => state.gachaPet(firstStudentId)],
  ['upgrade reroll', (state) => state.rerollPetFromUpgrade(firstStudentId, 5)],
  ['upgrade reward advancement', (state) => state.advanceUpgradeRewardProgress(firstStudentId, 5)],
  ['daily task claim', (state) => state.claimDailyTask(firstStudentId)],
  ['excused date', (state) => state.setDailyTaskExcusedDate(firstStudentId, '2026-10-15', true)],
  ['teacher feedback', (state) => state.saveMentorDailyFeedback(firstStudentId, { competency: 'growth', assessment: 'progressing', text: 'Synthetic new feedback' })],
  ['learning evidence', (state) => state.addLearningEvidence(firstStudentId, { competency: 'growth', level: 'mastered', evidenceType: 'project', title: 'Synthetic new evidence' })],
  ['class calendar', (state) => state.updateClassDailyTaskCalendar(archivedClassId, { ...calendar, schoolWeekdays: [1] })],
  ['goal creation', (state) => state.setClassGoal({ title: 'Synthetic new goal', competency: 'growth', targetCount: 3 })],
  ['goal removal', (state) => state.setClassGoal(null, 'retained-goal')],
  ['exam creation', (state) => state.saveExamRecord({ ...exam(), id: 'new-exam' })],
  ['exam update', (state) => state.saveExamRecord({ ...exam(), title: 'Synthetic changed exam' })],
  ['exam removal', (state) => state.deleteExamRecord('retained-exam')],
  ['warning', (state) => state.warnStudent(firstStudentId)],
  ['warning removal', (state) => state.removeWarning(firstStudentId)],
  ['discipline', (state) => state.disciplineStudent(firstStudentId, 'Synthetic formal reason')],
  ['level reduction', (state) => state.decreaseLevel(firstStudentId, 'Synthetic reduction reason')],
  ['penalty removal', (state) => state.removePenalty(firstStudentId)],
  ['season reset', (state) => state.resetSeason()],
  ['team assignment', (state) => state.setTeammate(firstStudentId, [secondStudentId])],
  ['battle', (state) => state.battle(firstStudentId, secondStudentId)],
  ['boss summon', (state) => state.summonBoss('Synthetic new boss', 50, [])],
  ['boss removal', (state) => state.removeBoss()],
  ['boss attack on pets', (state) => state.executeBossAttack()],
  ['boss recovery clearing', (state) => state.clearBossRecovery()],
  ['student boss attack', (state) => state.executeAttackBoss(firstStudentId)],
  ['local class deletion', (state) => state.deleteClass(archivedClassId)],
];

for (const [label, mutate] of attemptedMutations) {
  test(`archived class blocks ${label} even when currentClassId is forged`, async (t) => {
    setup(t);
    const before = JSON.stringify(useStore.getState().data);
    const events: AnalyticsEvent[] = [];
    const stop = configureAnalytics({ enabled: true, environment: 'development', sink: (event) => { events.push(event); } });
    t.after(stop);
    await mutate(useStore.getState());
    assert.equal(JSON.stringify(useStore.getState().data), before);
    assert.equal(useStore.getState().undoAction, null);
    assert.equal(useStore.getState().safetyUndoAction, null);
    assert.equal(useStore.getState().upgradeReward, null);
    assert.equal(useStore.getState().showBossVictory, false);
    assert.deepEqual(events, []);
  });
}

test('explicit archived calendar target is protected while another class is selected', (t) => {
  setup(t);
  useStore.setState({ data: { ...useStore.getState().data, currentClassId: activeClassId } });
  const before = JSON.stringify(useStore.getState().data);
  useStore.getState().updateClassDailyTaskCalendar(archivedClassId, { ...calendar, schoolWeekdays: [1] });
  assert.equal(JSON.stringify(useStore.getState().data), before);
  useStore.getState().updateClassDailyTaskCalendar(activeClassId, { ...calendar, schoolWeekdays: [1] });
  assert.deepEqual(useStore.getState().data.classes[1].dailyTaskCalendar?.schoolWeekdays, [1]);
});

test('settings changes do not revive archived pets or rewrite archived team assignments', (t) => {
  setup(t);
  const data = fixture();
  for (const classroom of data.classes) {
    classroom.students[0].pet.isDead = true;
    classroom.students[0].teamId = 'legacy-oversized-team';
    classroom.students[0].teammateId = 'missing-teammate';
  }
  useStore.setState({ data });
  const archived = data.classes[0];
  const before = JSON.stringify(archived);
  useStore.getState().updateSettings({ inclusiveMode: true, maxTeamSize: 2 });
  assert.equal(useStore.getState().data.classes[0], archived);
  assert.equal(JSON.stringify(useStore.getState().data.classes[0]), before);
  assert.equal(useStore.getState().data.classes[1].students[0].pet.isDead, false);
  assert.equal(useStore.getState().data.settings?.petCareMode, 'rest');
});

test('decay skips archived bytes while retaining the existing active class domain behavior', (t) => {
  setup(t);
  const data = useStore.getState().data;
  const before = JSON.stringify(data.classes[0]);
  const expected = applyDecay(data, now);
  useStore.getState().triggerDecay();
  assert.equal(JSON.stringify(useStore.getState().data.classes[0]), before);
  assert.deepEqual(useStore.getState().data.classes[1], expected.classes[1]);
  assert.notEqual(useStore.getState().data.classes[1].students[0].pet.fullness, data.classes[1].students[0].pet.fullness);
});

test('undo cannot change a class archived after the original point action', (t) => {
  setup(t, false);
  useStore.getState().addPoints(firstStudentId, 8);
  assert.ok(useStore.getState().undoAction);
  const data = useStore.getState().data;
  useStore.setState({ data: { ...data, currentClassId: activeClassId,
    classes: data.classes.map((classroom) => classroom.id === archivedClassId ? { ...classroom, archivedAt: now } : classroom) } });
  const before = JSON.stringify(useStore.getState().data);
  useStore.getState().undoLastPointAdjustment();
  assert.equal(JSON.stringify(useStore.getState().data), before);
  assert.equal(useStore.getState().undoAction, null);
});

test('safety reversal cannot change a class archived after the original discipline action', (t) => {
  setup(t, false);
  useStore.getState().disciplineStudent(firstStudentId, 'Synthetic formal reason');
  assert.ok(useStore.getState().safetyUndoAction);
  const data = useStore.getState().data;
  useStore.setState({ data: { ...data, currentClassId: activeClassId,
    classes: data.classes.map((classroom) => classroom.id === archivedClassId ? { ...classroom, archivedAt: now } : classroom) } });
  const before = JSON.stringify(useStore.getState().data);
  useStore.getState().undoLastSafetyAction();
  assert.equal(JSON.stringify(useStore.getState().data), before);
  assert.equal(useStore.getState().safetyUndoAction, null);
});

for (const defeated of [false, true]) {
  test(`boss ${defeated ? 'victory' : 'attack'} callback cannot rewrite a target archived during an in-flight operation`, async (t) => {
    setup(t, false);
    const data = fixture(false);
    data.classes[0].activeBoss!.currentHp = defeated ? 1 : 1000;
    useStore.setState({ data });
    let archivedSnapshot = '';
    useStore.setState({ triggerPetAnimation: () => {
      const latest = useStore.getState().data;
      useStore.setState({ data: { ...latest, currentClassId: activeClassId,
        classes: latest.classes.map((classroom) => classroom.id === archivedClassId ? { ...classroom, archivedAt: now } : classroom) } });
      archivedSnapshot = JSON.stringify(useStore.getState().data);
    } });
    await useStore.getState().executeAttackBoss(firstStudentId);
    assert.ok(archivedSnapshot);
    assert.equal(JSON.stringify(useStore.getState().data), archivedSnapshot);
    assert.equal(useStore.getState().showBossVictory, false);
    assert.equal(useStore.getState().bossVictoryResult, null);
  });
}

test('active feeding, play, points and boss attack retain the existing domain results', async (t) => {
  setup(t, false);
  t.mock.method(Math, 'random', () => 0.125);
  const data = fixture(false);
  data.classes[0].students[0].pet.fullness = 60;
  data.classes[0].students[0].pet.happiness = 60;
  useStore.setState({ data });
  const initial = data.classes[0].students[0];
  const expectedFeed = applyFeedToStudent(initial, 10, 20, now, 700);
  useStore.getState().feedPet(firstStudentId);
  assert.deepEqual(useStore.getState().data.classes[0].students[0], expectedFeed);
  const expectedPlay = applyPlayWithPet(expectedFeed, 5, 15, now, 700);
  useStore.getState().playWithPet(firstStudentId);
  assert.deepEqual(useStore.getState().data.classes[0].students[0], expectedPlay);
  useStore.getState().addPoints(firstStudentId, 8);
  assert.equal(useStore.getState().data.classes[0].students[0].points, expectedPlay.points + 8);
  const current = useStore.getState().data.classes[0];
  const expectedAttack = attackWorldBoss(current.students[0], current.activeBoss!, now);
  assert.ok(expectedAttack.updatedStudent);
  await useStore.getState().executeAttackBoss(firstStudentId);
  assert.deepEqual(useStore.getState().data.classes[0].students[0], expectedAttack.updatedStudent);
  assert.deepEqual(useStore.getState().data.classes[0].activeBoss, expectedAttack.updatedBoss);
});

test('archive selection is rejected without changing legacy missing-ID selection behavior', (t) => {
  setup(t);
  useStore.setState({ data: { ...useStore.getState().data, currentClassId: activeClassId } });
  useStore.getState().switchClass(archivedClassId);
  assert.equal(useStore.getState().data.currentClassId, activeClassId);
  useStore.getState().switchClass('missing-class');
  assert.equal(useStore.getState().data.currentClassId, 'missing-class');
});
