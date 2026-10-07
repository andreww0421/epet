import { Swords, Users } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCardActionState } from '../model/petCardModel';

type PetTeamActionProps = {
  language: Language;
  teammateName?: string;
  onTeamUp: () => void;
};

/** Team creation/management entry point for battle-enabled classrooms. */
export const PetTeamAction = ({
  language,
  teammateName,
  onTeamUp,
}: PetTeamActionProps) => (
  <button
    type="button"
    onClick={onTeamUp}
    className="w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 bg-sky-100 hover:bg-sky-200 text-sky-900 shadow-sm hover:shadow active:scale-95"
  >
    <Users className="h-4 w-4 mr-2" aria-hidden="true" />
    {teammateName
      ? language === 'en'
        ? 'Manage Team'
        : '管理隊伍'
      : language === 'en'
        ? 'Create Team'
        : '建立隊伍'}
  </button>
);

type PetBattleActionProps = {
  language: Language;
  actionState: Pick<PetCardActionState, 'battleEnabled' | 'canBattle'>;
  onBattle: () => void;
};

/** Solo/team battle entry point using model-provided readiness. */
export const PetBattleAction = ({
  language,
  actionState,
  onBattle,
}: PetBattleActionProps) => {
  const tLang = translations[language];
  return (
    <button
      type="button"
      onClick={onBattle}
      disabled={!actionState.canBattle}
      className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
        !actionState.canBattle
          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-rose-700 hover:bg-rose-800 text-white shadow-sm hover:shadow active:scale-95'
      }`}
    >
      <Swords className="h-3 w-3 mr-1" aria-hidden="true" />
      {actionState.battleEnabled ? tLang.battle : tLang.battleOff}
    </button>
  );
};

type PetBossAttackActionProps = {
  language: Language;
  actionState: Pick<
    PetCardActionState,
    'canAttackBoss' | 'bossAttackCost'
  >;
  onAttackBoss: () => void;
};

/** Active-boss attack interaction with its authoritative fullness cost. */
export const PetBossAttackAction = ({
  language,
  actionState,
  onAttackBoss,
}: PetBossAttackActionProps) => (
  <button
    type="button"
    onClick={onAttackBoss}
    className={`w-full mt-2 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
      !actionState.canAttackBoss
        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
        : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm hover:shadow active:scale-95'
    }`}
    disabled={!actionState.canAttackBoss}
  >
    <Swords className="h-3 w-3 mr-1" aria-hidden="true" />
    {translations[language].attack} (-{actionState.bossAttackCost})
  </button>
);
