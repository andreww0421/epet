import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { computeExamStudentAnalysis } from '../src/examAnalytics';
import { ArchivedClassHistoryPanel } from '../src/features/workspace/components/ArchivedClassHistoryPanel';
import { getArchivedClassHistory, getArchivedExamAnalyses } from '../src/features/workspace/model/classArchiveHistory';
import type { BossRewardRecord, ClassData } from '../src/store/types';

const archivedAt = Date.parse('2026-10-14T08:00:00Z');

const bossReward: BossRewardRecord = {
  id: 'boss-reward', bossId: 'boss-one', bossName: 'Historical boss', createdAt: archivedAt - 1,
  rank: 1, damage: 50, attackCount: 2, fairScore: 25, previousDamage: 10, previousFairScore: 10,
  improvementAmount: 40, fairImprovementAmount: 15, rewardPoints: 12, rewardRankPoints: 3,
  rewardHappiness: 5, rankRewardPoints: 5, rankRewardRankPoints: 2, rankRewardHappiness: 2,
  participationRewardPoints: 5, participationRewardRankPoints: 1, participationRewardHappiness: 2,
  improvementRewardPoints: 2, improvementRewardRankPoints: 0, improvementRewardHappiness: 1,
  receivedImprovementReward: true,
};

const fixture = (): ClassData => ({
  id: 'archived-class', name: 'Archived class history', archivedAt,
  students: [{
    id: 'student-one', name: 'Synthetic learner', points: 120,
    pet: { type: 'cat', fullness: 25, happiness: 50, level: 3, zeroFullnessSince: archivedAt - 100 },
    pointAdjustmentRecords: [{ id: 'point-one', source: 'manual', amount: 8, createdAt: archivedAt - 2, reasonLabel: 'Historical point reason' }],
    disciplineRecords: [{ id: 'penalty-one', type: 'warning', createdAt: archivedAt - 3, reason: 'Historical penalty reason' }],
    dailyProgress: { streak: 3, reflections: [{ id: 'reflection-one', date: '2026-10-14',
      createdAt: archivedAt - 4, author: 'mentor', competency: 'collaboration', text: 'Historical teacher comment' }] },
    bossRewardRecords: [bossReward],
    economyEventRecords: [{ id: 'battle-one', kind: 'spend', source: 'soloBattle', amount: 5, createdAt: archivedAt - 5 }],
  }, { id: 'student-two', name: 'Synthetic learner two', points: 10, pet: { type: 'egg', fullness: 70, happiness: 70, level: 1 } }],
  classGoals: [{ id: 'goal-one', title: 'Historical learning goal', competency: 'growth', targetCount: 5, createdAt: archivedAt - 6 }],
  learningEvidenceRecords: [{ id: 'evidence-one', classId: 'archived-class', studentId: 'student-one',
    competency: 'growth', level: 'mastered', evidenceType: 'project', title: 'Historical learning evidence',
    note: 'Historical evidence note', actor: 'mentor', source: 'manual', rubricVersion: '1.0', revision: 2, createdAt: archivedAt - 6 }],
  examRecords: [
    { id: 'exam-old', title: 'Previous assessment', examDate: '2026-10-01', createdAt: archivedAt - 8, updatedAt: archivedAt - 8,
      items: [{ id: 'old-math', name: 'Math', maxScore: 50 }], results: [
        { studentId: 'student-one', scores: { 'old-math': 25 }, updatedAt: archivedAt - 8 },
        { studentId: 'student-two', scores: { 'old-math': 40 }, updatedAt: archivedAt - 8 },
      ] },
    { id: 'exam-new', title: 'Latest assessment', examDate: '2026-10-14', createdAt: archivedAt - 7, updatedAt: archivedAt - 7,
      items: [{ id: 'new-math', name: 'Math', maxScore: 100 }, { id: 'reading', name: 'Reading', maxScore: 50 }], results: [
        { studentId: 'student-one', scores: { 'new-math': 90, reading: 20 }, mentorComment: 'Historical exam comment', updatedAt: archivedAt - 7 },
        { studentId: 'student-two', scores: { 'new-math': 50 }, updatedAt: archivedAt - 7 },
      ] },
  ],
  activeBoss: { id: 'boss-one', name: 'Historical boss', maxHp: 100, currentHp: 20,
    rewardTiers: [], contributions: { 'student-one': 50 }, attackCounts: { 'student-one': 2 }, isActive: true },
});

test('archived history preserves all retained records without normalizing or advancing the snapshot', () => {
  const classroom = fixture();
  const before = structuredClone(classroom);
  Object.freeze(classroom.examRecords);
  Object.freeze(classroom.learningEvidenceRecords);
  Object.freeze(classroom.students[0].pointAdjustmentRecords);
  const originalNow = Date.now;
  Date.now = () => { throw new Error('History projection must not read the current clock'); };
  try {
    const history = getArchivedClassHistory(classroom)!;
    assert.equal(history.archivedAt, archivedAt);
    assert.equal(history.evidence[0], classroom.learningEvidenceRecords![0]);
    assert.equal(history.goals[0], classroom.classGoals![0]);
    assert.equal(history.students, classroom.students);
    assert.equal(history.boss, classroom.activeBoss);
    assert.equal(history.activities.length, 5);
    assert.deepEqual(history.activities.map((entry) => entry.kind), ['boss', 'points', 'penalty', 'reflection', 'economy']);
    assert.deepEqual(history.exams.map((exam) => exam.id), ['exam-new', 'exam-old']);
    assert.deepEqual(classroom, before);
  } finally {
    Date.now = originalNow;
  }
});

test('archived exam scores, trends and support areas exactly match the existing exam domain', () => {
  const classroom = fixture();
  const history = getArchivedClassHistory(classroom)!;
  for (const exam of history.exams) {
    const analyses = getArchivedExamAnalyses(history.exams, exam.id, history.students);
    for (const { student, analysis } of analyses) {
      assert.deepEqual(analysis, computeExamStudentAnalysis(classroom.examRecords!, exam.id, student.id));
    }
  }
  const latest = getArchivedExamAnalyses(history.exams, 'exam-new', history.students);
  assert.equal(latest[0].analysis?.trend, 'improving');
  assert.equal(latest[0].analysis?.mentorComment, 'Historical exam comment');
  assert.deepEqual(latest[0].analysis?.weaknessItems.map((item) => item.name), ['Reading']);
  assert.equal(latest[1].analysis?.missingItems.length, 1);
});

test('historical view has labeled native selection and read-only retained educational and game records', () => {
  const classroom = fixture();
  const before = structuredClone(classroom);
  const html = renderToStaticMarkup(createElement(ArchivedClassHistoryPanel, { classroom, language: 'en' }));
  for (const text of ['ARCHIVED', 'READ-ONLY HISTORY', 'Snapshot time', 'UTC', 'Historical learning evidence',
    'Historical evidence note', 'Historical learning goal', 'Latest assessment', 'Previous assessment',
    'Class average', 'Improving', 'Historical exam comment', 'Historical point reason',
    'Historical penalty reason', 'Historical teacher comment', 'Historical boss', 'Solo battle',
    'Sensitive-action audit information remains in the Audit tab']) assert.ok(html.includes(text), text);
  assert.match(html, /<label for="[^"]+-exam"/);
  assert.match(html, /<select id="[^"]+-exam"/);
  assert.match(html, /<caption[^>]*>Latest assessment/);
  assert.match(html, /<th scope="row"/);
  assert.doesNotMatch(html, /<button|<input|<textarea|contenteditable|Save assessment|New assessment|Print|Download|Start boss/);
  assert.deepEqual(classroom, before);
});

test('active classes fail closed rather than exposing their records through an archived historical view', () => {
  const classroom = fixture();
  delete classroom.archivedAt;
  assert.equal(getArchivedClassHistory(classroom), null);
  const html = renderToStaticMarkup(createElement(ArchivedClassHistoryPanel, { classroom, language: 'en' }));
  assert.match(html, /Historical view is available only for archived classes/);
  assert.doesNotMatch(html, /Synthetic learner|Historical exam comment|<select/);
});

test('empty and legacy archived classes keep an honest empty read-only view', () => {
  const classroom: ClassData = { id: 'empty', name: 'Empty archived class', archivedAt, students: [] };
  const html = renderToStaticMarkup(createElement(ArchivedClassHistoryPanel, { classroom, language: 'zh' }));
  assert.match(html, /封存 · 唯讀歷史/);
  assert.match(html, /沒有保留的學習證據/);
  assert.match(html, /沒有保留的考試/);
  assert.match(html, /沒有保留的活動紀錄/);
  assert.doesNotMatch(html, /<button|<select/);
});

test('legacy out-of-range timestamps do not crash the historical presentation or fabricate a current date', () => {
  const classroom = fixture();
  classroom.archivedAt = Number.MAX_SAFE_INTEGER;
  classroom.students[0].pointAdjustmentRecords![0].createdAt = Number.NaN;
  const html = renderToStaticMarkup(createElement(ArchivedClassHistoryPanel, { classroom, language: 'en' }));
  assert.match(html, /Date not recorded/);
  assert.match(html, /Historical point reason/);
});
