import type { Language } from '../../../store/types';

export type ConsoleArea = 'today' | 'class' | 'learning' | 'activities' | 'settings';
export type ConsoleCapabilities = { readOnly: boolean; canAdministerWorkspace: boolean };
type Access = 'read' | 'write' | 'admin';
const destination = <Id extends string>(id: Id, area: ConsoleArea, zh: string, en: string, access: Access) =>
  ({ id, area, label: { zh, en }, access });

/** Task destinations, not feature ownership. This model never grants API access. */
export const CONSOLE_DESTINATIONS = [
  destination('today', 'today', '今日總覽', 'Overview', 'read'),
  destination('students', 'class', '學生', 'Students', 'write'),
  destination('groups', 'class', '分組', 'Groups', 'write'),
  destination('points', 'class', '加減分', 'Points', 'write'),
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
  destination('student-insights', 'class', '個人分析', 'Student analytics', 'read'),
  destination('class-insights', 'class', '班級分析', 'Class analytics', 'read'),
  destination('trends', 'learning', '學習趨勢', 'Learning trends', 'read'),
  destination('rules', 'settings', '規則', 'Rules', 'admin'),
  destination('reward-settings', 'settings', '獎勵設定', 'Reward settings', 'admin'),
  destination('workspace', 'settings', '工作區與使用者', 'Workspace and users', 'admin'),
  destination('security', 'settings', '安全與帳號', 'Security and account', 'admin'),
  destination('governance', 'settings', '資料治理', 'Data governance', 'admin'),
] as const;
export type ConsoleDestination = typeof CONSOLE_DESTINATIONS[number]['id'];
export const PRIMARY_AREAS: ConsoleArea[] = ['today', 'class', 'learning', 'activities'];
export const AREA_LABELS: Record<ConsoleArea, string> = {
  today: 'Today', class: 'Class', learning: 'Learning', activities: 'Activities', settings: 'Settings',
};
const AREA_LABELS_ZH: Record<ConsoleArea, string> = {
  today: '首頁', class: '班級', learning: '教學', activities: '活動', settings: '管理設定',
};
export const getAreaLabel = (area: ConsoleArea, language: Language) =>
  language === 'en' ? AREA_LABELS[area] : AREA_LABELS_ZH[area];
export const AREA_DESCRIPTIONS: Record<ConsoleArea, Record<Language, string>> = {
  today: { zh: '從目前班級開始，處理今天需要關注的事。', en: 'Start with your current class and what needs attention today.' },
  class: { zh: '管理學生與分組、加減分和每日評語，直接查看個人與班級分析。', en: 'Manage students, groups, points and daily comments, with student and class analytics close at hand.' },
  learning: { zh: '記錄學習證據，建立考試與目標，整理回饋報告並查看學習趨勢。', en: 'Capture evidence, create exams and goals, prepare feedback reports and review learning trends.' },
  activities: { zh: '帶領寵物、魔王與對戰活動；遊戲結果不代表學習評量。', en: 'Run pet, boss and battle activities. Game outcomes are not learning assessments.' },
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
const ANALYSIS_DESTINATIONS: readonly ConsoleDestination[] = ['student-insights', 'class-insights', 'trends'];
export const isAnalysisDestination = (id: ConsoleDestination) => ANALYSIS_DESTINATIONS.includes(id);
export const getAreaTaskDestinations = (area: ConsoleArea, capabilities: ConsoleCapabilities) =>
  getAreaDestinations(area, capabilities).filter((item) => !isAnalysisDestination(item.id));
export const getAreaAnalysisDestinations = (area: ConsoleArea, capabilities: ConsoleCapabilities) =>
  getAreaDestinations(area, capabilities).filter((item) => isAnalysisDestination(item.id));
export const resolveDestination = (id: ConsoleDestination, capabilities: ConsoleCapabilities): ConsoleDestination =>
  canOpenDestination(id, capabilities) ? id : 'today';
