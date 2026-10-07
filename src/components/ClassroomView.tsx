import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { translations } from '../i18n/translations';
import { DEFAULT_BOSS_RECOVERY_MINUTES } from '../gameRules';
import { getPublicStudentName } from '../studentPresentation';
import type {
  LearningEvidenceRecord,
  PublicLeaderboardMode,
  Student,
} from '../store/types';
import { useStore } from '../store/useStore';
import { ClassroomPresentation } from '../features/classroom/components/ClassroomPresentation';
import {
  ClassroomActivityPanel,
  ClassroomBattlePanel,
  ClassroomBossPanel,
  ClassroomBossVictoryDialog,
  ClassroomHeader,
  ClassroomLeaderboard,
  ClassroomStudentGrid,
  ClassroomTeamDialog,
  ClassroomTeamLeaderboard,
  getClassroomBattleSettings,
  useClassroomBattleDialog,
  useClassroomRankInfo,
  useClassroomRecoveryClock,
  useClassroomTeamDialog,
  type ClassroomViewMode,
} from '../features/classroom';

const EMPTY_STUDENTS: Student[] = [];
const EMPTY_LEARNING_EVIDENCE: LearningEvidenceRecord[] = [];

export type ClassroomConsoleMode = 'pets' | 'battle' | 'leaderboard' | 'boss';
type ClassroomViewProps = { consoleMode?: ClassroomConsoleMode; visible?: boolean };

/** No-mode callers are public/read-only. Interactive controls require an explicit
 * Teacher Console destination and remain protected by the existing backend. */
export const ClassroomView: React.FC<ClassroomViewProps> = (props) => props.consoleMode
  ? <TeacherClassroomActivity {...props} />
  : <ClassroomPresentation options={{ maskNames: true, inclusiveLeaderboard: true }} />;

const TeacherClassroomActivity: React.FC<ClassroomViewProps> = ({ consoleMode, visible = true }) => {
  const {
    currentClass,
    settings,
    showBossVictory,
    bossVictoryResult,
    bossHitFeedback,
    bossAttackFeedback,
    battle,
    setTeammate,
    dismissBossVictory,
    executeBossAttack,
    clearBossRecovery,
  } = useStore(
    useShallow((state) => ({
      currentClass: state.data.classes.find(
        (classroom) => classroom.id === state.data.currentClassId,
      ),
      settings: state.data.settings,
      showBossVictory: state.showBossVictory,
      bossVictoryResult: state.bossVictoryResult,
      bossHitFeedback: state.bossHitFeedback,
      bossAttackFeedback: state.bossAttackFeedback,
      battle: state.battle,
      setTeammate: state.setTeammate,
      dismissBossVictory: state.dismissBossVictory,
      executeBossAttack: state.executeBossAttack,
      clearBossRecovery: state.clearBossRecovery,
    })),
  );
  const [viewMode, setViewMode] = useState<ClassroomViewMode>('grid');

  useEffect(() => {
    if (consoleMode) setViewMode(consoleMode === 'leaderboard' ? 'leaderboard' : 'grid');
  }, [consoleMode]);

  const students = currentClass?.students ?? EMPTY_STUDENTS;
  const learningEvidenceRecords =
    currentClass?.learningEvidenceRecords ?? EMPTY_LEARNING_EVIDENCE;
  const language = settings?.language ?? 'zh';
  const tLang = translations[language];
  const publicNameMode = settings?.publicNameMode === 'full' ? 'full' : 'masked';
  const publicLeaderboardMode: PublicLeaderboardMode =
    settings?.publicLeaderboardMode === 'rank' ||
    settings?.publicLeaderboardMode === 'hidden'
      ? settings.publicLeaderboardMode
      : 'growth';
  const battleSettings = useMemo(
    () => getClassroomBattleSettings(settings),
    [settings],
  );
  const displayStudentName = useCallback(
    (name: string) => getPublicStudentName(name, publicNameMode),
    [publicNameMode],
  );
  const getRankInfo = useClassroomRankInfo(settings?.rankBrackets, tLang);
  const recoveryNow = useClassroomRecoveryClock(students);
  const battleDialog = useClassroomBattleDialog({
    students,
    settings: battleSettings,
    battle,
  });
  const teamDialog = useClassroomTeamDialog({
    students,
    maxTeamSize: battleSettings.maxTeamSize,
    setTeammate,
  });

  useEffect(() => {
    if (publicLeaderboardMode === 'hidden' && viewMode === 'leaderboard') {
      setViewMode('grid');
    }
  }, [publicLeaderboardMode, viewMode]);

  const content = students.length === 0 || viewMode === 'grid'
    ? (
      <ClassroomStudentGrid
        students={students}
        translations={tLang}
        onBattle={battleDialog.open}
        onTeamUp={teamDialog.open}
        getRankInfo={getRankInfo}
      />
    )
    : viewMode === 'leaderboard'
      ? (
        <ClassroomLeaderboard
          mode={publicLeaderboardMode === 'growth' ? 'growth' : 'rank'}
          students={students}
          learningEvidenceRecords={learningEvidenceRecords}
          translations={tLang}
          displayStudentName={displayStudentName}
          getRankInfo={getRankInfo}
        />
      )
      : (
        <ClassroomTeamLeaderboard
          students={students}
          settings={battleSettings}
          language={language}
          translations={tLang}
          displayStudentName={displayStudentName}
        />
      );

  return (
    <div className={consoleMode ? 'rounded-lg bg-amber-50/50' : 'min-h-[calc(100vh-64px)] bg-amber-50/50'}>
      <div className="px-4 sm:px-6 lg:px-8 pt-8">
        <div className="max-w-7xl mx-auto">
          {!consoleMode && <ClassroomHeader
            language={language}
            publicLeaderboardMode={publicLeaderboardMode}
            translations={tLang}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />}
          <ClassroomBossVictoryDialog
            open={visible && showBossVictory}
            result={bossVictoryResult}
            translations={tLang}
            displayStudentName={displayStudentName}
            onClose={dismissBossVictory}
          />
          {!consoleMode && <ClassroomActivityPanel
            students={students}
            goals={currentClass?.classGoals}
            learningEvidenceRecords={learningEvidenceRecords}
            now={recoveryNow}
            schoolTimeZone={settings?.schoolTimeZone}
            language={language}
            translations={tLang}
          />}
          {(!consoleMode || consoleMode === 'boss') && <ClassroomBossPanel
            boss={currentClass?.activeBoss}
            students={students}
            now={recoveryNow}
            hitFeedback={bossHitFeedback}
            attackFeedback={bossAttackFeedback}
            attackMode={settings?.bossAttackMode}
            recoveryMinutes={
              settings?.bossRecoveryMinutes ?? DEFAULT_BOSS_RECOVERY_MINUTES
            }
            language={language}
            translations={tLang}
            displayStudentName={displayStudentName}
            onBossAttack={executeBossAttack}
            onClearRecovery={clearBossRecovery}
          />}
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          {consoleMode === 'leaderboard' && (
            <nav aria-label={language === 'en' ? 'Leaderboard views' : '排行榜檢視'} className="mb-5 flex flex-wrap gap-2">
              {publicLeaderboardMode !== 'hidden' && <button type="button" aria-pressed={viewMode === 'leaderboard'} onClick={() => setViewMode('leaderboard')} className="min-h-11 rounded-md border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900">{publicLeaderboardMode === 'growth' ? tLang.leaderboardGrowth : tLang.leaderboard}</button>}
              <button type="button" aria-pressed={viewMode === 'teams'} onClick={() => setViewMode('teams')} className="min-h-11 rounded-md border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900">{language === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}</button>
            </nav>
          )}
          {consoleMode === 'leaderboard' && publicLeaderboardMode === 'hidden' && viewMode !== 'teams'
            ? <p className="pb-5 text-sm text-slate-600">{language === 'en' ? 'Individual leaderboards are hidden by the current privacy settings.' : '目前隱私設定已隱藏個人排行榜。'}</p>
            : consoleMode !== 'boss' && content}
          <ClassroomBattlePanel
            open={visible && battleDialog.isOpen}
            students={students}
            opponents={battleDialog.opponents}
            defenderId={battleDialog.defenderId}
            settings={battleSettings}
            language={language}
            translations={tLang}
            displayStudentName={displayStudentName}
            onClose={battleDialog.close}
            onSelectDefender={battleDialog.selectDefender}
            onStart={battleDialog.start}
          />
          <ClassroomTeamDialog
            open={visible && teamDialog.isOpen}
            student={teamDialog.student}
            currentTeamMembers={teamDialog.currentTeamMembers}
            availableTeammates={teamDialog.availableTeammates}
            selectedTeammateIds={teamDialog.selectedTeammateIds}
            maxTeamSize={battleSettings.maxTeamSize}
            language={language}
            translations={tLang}
            displayStudentName={displayStudentName}
            onClose={teamDialog.close}
            onClear={teamDialog.clear}
            onSave={teamDialog.save}
            onToggleTeammate={teamDialog.toggleTeammate}
          />
        </div>
      </div>
    </div>
  );
};
