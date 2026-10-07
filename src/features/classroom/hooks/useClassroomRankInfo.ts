import { useCallback } from 'react';
import { Award, Crown, Medal, Shield, Sparkles } from 'lucide-react';
import type { AppData } from '../../../store/types';
import type { ClassroomTranslations, GetClassroomRankInfo } from '../types';

const DEFAULT_RANK_BRACKETS = {
  diamond: 400,
  platinum: 300,
  gold: 200,
  silver: 100,
};

export const useClassroomRankInfo = (
  rankBrackets: NonNullable<AppData['settings']>['rankBrackets'],
  translations: ClassroomTranslations,
): GetClassroomRankInfo => useCallback((rankPoints) => {
  const brackets = rankBrackets ?? DEFAULT_RANK_BRACKETS;
  if (rankPoints >= brackets.diamond) {
    return {
      name: translations.diamond,
      color: 'text-cyan-500',
      bg: 'bg-cyan-100',
      icon: Crown,
    };
  }
  if (rankPoints >= brackets.platinum) {
    return {
      name: translations.platinum,
      color: 'text-teal-500',
      bg: 'bg-teal-100',
      icon: Sparkles,
    };
  }
  if (rankPoints >= brackets.gold) {
    return {
      name: translations.gold,
      color: 'text-yellow-500',
      bg: 'bg-yellow-100',
      icon: Medal,
    };
  }
  if (rankPoints >= brackets.silver) {
    return {
      name: translations.silver,
      color: 'text-gray-400',
      bg: 'bg-gray-100',
      icon: Award,
    };
  }
  return {
    name: translations.bronze,
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    icon: Shield,
  };
}, [rankBrackets, translations]);
