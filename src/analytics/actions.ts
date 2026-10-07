import type { PointAdjustmentSource } from '../store/types';
import { trackAnalytics } from './index';

/** Accepted count comes from the existing domain result, never re-run game rules. */
export const recordPointActionCompleted = (source: PointAdjustmentSource, amount: number, acceptedCount: number): void => {
  if ((source !== 'quick' && source !== 'manual' && source !== 'airdrop') || !Number.isFinite(amount) || amount === 0 || acceptedCount <= 0) return;
  trackAnalytics('point_action_completed', {
    action_source: source, direction: amount > 0 ? 'increase' : 'decrease', student_count: acceptedCount,
  });
};
