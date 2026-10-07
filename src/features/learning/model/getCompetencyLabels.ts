import { translations } from '../../../i18n/translations';
import type { Language, LearningCompetency } from '../../../store/types';

export const getCompetencyLabels = (
  language: Language,
): Record<LearningCompetency, string> => {
  const copy = translations[language];
  return {
    participation: copy.competencyParticipation,
    collaboration: copy.competencyCollaboration,
    selfManagement: copy.competencySelfManagement,
    assignmentQuality: copy.competencyAssignmentQuality,
    growth: copy.competencyGrowth,
  };
};
