import { Save, Settings } from 'lucide-react';
import { DailyTaskCalendarSettings } from './DailyTaskCalendarSettings';
import {
  ParticipationSupportSettings,
  PointGuardrailSettings,
} from '../../rewards/components/PointGuardrailPanel';
import { WorkspaceAccessPanel } from '../../workspace/components/WorkspaceAccessPanel';
import type { Language, PetCareMode } from '../../../store/types';
import { useDashboardSettings } from '../hooks/useDashboardSettings';
import { GameRuleSettings } from './GameRuleSettings';
import { SettingsOverview } from './SettingsOverview';
import { GameFeatureSettings } from './GameFeatureSettings';

type DashboardSettingsSectionProps = {
  canAdministerWorkspace: boolean;
  canWrite: boolean;
  languageDraft: Language;
  mode?: 'rules' | 'rewards' | 'workspace' | 'governance' | 'all';
  onLanguageDraftChange: (language: Language) => void;
  onPetCareModeDraftChange: (mode: PetCareMode) => void;
  petCareModeDraft: PetCareMode;
  visible: boolean;
};

/** Keeps one draft/save owner while the console exposes focused settings destinations. */
export const DashboardSettingsSection = ({
  canAdministerWorkspace,
  canWrite,
  languageDraft,
  mode = 'all',
  onLanguageDraftChange,
  onPetCareModeDraftChange,
  petCareModeDraft,
  visible,
}: DashboardSettingsSectionProps) => {
  const model = useDashboardSettings({
    canWrite,
    languageDraft,
    onLanguageDraftChange,
    petCareModeDraft,
    onPetCareModeDraftChange,
  });
  const { actions, calendar, context, guardrails, participation } = model;
  const { copy, currentClass, currentStudents, data, lang } = context;

  return (
    <div className={`${visible ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5`}>
      <h2 className="text-lg font-medium text-slate-900 mb-6 flex items-center">
        <Settings className="h-5 w-5 mr-2 text-indigo-500" />
        {copy.systemSettings}
      </h2>

      {canAdministerWorkspace && <div hidden={mode !== 'all' && mode !== 'rules'}>
        <GameFeatureSettings canWrite={canWrite} language={lang} />
      </div>}

      <div hidden={mode !== 'all' && mode !== 'workspace'}>
        {canAdministerWorkspace && (
          <WorkspaceAccessPanel
            classes={data.classes.map((classroom) => ({ id: classroom.id, name: classroom.name }))}
            language={lang}
          />
        )}
      </div>

      <div hidden={mode !== 'all' && mode !== 'rules'}>
        <DailyTaskCalendarSettings
          lang={lang}
          classes={data.classes.map((classroom) => ({ id: classroom.id, name: classroom.name }))}
          selectedClassId={currentClass?.id ?? ''}
          onClassChange={actions.switchClass}
          timeZone={calendar.schoolTimeZone}
          onTimeZoneChange={calendar.setSchoolTimeZone}
          schoolWeekdays={calendar.schoolWeekdays}
          onSchoolWeekdaysChange={calendar.setSchoolWeekdays}
          holidayDatesText={calendar.schoolHolidayDatesText}
          onHolidayDatesTextChange={calendar.setSchoolHolidayDatesText}
          makeupWindowDays={calendar.dailyTaskMakeupWindowDays}
          onMakeupWindowDaysChange={calendar.setDailyTaskMakeupWindowDays}
          students={currentStudents}
          onSetExcusedDate={actions.setDailyTaskExcusedDate}
          onSave={() => actions.saveCurrentClassDailyTaskCalendar(true)}
        />
      </div>

      <div hidden={mode !== 'all' && mode !== 'rewards'}>
        <PointGuardrailSettings
          lang={lang}
          enabled={guardrails.pointGuardrailsEnabled}
          onEnabledChange={guardrails.setPointGuardrailsEnabled}
          dailyPositiveLimit={guardrails.dailyPositivePointLimit}
          onDailyPositiveLimitChange={guardrails.setDailyPositivePointLimit}
          dailyNegativeLimit={guardrails.dailyNegativePointLimit}
          onDailyNegativeLimitChange={guardrails.setDailyNegativePointLimit}
          positiveRatioTarget={guardrails.positiveFeedbackRatioTarget}
          onPositiveRatioTargetChange={guardrails.setPositiveFeedbackRatioTarget}
        />

        <ParticipationSupportSettings
          lang={lang}
          enabled={participation.participationSupportEnabled}
          onEnabledChange={participation.setParticipationSupportEnabled}
          minimumDailyParticipationPoints={participation.minimumDailyParticipationPoints}
          onMinimumDailyParticipationPointsChange={participation.setMinimumDailyParticipationPoints}
          catchUpGapThreshold={participation.catchUpGapThreshold}
          onCatchUpGapThresholdChange={participation.setCatchUpGapThreshold}
          dailyCatchUpBonus={participation.dailyCatchUpBonus}
          onDailyCatchUpBonusChange={participation.setDailyCatchUpBonus}
        />
      </div>

      <div id="privacy-display-settings" tabIndex={-1} hidden={mode !== 'all' && mode !== 'rules' && mode !== 'governance'}>
        <SettingsOverview model={model} mode={mode === 'governance' ? 'governance' : mode === 'rules' ? 'rules' : 'all'} />
      </div>
      <div hidden={mode !== 'all' && mode !== 'rules' && mode !== 'rewards'}>
        <details className="mb-6 rounded-xl border border-slate-200 p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-700">{lang === 'en' ? 'Advanced game parameters' : '進階遊戲參數'}</summary>
          <p className="mb-4 text-sm text-slate-600">{lang === 'en' ? 'Economy, battle, boss and rank values. Changes apply only after saving settings; interface presets do not change these values.' : '包含經濟、對戰、魔王與段位數值。修改後需儲存設定才會套用；活動介面方案不會改動這些數值。'}</p>
          <GameRuleSettings model={model} mode={mode === 'rewards' ? 'rewards' : mode === 'rules' ? 'rules' : 'all'} />
        </details>
      </div>

      <div hidden={mode === 'workspace'} className="border-t border-slate-200 pt-5">
        <button
          onClick={actions.saveSettings}
          className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
        >
          <Save className="h-4 w-4 mr-2" />
          {copy.saveSettings}
        </button>
        {mode !== 'all' && mode !== 'workspace' && (
          <p className="mt-2 text-xs text-slate-500">
            {lang === 'en'
              ? 'Save applies Game Rules, Rewards and Data Governance drafts. Use Save activity entry points separately for visibility changes.'
              : '此按鈕套用遊戲規則、獎勵與資料治理草稿；活動入口請另按「儲存活動入口」保存。'}
          </p>
        )}
      </div>
    </div>
  );
};
