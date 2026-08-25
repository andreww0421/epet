import type { Student } from './store/types';
import type { EconomyEventSource, PointAdjustmentSource } from './gameRules';

const DAY_MS = 24 * 60 * 60 * 1000;

export type EconomySourceKey = PointAdjustmentSource | EconomyEventSource;

export type EconomySourceTotal = {
  source: EconomySourceKey;
  amount: number;
};

export type EconomyRecipient = {
  studentId: string;
  name: string;
  amount: number;
};

export type TeacherEconomyInsights = {
  windowDays: number;
  periodStart: number;
  totalIssued: number;
  totalSpent: number;
  issuanceSpendRatio: number | null;
  maxedStudents: number;
  maxedRate: number;
  petChangeCount: number;
  duplicatePetChangeCount: number;
  duplicatePetChangeRate: number;
  rewardConcentrationRate: number;
  topRecipientCount: number;
  issuanceSources: EconomySourceTotal[];
  spendSources: EconomySourceTotal[];
  topRecipients: EconomyRecipient[];
  warnings: {
    inflation: boolean;
    saturation: boolean;
    petDuplicates: boolean;
    concentration: boolean;
  };
};

const addSourceAmount = (
  target: Map<EconomySourceKey, number>,
  source: EconomySourceKey,
  amount: number,
) => target.set(source, (target.get(source) ?? 0) + amount);

const toSortedSources = (sourceMap: Map<EconomySourceKey, number>) =>
  [...sourceMap.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([source, amount]) => ({ source, amount }))
    .sort((a, b) => b.amount - a.amount);

export const getTeacherEconomyInsights = (
  students: Student[],
  maxPoints: number,
  now = Date.now(),
  requestedWindowDays = 30,
): TeacherEconomyInsights => {
  const windowDays = Math.max(1, Math.min(365, Math.trunc(requestedWindowDays) || 30));
  const periodStart = now - windowDays * DAY_MS;
  const issuanceSources = new Map<EconomySourceKey, number>();
  const spendSources = new Map<EconomySourceKey, number>();
  const issuedByStudent = new Map<string, number>();
  let totalIssued = 0;
  let totalSpent = 0;
  let petChangeCount = 0;
  let duplicatePetChangeCount = 0;

  const recordIssuance = (studentId: string, source: EconomySourceKey, amount: number) => {
    const normalizedAmount = Math.max(0, Math.trunc(amount));
    if (normalizedAmount === 0) return;
    totalIssued += normalizedAmount;
    issuedByStudent.set(studentId, (issuedByStudent.get(studentId) ?? 0) + normalizedAmount);
    addSourceAmount(issuanceSources, source, normalizedAmount);
  };

  students.forEach((student) => {
    (student.pointAdjustmentRecords ?? []).forEach((record) => {
      if (record.createdAt < periodStart || record.createdAt > now || record.amount <= 0) return;
      recordIssuance(student.id, record.source, record.amount);
    });

    const referencedBossRewards = new Set<string>();
    (student.economyEventRecords ?? []).forEach((record) => {
      if (record.createdAt < periodStart || record.createdAt > now) return;
      if (record.source === 'bossReward' && record.referenceId) {
        referencedBossRewards.add(record.referenceId);
      }
      if (record.kind === 'issuance' && record.amount > 0) {
        recordIssuance(student.id, record.source, record.amount);
      } else if (record.kind === 'spend' && record.amount < 0) {
        const amount = Math.abs(Math.trunc(record.amount));
        totalSpent += amount;
        addSourceAmount(spendSources, record.source, amount);
      }
      if (record.previousPetType && record.newPetType) {
        petChangeCount += 1;
        if (record.previousPetType === record.newPetType) duplicatePetChangeCount += 1;
      }
    });

    // Historical boss rewards predate the economy ledger. A reference ID prevents
    // newly recorded rewards from being counted through both data sources.
    (student.bossRewardRecords ?? []).forEach((record) => {
      if (
        record.createdAt < periodStart ||
        record.createdAt > now ||
        referencedBossRewards.has(record.id)
      ) return;
      recordIssuance(student.id, 'bossReward', record.rewardPoints);
    });
  });

  const rosterSize = students.length;
  const safeMaxPoints = Math.max(1, Math.trunc(maxPoints) || 700);
  const maxedStudents = students.filter((student) => student.points >= safeMaxPoints).length;
  const maxedRate = rosterSize > 0 ? maxedStudents / rosterSize : 0;
  const duplicatePetChangeRate = petChangeCount > 0
    ? duplicatePetChangeCount / petChangeCount
    : 0;
  const rankedRecipients = students
    .map((student) => ({
      studentId: student.id,
      name: student.name,
      amount: issuedByStudent.get(student.id) ?? 0,
    }))
    .filter((recipient) => recipient.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const topRecipientCount = rosterSize > 0 ? Math.max(1, Math.ceil(rosterSize * 0.2)) : 0;
  const topIssued = rankedRecipients
    .slice(0, topRecipientCount)
    .reduce((sum, recipient) => sum + recipient.amount, 0);
  const rewardConcentrationRate = totalIssued > 0 ? topIssued / totalIssued : 0;
  const issuanceSpendRatio = totalSpent > 0 ? totalIssued / totalSpent : null;

  return {
    windowDays,
    periodStart,
    totalIssued,
    totalSpent,
    issuanceSpendRatio,
    maxedStudents,
    maxedRate,
    petChangeCount,
    duplicatePetChangeCount,
    duplicatePetChangeRate,
    rewardConcentrationRate,
    topRecipientCount,
    issuanceSources: toSortedSources(issuanceSources),
    spendSources: toSortedSources(spendSources),
    topRecipients: rankedRecipients.slice(0, 5),
    warnings: {
      inflation: totalIssued > 0 && (totalSpent === 0 || (issuanceSpendRatio ?? 0) > 2),
      saturation: rosterSize >= 5 && maxedRate >= 0.2,
      petDuplicates: petChangeCount >= 3 && duplicatePetChangeRate >= 0.3,
      concentration: rosterSize >= 5 && totalIssued > 0 && rewardConcentrationRate >= 0.5,
    },
  };
};
