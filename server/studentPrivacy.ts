import type { AppData } from '../src/store/types';

const collectStudentIds = (data: AppData | null): Set<string> => new Set(
  data?.classes.flatMap((classroom) =>
    classroom.students.map((student) => student.id),
  ) ?? [],
);

export const findPermanentlyDeletedStudentIds = (
  previous: AppData | null,
  next: AppData,
): Set<string> => {
  const nextIds = collectStudentIds(next);
  return new Set(
    [...collectStudentIds(previous)].filter((studentId) => !nextIds.has(studentId)),
  );
};

export const purgeStudentsFromWorkspaceData = (
  data: AppData,
  deletedStudentIds: ReadonlySet<string>,
): AppData => {
  if (deletedStudentIds.size === 0) return data;
  return {
    ...data,
    classes: data.classes.map((classroom) => ({
      ...classroom,
      students: classroom.students
        .filter((student) => !deletedStudentIds.has(student.id))
        .map((student) => deletedStudentIds.has(student.teammateId ?? '')
          ? { ...student, teammateId: undefined, teamId: undefined }
          : student),
      learningEvidenceRecords: classroom.learningEvidenceRecords?.filter(
        (record) => !deletedStudentIds.has(record.studentId),
      ),
      examRecords: classroom.examRecords?.map((exam) => ({
        ...exam,
        results: exam.results.filter(
          (result) => !deletedStudentIds.has(result.studentId),
        ),
      })),
      activeBoss: classroom.activeBoss
        ? {
            ...classroom.activeBoss,
            contributions: Object.fromEntries(
              Object.entries(classroom.activeBoss.contributions).filter(
                ([studentId]) => !deletedStudentIds.has(studentId),
              ),
            ),
            attackCounts: classroom.activeBoss.attackCounts
              ? Object.fromEntries(
                  Object.entries(classroom.activeBoss.attackCounts).filter(
                    ([studentId]) => !deletedStudentIds.has(studentId),
                  ),
                )
              : undefined,
          }
        : undefined,
    })),
  };
};
