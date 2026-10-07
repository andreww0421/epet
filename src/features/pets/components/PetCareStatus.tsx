import { Moon } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';

type PetCareStatusProps = {
  language: Language;
  isDead: boolean;
  isResting: boolean;
  reviveCost: number;
};

/** Explains non-active pet care states before presenting available actions. */
export const PetCareStatus = ({
  language,
  isDead,
  isResting,
  reviveCost,
}: PetCareStatusProps) => {
  const tLang = translations[language];
  return (
    <>
      {isDead && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center">
          <div className="text-sm font-bold text-rose-700">{tLang.petDead}</div>
          <div className="mt-1 text-[11px] text-rose-600">
            {tLang.petDeadHint.replace('{cost}', reviveCost.toString())}
          </div>
        </div>
      )}
      {isResting && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-bold text-indigo-800">
            <Moon className="h-4 w-4" aria-hidden="true" />
            {tLang.petResting}
          </div>
          <div className="mt-1 text-[11px] text-indigo-700">
            {tLang.petRestingHint}
          </div>
        </div>
      )}
    </>
  );
};
