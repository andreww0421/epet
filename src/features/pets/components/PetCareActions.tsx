import { RefreshCw, Smile, Utensils } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCardActionState, PetCardModel } from '../model/petCardModel';

type PetCareActionsProps = {
  language: Language;
  pet: Pick<PetCardModel['pet'], 'fullness' | 'happiness'>;
  actionState: Pick<
    PetCardActionState,
    'feedCost' | 'playCost' | 'reviveCost' | 'canFeed' | 'canPlay' | 'canRevive'
  >;
  isDead: boolean;
  onFeed: () => void;
  onPlay: () => void;
  onRevive: () => void;
};

/** Feeding, play and revive interactions; eligibility comes from the pet model. */
export const PetCareActions = ({
  language,
  pet,
  actionState,
  isDead,
  onFeed,
  onPlay,
  onRevive,
}: PetCareActionsProps) => {
  const tLang = translations[language];
  if (isDead) {
    return (
      <button
        type="button"
        onClick={onRevive}
        disabled={!actionState.canRevive}
        className={`w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
          !actionState.canRevive
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-rose-700 hover:bg-rose-800 text-white shadow-sm hover:shadow active:scale-95'
        }`}
      >
        <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
        {tLang.revivePet.replace('{cost}', actionState.reviveCost.toString())}
      </button>
    );
  }

  return (
    <div className="flex space-x-2">
      <button
        type="button"
        onClick={onFeed}
        disabled={!actionState.canFeed || pet.fullness >= 100}
        className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
          !actionState.canFeed || pet.fullness >= 100
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-amber-400 hover:bg-amber-500 text-amber-900 shadow-sm hover:shadow active:scale-95'
        }`}
      >
        <Utensils className="h-3 w-3 mr-1" aria-hidden="true" />
        {pet.fullness >= 100
          ? tLang.alreadyFull
          : actionState.canFeed
            ? tLang.feedPet.replace('{cost}', actionState.feedCost.toString())
            : tLang.notEnoughPoints}
      </button>
      <button
        type="button"
        onClick={onPlay}
        disabled={!actionState.canPlay || pet.happiness >= 100}
        className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
          !actionState.canPlay || pet.happiness >= 100
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-rose-700 hover:bg-rose-800 text-white shadow-sm hover:shadow active:scale-95'
        }`}
      >
        <Smile className="h-3 w-3 mr-1" aria-hidden="true" />
        {pet.happiness >= 100
          ? language === 'en'
            ? 'Very happy!'
            : '已經很開心了'
          : actionState.canPlay
            ? tLang.playPet.replace('{cost}', actionState.playCost.toString())
            : tLang.notEnoughPoints}
      </button>
    </div>
  );
};
