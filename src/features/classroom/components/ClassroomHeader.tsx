import React from 'react';
import { BarChart3, Users } from 'lucide-react';
import type { Language, PublicLeaderboardMode } from '../../../store/types';
import type { ClassroomTranslations } from '../types';
import type { ClassroomViewMode } from '../model/classroomModels';

type ClassroomHeaderProps = {
  language: Language;
  publicLeaderboardMode: PublicLeaderboardMode;
  translations: ClassroomTranslations;
  viewMode: ClassroomViewMode;
  onViewModeChange: (viewMode: ClassroomViewMode) => void;
};

export const ClassroomHeader: React.FC<ClassroomHeaderProps> = ({
  language,
  publicLeaderboardMode,
  translations: tLang,
  viewMode,
  onViewModeChange,
}) => (
  <header className="text-center mb-6">
    <h1 className="text-3xl font-extrabold text-amber-900 tracking-tight">
      {tLang.classroomTitle}
    </h1>
    <p className="mt-3 max-w-2xl mx-auto text-xl text-amber-700 sm:mt-4">
      {tLang.classroomDesc}
    </p>
    <nav
      className="mt-6 flex flex-wrap justify-center gap-2"
      aria-label={language === 'en' ? 'Classroom views' : '教室檢視'}
    >
      <button
        type="button"
        onClick={() => onViewModeChange('grid')}
        aria-pressed={viewMode === 'grid'}
        className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'grid' ? 'bg-amber-700 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
      >
        <Users className="h-4 w-4 inline mr-2" />
        {tLang.classroomTitle}
      </button>
      {publicLeaderboardMode !== 'hidden' && (
        <button
          type="button"
          onClick={() => onViewModeChange('leaderboard')}
          aria-pressed={viewMode === 'leaderboard'}
          className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'leaderboard' ? 'bg-amber-700 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
        >
          <BarChart3 className="h-4 w-4 inline mr-2" />
          {publicLeaderboardMode === 'growth'
            ? tLang.leaderboardGrowth
            : tLang.leaderboard}
        </button>
      )}
      <button
        type="button"
        onClick={() => onViewModeChange('teams')}
        aria-pressed={viewMode === 'teams'}
        className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'teams' ? 'bg-amber-700 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
      >
        <Users className="h-4 w-4 inline mr-2" />
        {language === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}
      </button>
    </nav>
  </header>
);
