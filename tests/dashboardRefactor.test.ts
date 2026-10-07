import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardStudent } from '../src/features/students/model/createDashboardStudent';
import { buildPointReasonOptions } from '../src/features/rewards/model/buildPointReasonOptions';
import { buildDashboardRecordCollections } from '../src/features/records/model/buildDashboardRecordCollections';
import { createEnrolledStudent } from '../src/studentEnrollment';

test('dashboard enrollment uses the canonical student defaults outside React', () => {
  const student = createDashboardStudent('  Ada  ', 'student-ada');
  const canonicalStudent = createEnrolledStudent({ id: 'student-ada', name: 'Ada' });
  assert.deepEqual(student, canonicalStudent);
  assert.equal(student.id, 'student-ada');
  assert.equal(student.name, 'Ada');
  assert.equal(student.points, 200);
  assert.deepEqual(student.pet, {
    type: 'egg',
    fullness: 80,
    happiness: 80,
    level: 1,
  });
  assert.deepEqual(student.stats, { wins: 0, losses: 0 });
  assert.equal(student.nextUpgradeGachaLevel, 2);
  assert.deepEqual(student.dailyProgress, { streak: 0 });
  assert.deepEqual(student.disciplineRecords, []);
  assert.deepEqual(student.pointAdjustmentRecords, []);
  assert.deepEqual(student.economyEventRecords, []);
  assert.deepEqual(student.bossRewardRecords, []);
  assert.equal(student.bossRecovery, undefined);
});

test('point reason model localizes and preserves pinned/recent ordering', () => {
  const options = buildPointReasonOptions({
    language: 'en',
    pinnedReasonIds: ['growth'],
    recentReasonIds: ['late'],
  });
  assert.equal(options[0]?.id, 'growth');
  assert.equal(options[0]?.label, 'Demonstrated Growth');
  assert.equal(options[0]?.displayLabel, 'Demonstrated Growth +15');
  assert.equal(options[0]?.isPinned, true);
  assert.equal(options[1]?.id, 'late');
  assert.equal(options[1]?.isRecent, true);
});

test('records model attributes records to students and orders them newest first', () => {
  const ada = createDashboardStudent('Ada', 'student-ada');
  const grace = createDashboardStudent('Grace', 'student-grace');
  ada.disciplineRecords = [{ id: 'older-warning', type: 'warning', createdAt: 10 }];
  grace.disciplineRecords = [{ id: 'newer-discipline', type: 'discipline', createdAt: 20 }];
  ada.pointAdjustmentRecords = [{
    id: 'manual-points',
    amount: 5,
    createdAt: 30,
    source: 'manual',
  }];
  grace.dailyProgress = {
    streak: 0,
    reflections: [{
      id: 'mentor-feedback',
      date: '2026-09-10',
      createdAt: 40,
      competency: 'participation',
      author: 'mentor',
      mentorAssessment: 'progressing',
      text: 'Clear contribution',
    }],
  };

  const records = buildDashboardRecordCollections([ada, grace]);

  assert.deepEqual(
    records.disciplineRecords.map(({ id, studentId, studentName }) => ({
      id,
      studentId,
      studentName,
    })),
    [
      { id: 'newer-discipline', studentId: 'student-grace', studentName: 'Grace' },
      { id: 'older-warning', studentId: 'student-ada', studentName: 'Ada' },
    ],
  );
  assert.equal(records.pointAdjustmentRecords[0]?.studentName, 'Ada');
  assert.equal(records.dailyFeedbackRecords[0]?.studentId, 'student-grace');
});
