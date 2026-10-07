import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { runWorkspaceMutation } from '../../../auth/workspaceAccess';
import { DashboardRecordsPanel, type DashboardRecordsMode } from './DashboardRecordsPanel';
import { translations } from '../../../i18n/translations';
import { useStore } from '../../../store/useStore';
import { getCompetencyLabels } from '../../learning/model/getCompetencyLabels';
import type { RecordViewRequest } from '../model/recordNavigation';

type DashboardRecordsSectionProps = {
  classId: string;
  readOnly: boolean;
  visible?: boolean;
  mode?: DashboardRecordsMode;
  historyKind?: 'all' | 'boss';
  viewRequest?: RecordViewRequest | null;
};

/** Adapts selected-class state to the existing records presentation. */
export const DashboardRecordsSection = ({
  classId,
  readOnly,
  visible = true,
  mode = 'all',
  historyKind = 'all',
  viewRequest,
}: DashboardRecordsSectionProps) => {
  const { data, saveMentorDailyFeedback, showToast } = useStore(useShallow((state) => ({
    data: state.data,
    saveMentorDailyFeedback: state.saveMentorDailyFeedback,
    showToast: state.showToast,
  })));
  const lang = data.settings?.language || 'zh';
  const currentClass = data.classes.find((classData) => classData.id === classId);
  const competencyLabels = useMemo(() => getCompetencyLabels(lang), [lang]);

  return (
    <DashboardRecordsPanel
      classId={currentClass?.id}
      competencyLabels={competencyLabels}
      lang={lang}
      mode={mode}
      historyKind={historyKind}
      viewRequest={viewRequest}
      learningEvidence={currentClass?.learningEvidenceRecords ?? []}
      onSaveMentorDailyFeedback={(studentId, feedback) => runWorkspaceMutation(
        !readOnly,
        () => saveMentorDailyFeedback(studentId, feedback),
        () => showToast(
          lang === 'en'
            ? 'This workspace is read-only for your account.'
            : '目前帳號只能閱讀此工作區。',
          'error',
        ),
      )}
      schoolTimeZone={currentClass?.dailyTaskCalendar?.schoolTimeZone ?? data.settings?.schoolTimeZone}
      students={currentClass?.students ?? []}
      tLang={translations[lang]}
      visible={visible}
    />
  );
};
