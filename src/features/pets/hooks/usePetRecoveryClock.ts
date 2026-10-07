import React from 'react';

/** Re-renders a card once when its boss-recovery period expires. */
export const usePetRecoveryClock = (recoverAt: number | undefined) => {
  const [, setRevision] = React.useState(0);

  React.useEffect(() => {
    if (!recoverAt) return;
    const remaining = recoverAt - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => setRevision((current) => current + 1),
      Math.min(remaining + 50, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [recoverAt]);
};
