import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_ROSTER_FILE_BYTES,
  MAX_ROSTER_STUDENTS,
  applyExamScorePaste,
  createExamCsvTemplate,
  createRosterCsvTemplate,
  previewExamScorePaste,
  previewRosterImport,
} from '../src/imports/tabularImport.js';
import type { ExamRecord } from '../src/store/types.js';

const createExam = (): ExamRecord => ({
  id: 'exam-1',
  title: 'Midterm',
  examDate: '2026-08-14',
  items: [
    { id: 'math', name: 'Math', maxScore: 100 },
    { id: 'reading', name: 'Reading', maxScore: 50 },
  ],
  results: [{
    studentId: 'student-a',
    scores: { math: 80, reading: 20, archived: 12 },
    mentorComment: 'Keep showing your work.',
    updatedAt: 1000,
  }],
  createdAt: 1000,
  updatedAt: 1000,
});

const students = [
  { id: 'student-a', name: 'Alice' },
  { id: 'student-b', name: 'Bob' },
];

test('roster parser handles BOM, CRLF, quoted commas, and quoted newlines', () => {
  const preview = previewRosterImport(
    '\uFEFF學生姓名,備註\r\n"王\r\n小明","含,逗號"\r\n李小華,正常\r\n',
    [],
  );

  assert.equal(preview.canApply, true);
  assert.equal(preview.delimiter, ',');
  assert.deepEqual(preview.additions, ['王 小明', '李小華']);
  assert.deepEqual(preview.rows.map((row) => row.rowNumber), [2, 3]);
  assert.equal(preview.issues.length, 0);
});

test('roster parser auto-detects TSV and English name aliases', () => {
  const preview = previewRosterImport(
    'Student Name\tNote\r\nAlice\tA\r\nBob\tB\r\n',
    [],
  );

  assert.equal(preview.canApply, true);
  assert.equal(preview.delimiter, '\t');
  assert.deepEqual(preview.additions, ['Alice', 'Bob']);
});

test('roster parser warns and skips existing and repeated names', () => {
  const preview = previewRosterImport(
    '姓名\r\nAlice\r\n王　小明\r\n 王 小明 \r\n',
    [{ name: ' alice ' }],
  );

  assert.equal(preview.canApply, true);
  assert.deepEqual(preview.additions, ['王 小明']);
  assert.deepEqual(
    preview.rows.map(({ name, status }) => ({ name, status })),
    [
      { name: 'Alice', status: 'existing' },
      { name: '王 小明', status: 'add' },
      { name: '王 小明', status: 'duplicate' },
    ],
  );
  assert.deepEqual(
    preview.issues.map((issue) => issue.code),
    ['existing-student', 'duplicate-student'],
  );
  assert.ok(preview.issues.every((issue) => issue.severity === 'warning'));
});

test('roster parser rejects empty, overlong, and formula-like names', () => {
  const longName = '甲'.repeat(81);
  const preview = previewRosterImport(
    `姓名,備註\r\n,missing\r\n${longName},long\r\n" =HYPERLINK(""https://example.test"")",formula\r\n`,
    [],
  );

  assert.equal(preview.canApply, false);
  assert.deepEqual(
    preview.issues.map((issue) => issue.code),
    ['empty-name', 'name-too-long', 'formula-risk'],
  );
  assert.ok(preview.rows.every((row) => row.status === 'invalid'));
});

test('roster parser enforces byte and student limits before applying', () => {
  const oversized = previewRosterImport(
    `姓名\r\n${'甲'.repeat(MAX_ROSTER_FILE_BYTES)}`,
    [],
  );
  assert.equal(oversized.canApply, false);
  assert.equal(oversized.issues[0]?.code, 'file-too-large');
  assert.ok(oversized.sourceBytes > MAX_ROSTER_FILE_BYTES);

  const tooManyRows = [
    '姓名',
    ...Array.from({ length: MAX_ROSTER_STUDENTS + 1 }, (_, index) => `Student ${index}`),
  ].join('\r\n');
  const tooMany = previewRosterImport(tooManyRows, []);
  assert.equal(tooMany.canApply, false);
  assert.ok(tooMany.issues.some((issue) => issue.code === 'too-many-students'));
  assert.equal(tooMany.rows.length, MAX_ROSTER_STUDENTS);
});

test('roster parser requires exactly one supported name header', () => {
  const missing = previewRosterImport('Number\r\n1\r\n', []);
  assert.equal(missing.canApply, false);
  assert.ok(missing.issues.some((issue) => issue.code === 'missing-name-header'));

  const duplicate = previewRosterImport('姓名,Student Name\r\nAlice,Alice\r\n', []);
  assert.equal(duplicate.canApply, false);
  assert.ok(duplicate.issues.some((issue) => issue.code === 'duplicate-name-header'));
});

test('roster CSV template uses BOM and CRLF and neutralizes formula injection', () => {
  const csv = createRosterCsvTemplate('zh', [
    '=1+1',
    ' +SUM(A1:A2)',
    '-cmd',
    '@cmd',
    'Normal\nName',
  ]);

  assert.ok(csv.startsWith('\uFEFF姓名\r\n'));
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(csv.replaceAll('\r\n', '').includes('\r'), false);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /' \+SUM\(A1:A2\)/);
  assert.match(csv, /'-cmd/);
  assert.match(csv, /'@cmd/);
});

test('exam paste maps from the selected cell, preserves blanks, and accepts zero', () => {
  const exam = createExam();
  const preview = previewExamScorePaste('\t0\r\n90\t45', {
    exam,
    students,
    startStudentIndex: 0,
    startItemIndex: 0,
  });

  assert.equal(preview.canApply, true);
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.columnCount, 2);
  assert.deepEqual(
    preview.patches.map(({ studentId, itemId, score }) => ({ studentId, itemId, score })),
    [
      { studentId: 'student-a', itemId: 'reading', score: 0 },
      { studentId: 'student-b', itemId: 'math', score: 90 },
      { studentId: 'student-b', itemId: 'reading', score: 45 },
    ],
  );

  const applied = applyExamScorePaste(exam, preview, 5000);
  const alice = applied.results.find((result) => result.studentId === 'student-a');
  const bob = applied.results.find((result) => result.studentId === 'student-b');
  assert.deepEqual(alice?.scores, { math: 80, reading: 0, archived: 12 });
  assert.equal(alice?.mentorComment, 'Keep showing your work.');
  assert.equal(alice?.updatedAt, 5000);
  assert.deepEqual(bob?.scores, { math: 90, reading: 45 });
  assert.equal(applied.updatedAt, 5000);

  assert.deepEqual(exam.results[0].scores, { math: 80, reading: 20, archived: 12 });
  assert.equal(exam.updatedAt, 1000);
});

test('invalid, negative, and over-maximum scores make the whole paste unappliable', () => {
  const exam = createExam();
  const original = structuredClone(exam);
  const preview = previewExamScorePaste('101\tabc\r\n-1\t50', {
    exam,
    students,
    startStudentIndex: 0,
    startItemIndex: 0,
  });

  assert.equal(preview.canApply, false);
  assert.ok(preview.patches.some((patch) => patch.score === 50));
  assert.deepEqual(
    preview.issues.map((issue) => issue.code),
    ['score-over-maximum', 'invalid-score', 'negative-score'],
  );
  assert.throws(() => applyExamScorePaste(exam, preview, 5000));
  assert.deepEqual(exam, original);
});

test('formula-like score cells are rejected instead of evaluated', () => {
  const preview = previewExamScorePaste('=1+1', {
    exam: createExam(),
    students,
    startStudentIndex: 0,
    startItemIndex: 0,
  });

  assert.equal(preview.canApply, false);
  assert.equal(preview.issues[0]?.code, 'formula-risk');
});

test('matrix overflow and invalid starting positions block the complete paste', () => {
  const exam = createExam();
  const overflow = previewExamScorePaste('1\t2\r\n3\t4', {
    exam,
    students,
    startStudentIndex: 1,
    startItemIndex: 1,
  });
  assert.equal(overflow.canApply, false);
  assert.ok(overflow.issues.some((issue) => issue.code === 'matrix-overflow'));

  const invalidStart = previewExamScorePaste('1', {
    exam,
    students,
    startStudentIndex: 2,
    startItemIndex: 0,
  });
  assert.equal(invalidStart.canApply, false);
  assert.ok(invalidStart.issues.some((issue) => issue.code === 'invalid-start-position'));
});

test('blank score matrices preserve data and have no applicable changes', () => {
  const preview = previewExamScorePaste('\t', {
    exam: createExam(),
    students,
    startStudentIndex: 0,
    startItemIndex: 0,
  });

  assert.equal(preview.canApply, false);
  assert.equal(preview.patches.length, 0);
  assert.ok(preview.issues.some((issue) => issue.code === 'no-score-changes'));
});

test('exam CSV template includes stable IDs and protects names and item headings', () => {
  const exam = createExam();
  exam.items[0].name = '=SUM(A1:A2)';
  const csv = createExamCsvTemplate(
    exam,
    [
      { id: '-student-a', name: '@Alice' },
      { id: 'student-b', name: 'Bob' },
    ],
    'en',
  );

  assert.ok(csv.startsWith('\uFEFFePet ID,Student Name'));
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false);
  assert.match(csv, /'=SUM\(A1:A2\) \/ 100/);
  assert.match(csv, /'-student-a/);
  assert.match(csv, /'@Alice/);
});
