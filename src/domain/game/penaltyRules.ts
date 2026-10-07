import {
  LEVEL_DECREASE_COOLDOWN_MS,
  PENALTY_DURATION_MS,
} from './constants';
import { syncPetLifeState } from './petRules';
import { appendRecord, clamp, toFiniteNumber } from './ruleUtils';
import type {
  DisciplineRecord,
  DisciplineRecordType,
  PenaltyAmounts,
  PenaltyStatus,
  PenaltyStatusSource,
  SafetyActionEffect,
  SafetyActionSnapshot,
  StudentRuleState,
} from './types';

export const hasActiveLevelDecreaseCooldown = (
  records: DisciplineRecord[] | undefined,
  now = Date.now(),
) => {
  const reversedRecordIds = new Set(
    (records ?? [])
      .filter((record) => record.type === 'reversal' && record.reversesRecordId)
      .map((record) => record.reversesRecordId as string),
  );
  return (records ?? []).some(
    (record) =>
      record.type === 'levelDecrease' &&
      !reversedRecordIds.has(record.id) &&
      record.createdAt > now - LEVEL_DECREASE_COOLDOWN_MS,
  );
};

export const createDisciplineRecord = (
  type: DisciplineRecordType,
  warningCount?: number,
  now = Date.now(),
  details: Pick<
    DisciplineRecord,
    'reason' | 'actionKind' | 'reversesRecordId' | 'safetyEffect'
  > = {},
): DisciplineRecord => ({
  id: `record-${now}-${Math.random().toString(36).slice(2, 8)}`,
  type,
  createdAt: now,
  warningCount,
  ...details,
});

export const createPenaltyStatus = (
  source: PenaltyStatusSource,
  now = Date.now(),
): PenaltyStatus => ({
  source,
  until: now + PENALTY_DURATION_MS[source],
});

export const normalizePenaltyStatus = (
  raw: unknown,
  now = Date.now(),
): PenaltyStatus | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = (raw as { source?: string }).source;
  const until = toFiniteNumber((raw as { until?: unknown }).until, 0);
  if ((source !== 'autoPenalty' && source !== 'discipline') || until <= now) {
    return undefined;
  }
  return { source, until };
};

export const isPenaltyActive = (
  penaltyStatus: PenaltyStatus | undefined,
  now = Date.now(),
) => Boolean(penaltyStatus && penaltyStatus.until > now);

export const applyPenaltyToStudent = <T extends StudentRuleState>(
  student: T,
  penalty: PenaltyAmounts,
  options: {
    nextWarningPoints?: number;
    record?: DisciplineRecord;
    now?: number;
    source?: PenaltyStatusSource;
  } = {},
  maxPoints = 700,
) => ({
  ...student,
  points: clamp(student.points - penalty.points, 0, maxPoints),
  pet: syncPetLifeState(
    {
      ...student.pet,
      fullness: clamp(student.pet.fullness - penalty.fullness, 0, 100),
      happiness: clamp(student.pet.happiness - penalty.happiness, 0, 100),
    },
    options.now,
  ),
  rankPoints: Math.max(0, (student.rankPoints ?? 0) - penalty.rankPoints),
  warningPoints: Math.max(0, options.nextWarningPoints ?? student.warningPoints ?? 0),
  penaltyStatus: options.source
    ? createPenaltyStatus(options.source, options.now)
    : student.penaltyStatus,
  disciplineRecords: options.record
    ? appendRecord(student.disciplineRecords, options.record)
    : student.disciplineRecords ?? [],
});

const clonePenaltyStatus = (status: PenaltyStatus | undefined) =>
  status ? { source: status.source, until: status.until } : undefined;

export const createSafetyActionSnapshot = <T extends StudentRuleState>(
  student: T,
): SafetyActionSnapshot => ({
  points: student.points,
  rankPoints: student.rankPoints ?? 0,
  fullness: student.pet.fullness,
  happiness: student.pet.happiness,
  level: student.pet.level,
  warningPoints: student.warningPoints,
  activeWarningTimestamps: student.activeWarningTimestamps
    ? [...student.activeWarningTimestamps]
    : undefined,
  penaltyStatus: clonePenaltyStatus(student.penaltyStatus),
});

export const createSafetyActionEffect = <
  TBefore extends StudentRuleState,
  TAfter extends StudentRuleState,
>(
  before: TBefore,
  after: TAfter,
): SafetyActionEffect => ({
  before: createSafetyActionSnapshot(before),
  after: createSafetyActionSnapshot(after),
});

const samePenaltyStatus = (
  left: PenaltyStatus | undefined,
  right: PenaltyStatus | undefined,
) => left?.source === right?.source && left?.until === right?.until;

const sameOptionalNumberList = (
  left: number[] | undefined,
  right: number[] | undefined,
) => {
  if (!left || !right) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

/**
 * Reverses only the effect of one safety action. Numeric fields use inverse deltas so
 * unrelated additive changes made during the undo window survive. Non-additive
 * warning and penalty state is restored only while it still matches the action's
 * recorded post-state, preventing the undo from overwriting a newer command.
 */
export const applySafetyActionReversal = <T extends StudentRuleState>(
  student: T,
  effect: SafetyActionEffect,
  reversalRecord: DisciplineRecord,
  maxPoints = 700,
): T => {
  const { before, after } = effect;
  const warningStateUnchanged =
    student.warningPoints === after.warningPoints &&
    sameOptionalNumberList(student.activeWarningTimestamps, after.activeWarningTimestamps);
  const penaltyStateUnchanged = samePenaltyStatus(student.penaltyStatus, after.penaltyStatus);

  const nextStudent = {
    ...student,
    points: clamp(student.points - (after.points - before.points), 0, maxPoints),
    rankPoints: Math.max(
      0,
      (student.rankPoints ?? 0) - (after.rankPoints - before.rankPoints),
    ),
    warningPoints: warningStateUnchanged ? before.warningPoints : student.warningPoints,
    activeWarningTimestamps: warningStateUnchanged
      ? before.activeWarningTimestamps && [...before.activeWarningTimestamps]
      : student.activeWarningTimestamps,
    penaltyStatus: penaltyStateUnchanged
      ? clonePenaltyStatus(before.penaltyStatus)
      : student.penaltyStatus,
    pet: {
      ...student.pet,
      fullness: clamp(
        student.pet.fullness - (after.fullness - before.fullness),
        0,
        100,
      ),
      happiness: clamp(
        student.pet.happiness - (after.happiness - before.happiness),
        0,
        100,
      ),
      level: Math.max(1, student.pet.level - (after.level - before.level)),
    },
    disciplineRecords: appendRecord(student.disciplineRecords, reversalRecord),
  } as T;
  return nextStudent;
};
