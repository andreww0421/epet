import type { AppData, ExamRecord, Student } from '../../../store/types';

export type ExamRosterStudent = Pick<Student, 'id' | 'name'>;
export type ExamAssessmentContext = {
  id: string;
  name: string;
  students: ExamRosterStudent[];
  examRecords: ExamRecord[];
};

const EMPTY_EXAMS: ExamRecord[] = [];

/** One cache per mounted panel, never shared between accounts or workspaces.
 * Exam editing needs roster identity, not mutable game or learning records.
 */
export const createExamAssessmentContextSelector = (classId?: string) => {
  let previous: ExamAssessmentContext | undefined;
  let previousGeneration: number | undefined;
  return (data: AppData, sessionGeneration: number): ExamAssessmentContext | undefined => {
    if (sessionGeneration !== previousGeneration) {
      previous = undefined;
      previousGeneration = sessionGeneration;
    }
    const classroom = data.classes.find((item) => item.id === (classId ?? data.currentClassId));
    if (!classroom) {
      previous = undefined;
      return undefined;
    }
    const sameRoster = previous?.id === classroom.id &&
      previous.students.length === classroom.students.length &&
      classroom.students.every((student, index) =>
        previous!.students[index].id === student.id && previous!.students[index].name === student.name);
    const students = sameRoster ? previous!.students : classroom.students.map(({ id, name }) => ({ id, name }));
    const examRecords = classroom.examRecords ?? EMPTY_EXAMS;
    if (previous?.id === classroom.id && previous.name === classroom.name &&
        previous.students === students && previous.examRecords === examRecords) return previous;
    previous = { id: classroom.id, name: classroom.name, students, examRecords };
    return previous;
  };
};
