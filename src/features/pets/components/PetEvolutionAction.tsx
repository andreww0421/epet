import { Dices, Trophy } from 'lucide-react';
import { PET_MAX_LEVEL } from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCardActionState } from '../model/petCardModel';

type PetEvolutionActionProps = {
  language: Language;
  level: number;
  actionState: Pick<
    PetCardActionState,
    'canUpgrade' | 'hasUpgradeReward' | 'upgradeCost'
  >;
  onUpgrade: () => void;
};

/** Evolution/upgrade action and its pending reward indicator. */
export const PetEvolutionAction = ({
  language,
  level,
  actionState,
  onUpgrade,
}: PetEvolutionActionProps) => {
  const tLang = translations[language];
  return (
    <div className="relative flex-1">
      {level < PET_MAX_LEVEL && actionState.hasUpgradeReward && (
        <div
          className="pointer-events-none absolute -top-2 -left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-amber-200 bg-gradient-to-br from-amber-200 via-yellow-100 to-orange-200 text-amber-700 shadow-md animate-pulse"
          aria-hidden="true"
        >
          <Dices className="h-3.5 w-3.5" />
        </div>
      )}
      <button
        type="button"
        onClick={onUpgrade}
        disabled={!actionState.canUpgrade}
        className={`w-full flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
          !actionState.canUpgrade
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : actionState.hasUpgradeReward
              ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 hover:from-amber-500 hover:via-orange-500 hover:to-rose-500 text-white shadow-md hover:shadow-lg active:scale-95'
              : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm hover:shadow active:scale-95'
        }`}
      >
        <Trophy className="h-3 w-3 mr-1" aria-hidden="true" />
        {level >= PET_MAX_LEVEL
          ? tLang.maxLevel
          : tLang.upgradePet.replace(
              '{cost}',
              actionState.upgradeCost.toString(),
            )}
      </button>
    </div>
  );
};
