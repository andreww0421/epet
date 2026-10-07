import React, { useMemo } from 'react';
import { Target } from 'lucide-react';
import type {
  ClassGoal,
  Language,
  LearningCompetency,
  LearningEvidenceRecord,
  Student,
} from '../../../store/types';
import type { ClassroomTranslations } from '../types';
import {
  buildClassroomGoalMetrics,
  formatClassGoalWeekLabel,
} from '../model/classroomModels';

type ClassroomActivityPanelProps = {
  students: Student[];
  goals?: ClassGoal[];
  learningEvidenceRecords: LearningEvidenceRecord[];
  now: number;
  schoolTimeZone?: string;
  language: Language;
  translations: ClassroomTranslations;
};

export const ClassroomActivityPanel: React.FC<ClassroomActivityPanelProps> = ({
  students,
  goals,
  learningEvidenceRecords,
  now,
  schoolTimeZone,
  language,
  translations: tLang,
}) => {
  const metrics = useMemo(
    () => buildClassroomGoalMetrics(
      students,
      goals,
      learningEvidenceRecords,
      now,
      schoolTimeZone,
    ),
    [goals, learningEvidenceRecords, now, schoolTimeZone, students],
  );

  if (metrics.length === 0) return null;

  const competencyLabels: Record<LearningCompetency, string> = {
    participation: tLang.competencyParticipation,
    collaboration: tLang.competencyCollaboration,
    selfManagement: tLang.competencySelfManagement,
    assignmentQuality: tLang.competencyAssignmentQuality,
    growth: tLang.competencyGrowth,
  };
  const weekLabel = formatClassGoalWeekLabel(
    now,
    schoolTimeZone,
    language,
    tLang.classGoalWeekRange,
  );

  return (
    <section className="mb-4 border-y border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-emerald-700">
        <Target className="h-4 w-4" />
        {tLang.classGoal}
        <span className="ml-auto font-medium normal-case text-emerald-600">
          {weekLabel}
        </span>
      </div>
      <div className="divide-y divide-emerald-200">
        {metrics.map(({ goal, progress, coverage }) => {
          const progressPercent = Math.min(
            100,
            Math.round((progress / goal.targetCount) * 100),
          );
          return (
            <div
              key={goal.id}
              className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(230px,0.55fr)] sm:items-center sm:gap-6"
            >
              <div className="min-w-0">
                <h2 className="truncate text-base font-black text-emerald-950">
                  {goal.title}
                </h2>
                <p className="text-sm text-emerald-800">
                  {competencyLabels[goal.competency]}
                </p>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-bold text-emerald-900">
                  <span>
                    {progress >= goal.targetCount
                      ? tLang.classGoalCompleted
                      : tLang.classGoalProgress
                          .replace('{current}', progress.toString())
                          .replace('{target}', goal.targetCount.toString())}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-emerald-200">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs font-medium text-emerald-800">
                  {tLang.classGoalCoverage
                    .replace('{current}', coverage.studentsReached.toString())
                    .replace('{total}', coverage.totalStudents.toString())}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
