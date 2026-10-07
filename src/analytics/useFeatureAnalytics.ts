import { useEffect, useRef } from 'react';
import type { ConsoleDestination } from '../features/teacher-console/model/navigation';
import { trackAnalytics } from './index';

/** Tracks committed teacher navigation, never hidden feature mounts or DOM data. */
export const createFeatureOpenTracker = (report: (feature: ConsoleDestination) => void) => {
  let previous: ConsoleDestination | undefined;
  return (active: ConsoleDestination, enabled: boolean) => {
    if (!enabled) {
      previous = undefined;
      return;
    }
    if (previous === active) return;
    previous = active;
    report(active);
  };
};

export const useFeatureAnalytics = (active: ConsoleDestination, enabled: boolean) => {
  const tracker = useRef<ReturnType<typeof createFeatureOpenTracker> | null>(null);
  if (!tracker.current) {
    tracker.current = createFeatureOpenTracker((feature) => {
      trackAnalytics('feature_opened', { feature });
    });
  }
  useEffect(() => {
    tracker.current?.(active, enabled);
  }, [active, enabled]);
};
