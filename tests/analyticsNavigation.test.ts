import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeatureOpenTracker } from '../src/analytics/useFeatureAnalytics';
import type { ConsoleDestination } from '../src/features/teacher-console/model/navigation';

test('committed feature openings deduplicate StrictMode replay and repeated navigation', () => {
  const opened: ConsoleDestination[] = [];
  const track = createFeatureOpenTracker((feature) => opened.push(feature));
  track('today', true);
  track('today', true);
  track('exams', true);
  track('exams', true);
  track('today', true);
  assert.deepEqual(opened, ['today', 'exams', 'today']);
});

test('read-only navigation emits nothing and enabling starts a fresh teacher opening', () => {
  const opened: ConsoleDestination[] = [];
  const track = createFeatureOpenTracker((feature) => opened.push(feature));
  track('today', false);
  track('exams', false);
  assert.deepEqual(opened, []);
  track('exams', true);
  track('exams', true);
  track('records', false);
  track('records', true);
  assert.deepEqual(opened, ['exams', 'records']);
});

test('separate teacher console lifetimes do not retain feature history or identities', () => {
  const opened: ConsoleDestination[] = [];
  const first = createFeatureOpenTracker((feature) => opened.push(feature));
  const second = createFeatureOpenTracker((feature) => opened.push(feature));
  first('today', true);
  first('reports', true);
  second('today', true);
  assert.deepEqual(opened, ['today', 'reports', 'today']);
});
