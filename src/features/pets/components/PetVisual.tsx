import {
  Crown,
  Dumbbell,
  Heart,
  Sparkles,
  Swords,
} from 'lucide-react';
import { PET_TYPES } from '../../../store/constants';
import type { GetClassroomRankInfo } from '../../classroom/types';
import type {
  PetAnimationState,
  PetCardModel,
} from '../model/petCardModel';
import type { PetStatusPresentation } from '../presentation/petPresentation';
import { PetStats } from './PetStats';

type PetVisualProps = {
  language: PetCardModel['language'];
  pet: PetCardModel['pet'];
  animation: PetAnimationState;
  rankInfo: ReturnType<GetClassroomRankInfo>;
  status: PetStatusPresentation;
};

/** Pet illustration, animation, rank and stat presentation. */
export const PetVisual = ({
  language,
  pet,
  animation,
  rankInfo,
  status,
}: PetVisualProps) => {
  const petConfig = PET_TYPES.find(({ id }) => id === pet.type) ?? PET_TYPES[0];
  const PetIcon = petConfig.icon;
  const RankIcon = rankInfo.icon;
  const StatusIcon = status.Icon;

  return (
    <div
      className={`px-6 pt-14 pb-4 flex flex-col items-center justify-end relative h-64 transition-colors duration-500 ${
        pet.isDead
          ? 'bg-gradient-to-b from-slate-200/50 to-slate-400/30'
          : 'bg-gradient-to-b from-white to-amber-50/30'
      }`}
    >
      <div
        className={`absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shadow-md border border-white/50 backdrop-blur-sm ${rankInfo.bg}`}
      >
        <RankIcon className={`h-5 w-5 ${rankInfo.color}`} aria-hidden="true" />
        <div className="flex flex-col leading-none">
          <span className={`font-black text-sm tracking-widest ${rankInfo.color}`}>
            {rankInfo.name}
          </span>
          <span className={`text-[10px] font-bold ${rankInfo.color}`}>
            {pet.rankPoints} RP
          </span>
        </div>
      </div>

      {animation.isAnimating && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          aria-hidden="true"
        >
          <div
            className={`absolute rounded-full blur-3xl animate-pulse ${
              animation.isReroll
                ? 'h-44 w-44 bg-gradient-to-r from-fuchsia-300/40 via-amber-300/50 to-cyan-300/40'
                : animation.isGacha
                  ? 'h-40 w-40 bg-gradient-to-r from-violet-300/35 via-indigo-300/35 to-sky-300/35'
                  : 'h-36 w-36 bg-amber-300/30'
            }`}
          />
          {(animation.isGacha || animation.isReroll) && (
            <>
              <div
                className={`absolute h-28 w-28 rounded-full border-4 ${
                  animation.isReroll
                    ? 'border-fuchsia-300/70'
                    : 'border-indigo-300/70'
                } animate-[spin_1.8s_linear_infinite]`}
              />
              <div
                className={`absolute h-40 w-40 rounded-full border-2 ${
                  animation.isReroll
                    ? 'border-amber-200/70'
                    : 'border-sky-200/70'
                } animate-[ping_1.4s_ease-out_infinite]`}
              />
            </>
          )}
          <Sparkles
            className={`absolute h-10 w-10 ${
              animation.isReroll
                ? 'text-fuchsia-400 animate-[spin_1.2s_linear_infinite]'
                : 'text-yellow-400 animate-[spin_1.5s_linear_infinite]'
            }`}
          />
          <Sparkles
            className={`absolute -mt-10 -ml-14 h-8 w-8 ${
              animation.isReroll
                ? 'text-cyan-400 animate-[ping_0.9s_ease-out_infinite]'
                : 'text-indigo-400 animate-[ping_1.1s_ease-out_infinite]'
            }`}
          />
          <Sparkles
            className={`absolute mt-10 mr-16 h-7 w-7 ${
              animation.isReroll
                ? 'text-amber-400 animate-[ping_1s_ease-out_infinite]'
                : 'text-emerald-400 animate-[ping_1.3s_ease-out_infinite]'
            }`}
          />
          {animation.isReroll && (
            <>
              <Sparkles className="absolute -mt-16 ml-14 h-7 w-7 text-rose-400 animate-[bounce_0.9s_ease-in-out_infinite]" />
              <div className="absolute bottom-4 rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-fuchsia-600 shadow-md animate-bounce">
                New Pet
              </div>
            </>
          )}
          {(animation.isFeed || animation.isPlay || animation.isReroll) && (
            <>
              <Heart
                className={`h-8 w-8 animate-[ping_1s_ease-out_forwards] absolute opacity-75 ${
                  animation.isPlay
                    ? 'text-rose-500 fill-rose-500 scale-150'
                    : 'text-pink-500 fill-pink-500'
                }`}
              />
              <Heart
                className={`h-6 w-6 animate-[bounce_1s_ease-in-out_infinite] absolute -mt-16 ml-8 ${
                  animation.isPlay
                    ? 'text-rose-400 fill-rose-400 scale-125'
                    : 'text-pink-400 fill-pink-400'
                }`}
              />
              <Heart
                className={`h-5 w-5 animate-[bounce_1.2s_ease-in-out_infinite] absolute -mt-12 -ml-10 ${
                  animation.isPlay
                    ? 'text-rose-400 fill-rose-400 scale-125'
                    : 'text-pink-400 fill-pink-400'
                }`}
              />
            </>
          )}
          {animation.isAttack && (
            <Swords className="text-rose-600 h-14 w-14 absolute z-30 animate-[ping_0.6s_ease-out_forwards] drop-shadow-lg" />
          )}
        </div>
      )}

      <div
        className={`relative transition-all duration-300 z-10 ${
          animation.isAttack
            ? 'scale-125 -translate-y-6 drop-shadow-md'
            : animation.isPlay
              ? 'scale-125 animate-[bounce_0.5s_ease-in-out_infinite]'
              : animation.isAnimating
                ? 'scale-125 -translate-y-4'
                : 'hover:scale-105'
        } ${
          pet.evolutionStage === 1
            ? 'scale-90'
            : pet.evolutionStage === 2
              ? 'scale-100'
              : 'scale-125 mt-2'
        }`}
      >
        <div
          className={`relative flex flex-col items-center justify-center transition-all duration-500 ${
            pet.isDead
              ? 'opacity-50 grayscale animate-[pulse_3s_ease-in-out_infinite]'
              : pet.isHungry
                ? 'opacity-70 saturate-50 contrast-75'
                : pet.isHappy
                  ? 'brightness-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'
                  : ''
          } ${
            !pet.isDead && !pet.isHungry && pet.evolutionStage === 1
              ? 'animate-[bounce_3s_infinite]'
              : ''
          }`}
        >
          <div
            className={`p-4 rounded-full relative z-10 ${
              pet.isStrong ? 'bg-amber-100' : status.backgroundColor
            } ${
              animation.isReroll
                ? 'shadow-[0_0_30px_rgba(217,70,239,0.65)] ring-4 ring-fuchsia-200/70'
                : pet.evolutionStage >= 2
                  ? 'shadow-[0_0_15px_rgba(251,191,36,0.6)]'
                  : ''
            } ${
              pet.evolutionStage >= 3
                ? 'shadow-[0_0_25px_rgba(167,139,250,0.8)]'
                : ''
            }`}
          >
            {!pet.isDead && pet.evolutionStage >= 3 && (
              <div
                className="absolute -inset-6 rounded-full border-[4px] border-yellow-300/20 border-t-yellow-400 border-b-yellow-400 animate-[spin_4s_linear_infinite] shadow-[0_0_30px_rgba(250,204,21,0.6)] z-0 pointer-events-none"
                aria-hidden="true"
              />
            )}
            {pet.evolutionStage >= 3 && (
              <Crown
                className="h-10 w-10 text-yellow-400 fill-yellow-400 absolute -top-6 left-1/2 transform -translate-x-1/2 z-20 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)] animate-[pulse_2s_ease-in-out_infinite]"
                aria-hidden="true"
              />
            )}
            {pet.isStrong ? (
              <div className="relative">
                <PetIcon
                  className={`h-16 w-16 ${status.color}`}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <Dumbbell
                  className="h-8 w-8 text-slate-700 absolute -right-2 -bottom-2 transform rotate-12"
                  aria-hidden="true"
                />
              </div>
            ) : (
              <PetIcon
                className={`h-16 w-16 ${status.color}`}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            )}
            {!pet.isDead && pet.evolutionStage >= 2 && (
              <Sparkles
                className="h-7 w-7 text-amber-400 fill-amber-400 absolute -top-1 -right-1 animate-pulse drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]"
                aria-hidden="true"
              />
            )}
          </div>
          <div
            className={`absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-md border-2 z-20 ${status.borderColor}`}
            title={status.text}
            role="img"
            aria-label={status.text}
          >
            <StatusIcon
              className={`h-5 w-5 ${status.color}`}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      <PetStats language={language} pet={pet} />
    </div>
  );
};
