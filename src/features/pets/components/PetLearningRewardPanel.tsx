import { Target } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import type { Language, LearningCompetency } from '../../../store/types';
import type { PetLearningSummary } from '../model/petCardModel';

type PetLearningRewardPanelProps = {
  language: Language;
  learning: PetLearningSummary;
};

/** Displays learning-goal progress and the latest positive reward context. */
export const PetLearningRewardPanel = ({
  language,
  learning,
}: PetLearningRewardPanelProps) => {
  if (!learning.shouldDisplay) return null;

  const tLang = translations[language];
  const competencyLabels: Record<LearningCompetency, string> = {
    participation: tLang.competencyParticipation,
    collaboration: tLang.competencyCollaboration,
    selfManagement: tLang.competencySelfManagement,
    assignmentQuality: tLang.competencyAssignmentQuality,
    growth: tLang.competencyGrowth,
  };
  const latestPositiveSummary = learning.latestPositiveReason ?? (
    learning.latestPositiveCompetency
      ? competencyLabels[learning.latestPositiveCompetency]
      : undefined
  );
  const latestPositiveLabel = learning.latestPositiveSource === 'point'
    ? tLang.latestPointReason
    : tLang.latestPositiveFeedback;

  return (
    <section className="border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
      {learning.nextGoal && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center text-xs font-bold text-emerald-800">
              <Target className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{learning.nextGoal.goal.title}</span>
            </span>
            <span className="shrink-0 text-xs font-black text-emerald-950">
              {tLang.classGoalProgress
                .replace('{current}', learning.nextGoal.progress.toString())
                .replace(
                  '{target}',
                  learning.nextGoal.goal.targetCount.toString(),
                )}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            {tLang.classGoalNextAction.replace(
              '{competency}',
              competencyLabels[learning.nextGoal.goal.competency],
            )}
          </p>
        </>
      )}
      {learning.weeklyGoalsCompleted && (
        <p className="flex items-center text-xs font-bold text-emerald-800">
          <Target className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {tLang.classGoalPersonalCompleted}
        </p>
      )}
      <div
        className={`${
          learning.nextGoal || learning.weeklyGoalsCompleted
            ? 'mt-2 border-t border-emerald-100 pt-2'
            : ''
        }`}
      >
        <p className="text-[10px] font-bold uppercase text-emerald-700">
          {latestPositiveLabel}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-emerald-950">
            {latestPositiveSummary ?? tLang.noPositiveFeedback}
          </p>
          {learning.latestPositiveCompetency && (
            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
              {competencyLabels[learning.latestPositiveCompetency]}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
