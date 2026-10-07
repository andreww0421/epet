import type { Language } from '../../../store/types';

export type ConsoleArea = 'today' | 'class' | 'learning' | 'activities' | 'insights' | 'settings';
export type ConsoleCapabilities = { readOnly: boolean; canAdministerWorkspace: boolean };
type Access = 'read' | 'write' | 'admin';
const destination = <Id extends string>(id: Id, area: ConsoleArea, zh: string, en: string, access: Access) =>
  ({ id, area, label: { zh, en }, access });

/** Task destinations, not feature ownership. This model never grants API access. */
export const CONSOLE_DESTINATIONS = [
  destination('today', 'today', '今日總覽', 'Overview', 'read'),
  destination('students', 'class', '學生', 'Students', 'write'),
  destination('groups', 'class', '分組', 'Groups', 'write'),
  destination('points', 'class', '獎勵', 'Rewards', 'write'),
  destination('comments', 'class', '每日評語', 'Daily comments', 'write'),
  destination('records', 'class', '紀錄', 'Records', 'read'),
  destination('evidence', 'learning', '學習證據', 'Learning evidence', 'write'),
  destination('exams', 'learning', '考試分析', 'Exam analysis', 'read'),
  destination('goals', 'learning', '本週學習目標', 'Weekly learning goals', 'write'),
  destination('reports', 'learning', '每週回饋報告', 'Weekly feedback reports', 'read'),
  destination('pets', 'activities', '寵物', 'Pets', 'write'),
  destination('boss', 'activities', '魔王管理', 'Boss management', 'write'),
  destination('battle', 'activities', '對戰', 'Battle', 'write'),
  destination('activity-rewards', 'activities', '遊戲獎勵', 'Game rewards', 'write'),
  destination('leaderboard', 'activities', '排行榜', 'Leaderboard', 'write'),
  destination('student-insights', 'insights', '個人分析', 'Student analytics', 'read'),
  destination('class-insights', 'insights', '班級分析', 'Class analytics', 'read'),
  destination('trends', 'insights', '學習趨勢', 'Learning trends', 'read'),
  destination('rules', 'settings', '規則', 'Rules', 'admin'),
  destination('reward-settings', 'settings', '獎勵設定', 'Reward settings', 'admin'),
  destination('workspace', 'settings', '工作區與使用者', 'Workspace and users', 'admin'),
  destination('security', 'settings', '安全與帳號', 'Security and account', 'admin'),
  destination('governance', 'settings', '資料治理', 'Data governance', 'admin'),
] as const;
export type ConsoleDestination = typeof CONSOLE_DESTINATIONS[number]['id'];
export const PRIMARY_AREAS: ConsoleArea[] = ['today', 'class', 'learning', 'activities', 'insights'];
export const AREA_LABELS: Record<ConsoleArea, string> = {
  today: 'Today', class: 'Class', learning: 'Learning', activities: 'Activities', insights: 'Insights', settings: 'Settings',
};
export const AREA_DESCRIPTIONS: Record<ConsoleArea, Record<Language, string>> = {
  today: { zh: '從目前班級開始，處理今天需要關注的事。', en: 'Start with your current class and what needs attention today.' },
  class: { zh: '管理學生、分組與日常回饋。', en: 'Manage students, groups and day-to-day feedback.' },
  learning: { zh: '記錄學習證據，安排目標與評量，整理回饋報告。', en: 'Capture evidence, set goals, assess learning and prepare reports.' },
  activities: { zh: '帶領寵物、魔王與對戰活動；遊戲結果不代表學習評量。', en: 'Run pet, boss and battle activities. Game outcomes are not learning assessments.' },
  insights: { zh: '從學生、班級與學習趨勢理解進展。', en: 'Understand progress through student, class and learning insights.' },
  settings: { zh: '設定規則、管理工作區權限與資料安全。', en: 'Configure rules, workspace access and data safety.' },
};
export const getDestination = (id: ConsoleDestination) => CONSOLE_DESTINATIONS.find((item) => item.id === id)!;
export const canOpenDestination = (id: ConsoleDestination, capabilities: ConsoleCapabilities) => {
  const { access } = getDestination(id);
  return access === 'read' || (!capabilities.readOnly &&
    (access === 'write' || capabilities.canAdministerWorkspace));
};
export const getAreaDestinations = (area: ConsoleArea, capabilities: ConsoleCapabilities) =>
  CONSOLE_DESTINATIONS.filter((item) => item.area === area && canOpenDestination(item.id, capabilities));
export const resolveDestination = (id: ConsoleDestination, capabilities: ConsoleCapabilities): ConsoleDestination =>
  canOpenDestination(id, capabilities) ? id : 'today';
