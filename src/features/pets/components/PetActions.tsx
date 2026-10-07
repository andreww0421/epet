import { Dices } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { PetCardStoreActions } from '../hooks/usePetCardStore';
import type { PetCardModel } from '../model/petCardModel';
import { PetActionWarnings } from './PetActionWarnings';
import {
  PetBattleAction,
  PetBossAttackAction,
  PetTeamAction,
} from './PetBattleActions';
import { PetCareActions } from './PetCareActions';
import { PetCareStatus } from './PetCareStatus';
import { PetDailyRewardAction } from './PetDailyRewardAction';
import { PetEvolutionAction } from './PetEvolutionAction';

type PetActionsProps = {
  model: PetCardModel;
  storeActions: PetCardStoreActions;
  onBattle: (studentId: string) => void;
  onTeamUp: (studentId: string) => void;
};

/** Composes pet interactions while all eligibility remains in the pure model. */
export const PetActions = ({
  model,
  storeActions,
  onBattle,
  onTeamUp,
}: PetActionsProps) => {
  const { studentId, language, pet, actions } = model;
  const tLang = translations[language];
  if (pet.type === 'egg' && !pet.isDead) {
    return (
      <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-2">
        <button
          type="button"
          onClick={() => storeActions.gachaPet(studentId)}
          disabled={!actions.canGacha}
          className={`w-full flex items-center justify-center py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
            !actions.canGacha
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white shadow-md hover:shadow-lg active:scale-95'
          }`}
        >
          <Dices className="h-5 w-5 mr-2 animate-bounce" aria-hidden="true" />
          {tLang.gacha}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-2">
      <PetCareStatus
        language={language}
        isDead={pet.isDead}
        isResting={pet.isResting}
        reviveCost={actions.reviveCost}
      />
      <PetDailyRewardAction
        language={language}
        actionState={actions}
        onClaim={() => storeActions.claimDailyTask(studentId)}
      />
      {actions.battleEnabled && (
        <PetTeamAction
          language={language}
          teammateName={model.teammateName}
          onTeamUp={() => onTeamUp(studentId)}
        />
      )}
      <PetCareActions
        language={language}
        pet={pet}
        actionState={actions}
        isDead={pet.isDead}
        onFeed={() => storeActions.feedPet(studentId)}
        onPlay={() => storeActions.playWithPet(studentId)}
        onRevive={() => storeActions.revivePet(studentId)}
      />
      {!pet.isDead && (
        <>
          <div className="flex space-x-2">
            <PetEvolutionAction
              language={language}
              level={pet.level}
              actionState={actions}
              onUpgrade={() => storeActions.upgradePet(studentId)}
            />
            <PetBattleAction
              language={language}
              actionState={actions}
              onBattle={() => onBattle(studentId)}
            />
          </div>
          {actions.bossIsActive && (
            <PetBossAttackAction
              language={language}
              actionState={actions}
              onAttackBoss={() => {
                void storeActions.executeAttackBoss(studentId);
              }}
            />
          )}
          <PetActionWarnings language={language} actionState={actions} />
        </>
      )}
    </div>
  );
};
