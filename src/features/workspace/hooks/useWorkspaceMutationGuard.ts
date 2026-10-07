import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { runWorkspaceMutation } from '../../../auth/workspaceAccess';
import { useStore } from '../../../store/useStore';

export type WorkspaceMutationRunner = <T>(mutation: () => T) => T | undefined;

/**
 * Binds the shared workspace write guard to the current UI language.
 *
 * Feature components stay mounted when capabilities change so their drafts are
 * preserved, while every store mutation still observes the current write
 * permission just like the former DashboardView proxy did.
 */
export const useWorkspaceMutationGuard = (
  canWrite: boolean,
): WorkspaceMutationRunner => {
  const { language, showToast } = useStore(useShallow((state) => ({
    language: state.data.settings?.language || 'zh',
    showToast: state.showToast,
  })));

  return useCallback(
    <T,>(mutation: () => T) => runWorkspaceMutation(
      canWrite,
      mutation,
      () => showToast(
        language === 'en'
          ? 'This workspace is read-only for your account.'
          : '目前帳號只能閱讀此工作區。',
        'error',
      ),
    ),
    [canWrite, language, showToast],
  );
};
