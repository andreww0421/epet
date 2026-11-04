import { useCallback, useEffect, useRef, useState } from 'react';
import { isWorkspaceAccess, workspaceAccessKey, type WorkspaceAccess } from '../../../../shared/contracts/workspace';
import type { AppData } from '../../../store/types';
import {
  buildTeacherSetupSteps, consumeTeacherSetupRegistration, createTeacherSetupState,
  patchTeacherSetupState, readTeacherSetupState, writeTeacherSetupState,
  type TeacherSetupGameMode, type TeacherSetupPatch, type TeacherSetupState,
} from '../model/teacherSetup';

type Snapshot = { key: string | null; state: TeacherSetupState; ready: boolean; storageAvailable: boolean; dirty: boolean };
type Update = TeacherSetupPatch | ((previous: TeacherSetupState) => TeacherSetupPatch);
const emptySnapshot = (): Snapshot => ({ key: null, state: createTeacherSetupState(), ready: false, storageAvailable: false, dirty: false });

/** Access must be null until backend sync has loaded this exact verified scope. */
export const useTeacherSetup = (access: WorkspaceAccess | null, data: AppData, enabled: boolean) => {
  const key = enabled && isWorkspaceAccess(access) ? workspaceAccessKey(access) : null;
  const latestKey = useRef(key);
  latestKey.current = key;
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);

  // Mask the previous scope during render, before effects run, including a
  // sign-out, workspace switch, or changed role/class allowlist.
  const current = snapshot.key === key && key !== null ? snapshot : emptySnapshot();

  useEffect(() => {
    if (!key || !access) {
      setSnapshot((previous) => previous.key === null ? previous : emptySnapshot());
      return;
    }
    const loaded = readTeacherSetupState(access);
    if (consumeTeacherSetupRegistration(access)) {
      loaded.state = { ...loaded.state, mode: 'active' };
      // Commit enrollment immediately so repeated development effects cannot
      // replace the consumed registration with the idle default.
      loaded.storageAvailable = writeTeacherSetupState(access, loaded.state);
    }
    if (latestKey.current === key) setSnapshot({ key, ...loaded, ready: true, dirty: false });
  }, [key]);

  const update = useCallback((patch: Update) => {
    if (!key || latestKey.current !== key) return;
    setSnapshot((previous) => {
      if (previous.key !== key || !previous.ready) return previous;
      const state = patchTeacherSetupState(previous.state, typeof patch === 'function' ? patch(previous.state) : patch);
      if (state.mode === previous.state.mode && state.reviewed === previous.state.reviewed && state.gameMode === previous.state.gameMode) return previous;
      return { ...previous, state, dirty: true };
    });
  }, [key]);

  useEffect(() => {
    if (!key || !access || !current.ready || !current.dirty || latestKey.current !== key) return;
    const storageAvailable = writeTeacherSetupState(access, current.state);
    setSnapshot((previous) => previous.key === key && previous.state === current.state
      ? { ...previous, storageAvailable, dirty: false } : previous);
  }, [key, current.ready, current.state, current.dirty]);

  const steps = access && key ? buildTeacherSetupSteps(data, current.state, access) : [];
  const completedCount = steps.filter((step) => step.completed).length;
  const allComplete = steps.length === 5 && completedCount === steps.length;
  useEffect(() => {
    if (current.ready && allComplete && current.state.mode === 'active') update({ mode: 'completed' });
  }, [current.ready, current.state.mode, allComplete, update]);

  const start = useCallback(() => update({ mode: 'active' }), [update]);
  const pause = useCallback(() => update({ mode: 'paused' }), [update]);
  const skip = useCallback(() => update({ mode: 'skipped' }), [update]);
  const review = useCallback(() => update({ reviewed: true }), [update]);
  const setGameMode = useCallback((gameMode: TeacherSetupGameMode) => update({ gameMode }), [update]);

  return { state: current.state, ready: current.ready, storageAvailable: current.storageAvailable,
    steps, completedCount, allComplete, update, start, pause, skip, review, setGameMode };
};

export type TeacherSetupController = ReturnType<typeof useTeacherSetup>;
