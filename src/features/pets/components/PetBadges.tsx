import { Crown, Gift, Medal, Swords, type LucideIcon } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';

type PetBadgesProps = {
  badges: string[];
  language: Language;
};

type BadgePresentation = {
  id: string;
  label: string;
  Icon: LucideIcon;
  containerClassName: string;
  iconClassName: string;
};

/** Renders earned pet badges with equivalent visible and accessible labels. */
export const PetBadges = ({ badges, language }: PetBadgesProps) => {
  if (badges.length === 0) return null;
  const tLang = translations[language];
  const presentations: BadgePresentation[] = [
    {
      id: 'badgeFirstWin',
      label: tLang.badgeFirstWin,
      Icon: Medal,
      containerClassName: 'bg-amber-100 border-amber-200',
      iconClassName: 'text-amber-600',
    },
    {
      id: 'badgeVeteran',
      label: tLang.badgeVeteran,
      Icon: Swords,
      containerClassName: 'bg-rose-100 border-rose-200',
      iconClassName: 'text-rose-600',
    },
    {
      id: 'badgeRich',
      label: tLang.badgeRich,
      Icon: Gift,
      containerClassName: 'bg-emerald-100 border-emerald-200',
      iconClassName: 'text-emerald-600',
    },
    {
      id: 'badgeMaxLevel',
      label: tLang.badgeMaxLevel,
      Icon: Crown,
      containerClassName: 'bg-indigo-100 border-indigo-200',
      iconClassName: 'text-indigo-600',
    },
  ];
  const earned = presentations.filter(({ id }) => badges.includes(id));
  if (earned.length === 0) return null;

  return (
    <div
      className="absolute top-16 right-2 flex flex-col gap-1 z-20"
      role="list"
      aria-label={language === 'en' ? 'Pet badges' : '寵物徽章'}
    >
      {earned.map(({ id, label, Icon, containerClassName, iconClassName }) => (
        <div
          key={id}
          className={`p-1 rounded-full shadow-sm border ${containerClassName}`}
          title={label}
          role="listitem"
          aria-label={label}
        >
          <Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" />
        </div>
      ))}
    </div>
  );
};
