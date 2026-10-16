import type { AppData, ClassData } from '../src/store/types';
import type { StoredWorkspace } from './contracts';
import { getActiveClasses, isArchivedClass } from '../shared/domain/classArchive';

export class WorkspaceScopeViolationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const uniqueClassIds = (classes: ClassData[]) => {
  const ids = classes.map((classData) => classData.id);
  return new Set(ids).size === ids.length ? ids : null;
};

const assignedClasses = (
  data: AppData,
  assignedClassIds: ReadonlySet<string>,
) => data.classes.filter((classData) => assignedClassIds.has(classData.id));

/** Ordinary state sync cannot perform lifecycle transitions, even for owners.
 * Accept the raw or once-normalized read-only archive and retain trusted data.
 */
export const protectClassLifecycleWrite = (
  current: AppData,
  incoming: AppData,
  archiveSnapshots: { comparison?: AppData; submitted?: AppData } = {},
): AppData => {
  if (!uniqueClassIds(incoming.classes)) {
    throw new WorkspaceScopeViolationError('CLASS_SCOPE_CHANGED');
  }
  const incomingById = new Map(incoming.classes.map((item) => [item.id, item]));
  const currentById = new Map(current.classes.map((item) => [item.id, item]));
  const comparison = new Map((archiveSnapshots.comparison ?? current).classes
    .map((item) => [item.id, item]));
  const submitted = new Map((archiveSnapshots.submitted ?? incoming).classes
    .map((item) => [item.id, item]));
  for (const classroom of current.classes) {
    const replacement = incomingById.get(classroom.id);
    if (!replacement) {
      throw new WorkspaceScopeViolationError('CLASS_DELETE_REQUIRES_LIFECYCLE');
    }
    const raw = submitted.get(classroom.id);
    const rawJson = JSON.stringify(raw);
    if (raw?.archivedAt !== classroom.archivedAt || replacement.archivedAt !== classroom.archivedAt ||
      (isArchivedClass(classroom) && rawJson !== JSON.stringify(classroom) &&
        rawJson !== JSON.stringify(comparison.get(classroom.id)))) {
      throw new WorkspaceScopeViolationError('CLASS_ARCHIVE_CHANGED');
    }
  }
  // Newly created classes must enter the active lifecycle, not bypass archive.
  for (const classroom of incoming.classes) {
    if (!currentById.has(classroom.id) &&
      (classroom.archivedAt !== undefined || submitted.get(classroom.id)?.archivedAt !== undefined)) {
      throw new WorkspaceScopeViolationError('CLASS_ARCHIVE_CHANGED');
    }
  }
  return {
    ...incoming,
    classes: incoming.classes.map((classroom) => {
      const original = currentById.get(classroom.id);
      return original && isArchivedClass(original) ? original : classroom;
    }),
  };
};

export const scopeWorkspaceData = (
  data: AppData,
  assignedClassIds: ReadonlySet<string>,
): AppData => {
  const classes = assignedClasses(data, assignedClassIds);
  if (classes.length === 0) {
    throw new WorkspaceScopeViolationError('NO_ASSIGNED_CLASSES');
  }
  const activeClasses = getActiveClasses(classes);
  return {
    ...data,
    classes: structuredClone(classes),
    currentClassId: activeClasses.some(
      (classData) => classData.id === data.currentClassId,
    )
      ? data.currentClassId
      : activeClasses[0]?.id ?? '',
    settings: data.settings ? structuredClone(data.settings) : undefined,
  };
};

export const scopeStoredWorkspace = (
  workspace: StoredWorkspace,
  assignedClassIds: ReadonlySet<string>,
): StoredWorkspace => ({
  ...workspace,
  data: workspace.data
    ? scopeWorkspaceData(workspace.data, assignedClassIds)
    : null,
});

export const mergeTeacherWorkspaceData = (
  current: AppData,
  incoming: AppData,
  assignedClassIds: ReadonlySet<string>,
  archiveSnapshots: { comparison?: AppData; submitted?: AppData } = {},
): AppData => {
  const currentAssignedClasses = assignedClasses(current, assignedClassIds);
  if (currentAssignedClasses.length === 0) {
    throw new WorkspaceScopeViolationError('NO_ASSIGNED_CLASSES');
  }

  const incomingIds = uniqueClassIds(incoming.classes);
  const expectedIds = new Set(
    currentAssignedClasses.map((classData) => classData.id),
  );
  if (
    !incomingIds ||
    incomingIds.length !== expectedIds.size ||
    incomingIds.some((classId) => !expectedIds.has(classId))
  ) {
    throw new WorkspaceScopeViolationError('CLASS_SCOPE_CHANGED');
  }

  if (JSON.stringify(incoming.settings) !== JSON.stringify(current.settings)) {
    throw new WorkspaceScopeViolationError('WORKSPACE_SETTINGS_CHANGED');
  }

  const incomingById = new Map(
    incoming.classes.map((classData) => [classData.id, classData]),
  );
  for (const classroom of currentAssignedClasses) {
    const replacement = incomingById.get(classroom.id);
    if (classroom.students.some((student) => !replacement?.students.some((item) => item.id === student.id))) {
      throw new WorkspaceScopeViolationError('STUDENT_PRIVACY_ADMIN_REQUIRED');
    }
  }
  protectClassLifecycleWrite({ ...current, classes: currentAssignedClasses }, incoming, archiveSnapshots);
  return {
    ...current,
    classes: current.classes.map((classData) => {
      const replacement = incomingById.get(classData.id);
      // Validate archived input against the same canonical normalization, but
      // retain the trusted snapshot itself (including exact game/record data).
      return replacement && !isArchivedClass(classData)
        ? {
            ...structuredClone(replacement),
            id: classData.id,
            name: classData.name,
          }
        : classData;
    }),
    currentClassId: current.currentClassId,
    settings: current.settings,
    lastOpened: current.lastOpened,
  };
};
