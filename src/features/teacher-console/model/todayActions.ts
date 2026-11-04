export type TodayQuickAction = 'points' | 'give-points' | 'deduct-points' | 'comment' | 'evidence' | 'exam' | 'activity';
export type TodayPointEntryRequest = { id: number; direction: 'give' | 'deduct' };

export const TODAY_QUICK_ACTIONS: { id: TodayQuickAction; label: { zh: string; en: string } }[] = [
  { id: 'points', label: { zh: '加減分', en: 'Points' } },
  { id: 'exam', label: { zh: '記錄成績', en: 'Record grades' } },
  { id: 'evidence', label: { zh: '學習紀錄', en: 'Learning records' } },
  { id: 'activity', label: { zh: '開始活動', en: 'Start activity' } },
];
