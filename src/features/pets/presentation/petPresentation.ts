import {
  Frown,
  Ghost,
  Meh,
  Moon,
  Smile,
  type LucideIcon,
} from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCondition } from '../model/petCardModel';

export type PetStatusPresentation = {
  Icon: LucideIcon;
  text: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
};

/** Maps semantic pet condition to the unchanged visual treatment. */
export const getPetStatusPresentation = (
  language: Language,
  condition: PetCondition,
): PetStatusPresentation => {
  const tLang = translations[language];
  if (condition === 'dead') {
    return {
      Icon: Ghost,
      text: tLang.petDead,
      color: 'text-slate-500',
      backgroundColor: 'bg-slate-100',
      borderColor: 'border-slate-300',
    };
  }
  if (condition === 'resting') {
    return {
      Icon: Moon,
      text: tLang.petResting,
      color: 'text-indigo-600',
      backgroundColor: 'bg-indigo-50',
      borderColor: 'border-indigo-200',
    };
  }
  if (condition === 'hungry') {
    return {
      Icon: Frown,
      text: tLang.statusHungry,
      color: 'text-red-500',
      backgroundColor: 'bg-red-50',
      borderColor: 'border-red-200',
    };
  }
  if (condition === 'normal') {
    return {
      Icon: Meh,
      text: tLang.statusNormal,
      color: 'text-yellow-500',
      backgroundColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
    };
  }
  return {
    Icon: Smile,
    text: tLang.statusHappy,
    color: 'text-green-500',
    backgroundColor: 'bg-green-50',
    borderColor: 'border-green-200',
  };
};
