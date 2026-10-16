import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { getWorkspaceImportImpact, hasWorkspaceImportShape, matchesWorkspaceImportReview } from '../../../imports/workspaceImport';
import { importWorkspaceBackup } from '../../../services/backendApi';
import type { AppData, Language } from '../../../store/types';
import { normalizeAppData } from '../../../store/utils';
import { useWorkspacePrivacyOperation } from './useWorkspacePrivacyOperation';

export type WorkspaceImportReview = {
  workspaceId: string;
  workspaceName: string;
  expectedRevision: number;
  data: AppData;
  currentImpact: ReturnType<typeof getWorkspaceImportImpact>;
  incomingImpact: ReturnType<typeof getWorkspaceImportImpact>;
};

/** Preserves full-backup recovery through reviewed, revision-pinned server writes. */
export const useWorkspaceImportReview = (
  language: Language, flushChanges: () => Promise<boolean>, canWrite = true,
) => {
  const operation = useWorkspacePrivacyOperation(language, flushChanges);
  const { session } = useAuth();
  const [review, setReview] = useState<WorkspaceImportReview | null>(null);
  const current = useRef({ workspaceId: operation.workspaceId, allowed: operation.allowed && canWrite });
  current.current = { workspaceId: operation.workspaceId, allowed: operation.allowed && canWrite };
  useEffect(() => { setReview(null); }, [operation.workspaceId]);
  const reviewImport = async (input: unknown, workspaceId = operation.workspaceId) => {
    if (!workspaceId || workspaceId !== current.current.workspaceId || !current.current.allowed ||
        !hasWorkspaceImportShape(input)) return false;
    const now = Date.now();
    const data = normalizeAppData(input, now);
    return operation.execute(async (targetWorkspaceId, expectedRevision, existing) => {
      if (!existing || targetWorkspaceId !== workspaceId || !current.current.allowed) throw new Error('TARGET_CHANGED');
      setReview({ workspaceId, expectedRevision,
        workspaceName: session?.workspaces.find((item) => item.id === workspaceId)?.name ?? '',
        data, currentImpact: getWorkspaceImportImpact(existing), incomingImpact: getWorkspaceImportImpact(data) });
    }, false);
  };
  const stillReviewed = () => !!review && current.current.allowed && review.workspaceId === current.current.workspaceId;
  const replaceWorkspace = async (confirmation: string, acknowledged: boolean) => {
    if (!stillReviewed() || operation.busy || !acknowledged || confirmation !== 'IMPORT WORKSPACE') return;
    await operation.execute((workspaceId, expectedRevision, existing) => {
      if (!matchesWorkspaceImportReview(review, workspaceId, expectedRevision) || !existing ||
          JSON.stringify(getWorkspaceImportImpact(existing)) !== JSON.stringify(review.currentImpact)) {
        throw new Error('TARGET_CHANGED');
      }
      return importWorkspaceBackup(review.data, { expectedRevision, confirmation, acknowledgeReplacement: true }, workspaceId);
    });
  };
  return { ...operation, review: review?.workspaceId === operation.workspaceId && canWrite ? review : null,
    reviewImport, replaceWorkspace, closeReview: () => { if (!operation.busy) setReview(null); } };
};
