export type TodayQuickAction = 'give-points' | 'deduct-points' | 'comment' | 'evidence' | 'exam' | 'activity';
export type TodayPointEntryRequest = { id: number; direction: 'give' | 'deduct' };

export const TODAY_QUICK_ACTIONS: { id: TodayQuickAction; label: { zh: string; en: string } }[] = [
  { id: 'give-points', label: { zh: '給予積分', en: 'Give points' } },
  { id: 'deduct-points', label: { zh: '扣除積分', en: 'Deduct points' } },
  { id: 'comment', label: { zh: '新增評語', en: 'Add comment' } },
  { id: 'evidence', label: { zh: '新增學習證據', en: 'Add learning evidence' } },
  { id: 'exam', label: { zh: '建立／匯入考試', en: 'Create / import exam' } },
  { id: 'activity', label: { zh: '開始課堂活動', en: 'Start classroom activity' } },
];
