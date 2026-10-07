import { Gift } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCardActionState } from '../model/petCardModel';

type PetDailyRewardActionProps = {
  language: Language;
  actionState: Pick<
    PetCardActionState,
    | 'dailyTaskPlan'
    | 'dailyTaskUnavailable'
    | 'dailyTaskRewardPoints'
  >;
  onClaim: () => void;
};

/** Presents the daily reward action from the domain-provided claim plan. */
export const PetDailyRewardAction = ({
  language,
  actionState,
  onClaim,
}: PetDailyRewardActionProps) => {
  const tLang = translations[language];
  const { dailyTaskPlan } = actionState;
  const label = dailyTaskPlan.alreadyClaimed
    ? tLang.dailyTaskDone
    : dailyTaskPlan.frozen
      ? tLang.dailyTaskFrozen
      : dailyTaskPlan.claimKind === 'makeup'
        ? tLang.dailyTaskMakeup.replace('{date}', dailyTaskPlan.targetDate ?? '')
        : `${tLang.dailyTask} (+${actionState.dailyTaskRewardPoints})`;

  return (
    <button
      type="button"
      onClick={onClaim}
      disabled={actionState.dailyTaskUnavailable}
      className={`w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
        actionState.dailyTaskUnavailable
          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-emerald-400 hover:bg-emerald-500 text-emerald-950 shadow-sm hover:shadow active:scale-95'
      }`}
    >
      <Gift className="h-4 w-4 mr-2" aria-hidden="true" />
      {label}
    </button>
  );
};
