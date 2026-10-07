import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getWeeklyEducationInsights } from '../../../educationInsights';
import {
  DEFAULT_BOSS_ATTACK_DAMAGE,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS,
  DEFAULT_BOSS_RECOVERY_MINUTES,
  DEFAULT_CATCH_UP_GAP_THRESHOLD,
  DEFAULT_DAILY_CATCH_UP_BONUS,
  DEFAULT_DAILY_NEGATIVE_POINT_LIMIT,
  DEFAULT_DAILY_POSITIVE_POINT_LIMIT,
  DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS,
  DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS,
  DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
  DEFAULT_SCHOOL_TIME_ZONE,
  DEFAULT_SCHOOL_WEEKDAYS,
  SOLO_BATTLE_FULLNESS_COST,
  SOLO_BATTLE_LOSS_POINTS,
  SOLO_BATTLE_WIN_POINTS,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST,
  TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_MIN_FULLNESS,
  TEAM_BATTLE_MIN_FULLNESS_ENABLED,
} from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import { DEFAULT_BATTLE_MODE, DEFAULT_MAX_TEAM_SIZE } from '../../../store/constants';
import type {
  BattleMode,
  BossAttackMode,
  Language,
  PetCareMode,
  PublicLeaderboardMode,
  PublicNameMode,
} from '../../../store/types';
import { useStore } from '../../../store/useStore';
import { getSettingsImpactPreview } from '../../../store/utils';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';

type UseDashboardSettingsInput = {
  canWrite: boolean;
  languageDraft: Language;
  onLanguageDraftChange: (language: Language) => void;
  petCareModeDraft: PetCareMode;
  onPetCareModeDraftChange: (mode: PetCareMode) => void;
};

/**
 * Settings form controller. It owns draft state and translates drafts into the
 * existing store contracts; presentation components only render its model.
 */
export const useDashboardSettings = ({
  canWrite,
  languageDraft,
  onLanguageDraftChange,
  petCareModeDraft,
  onPetCareModeDraftChange,
}: UseDashboardSettingsInput) => {
  const {
    data,
    setDailyTaskExcusedDate,
    showToast,
    switchClass,
    updateClassDailyTaskCalendar,
    updateSettings,
  } = useStore(useShallow((state) => ({
    data: state.data,
    setDailyTaskExcusedDate: state.setDailyTaskExcusedDate,
    showToast: state.showToast,
    switchClass: state.switchClass,
    updateClassDailyTaskCalendar: state.updateClassDailyTaskCalendar,
    updateSettings: state.updateSettings,
  })));
  const lang = data.settings?.language || 'zh';
  const copy = translations[lang];
  const runMutation = useWorkspaceMutationGuard(canWrite);
  const currentClass = data.classes.find((classData) => classData.id === data.currentClassId);
  const currentStudents = useMemo(() => currentClass?.students ?? [], [currentClass]);

  const [decayAmount, setDecayAmount] = useState(data.settings?.decayAmount ?? 2);
  const [decayType, setDecayType] = useState<'hourly' | 'daily'>(data.settings?.decayType ?? 'hourly');
  const [inclusiveMode, setInclusiveMode] = useState(data.settings?.inclusiveMode !== false);
  const [pauseDecayOnWeekends, setPauseDecayOnWeekends] = useState(data.settings?.pauseDecayOnWeekends !== false);
  const [schoolTimeZone, setSchoolTimeZone] = useState(data.settings?.schoolTimeZone ?? DEFAULT_SCHOOL_TIME_ZONE);
  const [schoolWeekdays, setSchoolWeekdays] = useState<number[]>(data.settings?.schoolWeekdays ?? [...DEFAULT_SCHOOL_WEEKDAYS]);
  const [schoolHolidayDatesText, setSchoolHolidayDatesText] = useState((data.settings?.schoolHolidayDates ?? []).join('\n'));
  const [dailyTaskMakeupWindowDays, setDailyTaskMakeupWindowDays] = useState(data.settings?.dailyTaskMakeupWindowDays ?? DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS);
  const [pointGuardrailsEnabled, setPointGuardrailsEnabled] = useState(data.settings?.pointGuardrailsEnabled !== false);
  const [dailyPositivePointLimit, setDailyPositivePointLimit] = useState(data.settings?.dailyPositivePointLimit ?? DEFAULT_DAILY_POSITIVE_POINT_LIMIT);
  const [dailyNegativePointLimit, setDailyNegativePointLimit] = useState(data.settings?.dailyNegativePointLimit ?? DEFAULT_DAILY_NEGATIVE_POINT_LIMIT);
  const [positiveFeedbackRatioTarget, setPositiveFeedbackRatioTarget] = useState(data.settings?.positiveFeedbackRatioTarget ?? DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET);
  const [participationSupportEnabled, setParticipationSupportEnabled] = useState(data.settings?.participationSupportEnabled !== false);
  const [minimumDailyParticipationPoints, setMinimumDailyParticipationPoints] = useState(data.settings?.minimumDailyParticipationPoints ?? DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS);
  const [catchUpGapThreshold, setCatchUpGapThreshold] = useState(data.settings?.catchUpGapThreshold ?? DEFAULT_CATCH_UP_GAP_THRESHOLD);
  const [dailyCatchUpBonus, setDailyCatchUpBonus] = useState(data.settings?.dailyCatchUpBonus ?? DEFAULT_DAILY_CATCH_UP_BONUS);
  const [publicNameMode, setPublicNameMode] = useState<PublicNameMode>(data.settings?.publicNameMode === 'full' ? 'full' : 'masked');
  const [publicLeaderboardMode, setPublicLeaderboardMode] = useState<PublicLeaderboardMode>(
    data.settings?.publicLeaderboardMode === 'rank' || data.settings?.publicLeaderboardMode === 'hidden'
      ? data.settings.publicLeaderboardMode
      : 'growth',
  );
  const [maxPoints, setMaxPoints] = useState(data.settings?.maxPoints ?? 700);
  const [feedCost, setFeedCost] = useState(data.settings?.feedCost ?? 10);
  const [feedGain, setFeedGain] = useState(data.settings?.feedGain ?? 20);
  const [playCost, setPlayCost] = useState(data.settings?.playCost ?? 5);
  const [playGain, setPlayGain] = useState(data.settings?.playGain ?? 15);
  const [battleEnabled, setBattleEnabled] = useState(data.settings?.battleEnabled !== false);
  const [battleMode, setBattleMode] = useState<BattleMode>(data.settings?.battleMode ?? DEFAULT_BATTLE_MODE);
  const [maxTeamSize, setMaxTeamSize] = useState(data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE);
  const [reviveCost, setReviveCost] = useState(data.settings?.reviveCost ?? 120);
  const defaultBrackets = data.settings?.rankBrackets ?? { diamond: 400, platinum: 300, gold: 200, silver: 100 };
  const [bracketDiamond, setBracketDiamond] = useState(defaultBrackets.diamond);
  const [bracketPlatinum, setBracketPlatinum] = useState(defaultBrackets.platinum);
  const [bracketGold, setBracketGold] = useState(defaultBrackets.gold);
  const [bracketSilver, setBracketSilver] = useState(defaultBrackets.silver);
  const [battleRankPointsWin, setBattleRankPointsWin] = useState(data.settings?.battleRankPointsWin ?? 20);
  const [battleRankPointsLoss, setBattleRankPointsLoss] = useState(data.settings?.battleRankPointsLoss ?? 10);
  const [battleSettingsCategory, setBattleSettingsCategory] = useState<'solo' | 'team'>('solo');
  const [soloBattleAttackerFullnessCost, setSoloBattleAttackerFullnessCost] = useState(data.settings?.soloBattleAttackerFullnessCost ?? data.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST);
  const [soloBattleDefenderFullnessCost, setSoloBattleDefenderFullnessCost] = useState(data.settings?.soloBattleDefenderFullnessCost ?? data.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST);
  const [soloBattleWinPoints, setSoloBattleWinPoints] = useState(data.settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS);
  const [soloBattleLossPoints, setSoloBattleLossPoints] = useState(data.settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS);
  const [teamBattleMinFullnessEnabled, setTeamBattleMinFullnessEnabled] = useState(data.settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED);
  const [teamBattleMinFullness, setTeamBattleMinFullness] = useState(data.settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS);
  const [teamBattleAttackerFullnessCost, setTeamBattleAttackerFullnessCost] = useState(data.settings?.teamBattleAttackerFullnessCost ?? TEAM_BATTLE_ATTACKER_FULLNESS_COST);
  const [teamBattleAttackerTeammateFullnessCost, setTeamBattleAttackerTeammateFullnessCost] = useState(data.settings?.teamBattleAttackerTeammateFullnessCost ?? TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST);
  const [teamBattleDefenderFullnessCost, setTeamBattleDefenderFullnessCost] = useState(data.settings?.teamBattleDefenderFullnessCost ?? TEAM_BATTLE_DEFENDER_FULLNESS_COST);
  const [teamBattleDefenderTeammateFullnessCost, setTeamBattleDefenderTeammateFullnessCost] = useState(data.settings?.teamBattleDefenderTeammateFullnessCost ?? TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST);
  const [bossAttackMaxTargets, setBossAttackMaxTargets] = useState(data.settings?.bossAttackMaxTargets ?? DEFAULT_BOSS_ATTACK_MAX_TARGETS);
  const [bossAttackDamage, setBossAttackDamage] = useState(data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE);
  const [bossAttackMode, setBossAttackMode] = useState<BossAttackMode>(data.settings?.bossAttackMode ?? 'recoverable');
  const [bossRecoveryMinutes, setBossRecoveryMinutes] = useState(data.settings?.bossRecoveryMinutes ?? DEFAULT_BOSS_RECOVERY_MINUTES);
  const [enableSeasonResetRewards, setEnableSeasonResetRewards] = useState(data.settings?.enableSeasonResetRewards ?? false);
  const defaultRewards = data.settings?.seasonResetRewards ?? { diamond: 500, platinum: 400, gold: 300, silver: 200, bronze: 100 };
  const [rewardDiamond, setRewardDiamond] = useState(defaultRewards.diamond);
  const [rewardPlatinum, setRewardPlatinum] = useState(defaultRewards.platinum);
  const [rewardGold, setRewardGold] = useState(defaultRewards.gold);
  const [rewardSilver, setRewardSilver] = useState(defaultRewards.silver);
  const [rewardBronze, setRewardBronze] = useState(defaultRewards.bronze);

  useEffect(() => {
    const calendar = currentClass?.dailyTaskCalendar;
    setSchoolTimeZone(calendar?.schoolTimeZone ?? data.settings?.schoolTimeZone ?? DEFAULT_SCHOOL_TIME_ZONE);
    setSchoolWeekdays(calendar?.schoolWeekdays ?? data.settings?.schoolWeekdays ?? [...DEFAULT_SCHOOL_WEEKDAYS]);
    setSchoolHolidayDatesText((calendar?.schoolHolidayDates ?? data.settings?.schoolHolidayDates ?? []).join('\n'));
    setDailyTaskMakeupWindowDays(calendar?.dailyTaskMakeupWindowDays ?? data.settings?.dailyTaskMakeupWindowDays ?? DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS);
  }, [
    currentClass?.dailyTaskCalendar?.dailyTaskMakeupWindowDays,
    currentClass?.dailyTaskCalendar?.schoolHolidayDates,
    currentClass?.dailyTaskCalendar?.schoolTimeZone,
    currentClass?.dailyTaskCalendar?.schoolWeekdays,
    currentClass?.id,
    data.settings?.dailyTaskMakeupWindowDays,
    data.settings?.schoolHolidayDates,
    data.settings?.schoolTimeZone,
    data.settings?.schoolWeekdays,
  ]);

  const weeklyInsights = useMemo(
    () => getWeeklyEducationInsights(
      currentStudents,
      Date.now(),
      7,
      currentClass?.learningEvidenceRecords ?? [],
    ),
    [currentClass?.learningEvidenceRecords, currentStudents],
  );
  const settingsPreviewNow = useMemo(() => Date.now(), [currentClass?.id]);
  const settingsImpactPreview = useMemo(
    () => getSettingsImpactPreview(
      currentStudents,
      {
        decayAmount: Math.max(0, Number(decayAmount)),
        decayType,
        pauseDecayOnWeekends: inclusiveMode || pauseDecayOnWeekends,
        feedCost: Math.max(0, Number(feedCost)),
        feedGain: Math.max(1, Number(feedGain)),
      },
      weeklyInsights.positiveCount,
      settingsPreviewNow,
    ),
    [currentStudents, decayAmount, decayType, feedCost, feedGain, inclusiveMode, pauseDecayOnWeekends, settingsPreviewNow, weeklyInsights.positiveCount],
  );

  const persistCurrentClassDailyTaskCalendar = () => {
    if (!currentClass) return false;
    updateClassDailyTaskCalendar(currentClass.id, {
      schoolTimeZone,
      schoolWeekdays,
      schoolHolidayDates: schoolHolidayDatesText.split(/[\s,]+/).filter(Boolean),
      dailyTaskMakeupWindowDays: Number(dailyTaskMakeupWindowDays),
    });
    return true;
  };

  const saveCurrentClassDailyTaskCalendar = (announce = true) => {
    runMutation(() => {
      if (!persistCurrentClassDailyTaskCalendar()) return;
      if (announce) {
        showToast(
          lang === 'en'
            ? `${currentClass.name} daily task calendar saved.`
            : `${currentClass.name}的每日任務校曆已儲存`,
          'success',
        );
      }
    });
  };

  const saveSettings = () => {
    runMutation(() => {
      persistCurrentClassDailyTaskCalendar();
      updateSettings({
        decayAmount: Number(decayAmount),
        decayType,
        inclusiveMode,
        pauseDecayOnWeekends,
        pointGuardrailsEnabled,
        dailyPositivePointLimit: Number(dailyPositivePointLimit),
        dailyNegativePointLimit: Number(dailyNegativePointLimit),
        positiveFeedbackRatioTarget: Number(positiveFeedbackRatioTarget),
        participationSupportEnabled,
        minimumDailyParticipationPoints: Number(minimumDailyParticipationPoints),
        catchUpGapThreshold: Number(catchUpGapThreshold),
        dailyCatchUpBonus: Number(dailyCatchUpBonus),
        petCareMode: petCareModeDraft,
        publicNameMode,
        publicLeaderboardMode,
        language: languageDraft,
        feedCost: Number(feedCost),
        feedGain: Number(feedGain),
        playCost: Number(playCost),
        playGain: Number(playGain),
        battleEnabled,
        battleMode,
        maxTeamSize: Number(maxTeamSize),
        maxPoints: Number(maxPoints),
        reviveCost: Number(reviveCost),
        rankBrackets: {
          diamond: Number(bracketDiamond),
          platinum: Number(bracketPlatinum),
          gold: Number(bracketGold),
          silver: Number(bracketSilver),
        },
        battleRankPointsWin: Number(battleRankPointsWin),
        battleRankPointsLoss: Number(battleRankPointsLoss),
        soloBattleAttackerFullnessCost: Number(soloBattleAttackerFullnessCost),
        soloBattleDefenderFullnessCost: Number(soloBattleDefenderFullnessCost),
        soloBattleWinPoints: Number(soloBattleWinPoints),
        soloBattleLossPoints: Number(soloBattleLossPoints),
        teamBattleMinFullnessEnabled,
        teamBattleMinFullness: Number(teamBattleMinFullness),
        teamBattleAttackerFullnessCost: Number(teamBattleAttackerFullnessCost),
        teamBattleAttackerTeammateFullnessCost: Number(teamBattleAttackerTeammateFullnessCost),
        teamBattleDefenderFullnessCost: Number(teamBattleDefenderFullnessCost),
        teamBattleDefenderTeammateFullnessCost: Number(teamBattleDefenderTeammateFullnessCost),
        bossAttackMaxTargets: Number(bossAttackMaxTargets),
        bossAttackDamage: Number(bossAttackDamage),
        bossAttackMode,
        bossRecoveryMinutes: Number(bossRecoveryMinutes),
        enableSeasonResetRewards,
        seasonResetRewards: {
          diamond: Number(rewardDiamond),
          platinum: Number(rewardPlatinum),
          gold: Number(rewardGold),
          silver: Number(rewardSilver),
          bronze: Number(rewardBronze),
        },
      });
    });
  };

  const applySettingsPreset = (
    preset: 'lowCompetition' | 'cooperative' | 'shortCampaign',
    name: string,
  ) => {
    if (preset === 'lowCompetition') {
      setInclusiveMode(true);
      setBattleMode('both');
      setBattleRankPointsWin(8);
      setBattleRankPointsLoss(0);
      setSoloBattleWinPoints(30);
      setSoloBattleLossPoints(0);
      setBossAttackMode('recoverable');
      setBossAttackDamage(12);
      setDecayType('daily');
      setDecayAmount(2);
      setPauseDecayOnWeekends(true);
      onPetCareModeDraftChange('rest');
      setPublicNameMode('masked');
      setPublicLeaderboardMode('growth');
    } else if (preset === 'cooperative') {
      setInclusiveMode(true);
      setBattleMode('team');
      setMaxTeamSize(4);
      setBattleRankPointsWin(5);
      setBattleRankPointsLoss(0);
      setTeamBattleMinFullnessEnabled(false);
      setTeamBattleAttackerFullnessCost(10);
      setTeamBattleAttackerTeammateFullnessCost(8);
      setTeamBattleDefenderFullnessCost(10);
      setTeamBattleDefenderTeammateFullnessCost(8);
      setBossAttackMode('recoverable');
      setBossAttackDamage(16);
      setPauseDecayOnWeekends(true);
      onPetCareModeDraftChange('rest');
      setPublicNameMode('masked');
      setPublicLeaderboardMode('growth');
    } else {
      setInclusiveMode(true);
      setDecayType('daily');
      setDecayAmount(5);
      setMaxPoints(400);
      setFeedCost(8);
      setFeedGain(25);
      setPlayCost(4);
      setPlayGain(20);
      setBattleMode('both');
      setBossAttackMode('recoverable');
      setBossAttackDamage(20);
      setPauseDecayOnWeekends(true);
      onPetCareModeDraftChange('rest');
      setPublicNameMode('masked');
      setPublicLeaderboardMode('growth');
    }
    setParticipationSupportEnabled(true);
    setMinimumDailyParticipationPoints(20);
    setCatchUpGapThreshold(preset === 'lowCompetition' ? 75 : 100);
    setDailyCatchUpBonus(preset === 'lowCompetition' ? 15 : 10);
    showToast(copy.presetApplied.replace('{name}', name), 'success');
  };

  const toggleInclusiveMode = () => {
    setInclusiveMode((enabled) => {
      const nextEnabled = !enabled;
      if (nextEnabled) {
        setPauseDecayOnWeekends(true);
        onPetCareModeDraftChange('rest');
        setPublicNameMode('masked');
        setPublicLeaderboardMode('growth');
        setBossAttackMode('recoverable');
      }
      return nextEnabled;
    });
  };

  return {
    actions: {
      applySettingsPreset,
      saveCurrentClassDailyTaskCalendar,
      saveSettings,
      setDailyTaskExcusedDate: (studentId: string, date: string, excused: boolean) =>
        runMutation(() => setDailyTaskExcusedDate(studentId, date, excused)),
      switchClass: (classId: string) => runMutation(() => switchClass(classId)),
      toggleInclusiveMode,
    },
    battle: {
      battleEnabled, setBattleEnabled, battleMode, setBattleMode, maxTeamSize, setMaxTeamSize,
      battleRankPointsWin, setBattleRankPointsWin, battleRankPointsLoss, setBattleRankPointsLoss,
      battleSettingsCategory, setBattleSettingsCategory,
      soloBattleAttackerFullnessCost, setSoloBattleAttackerFullnessCost,
      soloBattleDefenderFullnessCost, setSoloBattleDefenderFullnessCost,
      soloBattleWinPoints, setSoloBattleWinPoints, soloBattleLossPoints, setSoloBattleLossPoints,
      teamBattleMinFullnessEnabled, setTeamBattleMinFullnessEnabled,
      teamBattleMinFullness, setTeamBattleMinFullness,
      teamBattleAttackerFullnessCost, setTeamBattleAttackerFullnessCost,
      teamBattleAttackerTeammateFullnessCost, setTeamBattleAttackerTeammateFullnessCost,
      teamBattleDefenderFullnessCost, setTeamBattleDefenderFullnessCost,
      teamBattleDefenderTeammateFullnessCost, setTeamBattleDefenderTeammateFullnessCost,
    },
    boss: {
      bossAttackMaxTargets, setBossAttackMaxTargets, bossAttackDamage, setBossAttackDamage,
      bossAttackMode, setBossAttackMode, bossRecoveryMinutes, setBossRecoveryMinutes,
    },
    calendar: {
      schoolTimeZone, setSchoolTimeZone, schoolWeekdays, setSchoolWeekdays,
      schoolHolidayDatesText, setSchoolHolidayDatesText,
      dailyTaskMakeupWindowDays, setDailyTaskMakeupWindowDays,
    },
    context: { copy, currentClass, currentStudents, data, lang },
    economy: { feedCost, setFeedCost, feedGain, setFeedGain, playCost, setPlayCost, playGain, setPlayGain, reviveCost, setReviveCost },
    general: { decayAmount, setDecayAmount, decayType, setDecayType, languageDraft, onLanguageDraftChange, maxPoints, setMaxPoints },
    guardrails: { pointGuardrailsEnabled, setPointGuardrailsEnabled, dailyPositivePointLimit, setDailyPositivePointLimit, dailyNegativePointLimit, setDailyNegativePointLimit, positiveFeedbackRatioTarget, setPositiveFeedbackRatioTarget },
    participation: { participationSupportEnabled, setParticipationSupportEnabled, minimumDailyParticipationPoints, setMinimumDailyParticipationPoints, catchUpGapThreshold, setCatchUpGapThreshold, dailyCatchUpBonus, setDailyCatchUpBonus },
    privacy: { inclusiveMode, pauseDecayOnWeekends, setPauseDecayOnWeekends, petCareModeDraft, onPetCareModeDraftChange, publicNameMode, setPublicNameMode, publicLeaderboardMode, setPublicLeaderboardMode },
    preview: settingsImpactPreview,
    season: { bracketDiamond, setBracketDiamond, bracketPlatinum, setBracketPlatinum, bracketGold, setBracketGold, bracketSilver, setBracketSilver, enableSeasonResetRewards, setEnableSeasonResetRewards, rewardDiamond, setRewardDiamond, rewardPlatinum, setRewardPlatinum, rewardGold, setRewardGold, rewardSilver, setRewardSilver, rewardBronze, setRewardBronze },
  };
};

export type DashboardSettingsModel = ReturnType<typeof useDashboardSettings>;
