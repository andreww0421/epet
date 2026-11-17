import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { getStoreSessionGeneration, getStoreSessionResetReason, useStore } from '../../../store/useStore';
import { createLearningDraftMemory, type LearningDraftAuthorization } from '../model/learningDraftMemory';

// The console is temporarily unmounted during a network failure. Keep its form
// drafts in memory for this verified store session, never browser storage.
let draftGeneration = getStoreSessionGeneration();
const memory = createLearningDraftMemory();
const invalidateSessionDrafts = () => {
  const generation = getStoreSessionGeneration();
  if (generation !== draftGeneration) {
    if (getStoreSessionResetReason() === 'replace-workspace') memory.clear();
    else memory.suspend();
    draftGeneration = generation;
  }
  return generation;
};
// resetStoreForSession increments the generation before updating the store;
// revoke reads immediately, even while unmounted. Only fresh exact authority
// can restore suspended drafts; explicit remote adoption discards them.
useStore.subscribe(invalidateSessionDrafts);

export const authorizeLearningDrafts = (authorization: LearningDraftAuthorization | null | undefined) =>
  memory.authorize(authorization, invalidateSessionDrafts());

/** Memory-only drafts, isolated by verified store session and caller's composite identity. */
export const useScopedLearningDraft = <T,>(key: string, initial: () => T): [T, Dispatch<SetStateAction<T>>] => {
  const generation = invalidateSessionDrafts();
  const permit = memory.current(generation);
  const [, render] = useState(0);
  // Standalone editors retain component-local behavior without verified access.
  const [fallback, setFallback] = useState<{ key: string; generation: number; draft: T }>(
    () => ({ key, generation, draft: initial() }),
  );
  const draft = permit ? memory.read(permit, key, initial) as T
    : fallback.key === key && fallback.generation === generation ? fallback.draft : initial();
  const setDraft = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (invalidateSessionDrafts() !== generation) return;
    const apply = (previous: T) => typeof update === 'function' ? (update as (value: T) => T)(previous) : update;
    if (permit) {
      if (memory.update(permit, key, apply)) render((revision) => revision + 1);
    } else if (!memory.current(generation)) {
      setFallback((previous) => ({ key, generation, draft: apply(previous.key === key && previous.generation === generation ? previous.draft : initial()) }));
    }
  }, [generation, key, permit]);
  return [draft, setDraft];
};
