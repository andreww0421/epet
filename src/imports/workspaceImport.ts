import { isArchivedClass } from '../../shared/domain/classArchive';
import type { AppData } from '../store/types';

export const hasWorkspaceImportShape = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.classes) || Array.isArray(record.students);
};

export const getWorkspaceImportImpact = (data: AppData) => ({
  classes: data.classes.length,
  students: data.classes.reduce((sum, classroom) => sum + classroom.students.length, 0),
  evidence: data.classes.reduce((sum, classroom) => sum + (classroom.learningEvidenceRecords?.length ?? 0), 0),
  exams: data.classes.reduce((sum, classroom) => sum + (classroom.examRecords?.length ?? 0), 0),
  archived: data.classes.filter(isArchivedClass).length,
});

export type WorkspaceImportImpact = ReturnType<typeof getWorkspaceImportImpact>;

export const matchesWorkspaceImportReview = (
  reviewed: { workspaceId: string; expectedRevision: number },
  workspaceId: string, revision: number,
) => reviewed.workspaceId === workspaceId && reviewed.expectedRevision === revision;
