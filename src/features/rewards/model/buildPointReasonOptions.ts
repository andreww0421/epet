import { POINT_REASON_OPTIONS } from '../../../i18n/translations';
import type { Language, PointReasonOption } from '../../../store/types';

export type DashboardPointReasonOption = PointReasonOption & {
  displayLabel: string;
  isPinned: boolean;
  isRecent: boolean;
  label: string;
};

type BuildPointReasonOptionsInput = {
  configuredReasons?: PointReasonOption[];
  language: Language;
  pinnedReasonIds?: string[];
  recentReasonIds?: string[];
};

/** Localizes and orders reason shortcuts without coupling that policy to JSX. */
export const buildPointReasonOptions = ({
  configuredReasons,
  language,
  pinnedReasonIds = [],
  recentReasonIds = [],
}: BuildPointReasonOptionsInput): DashboardPointReasonOption[] => {
  const source = configuredReasons?.length ? configuredReasons : POINT_REASON_OPTIONS;
  return source
    .map((option, originalIndex) => ({
      ...option,
      label: option.labels[language] ?? option.labels.zh,
      displayLabel: `${option.labels[language] ?? option.labels.zh} ${option.amount > 0 ? '+' : ''}${option.amount}`,
      isPinned: pinnedReasonIds.includes(option.id),
      isRecent: recentReasonIds.includes(option.id),
      originalIndex,
    }))
    .sort((left, right) => {
      const leftGroup = left.isPinned ? 0 : left.isRecent ? 1 : 2;
      const rightGroup = right.isPinned ? 0 : right.isRecent ? 1 : 2;
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      if (left.isPinned && right.isPinned) {
        return pinnedReasonIds.indexOf(left.id) - pinnedReasonIds.indexOf(right.id);
      }
      if (left.isRecent && right.isRecent) {
        return recentReasonIds.indexOf(left.id) - recentReasonIds.indexOf(right.id);
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...option }) => option);
};
