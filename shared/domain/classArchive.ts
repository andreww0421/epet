import type { AppData, ClassData } from '../../src/store/types';

export const CLASS_ARCHIVE_CONFIRMATIONS = {
  archive: 'ARCHIVE CLASS',
  reopen: 'REOPEN CLASS',
} as const;
export type ClassArchiveAction = keyof typeof CLASS_ARCHIVE_CONFIRMATIONS;
export const CLASS_DELETE_CONFIRMATION = 'DELETE CLASS';
export type ClassLifecycleStatus = 'active' | 'archived';

export const normalizeArchivedAt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value : undefined;

export const isArchivedClass = (classroom: Pick<ClassData, 'archivedAt'>) =>
  normalizeArchivedAt(classroom.archivedAt) !== undefined;

/** The status is derived from compatible metadata; it is never stored twice. */
export const getClassLifecycleStatus = (
  classroom: Pick<ClassData, 'archivedAt'>,
): ClassLifecycleStatus => isArchivedClass(classroom) ? 'archived' : 'active';

export const getActiveClasses = (classes: ClassData[]) =>
  classes.filter((classroom) => !isArchivedClass(classroom));

export const findActiveClassIndex = (
  data: Pick<AppData, 'classes' | 'currentClassId'>,
  classId = data.currentClassId,
) => data.classes.findIndex((classroom) => classroom.id === classId && !isArchivedClass(classroom));

export const getClassDeletionImpact = (classroom: ClassData) => ({
  studentCount: classroom.students.length,
  evidenceCount: classroom.learningEvidenceRecords?.length ?? 0,
  examCount: classroom.examRecords?.length ?? 0,
});

/** Archiving changes availability, never educational records or game values. */
export const updateClassArchive = (
  data: AppData, classId: string, action: ClassArchiveAction, now: number,
): AppData => {
  const classroom = data.classes.find((item) => item.id === classId);
  if (!classroom) throw new Error('CLASS_NOT_FOUND');
  const archived = isArchivedClass(classroom);
  if ((action === 'archive') === archived) return data;
  if (action === 'archive' && getActiveClasses(data.classes).length <= 1) {
    throw new Error('LAST_ACTIVE_CLASS');
  }
  const classes = data.classes.map((item) => {
    if (item.id !== classId) return item;
    const { archivedAt: _previous, ...active } = item;
    return action === 'archive' ? { ...active, archivedAt: now } : active;
  });
  const activeClasses = getActiveClasses(classes);
  return {
    ...data,
    classes,
    currentClassId: activeClasses.some((item) => item.id === data.currentClassId)
      ? data.currentClassId : activeClasses[0]?.id ?? '',
  };
};

/** Permanent removal is distinct from reversible archive/restore operations. */
export const deleteClassFromWorkspace = (data: AppData, classId: string): AppData => {
  const classroom = data.classes.find((item) => item.id === classId);
  if (!classroom) throw new Error('CLASS_NOT_FOUND');
  if (!isArchivedClass(classroom) && getActiveClasses(data.classes).length <= 1) {
    throw new Error('LAST_ACTIVE_CLASS');
  }
  const classes = data.classes.filter((item) => item.id !== classId);
  const activeClasses = getActiveClasses(classes);
  return {
    ...data,
    classes,
    currentClassId: activeClasses.some((item) => item.id === data.currentClassId)
      ? data.currentClassId : activeClasses[0]?.id ?? '',
  };
};
