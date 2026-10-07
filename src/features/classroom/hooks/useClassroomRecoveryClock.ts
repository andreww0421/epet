import { useEffect, useState } from 'react';
import type { Student } from '../../../store/types';
import { isBossRecoveryActive } from '../../../gameRules';

export const useClassroomRecoveryClock = (students: Student[]) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!students.some((student) =>
      isBossRecoveryActive(student.bossRecovery, Date.now()))) return;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [students]);

  return now;
};
