import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDecay, countDecayPeriods, getSettingsImpactPreview } from '../src/store/calculations/decay';
import * as facade from '../src/store/utils';
import { createEnrolledStudent } from '../src/studentEnrollment';
import type { AppData } from '../src/store/types';

const HOUR = 60 * 60 * 1000;
const now = new Date(2026, 10, 16, 12).getTime();
const fixture = (): AppData => ({
  currentClassId: 'A', lastOpened: now,
  settings: { decayAmount: 2, decayType: 'hourly', petCareMode: 'rest', pauseDecayOnWeekends: false },
  classes: ['A', 'B'].map(id => ({ id, name: id, students: [createEnrolledStudent({ id: '100', name: `Synthetic ${id}` })] })),
});

test('legacy utils exports remain the same calculation functions without a second implementation', () => {
  assert.equal(facade.applyDecay, applyDecay);
  assert.equal(facade.countDecayPeriods, countDecayPeriods);
  assert.equal(facade.getSettingsImpactPreview, getSettingsImpactPreview);
});

test('decay counting retains local calendar weekends and partial interval boundaries', () => {
  const friday = new Date(2026, 10, 13, 12).getTime();
  assert.equal(new Date(friday).getDay(), 5);
  const monday = new Date(2026, 10, 16, 12).getTime();
  assert.equal(countDecayPeriods(friday, monday, HOUR, true), 24);
  assert.equal(countDecayPeriods(friday, monday, HOUR, false), 72);
  assert.equal(countDecayPeriods(now, now + HOUR - 1, HOUR, false), 0);
  assert.equal(countDecayPeriods(now, now - HOUR, HOUR, true), 0);
});

test('no-op decay retains data identity, while rest-mode recovery changes only necessary student state', () => {
  const data = fixture();
  const before = structuredClone(data);
  assert.equal(applyDecay(data, now + HOUR - 1), data);
  assert.deepEqual(data, before);
  data.classes[0].students[0].pet.isDead = true;
  data.classes[1].archivedAt = now - HOUR;
  data.classes[1].students[0].pet.isDead = true;
  const recovered = applyDecay(data, now);
  assert.equal(recovered.classes[0].students[0].pet.isDead, false);
  assert.equal(data.classes[0].students[0].pet.isDead, true);
  assert.equal(recovered.classes[1], data.classes[1]);
  assert.equal(recovered.classes[1].students[0].pet.isDead, true);
});

test('elapsed decay preserves archived snapshots, progress clocks and class-local matching student IDs', () => {
  const data = fixture();
  data.classes[1].archivedAt = now - HOUR;
  const before = structuredClone(data);
  const result = applyDecay(data, now + 2 * HOUR + 123);
  assert.notEqual(result, data);
  assert.equal(result.lastOpened, now + 2 * HOUR);
  assert.equal(result.classes[0].students[0].pet.fullness, 76);
  assert.equal(result.classes[1], data.classes[1]);
  assert.equal(result.classes[1].students[0].pet.fullness, 80);
  assert.deepEqual(data, before);
});

test('settings preview keeps existing upgrade economics and never mutates learner state', () => {
  const students = fixture().classes.map(item => item.students[0]);
  students[0] = { ...students[0], points: 0, pet: { ...students[0].pet, fullness: 20 } };
  students[1] = { ...students[1], pet: { ...students[1].pet, fullness: 100, level: 10 } };
  const before = structuredClone(students);
  assert.deepEqual(getSettingsImpactPreview(students, {
    decayAmount: 2, decayType: 'daily', pauseDecayOnWeekends: false, feedCost: 10, feedGain: 20,
  }, 14, now), {
    currentAverageFullness: 60, projectedAverageFullness: 46, sevenDayDecay: 14,
    estimatedUpgradeActions: 7, estimatedUpgradeDays: 7,
  });
  assert.deepEqual(students, before);
  assert.deepEqual(getSettingsImpactPreview([], {
    decayAmount: 2, decayType: 'daily', pauseDecayOnWeekends: false, feedCost: 10, feedGain: 20,
  }, 0, now), { currentAverageFullness: 0, projectedAverageFullness: 0, sevenDayDecay: 0, estimatedUpgradeActions: 0, estimatedUpgradeDays: 0 });
});
