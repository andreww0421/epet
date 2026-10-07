import { useCallback, useMemo, useState } from 'react';
import type { Student } from '../../../store/types';
import {
  getEligibleBattleOpponents,
  type ClassroomBattleSettings,
} from '../model/classroomModels';

type UseClassroomBattleDialogOptions = {
  students: Student[];
  settings: ClassroomBattleSettings;
  battle: (attackerId: string, defenderId: string) => void;
};

export const useClassroomBattleDialog = ({
  students,
  settings,
  battle,
}: UseClassroomBattleDialogOptions) => {
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const readinessNow = useMemo(() => Date.now(), [attackerId, students]);

  const attacker = useMemo(
    () => attackerId
      ? students.find((student) => student.id === attackerId) ?? null
      : null,
    [attackerId, students],
  );
  const opponents = useMemo(
    () => getEligibleBattleOpponents(students, attackerId, readinessNow, settings),
    [attackerId, readinessNow, settings, students],
  );

  const open = useCallback((studentId: string) => {
    setAttackerId(studentId);
    setDefenderId(null);
  }, []);
  const close = useCallback(() => {
    setAttackerId(null);
    setDefenderId(null);
  }, []);
  const start = useCallback(() => {
    if (!attackerId || !defenderId) return;
    battle(attackerId, defenderId);
    close();
  }, [attackerId, battle, close, defenderId]);

  return {
    attacker,
    defenderId,
    opponents,
    isOpen: attacker !== null,
    open,
    close,
    selectDefender: setDefenderId,
    start,
  };
};
