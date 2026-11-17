import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloneGameFeaturePreset, GAME_FEATURE_PRESETS, isGameFeatures, resolveGameFeatures,
  type GameFeaturePreset,
} from '../shared/gameFeatures';
import { assertWorkspaceData, WorkspaceValidationError } from '../shared/validation/workspaceValidation';
import { mergeTeacherWorkspaceData, scopeWorkspaceData } from '../server/workspaceScope';
import { createInitialData, normalizeAppData } from '../src/store/utils';
import { buildClassroomPresentation } from '../src/features/classroom/model/classroomPresentation';
import { createDashboardStudent } from '../src/features/students/model/createDashboardStudent';
import { canOpenDestination, getAreaDestinations, resolveDestination } from '../src/features/teacher-console/model/navigation';

const NOW = Date.parse('2026-11-15T00:00:00Z');

test('simple policy removes battle, grouping and rank entry points while teaching and history stay available', () => {
  const access = { readOnly: false, canAdministerWorkspace: false, gameFeatures: cloneGameFeaturePreset('simple') };
  assert.deepEqual(getAreaDestinations('activities', access).map(item => item.id), ['pets']);
  for (const id of ['groups', 'battle', 'boss', 'leaderboard'] as const) {
    assert.equal(canOpenDestination(id, access), false);
    assert.equal(resolveDestination(id, access), 'today');
  }
  for (const id of ['points', 'comments', 'records', 'evidence', 'exams', 'reports', 'student-insights', 'class-insights'] as const) {
    assert.equal(canOpenDestination(id, access), true);
  }
});

test('teaching policy hides all activities and full policy never grants admin or read-only write access', () => {
  const teacher = { readOnly: false, canAdministerWorkspace: false };
  assert.deepEqual(getAreaDestinations('activities', { ...teacher, gameFeatures: cloneGameFeaturePreset('teaching') }), []);
  assert.equal(canOpenDestination('records', { ...teacher, gameFeatures: cloneGameFeaturePreset('teaching') }), true);
  const full = cloneGameFeaturePreset('full');
  assert.equal(canOpenDestination('rules', { ...teacher, gameFeatures: full }), false);
  assert.deepEqual(getAreaDestinations('activities', { readOnly: true, canAdministerWorkspace: true, gameFeatures: full }), []);
  assert.equal(canOpenDestination('rules', { readOnly: false, canAdministerWorkspace: true, gameFeatures: full }), true);
});
const PRESETS: readonly GameFeaturePreset[] = ['simple', 'full', 'teaching'];
const populatedWorkspace = () => {
  const data = createInitialData(NOW);
  data.settings = { ...data.settings!, inclusiveMode: false, petCareMode: 'death',
    publicNameMode: 'full', publicLeaderboardMode: 'rank', battleEnabled: true,
    battleMode: 'both', feedCost: 17, playCost: 9 };
  const alice = createDashboardStudent('Synthetic Alice', '100');
  alice.points = 271;
  alice.pet = { type: 'dog', fullness: 75, happiness: 64, level: 3 };
  alice.stats = { wins: 2, losses: 1 };
  alice.rankPoints = 42;
  alice.nextUpgradeGachaLevel = 4;
  alice.teamId = 'synthetic-team';
  alice.pointAdjustmentRecords = [{ id: 'points', amount: 11, createdAt: NOW, source: 'manual' }];
  alice.economyEventRecords = [{ id: 'economy', kind: 'spend', source: 'upgrade', amount: -25,
    createdAt: NOW, referenceId: 'synthetic-upgrade' }];
  alice.disciplineRecords = [{ id: 'warning', type: 'warning', createdAt: NOW, reason: 'Synthetic reminder' }];
  alice.dailyProgress = { streak: 3, reflections: [{ id: 'feedback', date: '2026-11-15',
    createdAt: NOW, competency: 'participation', author: 'mentor', text: 'Synthetic feedback' }] };
  data.classes = [{ id: 'A', name: 'Synthetic Class A', students: [alice],
    activeBoss: { id: 'boss', name: 'Synthetic Boss', maxHp: 120, currentHp: 65,
      rewardTiers: [], contributions: { '100': 22 }, attackCounts: { '100': 2 }, isActive: true },
    learningEvidenceRecords: [{ id: 'evidence', classId: 'A', studentId: '100',
      competency: 'participation', level: 'mastered', evidenceType: 'observation',
      title: 'Synthetic evidence', actor: 'mentor', source: 'manual', rubricVersion: '1.0',
      revision: 1, createdAt: NOW }],
    examRecords: [{ id: 'exam', title: 'Synthetic exam', examDate: '2026-11-15',
      items: [{ id: 'math', name: 'Math', maxScore: 100 }],
      results: [{ studentId: '100', scores: { math: 93 }, updatedAt: NOW }],
      createdAt: NOW, updatedAt: NOW }] },
  { id: 'B', name: 'Synthetic Class B', students: [createDashboardStudent('Synthetic Bob', '100')] }];
  data.currentClassId = 'A';
  return normalizeAppData(data, NOW);
};

test('new workspaces use simple entry points with the existing friendly rule defaults', () => {
  const first = createInitialData(NOW);
  const second = createInitialData(NOW);
  assert.deepEqual(first.settings?.gameFeatures, { pets: true, battles: false, bosses: false, leaderboards: false });
  assert.equal(first.settings?.inclusiveMode, true);
  assert.equal(first.settings?.petCareMode, 'rest');
  assert.equal(first.settings?.publicNameMode, 'masked');
  assert.equal(first.settings?.publicLeaderboardMode, 'hidden');
  assert.equal(first.settings?.battleEnabled, true, 'UI defaults must not rewrite the gameplay switch');
  first.settings!.gameFeatures!.pets = false;
  assert.equal(second.settings?.gameFeatures?.pets, true, 'workspaces do not share mutable flags');
});

test('missing legacy policy retains all activities and remains absent through normalization and JSON', () => {
  for (const settings of [undefined, {}, { battleEnabled: false }]) {
    const normalized = normalizeAppData({ currentClassId: 'legacy', classes: [
      { id: 'legacy', name: 'Legacy Class', students: [] },
    ], settings }, NOW);
    assert.equal(Object.hasOwn(normalized.settings!, 'gameFeatures'), false);
    assert.deepEqual(resolveGameFeatures(normalized.settings?.gameFeatures), GAME_FEATURE_PRESETS.full);
    const roundTrip = normalizeAppData(JSON.parse(JSON.stringify(normalized)), NOW);
    assert.equal(Object.hasOwn(roundTrip.settings!, 'gameFeatures'), false);
    if (settings?.battleEnabled === false) assert.equal(roundTrip.settings?.battleEnabled, false);
    assertWorkspaceData(roundTrip);
  }
});

test('presets and resolvers isolate mutable settings drafts', () => {
  assert.equal(Object.isFrozen(GAME_FEATURE_PRESETS), true);
  for (const preset of PRESETS) {
    assert.equal(Object.isFrozen(GAME_FEATURE_PRESETS[preset]), true);
    const draft = cloneGameFeaturePreset(preset);
    const before = { ...GAME_FEATURE_PRESETS[preset] };
    const resolved = resolveGameFeatures(draft);
    resolved.pets = !resolved.pets;
    assert.deepEqual(draft, before);
    draft.bosses = !draft.bosses;
    assert.deepEqual(GAME_FEATURE_PRESETS[preset], before);
  }
});

test('complete policies validate, clone and survive import-style JSON round trips', () => {
  for (const preset of PRESETS) {
    const data = populatedWorkspace();
    data.settings!.gameFeatures = cloneGameFeaturePreset(preset);
    assertWorkspaceData(data);
    assertWorkspaceData(data, 'legacy');
    const normalized = normalizeAppData(JSON.parse(JSON.stringify(data)), NOW);
    assert.deepEqual(normalized.settings?.gameFeatures, GAME_FEATURE_PRESETS[preset]);
    assert.notEqual(normalized.settings?.gameFeatures, data.settings?.gameFeatures);
  }
});

test('malformed present policies fail before normalization instead of silently enabling activities', () => {
  const candidates: unknown[] = [null, false, 'simple', [], {}, { pets: true },
    { ...GAME_FEATURE_PRESETS.full, battles: 'false' },
    { ...GAME_FEATURE_PRESETS.full, bosses: 0 },
    { ...GAME_FEATURE_PRESETS.full, pets: undefined },
    { ...GAME_FEATURE_PRESETS.full, unknownFeature: true },
    Object.create(GAME_FEATURE_PRESETS.full),
  ];
  for (const gameFeatures of candidates) {
    assert.equal(isGameFeatures(gameFeatures), false);
    const data = { ...createInitialData(NOW), settings: { ...createInitialData(NOW).settings, gameFeatures } };
    assert.throws(() => assertWorkspaceData(data), WorkspaceValidationError);
    assert.throws(() => assertWorkspaceData(data, 'legacy'), WorkspaceValidationError);
    assert.throws(() => normalizeAppData(data, NOW), WorkspaceValidationError);
  }
});

test('activity visibility changes preserve player progress, teaching history, economy rules and presentation', () => {
  const baseline = populatedWorkspace();
  const options = { maskNames: true, inclusiveLeaderboard: true };
  const presentation = buildClassroomPresentation(baseline.classes[0], baseline.settings, options);
  const { gameFeatures: _originalPolicy, ...ruleSettings } = baseline.settings!;
  const combinations = Array.from({ length: 16 }, (_, mask) => ({
    pets: Boolean(mask & 1), battles: Boolean(mask & 2), bosses: Boolean(mask & 4), leaderboards: Boolean(mask & 8),
  }));
  for (const gameFeatures of combinations) {
    const changed = normalizeAppData({ ...baseline,
      settings: { ...baseline.settings, gameFeatures } }, NOW);
    assert.deepEqual(changed.classes, baseline.classes, 'hidden features must retain both classes and all histories');
    assert.equal(changed.currentClassId, baseline.currentClassId);
    assert.equal(changed.lastOpened, baseline.lastOpened);
    const { gameFeatures: _changedPolicy, ...unchangedRules } = changed.settings!;
    assert.deepEqual(unchangedRules, ruleSettings, 'UI policies must not change economy, penalties or battle rules');
    assert.deepEqual(buildClassroomPresentation(changed.classes[0], changed.settings, options), presentation);
  }
});

test('teachers retain authorized edits but cannot change workspace feature policies', () => {
  for (const legacy of [false, true]) {
    const current = populatedWorkspace();
    if (legacy) delete current.settings!.gameFeatures;
    const scope = new Set(['A']);
    const authorized = normalizeAppData(scopeWorkspaceData(current, scope), NOW);
    authorized.classes[0].students[0].points += 1;
    const merged = mergeTeacherWorkspaceData(current, authorized, scope);
    assert.equal(merged.classes[0].students[0].points, current.classes[0].students[0].points + 1);
    assert.deepEqual(merged.classes[1], current.classes[1], 'Class B must remain unchanged');
    assert.deepEqual(merged.settings, current.settings);
    const attack = structuredClone(authorized);
    attack.settings!.gameFeatures = cloneGameFeaturePreset('teaching');
    assert.throws(() => mergeTeacherWorkspaceData(current, attack, scope), /WORKSPACE_SETTINGS_CHANGED/);
    if (!legacy) {
      delete attack.settings!.gameFeatures;
      assert.throws(() => mergeTeacherWorkspaceData(current, attack, scope), /WORKSPACE_SETTINGS_CHANGED/);
    }
  }
});
