import type { LucideIcon } from 'lucide-react';
import { translations } from '../../i18n/translations';
import type { Language } from '../../store/types';

export type ClassroomTranslations = (typeof translations)[Language];

export type ClassroomRankInfo = {
  name: string;
  icon: LucideIcon;
  color: string;
  bg: string;
};

export type GetClassroomRankInfo = (rankPoints: number) => ClassroomRankInfo;
