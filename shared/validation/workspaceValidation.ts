/** Resource limits apply before normalization, cloning, sorting or projection.
 * They are deliberately wider than the UI's domain/retention limits so legacy
 * defaults and migrations can still run after the input has been bounded.
 */
export const WORKSPACE_INPUT_LIMITS = Object.freeze({
  maxDepth: 24,
  maxNodes: 100_000,
  maxArray: 10_000,
  maxObjectKeys: 2_000,
  maxString: 4_096,
  maxKey: 200,
  maxClasses: 200,
  maxStudentsPerClass: 500,
  maxStudents: 5_000,
  maxWarningPoints: 1_000,
  maxTotalWarningTimestamps: 10_000,
  maxNumber: 1_000_000_000,
  maxTimestamp: 8_640_000_000_000_000,
});

export class WorkspaceValidationError extends Error {
  readonly code = 'INVALID_APP_DATA';
  constructor() { super('INVALID_APP_DATA'); }
}

const invalid = (): never => { throw new WorkspaceValidationError(); };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Normalization historically accepts numeric strings. Keep that bounded
 * compatibility here; network/persistence schemas require actual numbers.
 */
export const checkedWarningPoints = (value: unknown): number => {
  if (value == null) return 0;
  if (typeof value !== 'number' && typeof value !== 'string') return invalid();
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(count) || count < 0 || count > WORKSPACE_INPUT_LIMITS.maxWarningPoints) return invalid();
  return count;
};

/** Iterative and budgeted, including unknown extension fields. Do not recurse
 * or JSON.stringify an unbounded tree just to decide whether it is safe.
 * Undefined optional properties are emitted by the existing normalizer.
 */
const inspectResourceBounds = (value: unknown, maximumStringLength: number, checkWarningExpansion = true): void => {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  let warningTimestamps = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > WORKSPACE_INPUT_LIMITS.maxNodes || entry.depth > WORKSPACE_INPUT_LIMITS.maxDepth) invalid();
    const item = entry.value;
    if (item == null || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Math.abs(item) > WORKSPACE_INPUT_LIMITS.maxTimestamp) invalid();
      continue;
    }
    if (typeof item === 'string') {
      if (item.length > maximumStringLength) invalid();
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length > WORKSPACE_INPUT_LIMITS.maxArray || nodes + pending.length + item.length > WORKSPACE_INPUT_LIMITS.maxNodes) invalid();
      for (const child of item) pending.push({ value: child, depth: entry.depth + 1 });
      continue;
    }
    if (!object(item)) return invalid();
    const keys = Object.keys(item);
    if (keys.length > WORKSPACE_INPUT_LIMITS.maxObjectKeys || nodes + pending.length + keys.length > WORKSPACE_INPUT_LIMITS.maxNodes) invalid();
    if (checkWarningExpansion && (Object.hasOwn(item, 'warningPoints') || Object.hasOwn(item, 'activeWarningTimestamps'))) {
      const count = checkedWarningPoints(item.warningPoints);
      const timestamps = item.activeWarningTimestamps;
      if (Array.isArray(timestamps) && timestamps.length > WORKSPACE_INPUT_LIMITS.maxWarningPoints) invalid();
      warningTimestamps += Array.isArray(timestamps) ? timestamps.length : count;
      if (warningTimestamps > WORKSPACE_INPUT_LIMITS.maxTotalWarningTimestamps) invalid();
    }
    for (const key of keys) {
      if (key.length > WORKSPACE_INPUT_LIMITS.maxKey) invalid();
      pending.push({ value: item[key], depth: entry.depth + 1 });
    }
  }
};

export const assertWorkspaceResourceBounds = (value: unknown): void =>
  inspectResourceBounds(value, WORKSPACE_INPUT_LIMITS.maxString);

/** D1 must preserve its existing byte-size error before field-size errors.
 * Bound traversal/expansion first; serialize once, enforce 900 KiB, then run
 * the complete schema (including individual strings) before any persistence.
 */
export const assertWorkspaceSerializationBounds = (value: unknown): void =>
  inspectResourceBounds(value, Infinity);

/** Privacy purges rewrite retained source snapshots without normalizing them.
 * Preserve unrelated legacy values; their counts cannot trigger expansion here.
 * This exception must never authorize a new current snapshot or a restore.
 */
export const assertRetainedRevisionSerializationBounds = (value: unknown): void =>
  inspectResourceBounds(value, Infinity, false);

type Rule = (value: unknown, legacy?: boolean) => boolean;
const text = (maximum: number = WORKSPACE_INPUT_LIMITS.maxString): Rule =>
  (value) => typeof value === 'string' && value.length <= maximum;
const number = (minimum = 0, maximum: number = WORKSPACE_INPUT_LIMITS.maxNumber, integer = false): Rule =>
  (value, legacy) => {
    const numeric = legacy && typeof value === 'string' && value.length <= 64 &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : value;
    return typeof numeric === 'number' && Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum && (!integer || Number.isInteger(numeric));
  };
const boolean: Rule = (value) => typeof value === 'boolean';
const timestamp = number(0, WORKSPACE_INPUT_LIMITS.maxTimestamp);
const signed = number(-WORKSPACE_INPUT_LIMITS.maxNumber);
const id = text(200);
const name = text(200);
const count = number(0, WORKSPACE_INPUT_LIMITS.maxWarningPoints, true);
const nullable = (rule: Rule): Rule => (value, legacy) => value === null || rule(value, legacy);
const list = (rule: Rule, maximum = 2_000): Rule =>
  (value, legacy) => Array.isArray(value) && value.length <= maximum && value.every((item) => rule(item, legacy));
const fields = (shape: Record<string, Rule>, required: string[] = []): Rule =>
  (value, legacy) => object(value) && required.every((key) => Object.hasOwn(value, key)) &&
    Object.entries(shape).every(([key, rule]) => value[key] === undefined ? !required.includes(key) : rule(value[key], legacy));
const dictionary = (rule: Rule, maximum = 2_000): Rule =>
  (value, legacy) => object(value) && Object.keys(value).length <= maximum && Object.values(value).every((item) => rule(item, legacy));

const calendarFields = {
  schoolTimeZone: text(100), schoolWeekdays: list(number(0, 6, true), 7),
  schoolHolidayDates: list(text(10), 3_660), dailyTaskMakeupWindowDays: number(),
};
const penalty = fields({ source: text(40), until: timestamp });
const safetySnapshot = fields({
  points: number(), rankPoints: number(), fullness: number(), happiness: number(), level: number(),
  warningPoints: count, activeWarningTimestamps: list(timestamp, WORKSPACE_INPUT_LIMITS.maxWarningPoints), penaltyStatus: penalty,
});
const discipline = fields({
  id, type: text(40), createdAt: timestamp, warningCount: count, reason: text(),
  actionKind: text(40), reversesRecordId: id, safetyEffect: fields({ before: safetySnapshot, after: safetySnapshot }),
});
const pointRecord = fields({
  id, amount: signed, createdAt: timestamp, source: text(80), reasonId: id, reasonLabel: text(),
  competency: text(80), effectiveDate: text(10), claimKind: text(40), requestedAmount: signed,
  guardrailOutcome: text(40), guardrailReason: text(80),
});
const economyRecord = fields({
  id, kind: text(80), source: text(80), amount: signed, createdAt: timestamp,
  referenceId: id, previousPetType: text(80), newPetType: text(80),
});
const reward = fields({ points: number(), happiness: number(), rankPoints: number() });
const bossRewardFields: Record<string, Rule> = {
  id, bossId: id, bossName: name, createdAt: timestamp, receivedImprovementReward: boolean,
};
for (const key of [
  'rank', 'damage', 'attackCount', 'fairScore', 'previousDamage', 'previousFairScore',
  'improvementAmount', 'fairImprovementAmount', 'rewardPoints', 'rewardRankPoints', 'rewardHappiness',
  'rankRewardPoints', 'rankRewardRankPoints', 'rankRewardHappiness', 'participationRewardPoints',
  'participationRewardRankPoints', 'participationRewardHappiness', 'improvementRewardPoints',
  'improvementRewardRankPoints', 'improvementRewardHappiness',
]) bossRewardFields[key] = number();
const reflection = fields({
  id, date: text(10), createdAt: timestamp, competency: text(80), author: text(40),
  selfAssessment: text(40), mentorAssessment: text(40), text: text(),
});
const student = fields({
  id, name, points: number(),
  pet: fields({ type: text(80), fullness: number(), happiness: number(), level: number(), isDead: boolean, zeroFullnessSince: timestamp }),
  stats: fields({ wins: number(), losses: number() }), rankPoints: number(), warningPoints: count,
  activeWarningTimestamps: list(timestamp, WORKSPACE_INPUT_LIMITS.maxWarningPoints),
  nextUpgradeGachaLevel: nullable(number()), penaltyStatus: penalty,
  disciplineRecords: list(discipline), pointAdjustmentRecords: list(pointRecord),
  economyEventRecords: list(economyRecord), bossRewardRecords: list(fields(bossRewardFields)),
  dailyProgress: fields({ lastClaimDate: text(10), streak: number(), reflections: list(reflection), excusedDates: list(text(10), 3_660) }),
  bossRecovery: fields({ impact: number(), startedAt: timestamp, recoverAt: timestamp }),
  lastBossDamage: number(), lastBossFairScore: number(), teamId: text(512), teammateId: text(512), badges: list(text(200)),
});
const goal = fields({ id, title: text(), competency: text(80), targetCount: number(), createdAt: timestamp, weekStartDate: text(10) });
const boss = fields({
  id, name, maxHp: number(), currentHp: number(), rewardPoints: number(), rewardHappiness: number(),
  rewardTiers: list(fields({ rank: number(), points: number(), happiness: number(), rankPoints: number() })),
  participationReward: reward, improvementReward: reward,
  contributions: dictionary(number()), attackCounts: dictionary(number()), isActive: boolean,
});
const evidence = fields({
  id, classId: id, studentId: id, competency: text(80), level: text(40), evidenceType: text(40),
  title: text(), note: text(), actor: text(40), source: text(80), sourceId: id,
  rubricVersion: text(100), revision: number(), createdAt: timestamp,
});
const exam = fields({
  id, title: text(), examDate: text(10), createdAt: timestamp, updatedAt: timestamp,
  items: list(fields({ id, name, maxScore: number() }), 100),
  results: list(fields({ studentId: id, scores: dictionary(nullable(number()), 100), mentorComment: text(), updatedAt: timestamp }), WORKSPACE_INPUT_LIMITS.maxStudentsPerClass),
});
const classroomFields = {
  id, name, archivedAt: timestamp, students: list(student, WORKSPACE_INPUT_LIMITS.maxStudentsPerClass),
  dailyTaskCalendar: fields(calendarFields), activeBoss: boss, classGoals: list(goal), classGoal: goal,
  learningEvidenceRecords: list(evidence), examRecords: list(exam, 200),
};
const settingsFields: Record<string, Rule> = {
  ...calendarFields,
  decayType: text(40), petCareMode: text(40), publicNameMode: text(40), publicLeaderboardMode: text(40),
  language: text(10), battleMode: text(40), bossAttackMode: text(40),
  rankBrackets: fields({ diamond: number(), platinum: number(), gold: number(), silver: number() }),
  seasonResetRewards: fields({ diamond: number(), platinum: number(), gold: number(), silver: number(), bronze: number() }),
  pointReasonOptions: list(fields({ id, amount: signed, labels: fields({ zh: text(), en: text() }), competency: text(80) })),
  pinnedReasonIds: list(id), recentReasonIds: list(id),
  feedbackReasonHistory: list((value) => text()(value) || fields({ label: text(), competency: text(80) })(value)),
};
for (const key of [
  'inclusiveMode', 'pauseDecayOnWeekends', 'battleEnabled', 'teamBattleMinFullnessEnabled',
  'pointGuardrailsEnabled', 'participationSupportEnabled', 'enableSeasonResetRewards',
]) settingsFields[key] = boolean;
for (const key of [
  'decayAmount', 'hourlyDecay', 'feedCost', 'feedGain', 'playCost', 'playGain', 'maxTeamSize', 'maxPoints',
  'battleRankPointsWin', 'battleRankPointsLoss', 'soloBattleFullnessCost', 'soloBattleAttackerFullnessCost',
  'soloBattleDefenderFullnessCost', 'soloBattleWinPoints', 'soloBattleLossPoints', 'teamBattleMinFullness',
  'teamBattleAttackerFullnessCost', 'teamBattleAttackerTeammateFullnessCost', 'teamBattleDefenderFullnessCost',
  'teamBattleDefenderTeammateFullnessCost', 'bossAttackMaxTargets', 'bossAttackDamage', 'bossRecoveryMinutes',
  'dailyPositivePointLimit', 'dailyNegativePointLimit', 'positiveFeedbackRatioTarget', 'minimumDailyParticipationPoints',
  'catchUpGapThreshold', 'dailyCatchUpBonus', 'reviveCost',
]) settingsFields[key] = number();

/** Validate the caller's representation, without defaulting, copying, coercing
 * or truncating it. Legacy backups can omit new fields/use known aliases.
 */
export const assertWorkspaceData = (value: unknown, format: 'snapshot' | 'legacy' = 'snapshot'): void => {
  assertWorkspaceResourceBounds(value);
  if (!object(value)) return invalid();
  const strict = format === 'snapshot';
  const root = fields({
    currentClassId: id, lastOpened: timestamp, settings: fields(settingsFields),
    classes: list(fields(classroomFields, strict ? ['id', 'students'] : []), WORKSPACE_INPUT_LIMITS.maxClasses),
    students: list(student, WORKSPACE_INPUT_LIMITS.maxStudentsPerClass),
  }, strict ? ['currentClassId', 'classes'] : []);
  if (!root(value, !strict) || (!strict && !Array.isArray(value.classes) && !Array.isArray(value.students))) invalid();
  const classes = Array.isArray(value.classes) && value.classes.length ? value.classes : [{ students: value.students ?? [] }];
  let students = 0;
  for (const classroom of classes) {
    students += Array.isArray(classroom.students) ? classroom.students.length : 0;
    if (students > WORKSPACE_INPUT_LIMITS.maxStudents) invalid();
  }
};
