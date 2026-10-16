import { isArchivedClass } from '../../../../shared/domain/classArchive';
import type { ClassData } from '../../../store/types';

/** A review belongs to one workspace, even when two workspaces reuse class IDs. */
export const matchesReviewedClass = (
  target: ClassData, reviewedWorkspaceId: string | null,
  workspaceId: string, latest: ClassData | undefined, deleting: boolean,
): boolean => !!reviewedWorkspaceId && reviewedWorkspaceId === workspaceId && !!latest &&
  latest.id === target.id && latest.name === target.name && latest.archivedAt === target.archivedAt &&
  isArchivedClass(latest) === isArchivedClass(target) && (!deleting || (
    latest.students.length === target.students.length &&
    (latest.learningEvidenceRecords?.length ?? 0) === (target.learningEvidenceRecords?.length ?? 0) &&
    (latest.examRecords?.length ?? 0) === (target.examRecords?.length ?? 0)
  ));
