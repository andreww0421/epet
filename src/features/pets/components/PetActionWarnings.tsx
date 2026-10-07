import { AlertCircle } from 'lucide-react';
import { SOLO_BATTLE_MIN_FULLNESS } from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCardActionState } from '../model/petCardModel';

type PetActionWarningsProps = {
  language: Language;
  actionState: PetCardActionState;
};

const WarningIcon = () => (
  <AlertCircle className="h-3 w-3 inline mr-1" aria-hidden="true" />
);

/** Human-readable explanations for disabled pet actions. */
export const PetActionWarnings = ({
  language,
  actionState,
}: PetActionWarningsProps) => {
  if (!actionState.warnings.show) return null;
  const tLang = translations[language];
  const battleNeedFullnessText = actionState.battleMode === 'team'
    ? (tLang.battleNeedFullness ?? '').replace(
        '{value}',
        actionState.teamBattleMinFullness.toString(),
      )
    : actionState.battleMode === 'both'
      ? actionState.teamBattleMinFullnessEnabled
        ? language === 'en'
          ? `Solo requires ${SOLO_BATTLE_MIN_FULLNESS} fullness; team requires ${actionState.teamBattleMinFullness}.`
          : `個人賽需 ${SOLO_BATTLE_MIN_FULLNESS} 飽食度；隊伍賽需 ${actionState.teamBattleMinFullness} 飽食度。`
        : language === 'en'
          ? `Solo requires ${SOLO_BATTLE_MIN_FULLNESS} fullness; team battle ignores the fullness gate.`
          : `個人賽需 ${SOLO_BATTLE_MIN_FULLNESS} 飽食度；隊伍賽不受最低飽食度限制。`
      : (tLang.battleNeedFullness ?? '').replace(
          '{value}',
          SOLO_BATTLE_MIN_FULLNESS.toString(),
        );

  return (
    <p
      className="text-center text-[10px] text-red-700 mt-2 flex flex-col items-center justify-center space-y-0.5"
      aria-live="polite"
    >
      {actionState.warnings.feedNeedsPoints && (
        <span>
          <WarningIcon />
          {tLang.feedNeedPoints.replace(
            '{cost}',
            actionState.feedCost.toString(),
          )}
        </span>
      )}
      {actionState.warnings.playNeedsPoints && (
        <span>
          <WarningIcon />
          {tLang.playNeedPoints.replace(
            '{cost}',
            actionState.playCost.toString(),
          )}
        </span>
      )}
      {actionState.warnings.battleDisabled && (
        <span><WarningIcon />{tLang.battleDisabledByTeacher}</span>
      )}
      {actionState.warnings.battleBlockedByPenalty && (
        <span><WarningIcon />{tLang.battleBlockedByPenalty}</span>
      )}
      {actionState.warnings.battleBlockedByMood && (
        <span>
          <WarningIcon />
          {language === 'en'
            ? 'Mood too low, refusing to battle!'
            : '心情過低，罷工拒絕出戰！'}
        </span>
      )}
      {actionState.warnings.battleBlockedByFullness && (
        <span><WarningIcon />{battleNeedFullnessText}</span>
      )}
      {actionState.warnings.upgradeNeedsFullness && (
        <span><WarningIcon />{tLang.upgradeNeedFullness}</span>
      )}
      {actionState.warnings.upgradeNeedsPoints && (
        <span>
          <WarningIcon />
          {tLang.upgradeNeedPoints.replace(
            '{cost}',
            actionState.upgradeCost.toString(),
          )}
        </span>
      )}
      {actionState.warnings.upgradeBlockedByMood && (
        <span><WarningIcon />{tLang.moodLowPenalty}</span>
      )}
    </p>
  );
};
