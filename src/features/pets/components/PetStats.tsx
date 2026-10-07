import { Heart } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../store/types';
import type { PetCardModel } from '../model/petCardModel';

type PetStatsProps = {
  language: Language;
  pet: PetCardModel['pet'];
};

/** Accessible fullness and happiness meters for the presented pet. */
export const PetStats = ({ language, pet }: PetStatsProps) => {
  const tLang = translations[language];
  return (
    <div className="w-full mt-6">
      <div className="flex justify-between text-xs mb-1 font-medium text-gray-500">
        <span>{tLang.petFullness}</span>
        <span>{pet.fullness}/100</span>
      </div>
      <div
        className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner"
        role="progressbar"
        aria-label={tLang.petFullness}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pet.fullness}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            pet.isHungry
              ? 'bg-red-400'
              : pet.isNormal
                ? 'bg-yellow-400'
                : 'bg-green-400'
          }`}
          style={{ width: `${pet.fullness}%` }}
        />
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-xs mb-1 font-medium text-gray-500">
          <span className="flex items-center">
            <Heart
              className={`h-3 w-3 mr-1 ${
                pet.happiness >= 70
                  ? 'text-emerald-500'
                  : pet.happiness >= 30
                    ? 'text-amber-500'
                    : 'text-fuchsia-500'
              }`}
              aria-hidden="true"
            />
            {tLang.happiness}
          </span>
          <span>{pet.happiness}/100</span>
        </div>
        <div
          className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden flex"
          role="progressbar"
          aria-label={tLang.happiness}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pet.happinessPercent}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              pet.happiness >= 70
                ? 'bg-emerald-400'
                : pet.happiness >= 30
                  ? 'bg-amber-400'
                  : 'bg-fuchsia-400'
            }`}
            style={{ width: `${pet.happinessPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
