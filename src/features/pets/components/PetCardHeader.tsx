import { AlertCircle, Star, Users, Zap } from 'lucide-react';
import { WARNING_THRESHOLD } from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import type { PetCardModel } from '../model/petCardModel';
import { PetCooldownStatus } from './PetCooldownStatus';

type PetCardHeaderProps = Pick<
  PetCardModel,
  | 'language'
  | 'publicStudentName'
  | 'points'
  | 'maxPoints'
  | 'warningPoints'
  | 'streak'
  | 'teammateName'
  | 'hasActivePenalty'
  | 'hasBossRecovery'
  | 'bossRecoveryMinutes'
> & {
  headingId: string;
  level: number;
  borderColor: string;
  backgroundColor: string;
};

/** Student identity, progression and high-level pet state for one card. */
export const PetCardHeader = ({
  language,
  publicStudentName,
  points,
  maxPoints,
  warningPoints,
  streak,
  teammateName,
  hasActivePenalty,
  hasBossRecovery,
  bossRecoveryMinutes,
  headingId,
  level,
  borderColor,
  backgroundColor,
}: PetCardHeaderProps) => {
  const tLang = translations[language];
  return (
    <header
      className={`px-4 py-3 border-b ${borderColor} ${backgroundColor} flex justify-between items-center`}
    >
      <div className="flex flex-col">
        <h2 id={headingId} className="font-bold text-gray-800 text-lg">
          {publicStudentName}
        </h2>
        <span className="text-xs font-bold text-amber-700 flex items-center">
          <Star className="h-3 w-3 mr-1 fill-amber-500" aria-hidden="true" />
          Lv. {level}
        </span>
        {warningPoints > 0 && (
          <span className="mt-1 inline-flex w-fit items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
            <AlertCircle className="mr-1 h-3 w-3" aria-hidden="true" />
            {tLang.warningPoints} {warningPoints}/{WARNING_THRESHOLD}
          </span>
        )}
        {hasActivePenalty && (
          <span className="mt-1 inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
            <Zap className="mr-1 h-3 w-3" aria-hidden="true" />
            {tLang.penaltyStatus}
          </span>
        )}
        {streak > 0 && (
          <span className="mt-1 inline-flex w-fit items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
            <Star className="mr-1 h-3 w-3" aria-hidden="true" />
            {tLang.dailyTaskStreak.replace('{days}', String(streak))}
          </span>
        )}
        {teammateName && (
          <span className="mt-1 inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
            <Users className="mr-1 h-3 w-3" aria-hidden="true" />
            {language === 'en' ? 'Team' : '隊伍'}: {teammateName}
          </span>
        )}
        {hasBossRecovery && (
          <PetCooldownStatus
            language={language}
            minutes={bossRecoveryMinutes}
          />
        )}
      </div>
      <div className="flex items-center bg-white px-2 py-1 rounded-full shadow-sm">
        <span className="text-xs font-bold text-indigo-600 mr-1">
          {tLang.points}
        </span>
        <span className="font-black text-indigo-700">
          {points}/{maxPoints}
        </span>
      </div>
    </header>
  );
};
