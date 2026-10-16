import type { ClassArchiveAction } from '../../../../shared/domain/classArchive';
import { deleteClassOnBackend, manageClassArchive } from '../../../services/backendApi';
import type { ClassData, Language } from '../../../store/types';
import { useWorkspacePrivacyOperation } from './useWorkspacePrivacyOperation';
import { matchesReviewedClass } from '../model/classLifecycleReview';

export type ClassLifecycleAction = ClassArchiveAction | 'delete';

/** Pins the reviewed target to existing sync, workspace, membership and revision guards. */
export const useClassLifecycleAction = (language: Language, flushChanges: () => Promise<boolean>) => {
  const operation = useWorkspacePrivacyOperation(language, flushChanges);
  const runClassAction = async (
    target: ClassData, reviewedWorkspaceId: string | null, action: ClassLifecycleAction, confirmation: string,
    acknowledgePermanentDeletion = false,
  ) => {
    if (!reviewedWorkspaceId || reviewedWorkspaceId !== operation.workspaceId ||
        (action === 'delete' && !acknowledgePermanentDeletion)) return false;
    return operation.execute((workspaceId, expectedRevision, data) => {
      const latest = data?.classes.find((item) => item.id === target.id);
      if (!matchesReviewedClass(target, reviewedWorkspaceId, workspaceId, latest, action === 'delete')) {
        throw new Error('TARGET_CHANGED');
      }
      return action === 'delete'
        ? deleteClassOnBackend(target.id, { expectedRevision, confirmation, acknowledgePermanentDeletion: true }, workspaceId)
        : manageClassArchive(target.id, action, { expectedRevision, confirmation }, workspaceId);
    });
  };
  return { ...operation, runClassAction };
};
