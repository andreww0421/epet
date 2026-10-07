import { ShieldCheck } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';

type PetCooldownStatusProps = {
  language: Language;
  minutes: number;
};

/** Presents the active boss-recovery cooldown without owning its timer. */
export const PetCooldownStatus = ({
  language,
  minutes,
}: PetCooldownStatusProps) => (
  <span
    className="mt-1 inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700"
    role="status"
  >
    <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
    {translations[language].bossRecoveryStatus.replace(
      '{minutes}',
      String(minutes),
    )}
  </span>
);
