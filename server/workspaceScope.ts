import type { AppData, ClassData } from '../src/store/types';
import type { StoredWorkspace } from './contracts';

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

export const scopeWorkspaceData = (
  data: AppData,
  assignedClassIds: ReadonlySet<string>,
): AppData => {
  const classes = assignedClasses(data, assignedClassIds);
  if (classes.length === 0) {
    throw new WorkspaceScopeViolationError('NO_ASSIGNED_CLASSES');
  }
  return {
    ...data,
    classes: structuredClone(classes),
    currentClassId: classes.some(
      (classData) => classData.id === data.currentClassId,
    )
      ? data.currentClassId
      : classes[0].id,
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
  return {
    ...current,
    classes: current.classes.map((classData) => {
      const replacement = incomingById.get(classData.id);
      return replacement
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
