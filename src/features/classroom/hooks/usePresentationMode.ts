import { useCallback, useEffect, useState } from 'react';

const PRESENTATION_FLAG = 'epet.presentation.active';
const PRESENTATION_HASH = '#/presentation';

const readPresentationMode = () => {
  if (window.location.hash === PRESENTATION_HASH) return true;
  try {
    return window.sessionStorage.getItem(PRESENTATION_FLAG) === '1';
  } catch {
    return false;
  }
};

/** Only a non-sensitive UI flag is stored. No class, student, or preference data.
 * Reload/back navigation must not silently replace a projected screen with the
 * teacher console. This is a privacy guard, not an authorization mechanism. */
export const usePresentationMode = () => {
  const [active, setActive] = useState(readPresentationMode);
  const enter = useCallback(() => {
    try { window.sessionStorage.setItem(PRESENTATION_FLAG, '1'); } catch { /* The URL also retains the guard. */ }
    window.history.replaceState(null, '', PRESENTATION_HASH);
    setActive(true);
  }, []);
  const leave = useCallback(() => {
    try { window.sessionStorage.removeItem(PRESENTATION_FLAG); } catch { /* No student data is stored. */ }
    if (window.location.hash === PRESENTATION_HASH) window.history.replaceState(null, '', '#/');
    setActive(false);
  }, []);
  useEffect(() => {
    // Navigating away from the fragment is not an exit authorization.
    const onHashChange = () => {
      if (active || window.location.hash === PRESENTATION_HASH) enter();
    };
    if (active && window.location.hash !== PRESENTATION_HASH) enter();
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, [active, enter]);
  return { active, enter, leave };
};
