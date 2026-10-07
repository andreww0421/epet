import type { Student } from '../../../store/types';

/** One canonical definition shared by daily comments and the read-only Today summary. */
export const getMentorFeedbackCount = (students: Student[], schoolDate: string) => students.filter((student) =>
  student.dailyProgress?.reflections?.some((reflection) => reflection.date === schoolDate && reflection.author === 'mentor'),
).length;
