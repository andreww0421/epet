import Papa from 'papaparse';

import type {
  ExamRecord,
  Language,
  Student,
} from '../store/types';

export const MAX_ROSTER_FILE_BYTES = 256 * 1024;
export const MAX_ROSTER_STUDENTS = 200;
export const MAX_STUDENT_NAME_LENGTH = 80;

export type ImportIssueSeverity = 'error' | 'warning';

export type TabularImportIssueCode =
  | 'file-too-large'
  | 'missing-name-header'
  | 'duplicate-name-header'
  | 'parse-error'
  | 'too-many-students'
  | 'empty-name'
  | 'name-too-long'
  | 'formula-risk'
  | 'existing-student'
  | 'duplicate-student'
  | 'no-new-students'
  | 'empty-paste'
  | 'invalid-start-position'
  | 'matrix-overflow'
  | 'invalid-score'
  | 'negative-score'
  | 'score-over-maximum'
  | 'no-score-changes';

export type TabularImportIssue = {
  code: TabularImportIssueCode;
  severity: ImportIssueSeverity;
  row?: number;
  column?: number;
  details?: Record<string, string | number>;
};

export type RosterImportRow = {
  rowNumber: number;
  name: string;
  status: 'add' | 'existing' | 'duplicate' | 'invalid';
};

export type RosterImportPreview = {
  rows: RosterImportRow[];
  additions: string[];
  issues: TabularImportIssue[];
  delimiter: string;
  canApply: boolean;
  sourceBytes: number;
};

export type ExamScorePasteOptions = {
  exam: ExamRecord;
  students: readonly Pick<Student, 'id' | 'name'>[];
  startStudentIndex: number;
  startItemIndex: number;
};

export type ExamScorePatch = {
  row: number;
  column: number;
  targetStudentIndex: number;
  targetItemIndex: number;
  studentId: string;
  studentName: string;
  itemId: string;
  itemName: string;
  score: number;
  previousScore?: number;
};

export type ExamScorePastePreview = {
  examId: string;
  startStudentIndex: number;
  startItemIndex: number;
  rowCount: number;
  columnCount: number;
  patches: ExamScorePatch[];
  issues: TabularImportIssue[];
  canApply: boolean;
};

const NAME_HEADER_ALIASES = new Set([
  '姓名',
  '學生姓名',
  '学生姓名',
  '學生',
  '学生',
  'name',
  'student',
  'studentname',
  'learner',
  'learnername',
]);

const DECIMAL_SCORE_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const FORMULA_RISK_PATTERN = /^[\s]*[=+\-@]/;

const getSourceBytes = (source: string) => new TextEncoder().encode(source).byteLength;

const normalizeHeader = (value: string) =>
  value
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, '');

export const normalizeRosterName = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');

const getRosterIdentity = (value: string) =>
  normalizeRosterName(value).toLocaleLowerCase();

const isBlankRow = (row: readonly string[]) =>
  row.every((cell) => cell.trim() === '');

const trimTrailingBlankRows = (rows: string[][]) => {
  const trimmed = [...rows];
  while (trimmed.length > 0 && isBlankRow(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }
  return trimmed;
};

const toStringRows = (rows: unknown[][]) =>
  rows.map((row) => row.map((cell) => String(cell ?? '')));

const getParseIssues = (errors: Papa.ParseError[]): TabularImportIssue[] =>
  errors
    .filter((error) => error.code !== 'UndetectableDelimiter')
    .map((error) => ({
      code: 'parse-error' as const,
      severity: 'error' as const,
      row: Number.isInteger(error.row) ? error.row + 1 : undefined,
      details: {
        parserCode: error.code,
      },
    }));

const emptyRosterPreview = (
  sourceBytes: number,
  issues: TabularImportIssue[],
): RosterImportPreview => ({
  rows: [],
  additions: [],
  issues,
  delimiter: ',',
  canApply: false,
  sourceBytes,
});

export const previewRosterImport = (
  source: string,
  existingStudents: readonly Pick<Student, 'name'>[],
): RosterImportPreview => {
  const sourceBytes = getSourceBytes(source);
  if (sourceBytes > MAX_ROSTER_FILE_BYTES) {
    return emptyRosterPreview(sourceBytes, [{
      code: 'file-too-large',
      severity: 'error',
      details: {
        actualBytes: sourceBytes,
        maximumBytes: MAX_ROSTER_FILE_BYTES,
      },
    }]);
  }

  const parseSource = source
    .replace(/^\uFEFF/, '')
    .replace(/(?:\r\n|\r|\n)+$/, '');
  const parsed = Papa.parse<string[]>(parseSource, {
    delimiter: '',
    delimitersToGuess: [',', '\t'],
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const parsedRows = trimTrailingBlankRows(toStringRows(parsed.data));
  const issues = getParseIssues(parsed.errors);
  const delimiter = parsed.meta.delimiter === '\t' ? '\t' : ',';

  if (parsedRows.length === 0) {
    issues.push({ code: 'missing-name-header', severity: 'error', row: 1 });
    return {
      ...emptyRosterPreview(sourceBytes, issues),
      delimiter,
    };
  }

  const nameColumns = parsedRows[0]
    .map((header, index) => NAME_HEADER_ALIASES.has(normalizeHeader(header)) ? index : -1)
    .filter((index) => index >= 0);
  if (nameColumns.length === 0) {
    issues.push({ code: 'missing-name-header', severity: 'error', row: 1 });
  } else if (nameColumns.length > 1) {
    issues.push({
      code: 'duplicate-name-header',
      severity: 'error',
      row: 1,
      details: { count: nameColumns.length },
    });
  }

  const dataRows = parsedRows.slice(1);
  if (dataRows.length > MAX_ROSTER_STUDENTS) {
    issues.push({
      code: 'too-many-students',
      severity: 'error',
      details: {
        actualStudents: dataRows.length,
        maximumStudents: MAX_ROSTER_STUDENTS,
      },
    });
  }

  const rows: RosterImportRow[] = [];
  const additions: string[] = [];
  const existingNames = new Set(
    existingStudents.map((student) => getRosterIdentity(student.name)),
  );
  const seenNames = new Set<string>();
  const nameColumn = nameColumns[0];

  if (nameColumn != null) {
    dataRows.slice(0, MAX_ROSTER_STUDENTS).forEach((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const rawName = row[nameColumn] ?? '';
      const name = normalizeRosterName(rawName);
      const identity = getRosterIdentity(name);

      if (!name) {
        rows.push({ rowNumber, name, status: 'invalid' });
        issues.push({ code: 'empty-name', severity: 'error', row: rowNumber });
        return;
      }
      if (FORMULA_RISK_PATTERN.test(name)) {
        rows.push({ rowNumber, name, status: 'invalid' });
        issues.push({ code: 'formula-risk', severity: 'error', row: rowNumber });
        return;
      }
      const nameLength = Array.from(name).length;
      if (nameLength > MAX_STUDENT_NAME_LENGTH) {
        rows.push({ rowNumber, name, status: 'invalid' });
        issues.push({
          code: 'name-too-long',
          severity: 'error',
          row: rowNumber,
          details: {
            actualLength: nameLength,
            maximumLength: MAX_STUDENT_NAME_LENGTH,
          },
        });
        return;
      }
      if (existingNames.has(identity)) {
        rows.push({ rowNumber, name, status: 'existing' });
        issues.push({
          code: 'existing-student',
          severity: 'warning',
          row: rowNumber,
          details: { name },
        });
        seenNames.add(identity);
        return;
      }
      if (seenNames.has(identity)) {
        rows.push({ rowNumber, name, status: 'duplicate' });
        issues.push({
          code: 'duplicate-student',
          severity: 'warning',
          row: rowNumber,
          details: { name },
        });
        return;
      }

      seenNames.add(identity);
      rows.push({ rowNumber, name, status: 'add' });
      additions.push(name);
    });
  }

  if (additions.length === 0 && !issues.some((issue) => issue.severity === 'error')) {
    issues.push({ code: 'no-new-students', severity: 'warning' });
  }
  const hasErrors = issues.some((issue) => issue.severity === 'error');

  return {
    rows,
    additions,
    issues,
    delimiter,
    canApply: !hasErrors && additions.length > 0,
    sourceBytes,
  };
};

const emptyExamPreview = (
  options: ExamScorePasteOptions,
  issues: TabularImportIssue[],
): ExamScorePastePreview => ({
  examId: options.exam.id,
  startStudentIndex: options.startStudentIndex,
  startItemIndex: options.startItemIndex,
  rowCount: 0,
  columnCount: 0,
  patches: [],
  issues,
  canApply: false,
});

export const previewExamScorePaste = (
  source: string,
  options: ExamScorePasteOptions,
): ExamScorePastePreview => {
  const parsed = Papa.parse<string[]>(source.replace(/^\uFEFF/, ''), {
    delimiter: '\t',
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const rows = trimTrailingBlankRows(toStringRows(parsed.data));
  const issues = getParseIssues(parsed.errors);
  const rowCount = rows.length;
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);

  if (rowCount === 0) {
    issues.push(source.length === 0
      ? { code: 'empty-paste', severity: 'error' }
      : { code: 'no-score-changes', severity: 'warning' });
    return emptyExamPreview(options, issues);
  }

  const validStart =
    Number.isInteger(options.startStudentIndex) &&
    Number.isInteger(options.startItemIndex) &&
    options.startStudentIndex >= 0 &&
    options.startStudentIndex < options.students.length &&
    options.startItemIndex >= 0 &&
    options.startItemIndex < options.exam.items.length;
  if (!validStart) {
    issues.push({
      code: 'invalid-start-position',
      severity: 'error',
      details: {
        startStudentIndex: options.startStudentIndex,
        startItemIndex: options.startItemIndex,
      },
    });
  }

  const availableRows = Math.max(0, options.students.length - options.startStudentIndex);
  const availableColumns = Math.max(0, options.exam.items.length - options.startItemIndex);
  if (rowCount > availableRows || columnCount > availableColumns) {
    issues.push({
      code: 'matrix-overflow',
      severity: 'error',
      details: {
        pastedRows: rowCount,
        pastedColumns: columnCount,
        availableRows,
        availableColumns,
      },
    });
  }

  const resultByStudentId = new Map(
    options.exam.results.map((result) => [result.studentId, result] as const),
  );
  const patches: ExamScorePatch[] = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((rawCell, columnIndex) => {
      const targetStudentIndex = options.startStudentIndex + rowIndex;
      const targetItemIndex = options.startItemIndex + columnIndex;
      const student = options.students[targetStudentIndex];
      const item = options.exam.items[targetItemIndex];
      const cell = rawCell.normalize('NFKC').trim();
      if (!cell || !student || !item) return;

      if (!DECIMAL_SCORE_PATTERN.test(cell)) {
        issues.push({
          code: FORMULA_RISK_PATTERN.test(cell) ? 'formula-risk' : 'invalid-score',
          severity: 'error',
          row: rowIndex + 1,
          column: columnIndex + 1,
          details: {
            studentName: student.name,
            itemName: item.name,
          },
        });
        return;
      }

      const score = Number(cell);
      if (!Number.isFinite(score)) {
        issues.push({
          code: 'invalid-score',
          severity: 'error',
          row: rowIndex + 1,
          column: columnIndex + 1,
          details: {
            studentName: student.name,
            itemName: item.name,
          },
        });
        return;
      }
      if (score < 0) {
        issues.push({
          code: 'negative-score',
          severity: 'error',
          row: rowIndex + 1,
          column: columnIndex + 1,
          details: {
            studentName: student.name,
            itemName: item.name,
          },
        });
        return;
      }
      if (score > item.maxScore) {
        issues.push({
          code: 'score-over-maximum',
          severity: 'error',
          row: rowIndex + 1,
          column: columnIndex + 1,
          details: {
            studentName: student.name,
            itemName: item.name,
            maximumScore: item.maxScore,
            score,
          },
        });
        return;
      }

      patches.push({
        row: rowIndex + 1,
        column: columnIndex + 1,
        targetStudentIndex,
        targetItemIndex,
        studentId: student.id,
        studentName: student.name,
        itemId: item.id,
        itemName: item.name,
        score,
        previousScore: resultByStudentId.get(student.id)?.scores[item.id],
      });
    });
  });

  if (patches.length === 0 && !issues.some((issue) => issue.severity === 'error')) {
    issues.push({ code: 'no-score-changes', severity: 'warning' });
  }
  const hasErrors = issues.some((issue) => issue.severity === 'error');

  return {
    examId: options.exam.id,
    startStudentIndex: options.startStudentIndex,
    startItemIndex: options.startItemIndex,
    rowCount,
    columnCount,
    patches,
    issues,
    canApply: !hasErrors && patches.length > 0,
  };
};

export const applyExamScorePaste = (
  exam: ExamRecord,
  preview: ExamScorePastePreview,
  now = Date.now(),
): ExamRecord => {
  if (!preview.canApply || preview.examId !== exam.id) {
    throw new Error('Cannot apply an invalid or stale exam score paste preview.');
  }

  const itemById = new Map(exam.items.map((item) => [item.id, item] as const));
  const patchesByStudent = new Map<string, ExamScorePatch[]>();
  const targetKeys = new Set<string>();
  preview.patches.forEach((patch) => {
    const item = itemById.get(patch.itemId);
    const targetKey = `${patch.studentId}\u0000${patch.itemId}`;
    if (
      !item ||
      !Number.isFinite(patch.score) ||
      patch.score < 0 ||
      patch.score > item.maxScore ||
      targetKeys.has(targetKey)
    ) {
      throw new Error('Cannot apply an invalid or stale exam score paste preview.');
    }
    targetKeys.add(targetKey);
    const studentPatches = patchesByStudent.get(patch.studentId) ?? [];
    studentPatches.push(patch);
    patchesByStudent.set(patch.studentId, studentPatches);
  });

  const existingStudentIds = new Set(exam.results.map((result) => result.studentId));
  const results = exam.results.map((result) => {
    const studentPatches = patchesByStudent.get(result.studentId);
    if (!studentPatches) return result;
    const scores = { ...result.scores };
    studentPatches.forEach((patch) => {
      scores[patch.itemId] = patch.score;
    });
    return {
      ...result,
      scores,
      updatedAt: now,
    };
  });

  patchesByStudent.forEach((studentPatches, studentId) => {
    if (existingStudentIds.has(studentId)) return;
    results.push({
      studentId,
      scores: Object.fromEntries(
        studentPatches.map((patch) => [patch.itemId, patch.score]),
      ),
      updatedAt: now,
    });
  });

  return {
    ...exam,
    results,
    updatedAt: now,
  };
};

const normalizeCsvLineEndings = (value: string) =>
  value.replace(/\r\n|\r|\n/g, '\r\n');

const protectSpreadsheetText = (value: string) => {
  const normalized = normalizeCsvLineEndings(value);
  return FORMULA_RISK_PATTERN.test(normalized) ? `'${normalized}` : normalized;
};

const createCsv = (rows: Array<Array<string | number>>) => {
  const protectedRows = rows.map((row) => row.map((cell) =>
    typeof cell === 'string' ? protectSpreadsheetText(cell) : cell
  ));
  const body = Papa.unparse(protectedRows, {
    delimiter: ',',
    newline: '\r\n',
    escapeFormulae: true,
  });
  return `\uFEFF${body.replace(/(?:\r\n)+$/, '')}\r\n`;
};

export const createRosterCsvTemplate = (
  language: Language = 'zh',
  names: readonly string[] = [],
) => createCsv([
  [language === 'en' ? 'Student Name' : '姓名'],
  ...names.map((name) => [name]),
]);

export const createExamCsvTemplate = (
  exam: ExamRecord,
  students: readonly Pick<Student, 'id' | 'name'>[],
  language: Language = 'zh',
) => createCsv([
  [
    'ePet ID',
    language === 'en' ? 'Student Name' : '姓名',
    ...exam.items.map((item) => `${item.name} / ${item.maxScore}`),
  ],
  ...students.map((student) => {
    const result = exam.results.find((candidate) => candidate.studentId === student.id);
    return [
      student.id,
      student.name,
      ...exam.items.map((item) => result?.scores[item.id] ?? ''),
    ];
  }),
]);
