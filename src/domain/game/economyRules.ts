import type { LearningCompetency } from '../../../shared/education';
import {
  ECONOMY_EVENT_KINDS,
  ECONOMY_EVENT_SOURCES,
  MAX_ECONOMY_EVENT_RECORDS,
  MAX_POINT_ADJUSTMENT_RECORDS,
} from './constants';
import { appendRecord, clamp, toFiniteNumber } from './ruleUtils';
import type {
  EconomyEventKind,
  EconomyEventRecord,
  EconomyEventSource,
  PointAdjustmentRecord,
  PointAdjustmentSource,
  StudentRuleState,
} from './types';

export const isEconomyEventKind = (value: unknown): value is EconomyEventKind =>
  ECONOMY_EVENT_KINDS.includes(value as EconomyEventKind);

export const isEconomyEventSource = (value: unknown): value is EconomyEventSource =>
  ECONOMY_EVENT_SOURCES.includes(value as EconomyEventSource);

export const createPointAdjustmentRecord = (
  amount: number,
  source: PointAdjustmentSource,
  reason?: { id?: string; label?: string; competency?: LearningCompetency },
  now = Date.now(),
  audit?: Pick<
    PointAdjustmentRecord,
    | 'effectiveDate'
    | 'claimKind'
    | 'requestedAmount'
    | 'guardrailOutcome'
    | 'guardrailReason'
  >,
): PointAdjustmentRecord => ({
  id: `points-${now}-${Math.random().toString(36).slice(2, 8)}`,
  amount,
  createdAt: now,
  source,
  reasonId: reason?.id,
  reasonLabel: reason?.label,
  competency: reason?.competency,
  ...(audit?.effectiveDate ? { effectiveDate: audit.effectiveDate } : {}),
  ...(audit?.claimKind ? { claimKind: audit.claimKind } : {}),
  ...(audit?.requestedAmount != null ? { requestedAmount: audit.requestedAmount } : {}),
  ...(audit?.guardrailOutcome ? { guardrailOutcome: audit.guardrailOutcome } : {}),
  ...(audit?.guardrailReason ? { guardrailReason: audit.guardrailReason } : {}),
});

export const createEconomyEventRecord = (
  kind: EconomyEventKind,
  source: EconomyEventSource,
  amount: number,
  now = Date.now(),
  details: Pick<
    EconomyEventRecord,
    'referenceId' | 'previousPetType' | 'newPetType'
  > = {},
): EconomyEventRecord => ({
  id: `economy-${now}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  source,
  amount: Math.trunc(toFiniteNumber(amount, 0)),
  createdAt: now,
  ...(details.referenceId ? { referenceId: details.referenceId } : {}),
  ...(details.previousPetType ? { previousPetType: details.previousPetType } : {}),
  ...(details.newPetType ? { newPetType: details.newPetType } : {}),
});

export const appendEconomyEventToStudent = <T extends StudentRuleState>(
  student: T,
  record: EconomyEventRecord,
) => ({
  ...student,
  economyEventRecords: appendRecord(
    student.economyEventRecords,
    record,
    MAX_ECONOMY_EVENT_RECORDS,
  ),
});

/** Internal domain helper. Intentionally omitted from the public barrel. */
export const appendEconomyDelta = <T extends StudentRuleState>(
  before: T,
  after: T,
  source: EconomyEventSource,
  now: number,
): T => {
  const amount = Math.trunc(after.points - before.points);
  if (amount === 0) return after;
  return appendEconomyEventToStudent(
    after,
    createEconomyEventRecord(amount > 0 ? 'issuance' : 'spend', source, amount, now),
  ) as T;
};

export const applyPointAdjustmentToStudent = <T extends StudentRuleState>(
  student: T,
  amount: number,
  record: PointAdjustmentRecord,
  maxPoints = 700,
) => ({
  ...student,
  points: clamp(student.points + amount, 0, maxPoints),
  pointAdjustmentRecords: appendRecord(
    student.pointAdjustmentRecords,
    record,
    MAX_POINT_ADJUSTMENT_RECORDS,
  ),
});
