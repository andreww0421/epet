import type { ConsoleDestination } from '../../teacher-console/model/navigation';

/** Console-only selection; never a persisted assessment or an authorization grant. */
export type LearningStudentSelection = {
  studentId: string;
  onStudentChange: (studentId: string) => void;
};

export type LearningWorkflowStep = 'record' | 'progress' | 'report';

export const getLearningWorkflowStep = (destination: ConsoleDestination): LearningWorkflowStep | null => {
  if (['evidence', 'exams', 'comments', 'goals'].includes(destination)) return 'record';
  if (['trends', 'student-insights', 'class-insights'].includes(destination)) return 'progress';
  return destination === 'reports' ? 'report' : null;
};

export const resolveLearningStudent = (
  classId: string,
  students: readonly { id: string }[],
  selection: { classId: string; studentId: string } | null,
) => students.find((student) => selection?.classId === classId && student.id === selection.studentId)?.id
  ?? students[0]?.id ?? '';
