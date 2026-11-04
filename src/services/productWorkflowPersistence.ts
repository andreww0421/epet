import type { AppData } from '../store/types';
import {
  acknowledgeProductWorkflow, completeLocalProductWorkflow, isProductWorkflowPending, markProductWorkflowUnconfirmed,
  rejectProductWorkflow,
  subscribeProductWorkflowCleared, type ProductWorkflowToken,
} from '../analytics/workflows';

type Witness =
  | { kind: 'class'; classId: string }
  | { kind: 'student'; classId: string; studentId: string }
  | { kind: 'point'; classId: string; studentId: string; recordId: string; amount: number }
  | { kind: 'exam'; classId: string; examId: string };
type Receipt = { token: ProductWorkflowToken; witnesses: Witness[] };
const receipts = new Map<string, Receipt>();
const MAX_WITNESSES = 2000;
subscribeProductWorkflowCleared(() => receipts.clear());

/** Private effect witnesses live outside event metadata, drafts and browser storage. */
export const registerProductWorkflowPersistence = (
  token: ProductWorkflowToken | null, before: AppData, after: AppData,
) => {
  try {
    if (!token || !isProductWorkflowPending(token)) return;
    const witnesses: Witness[] = [];
    for (const classroom of after.classes) {
      const previous = before.classes.find((item) => item.id === classroom.id);
      if (token.flow === 'class_create' && !previous) witnesses.push({ kind: 'class', classId: classroom.id });
      if (!previous) continue;
      if (token.flow === 'roster_import') {
        for (const student of classroom.students) {
          if (!previous.students.some((item) => item.id === student.id)) {
            witnesses.push({ kind: 'student', classId: classroom.id, studentId: student.id });
          }
        }
      }
      if (token.flow === 'exam_create') {
        for (const exam of classroom.examRecords ?? []) {
          if (!(previous.examRecords ?? []).some((item) => item.id === exam.id)) {
            witnesses.push({ kind: 'exam', classId: classroom.id, examId: exam.id });
          }
        }
      }
      if (token.flow === 'point_increase' || token.flow === 'point_decrease') {
        for (const student of classroom.students) {
          const previousStudent = previous.students.find((item) => item.id === student.id);
          if (!previousStudent) continue;
          for (const record of student.pointAdjustmentRecords ?? []) {
            if (!(previousStudent.pointAdjustmentRecords ?? []).some((item) => item.id === record.id)) {
              witnesses.push({ kind: 'point', classId: classroom.id, studentId: student.id,
                recordId: record.id, amount: record.amount });
            }
          }
        }
      }
    }
    for (const [attempt, receipt] of receipts) if (!isProductWorkflowPending(receipt.token)) receipts.delete(attempt);
    // Oversized effects remain unconfirmed instead of retaining an unbounded private witness list.
    if (receipts.size >= 16) receipts.delete(receipts.keys().next().value!);
    receipts.set(token.attempt, { token, witnesses: witnesses.length <= MAX_WITNESSES ? witnesses : [] });
  } catch { /* Optional bookkeeping cannot affect accepted store operations. */ }
};

export const recordProductWorkflowCommandResult = (
  token: ProductWorkflowToken | null, before: AppData, after: AppData, accepted: boolean,
) => {
  try {
    if (!accepted) { rejectProductWorkflow(token); return; }
    registerProductWorkflowPersistence(token, before, after);
    completeLocalProductWorkflow(token);
  } catch { /* Store results are authoritative even when instrumentation fails. */ }
};
const represented = (data: AppData, witnesses: Witness[]) => witnesses.length > 0 && witnesses.every((witness) => {
  const classroom = data.classes.find((item) => item.id === witness.classId);
  if (!classroom) return false;
  if (witness.kind === 'class') return true;
  if (witness.kind === 'exam') return (classroom.examRecords ?? []).some((item) => item.id === witness.examId);
  const student = classroom.students.find((item) => item.id === witness.studentId);
  if (!student) return false;
  return witness.kind === 'student' || (student.pointAdjustmentRecords ?? []).some(
    (item) => item.id === witness.recordId && item.amount === witness.amount);
});

/** Capture only attempts existing when this exact draft goes in flight. Never watermark newer commands. */
export const captureProductWorkflowSave = (data: AppData) => {
  const captured: Array<{ receipt: Receipt; represented: boolean }> = [];
  try {
    for (const receipt of receipts.values()) {
      if (isProductWorkflowPending(receipt.token)) captured.push({ receipt, represented: represented(data, receipt.witnesses) });
      else receipts.delete(receipt.token.attempt);
    }
  } catch { /* No analytics receipt is safer than an unverifiable acknowledgement. */ }
  let settled = false;
  const settle = (freshWrite: boolean, confirmedData = data) => {
    if (settled) return;
    settled = true;
    for (const item of captured) {
      if (receipts.get(item.receipt.token.attempt) !== item.receipt) continue;
      receipts.delete(item.receipt.token.attempt);
      let confirmed = false;
      try { confirmed = freshWrite && item.represented && represented(confirmedData, item.receipt.witnesses); }
      catch { /* A malformed response is never persistence proof. */ }
      if (confirmed) acknowledgeProductWorkflow(item.receipt.token);
      else markProductWorkflowUnconfirmed(item.receipt.token);
    }
  };
  return {
    get classCreateIntent() { return captured.some((item) => item.represented &&
      item.receipt.token.flow === 'class_create' && receipts.get(item.receipt.token.attempt) === item.receipt &&
      isProductWorkflowPending(item.receipt.token)); },
    acknowledge: (confirmedData?: AppData) => settle(true, confirmedData),
    unconfirmed: () => settle(false),
  };
};
