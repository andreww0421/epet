import type { Student } from '../../../store/types';
import { createEnrolledStudent } from '../../../studentEnrollment';

/**
 * Builds the initial student shape used by the dashboard form.
 *
 * Keeping this factory outside React prevents the presentation layer from
 * knowing which game-state fields a newly enrolled student must start with.
 */
export const createDashboardStudent = (
  name: string,
  id = Date.now().toString(),
): Student => createEnrolledStudent({ id, name: name.trim() });
