import React, { useState, useRef } from 'react';
import { 
  Users, Settings, AlertCircle, Trash2, Star, Shield, Zap, X, Plus, Minus,
  Download, Upload, ChevronsDown, Edit2, Save, BookOpen, RefreshCw, Skull, Swords,
  Gift, Crosshair,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { translations, petNames, POINT_REASON_OPTIONS } from '../i18n/translations';
import { PET_TYPES, DEFAULT_BATTLE_MODE, DEFAULT_MAX_TEAM_SIZE } from '../store/constants';
import { normalizeAppData, applyDecay } from '../store/utils';
import { Student, Language, BattleMode, BossRewardTier } from '../store/types';
import { 
  isPenaltyActive, WARNING_THRESHOLD, WARNING_AUTO_PENALTY, DIRECT_DISCIPLINE_PENALTY,
  SOLO_BATTLE_FULLNESS_COST, SOLO_BATTLE_WIN_POINTS, SOLO_BATTLE_LOSS_POINTS,
  TEAM_BATTLE_MIN_FULLNESS, TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  TEAM_BATTLE_ATTACKER_FULLNESS_COST, TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  TEAM_BATTLE_DEFENDER_FULLNESS_COST, TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  DEFAULT_BOSS_ATTACK_MAX_TARGETS, DEFAULT_BOSS_ATTACK_DAMAGE, DEFAULT_BOSS_REWARD_TIERS,
  type DisciplineRecordType
} from '../gameRules';

export const DashboardView: React.FC = () => {
  const store = useStore();
  const data = store.data;
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newStudentName, setNewStudentName] = useState('');
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [customPoints, setCustomPoints] = useState<{id: string, name: string} | null>(null);
  const [pointsAmount, setPointsAmount] = useState('');
  const [showAirdrop, setShowAirdrop] = useState(false);
  const [airdropAmount, setAirdropAmount] = useState('');
  const [airdropReason, setAirdropReason] = useState('');
  const [recordView, setRecordView] = useState<'discipline' | 'points'>('discipline');
  const [decayAmount, setDecayAmount] = useState(data.settings?.decayAmount ?? 2);
  const [decayType, setDecayType] = useState<'hourly' | 'daily'>(data.settings?.decayType ?? 'hourly');
  const [maxPoints, setMaxPoints] = useState(data.settings?.maxPoints ?? 700);
  const [feedCost, setFeedCost] = useState(data.settings?.feedCost ?? 10);
  const [feedGain, setFeedGain] = useState(data.settings?.feedGain ?? 20);
  const [playCost, setPlayCost] = useState(data.settings?.playCost ?? 5);
  const [playGain, setPlayGain] = useState(data.settings?.playGain ?? 15);
  const [battleMode, setBattleMode] = useState<BattleMode>(data.settings?.battleMode ?? DEFAULT_BATTLE_MODE);
  const [maxTeamSize, setMaxTeamSize] = useState(data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE);
  const [currentLang, setCurrentLang] = useState<Language>(lang);
  const [reviveCost, setReviveCost] = useState(data.settings?.reviveCost ?? 120);

  const defaultBrackets = data.settings?.rankBrackets ?? { diamond: 400, platinum: 300, gold: 200, silver: 100 };
  const [bracketDiamond, setBracketDiamond] = useState(defaultBrackets.diamond);
  const [bracketPlatinum, setBracketPlatinum] = useState(defaultBrackets.platinum);
  const [bracketGold, setBracketGold] = useState(defaultBrackets.gold);
  const [bracketSilver, setBracketSilver] = useState(defaultBrackets.silver);

  const [battleRankPointsWin, setBattleRankPointsWin] = useState(data.settings?.battleRankPointsWin ?? 20);
  const [battleRankPointsLoss, setBattleRankPointsLoss] = useState(data.settings?.battleRankPointsLoss ?? 10);
  const [battleSettingsCategory, setBattleSettingsCategory] = useState<'solo' | 'team'>('solo');
  const [soloBattleAttackerFullnessCost, setSoloBattleAttackerFullnessCost] = useState(
    data.settings?.soloBattleAttackerFullnessCost ?? data.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST,
  );
  const [soloBattleDefenderFullnessCost, setSoloBattleDefenderFullnessCost] = useState(
    data.settings?.soloBattleDefenderFullnessCost ?? data.settings?.soloBattleFullnessCost ?? SOLO_BATTLE_FULLNESS_COST,
  );
  const [soloBattleWinPoints, setSoloBattleWinPoints] = useState(data.settings?.soloBattleWinPoints ?? SOLO_BATTLE_WIN_POINTS);
  const [soloBattleLossPoints, setSoloBattleLossPoints] = useState(data.settings?.soloBattleLossPoints ?? SOLO_BATTLE_LOSS_POINTS);
  const [teamBattleMinFullnessEnabled, setTeamBattleMinFullnessEnabled] = useState(
    data.settings?.teamBattleMinFullnessEnabled ?? TEAM_BATTLE_MIN_FULLNESS_ENABLED,
  );
  const [teamBattleMinFullness, setTeamBattleMinFullness] = useState(
    data.settings?.teamBattleMinFullness ?? TEAM_BATTLE_MIN_FULLNESS,
  );
  const [teamBattleAttackerFullnessCost, setTeamBattleAttackerFullnessCost] = useState(
    data.settings?.teamBattleAttackerFullnessCost ?? TEAM_BATTLE_ATTACKER_FULLNESS_COST,
  );
  const [teamBattleAttackerTeammateFullnessCost, setTeamBattleAttackerTeammateFullnessCost] = useState(
    data.settings?.teamBattleAttackerTeammateFullnessCost ?? TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST,
  );
  const [teamBattleDefenderFullnessCost, setTeamBattleDefenderFullnessCost] = useState(
    data.settings?.teamBattleDefenderFullnessCost ?? TEAM_BATTLE_DEFENDER_FULLNESS_COST,
  );
  const [teamBattleDefenderTeammateFullnessCost, setTeamBattleDefenderTeammateFullnessCost] = useState(
    data.settings?.teamBattleDefenderTeammateFullnessCost ?? TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST,
  );
  const [bossAttackMaxTargets, setBossAttackMaxTargets] = useState(
    data.settings?.bossAttackMaxTargets ?? DEFAULT_BOSS_ATTACK_MAX_TARGETS,
  );
  const [bossAttackDamage, setBossAttackDamage] = useState(
    data.settings?.bossAttackDamage ?? DEFAULT_BOSS_ATTACK_DAMAGE,
  );
  const [enableSeasonResetRewards, setEnableSeasonResetRewards] = useState(data.settings?.enableSeasonResetRewards ?? false);

  const defaultRewards = data.settings?.seasonResetRewards ?? { diamond: 500, platinum: 400, gold: 300, silver: 200, bronze: 100 };
  const [rewardDiamond, setRewardDiamond] = useState(defaultRewards.diamond);
  const [rewardPlatinum, setRewardPlatinum] = useState(defaultRewards.platinum);
  const [rewardGold, setRewardGold] = useState(defaultRewards.gold);
  const [rewardSilver, setRewardSilver] = useState(defaultRewards.silver);
  const [rewardBronze, setRewardBronze] = useState(defaultRewards.bronze);

  const [selectedReasons, setSelectedReasons] = useState<Record<string, string>>({});
  
  const [newClassName, setNewClassName] = useState('');
  const [showAddClass, setShowAddClass] = useState(false);
  const [classToDelete, setClassToDelete] = useState<string | null>(null);

  const [bossNameInput, setBossNameInput] = useState('');
  const [bossHpInput, setBossHpInput] = useState(1000);
  const [bossRewardTiers, setBossRewardTiers] = useState<BossRewardTier[]>(() =>
    DEFAULT_BOSS_REWARD_TIERS.map((tier) => ({ ...tier })),
  );

  const currentClass = data.classes.find((c: any) => c.id === data.currentClassId);
  const currentStudents = currentClass?.students || [];
  const disciplineRecords = currentStudents
    .flatMap((student: any) =>
      (student.disciplineRecords ?? []).map((record: any) => ({
        ...record,
        studentName: student.name,
      })),
    )
    .sort((a: any, b: any) => b.createdAt - a.createdAt)
    .slice(0, 12);
  const pointAdjustmentRecords = currentStudents
    .flatMap((student: any) =>
      (student.pointAdjustmentRecords ?? []).map((record: any) => ({
        ...record,
        studentName: student.name,
      })),
    )
    .sort((a: any, b: any) => b.createdAt - a.createdAt)
    .slice(0, 12);

  const getRecordLabel = (type: DisciplineRecordType) => {
    if (type === 'autoPenalty') return tLang.recordAutoPenalty;
    if (type === 'discipline') return tLang.recordDiscipline;
    return tLang.recordWarning;
  };

  const getRecordTone = (type: DisciplineRecordType) => {
    if (type === 'autoPenalty') return 'bg-amber-100 text-amber-700';
    if (type === 'discipline') return 'bg-rose-100 text-rose-700';
    return 'bg-slate-100 text-slate-700';
  };

  const formatRecordTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString(lang === 'zh' ? 'zh-TW' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const penaltySummary = (penalty: { points: number; fullness: number; happiness: number; rankPoints: number }) =>
    tLang.recordPenaltySummary
      .replace('{points}', penalty.points.toString())
      .replace('{fullness}', penalty.fullness.toString())
      .replace('{happiness}', penalty.happiness.toString())
      .replace('{rankPoints}', penalty.rankPoints.toString());

  const pointReasonOptions = POINT_REASON_OPTIONS.map((option) => ({
    ...option,
    label: option.labels[currentLang] ?? option.labels.zh,
  }));
  const guideStudentItems =
    lang === 'en'
      ? [
          'Students use points for feeding, upgrades, revives, and gacha; pets still lose fullness over time even after export/import.',
          'Students can build teams from 2 to 6 members depending on the current system setting.',
          'Battle mode is controlled in System Settings and can run as solo only, team only, or automatic fallback.',
          'Team battles use a weighted support formula, so larger teams help without multiplying total power linearly.',
          'Winning as a full team grants an exclusive bonus of +10 points and +6 mood to each winning member.',
          'Free reroll milestones are consumed in order at level 2, 4, 6, then 8. Dead pets must be revived before they can act again.',
        ]
      : [
          '學生可用積分餵食、升級、復活與扭蛋；資料匯出後再匯入也會依時間持續扣除飽食度。',
          '雙方互相選定隊友後會形成隊伍；若兩邊都有可出戰隊友，對戰會自動切換成隊伍模式。',
          '隊伍對戰採用主將全額、隊友加權的戰力公式，隊友能支援但不會直接把總戰力翻倍。',
          '完整雙人隊伍獲勝時，每位獲勝成員都會獲得隊伍專屬獎勵：+10 積分、+6 心情。',
          '免費重抽會依序在 2、4、6、8 級觸發；寵物死亡後必須先復活，才能再次行動。',
        ];
  const guideTeacherItems =
    lang === 'en'
      ? [
          'Fixed reason menus keep point changes more consistent, and every quick/manual adjustment is written to the point log.',
          'Warnings still stack to 3. Auto penalties apply a 24-hour weakened status; formal discipline applies a 48-hour weakened status.',
          'The record panel lets mentors switch between discipline history and point-adjustment history.',
          'The team leaderboard ranks paired students by combined RP, then by win rate and average level.',
          'Team balance is intentionally softer than solo battles, so team mode adds coordination value instead of pure snowballing.',
        ]
      : [
          '固定原因選單可讓加減分更一致，所有快速加減分與手動調整都會寫入加減分記錄。',
          '警告累積到第 3 次會自動觸發處罰並進入 24 小時虛弱；正式處罰則直接進入 48 小時虛弱。',
          '記錄面板可切換查看處罰記錄與加減分記錄，方便導師回頭追蹤。',
          '隊伍排行榜會以隊伍總 RP 排序，再比較勝率與平均等級，方便觀察組隊成效。',
          '隊伍戰的平衡刻意比單人戰保守，重點是鼓勵合作，而不是讓高等級組合直接滾雪球。',
        ];

  const handleSaveSettings = () => {
    store.updateSettings({
      decayAmount: Number(decayAmount),
      decayType,
      language: currentLang,
      feedCost: Number(feedCost),
      feedGain: Number(feedGain),
      playCost: Number(playCost),
      playGain: Number(playGain),
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
      enableSeasonResetRewards,
      seasonResetRewards: {
        diamond: Number(rewardDiamond),
        platinum: Number(rewardPlatinum),
        gold: Number(rewardGold),
        silver: Number(rewardSilver),
        bronze: Number(rewardBronze),
      }
    });
  };

  const handleAddClass = () => {
    if (!newClassName.trim()) return;
    store.addClass(newClassName.trim());
    setNewClassName('');
    setShowAddClass(false);
  };

  const handleAddStudent = () => {
    if (!newStudentName.trim()) return;
    const newStudent: Student = {
      id: Date.now().toString(),
      name: newStudentName.trim(),
      points: 0,
      pet: {
        type: 'egg',
        fullness: 80,
        happiness: 80,
        level: 1
      },
      stats: { wins: 0, losses: 0 },
      rankPoints: 0,
      warningPoints: 0,
      nextUpgradeGachaLevel: 2,
      penaltyStatus: undefined,
      disciplineRecords: [],
      pointAdjustmentRecords: [],
      dailyProgress: { streak: 0 },
      teamId: undefined,
      badges: []
    };
    store.addStudent(newStudent);
    setNewStudentName('');
  };

  const exportData = () => {
    const snapshot = applyDecay({ ...data }, Date.now());
    const dataStr = JSON.stringify(snapshot, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `tamagotchi_classroom_${new Date().toISOString().slice(0,10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        const hasSupportedShape = Array.isArray(importedData?.classes) || Array.isArray(importedData?.students);

        if (hasSupportedShape) {
          store.importData(importedData);
          store.showToast(tLang.importSuccess, 'success');
        } else {
          store.showToast(tLang.invalidData, 'error');
        }
      } catch (error) {
        store.showToast(tLang.invalidData, 'error');
      }
    };
    reader.onerror = () => {
      store.showToast(tLang.fileReadFailed, 'error');
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-slate-50 min-h-full">
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tLang.dashboard}</h1>
          <p className="mt-2 text-sm text-slate-600">{tLang.dashboardDesc}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button
            onClick={exportData}
            className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            {tLang.exportData}
          </button>
          <input 
            type="file" 
            accept=".json" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={importData} 
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Upload className="h-4 w-4 mr-2" />
            {tLang.importData}
          </button>
        </div>
      </div>

      {/* Class Management */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 w-full sm:max-w-xs">
            <label htmlFor="classSelect" className="block text-sm font-medium text-slate-700 mb-1">{tLang.classManagement}</label>
            <select
              id="classSelect"
              value={data.currentClassId}
              onChange={(e) => store.switchClass(e.target.value)}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              {data.classes.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex space-x-3 mt-4 sm:mt-0 items-end">
            <button
              onClick={() => setShowAddClass(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              <Plus className="h-4 w-4 mr-2" />
              {tLang.addClass}
            </button>
            <button
              onClick={() => {
                if (window.confirm(tLang.resetSeason + '?')) {
                  store.resetSeason();
                }
              }}
              className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-amber-600 bg-white hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {tLang.resetSeason}
            </button>
            <button
              onClick={() => setClassToDelete(data.currentClassId)}
              disabled={data.classes.length <= 1}
              className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {tLang.deleteClass}
            </button>
          </div>
        </div>
      </div>

      {/* Add Student Form */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <Users className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.addStudent}
        </h3>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="studentName" className="block text-sm font-medium text-slate-700 mb-1">{tLang.studentName}</label>
            <input 
              type="text" 
              id="studentName"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              placeholder={tLang.enterName}
            />
          </div>
          <button
            onClick={handleAddStudent}
            disabled={!newStudentName.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            {tLang.add}
          </button>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{tLang.pointManagement}</h3>
            <p className="mt-1 text-xs text-slate-500">{tLang.airdropHint}</p>
          </div>
          <button
            onClick={() => setShowAirdrop(true)}
            disabled={currentStudents.length === 0}
            className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Gift className="mr-2 h-4 w-4" />
            {tLang.airdropAll}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.studentName}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petType}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.level}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.points}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petFullness}</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.actions}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {currentStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    {tLang.noStudents}
                  </td>
                </tr>
              ) : (
                currentStudents.map((student: any) => {
                  const petConfig = PET_TYPES.find(p => p.id === student.pet.type) || PET_TYPES[0];
                  const PetIcon = petConfig.icon;
                  const warningPoints = student.warningPoints ?? 0;
                  const activePenalty = isPenaltyActive(student.penaltyStatus);
                  
                  return (
                    <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-slate-900">{student.name}</div>
                          <button
                            onClick={() => {
                              const newName = window.prompt(lang === 'en' ? 'Enter new name' : '輸入新姓名', student.name);
                              if (newName !== null) {
                                store.editStudentName(student.id, newName);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded-md transition-colors"
                            title={lang === 'en' ? 'Edit name' : '修改姓名'}
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            warningPoints > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            <AlertCircle className="mr-1 h-3 w-3" />
                            {tLang.warningPoints} {warningPoints}/{WARNING_THRESHOLD}
                          </span>
                          {warningPoints > 0 && (
                            <button
                               onClick={() => store.removeWarning(student.id)}
                               className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-300"
                               title={lang === 'en' ? 'Remove Warning' : '消除警告'}
                            >
                               <Minus className="h-3 w-3" />
                            </button>
                          )}
                          {activePenalty && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                              <Zap className="mr-1 h-3 w-3" />
                              {tLang.penaltyStatus}
                            </span>
                          )}
                          {activePenalty && (
                            <button
                               onClick={() => store.removePenalty(student.id)}
                               className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-300"
                               title={lang === 'en' ? 'Remove Penalty' : '解除虛弱'}
                            >
                               <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        {activePenalty && (
                          <div className="mt-1 text-[11px] text-amber-700">
                            {tLang.penaltyUntil.replace('{time}', formatRecordTime(student.penaltyStatus.until))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-slate-600">
                          <PetIcon className="h-4 w-4 mr-2 text-slate-400" />
                          {petNames[lang][petConfig.id as keyof typeof petNames['zh']]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-amber-600">Lv. {student.pet.level || 1}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-indigo-600">{student.points} / {maxPoints}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="flex items-center">
                            <div className="w-full bg-slate-200 rounded-full h-2.5 mr-2 max-w-[100px]">
                              <div 
                                className={`h-2.5 rounded-full ${
                                  student.pet.fullness > 70 ? 'bg-green-500' : 
                                  student.pet.fullness >= 30 ? 'bg-yellow-400' : 'bg-red-500'
                                }`} 
                                style={{ width: `${student.pet.fullness}%` }}
                              ></div>
                            </div>
                            <span className="text-sm text-slate-600">{student.pet.fullness}/100</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{tLang.happiness}: {student.pet.happiness ?? 80}/100</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end items-center space-x-3">
                          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <select
                              value={selectedReasons[student.id] ?? POINT_REASON_OPTIONS[0].id}
                              onChange={(e) =>
                                setSelectedReasons((prev) => ({
                                  ...prev,
                                  [student.id]: e.target.value,
                                }))
                              }
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                              title={tLang.fixedReason ?? '固定原因'}
                            >
                              {pointReasonOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                const selectedReasonId = selectedReasons[student.id] ?? POINT_REASON_OPTIONS[0].id;
                                const selectedReason = pointReasonOptions.find((option) => option.id === selectedReasonId) ?? pointReasonOptions[0];
                                store.addPoints(student.id, selectedReason.amount, 'quick', {
                                  id: selectedReason.id,
                                  label: selectedReason.label,
                                });
                              }}
                              disabled={
                                (() => {
                                  const selectedReasonId = selectedReasons[student.id] ?? POINT_REASON_OPTIONS[0].id;
                                  const selectedReason = pointReasonOptions.find((option) => option.id === selectedReasonId) ?? pointReasonOptions[0];
                                  return selectedReason.amount < 0 && student.points < Math.abs(selectedReason.amount);
                                })()
                              }
                              className="inline-flex items-center rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              title={tLang.applyReason ?? '套用'}
                            >
                              {tLang.applyReason ?? '套用'}
                            </button>
                            <button
                              onClick={() => setCustomPoints({id: student.id, name: student.name})}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 transition-colors"
                              title={tLang.manualAdjust}
                            >
                              <Edit2 className="h-3 w-3" /> {tLang.manual}
                            </button>
                          </div>

                          {/* Decrease Level */}
                          <button
                            onClick={() => store.decreaseLevel(student.id)}
                            disabled={(student.pet.level || 1) <= 1}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={tLang.decreaseLevel}
                          >
                            <ChevronsDown className="h-4 w-4" />
                          </button>

                          <div className="flex space-x-1 bg-amber-50 p-1 rounded-md border border-amber-100">
                            <button
                              onClick={() => store.warnStudent(student.id)}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
                              title={tLang.issueWarning}
                            >
                              <AlertCircle className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => store.disciplineStudent(student.id)}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                              title={tLang.discipline}
                            >
                              <Shield className="h-3 w-3" />
                            </button>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => setStudentToDelete(student.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title={tLang.deleteStudent}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-medium text-slate-900 flex items-center">
            <Shield className="h-5 w-5 mr-2 text-rose-500" />
            {recordView === 'discipline' ? tLang.disciplineRecords : tLang.pointAdjustmentRecords}
          </h3>
          <div className="inline-flex rounded-full bg-white p-1 border border-slate-200">
            <button
              onClick={() => setRecordView('discipline')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                recordView === 'discipline' ? 'bg-rose-100 text-rose-700' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tLang.recordMenuDiscipline}
            </button>
            <button
              onClick={() => setRecordView('points')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                recordView === 'points' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tLang.recordMenuPoints}
            </button>
          </div>
        </div>
        {recordView === 'discipline' ? (
          disciplineRecords.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500 text-center">{tLang.noDisciplineRecords}</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {disciplineRecords.map((record: any) => (
                <div key={record.id} className="px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${getRecordTone(record.type)}`}>
                        {getRecordLabel(record.type)}
                      </span>
                      <span className="font-medium text-slate-900">{record.studentName}</span>
                      {record.type === 'warning' && (
                        <span className="text-sm text-slate-500">
                          {tLang.warningPoints} {record.warningCount}/{WARNING_THRESHOLD}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {record.type === 'warning'
                        ? tLang.warningIssued.replace('{name}', record.studentName).replace('{count}', String(record.warningCount ?? 1))
                        : record.type === 'autoPenalty'
                          ? penaltySummary(WARNING_AUTO_PENALTY)
                          : penaltySummary(DIRECT_DISCIPLINE_PENALTY)}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-slate-400">{formatRecordTime(record.createdAt)}</div>
                </div>
              ))}
            </div>
          )
        ) : (
          pointAdjustmentRecords.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500 text-center">{tLang.noPointAdjustmentRecords}</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {pointAdjustmentRecords.map((record: any) => (
                <div key={record.id} className="px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        record.amount >= 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {record.source === 'airdrop'
                          ? tLang.recordAirdrop
                          : record.source === 'manual'
                            ? tLang.recordManualAdjust
                            : tLang.recordQuickAdjust}
                      </span>
                      <span className="font-medium text-slate-900">{record.studentName}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {record.reasonLabel
                        ? `${record.reasonLabel} (${record.amount >= 0 ? '+' : '-'}${Math.abs(record.amount)})`
                        : tLang.recordPointSummary
                            .replace('{label}', record.amount >= 0 ? '+' : '-')
                            .replace('{amount}', Math.abs(record.amount).toString())}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-slate-400">{formatRecordTime(record.createdAt)}</div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <div className="mt-6 bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <BookOpen className="h-5 w-5 mr-2 text-emerald-500" />
          {tLang.guideTitle}
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="mb-3 flex items-center text-sm font-bold text-emerald-800">
              <Star className="mr-2 h-4 w-4" />
              {tLang.guideStudentTitle}
            </div>
            <ul className="space-y-2 text-sm text-emerald-900">
              {guideStudentItems.map((item) => (
                <li key={item} className="flex items-start">
                  <span className="mt-1 mr-2 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div className="mb-3 flex items-center text-sm font-bold text-indigo-800">
              <Shield className="mr-2 h-4 w-4" />
              {tLang.guideTeacherTitle}
            </div>
            <ul className="space-y-2 text-sm text-indigo-900">
              {guideTeacherItems.map((item) => (
                <li key={item} className="flex items-start">
                  <span className="mt-1 mr-2 h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Boss Management */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5">
        <h3 className="text-lg font-medium text-amber-900 mb-4 flex items-center">
          <Skull className="h-5 w-5 mr-2 text-rose-500" />
          {tLang.bossManagement ?? '魔王副本管理'}
        </h3>
        {currentClass?.activeBoss?.isActive ? (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex-1 w-full">
              <h4 className="text-lg font-bold text-rose-800 flex items-center mb-2">
                {currentClass.activeBoss.name}
              </h4>
              <div className="w-full bg-slate-200 rounded-full h-4 relative overflow-hidden">
                <div 
                  className="bg-rose-500 h-4 rounded-full transition-all duration-300" 
                  style={{ width: `${Math.max(0, (currentClass.activeBoss.currentHp / currentClass.activeBoss.maxHp) * 100)}%` }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white shadow-black drop-shadow-md">
                  {currentClass.activeBoss.currentHp} / {currentClass.activeBoss.maxHp}
                </div>
              </div>
            </div>
            <button
              onClick={() => store.removeBoss()}
              className="bg-white text-rose-600 border border-rose-200 px-4 py-2 rounded-md font-medium hover:bg-rose-100 transition-colors shrink-0"
            >
              {tLang.removeBoss ?? '撤退魔王'}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{tLang.bossName}</label>
                <input
                  type="text"
                  value={bossNameInput}
                  onChange={(e) => setBossNameInput(e.target.value)}
                  placeholder={tLang.enterBossName}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{tLang.bossHp}</label>
                <input
                  type="number"
                  min="1"
                  value={bossHpInput}
                  onChange={(e) => setBossHpInput(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">{tLang.bossRankRewards}</h4>
                  <p className="mt-1 text-xs text-slate-500">{tLang.bossRankRewardsHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const usedRanks = new Set(bossRewardTiers.map((tier) => tier.rank));
                    const nextRank = Array.from({ length: Math.max(10, currentStudents.length) }, (_, index) => index + 1)
                      .find((rank) => !usedRanks.has(rank));
                    if (nextRank) {
                      setBossRewardTiers((tiers) => [...tiers, { rank: nextRank, points: 0, happiness: 0 }]);
                    }
                  }}
                  className="inline-flex shrink-0 items-center rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {tLang.addRewardTier}
                </button>
              </div>
              <div className="space-y-2">
                {bossRewardTiers
                  .slice()
                  .sort((left, right) => left.rank - right.rank)
                  .map((tier) => (
                    <div key={tier.rank} className="grid grid-cols-[minmax(88px,0.8fr)_1fr_1fr_36px] items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <label className="text-xs font-medium text-slate-600">
                        {tLang.rewardRank}
                        <select
                          value={tier.rank}
                          onChange={(e) => {
                            const rank = Number(e.target.value);
                            setBossRewardTiers((tiers) => tiers.map((item) => item.rank === tier.rank ? { ...item, rank } : item));
                          }}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                        >
                          {Array.from({ length: Math.max(10, currentStudents.length) }, (_, index) => index + 1).map((rank) => (
                            <option key={rank} value={rank} disabled={rank !== tier.rank && bossRewardTiers.some((item) => item.rank === rank)}>
                              {tLang.rewardRankOption.replace('{rank}', rank.toString())}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        {tLang.rewardPoints}
                        <input
                          type="number"
                          min="0"
                          value={tier.points}
                          onChange={(e) => setBossRewardTiers((tiers) => tiers.map((item) => item.rank === tier.rank ? { ...item, points: Number(e.target.value) } : item))}
                          className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white p-2 text-sm"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        {tLang.rewardHappiness}
                        <input
                          type="number"
                          min="0"
                          value={tier.happiness}
                          onChange={(e) => setBossRewardTiers((tiers) => tiers.map((item) => item.rank === tier.rank ? { ...item, happiness: Number(e.target.value) } : item))}
                          className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white p-2 text-sm"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setBossRewardTiers((tiers) => tiers.filter((item) => item.rank !== tier.rank))}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                        title={tLang.removeRewardTier}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>

            <button
              onClick={() => {
                store.summonBoss(bossNameInput, bossHpInput, bossRewardTiers);
                setBossNameInput('');
              }}
              disabled={!bossNameInput.trim() || bossRewardTiers.length === 0}
              className="w-full rounded-md bg-rose-600 px-4 py-2 font-medium text-white transition-colors hover:bg-rose-700 disabled:bg-slate-300 sm:w-auto"
            >
              {tLang.summonBoss}
            </button>
          </div>
        )}
      </div>

      {/* System Settings */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-6 flex items-center">
          <Settings className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.systemSettings}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {/* 基本規則 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'General Rules' : '基本規則'}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="language" className="text-sm font-medium text-slate-700">{tLang.language}</label>
              <select
                id="language"
                value={currentLang}
                onChange={(e) => setCurrentLang(e.target.value as Language)}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="maxPoints" className="text-sm font-medium text-slate-700">{tLang.maxPoints ?? '總積分上限'}</label>
              <input
                type="number"
                id="maxPoints"
                min="0"
                value={maxPoints}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="decayType" className="text-sm font-medium text-slate-700">{tLang.decayFrequency}</label>
              <select
                id="decayType"
                value={decayType}
                onChange={(e) => setDecayType(e.target.value as 'hourly' | 'daily')}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              >
                <option value="hourly">{tLang.hourly}</option>
                <option value="daily">{tLang.daily}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="decayAmount" className="text-sm font-medium text-slate-700">{tLang.decayAmount}</label>
              <input 
                type="number" 
                id="decayAmount"
                min="0"
                value={decayAmount}
                onChange={(e) => setDecayAmount(Number(e.target.value))}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              />
            </div>
          </div>

          {/* 互動設定 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'Economy & Interactions' : '經濟與互動數值'}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="feedCost" className="text-sm font-medium text-slate-700">{tLang.feedCost}</label>
              <input type="number" id="feedCost" min="1" value={feedCost} onChange={(e) => setFeedCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="feedGain" className="text-sm font-medium text-slate-700">{tLang.feedGain ?? '餵食回復飽食度'}</label>
              <input type="number" id="feedGain" min="1" value={feedGain} onChange={(e) => setFeedGain(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="playCost" className="text-sm font-medium text-slate-700">{tLang.playCost ?? '玩耍所需積分'}</label>
              <input type="number" id="playCost" min="1" value={playCost} onChange={(e) => setPlayCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="playGain" className="text-sm font-medium text-slate-700">{tLang.playGain ?? '玩耍回復心情'}</label>
              <input type="number" id="playGain" min="1" value={playGain} onChange={(e) => setPlayGain(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="reviveCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Revive Cost' : '復活需要積分'}</label>
              <input type="number" id="reviveCost" min="0" value={reviveCost} onChange={(e) => setReviveCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
          </div>

          {/* 魔王設定 */}
          <div className="space-y-4 bg-rose-50 p-4 rounded-xl border border-rose-200">
            <h4 className="text-sm font-bold text-rose-800 pb-2 border-b border-rose-200 flex items-center">
              <Crosshair className="mr-2 h-4 w-4" />
              {tLang.bossAttackSettings}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="bossAttackMaxTargets" className="text-sm font-medium text-slate-700">{tLang.bossAttackMaxTargets}</label>
              <select
                id="bossAttackMaxTargets"
                value={bossAttackMaxTargets}
                onChange={(e) => setBossAttackMaxTargets(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
              >
                {[0, 1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>{tLang.bossTargetCountOption.replace('{count}', count.toString())}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{tLang.bossAttackMaxTargetsHint}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="bossAttackDamage" className="text-sm font-medium text-slate-700">{tLang.bossAttackDamage}</label>
              <input
                type="number"
                id="bossAttackDamage"
                min="0"
                value={bossAttackDamage}
                onChange={(e) => setBossAttackDamage(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500"
              />
              <p className="text-xs text-slate-500">{tLang.bossAttackDamageHint}</p>
            </div>
          </div>

          {/* 對戰設定 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'Battle Settings' : '對戰與組隊設定'}
            </h4>
            <div className="flex flex-col gap-1">
              <label htmlFor="battleMode" className="text-sm font-medium text-slate-700">
                {lang === 'en' ? 'Battle Mode' : '支援對戰模式'}
              </label>
              <select
                id="battleMode"
                value={battleMode}
                onChange={(e) => setBattleMode(e.target.value as BattleMode)}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              >
                <option value="both">{lang === 'en' ? 'Solo + Team' : '個人賽 + 隊伍賽'}</option>
                <option value="solo">{lang === 'en' ? 'Solo Only' : '僅個人賽'}</option>
                <option value="team">{lang === 'en' ? 'Team Only' : '僅隊伍賽'}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="maxTeamSize" className="text-sm font-medium text-slate-700">
                {lang === 'en' ? 'Max Team Size' : '隊伍上限人數'}
              </label>
              <input
                type="number"
                id="maxTeamSize"
                min="2"
                max="6"
                value={maxTeamSize}
                onChange={(e) => setMaxTeamSize(Number(e.target.value))}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="battleRankPointsWin" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Win RP' : '對戰獲勝加分 (RP)'}</label>
              <input type="number" id="battleRankPointsWin" min="0" value={battleRankPointsWin} onChange={(e) => setBattleRankPointsWin(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="battleRankPointsLoss" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Loss RP' : '落敗扣分 (RP)'}</label>
              <input type="number" id="battleRankPointsLoss" min="0" value={battleRankPointsLoss} onChange={(e) => setBattleRankPointsLoss(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
            </div>
            <div className="pt-2 border-t border-slate-200 mt-2 space-y-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="battleSettingsCategory" className="text-sm font-medium text-slate-700">
                  {lang === 'en' ? 'Rules to Adjust' : '調整賽制'}
                </label>
                <select
                  id="battleSettingsCategory"
                  value={battleSettingsCategory}
                  onChange={(e) => setBattleSettingsCategory(e.target.value as 'solo' | 'team')}
                  className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                >
                  <option value="solo">{lang === 'en' ? 'Solo Battle Rules' : '個人賽飽食度機制'}</option>
                  <option value="team">{lang === 'en' ? 'Team Battle Rules' : '隊伍賽飽食度機制'}</option>
                </select>
              </div>

              {battleSettingsCategory === 'solo' ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    {lang === 'en'
                      ? 'Solo battle costs are based on whether the student starts or receives the challenge.'
                      : '個人賽依學生是發起挑戰或接受挑戰，分別套用飽食度消耗。'}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleAttackerFullnessCost" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Attacker Fullness Cost' : '進攻方消耗飽食度'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleAttackerFullnessCost"
                        min="0"
                        value={soloBattleAttackerFullnessCost}
                        onChange={(e) => setSoloBattleAttackerFullnessCost(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleDefenderFullnessCost" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Defender Fullness Cost' : '防守方消耗飽食度'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleDefenderFullnessCost"
                        min="0"
                        value={soloBattleDefenderFullnessCost}
                        onChange={(e) => setSoloBattleDefenderFullnessCost(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleWinPoints" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Solo Win Points' : '個人賽勝利積分'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleWinPoints"
                        min="0"
                        value={soloBattleWinPoints}
                        onChange={(e) => setSoloBattleWinPoints(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="soloBattleLossPoints" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Solo Loss Penalty' : '個人賽失敗扣分'}
                      </label>
                      <input
                        type="number"
                        id="soloBattleLossPoints"
                        min="0"
                        value={soloBattleLossPoints}
                        onChange={(e) => setSoloBattleLossPoints(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    {lang === 'en'
                      ? 'Team battle costs are based on each participant role, independent of the match result.'
                      : '隊伍賽依每位成員在本場的角色扣除飽食度，不受勝敗結果影響。'}
                  </p>
                  <div className="space-y-3">
                    <h5 className="text-xs font-bold text-slate-600">{lang === 'en' ? 'Attacking Team' : '攻擊方'}</h5>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleAttackerFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Initiator Fullness Cost' : '發動攻擊者消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleAttackerFullnessCost" min="0" value={teamBattleAttackerFullnessCost} onChange={(e) => setTeamBattleAttackerFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleAttackerTeammateFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Attacking Teammate Cost' : '攻擊方隊友消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleAttackerTeammateFullnessCost" min="0" value={teamBattleAttackerTeammateFullnessCost} onChange={(e) => setTeamBattleAttackerTeammateFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-slate-200 pt-3">
                    <h5 className="text-xs font-bold text-slate-600">{lang === 'en' ? 'Defending Team' : '防守方'}</h5>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleDefenderFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Target Fullness Cost' : '被攻擊者消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleDefenderFullnessCost" min="0" value={teamBattleDefenderFullnessCost} onChange={(e) => setTeamBattleDefenderFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="teamBattleDefenderTeammateFullnessCost" className="text-sm font-medium text-slate-700">
                          {lang === 'en' ? 'Defending Teammate Cost' : '防守方隊友消耗飽食度'}
                        </label>
                        <input type="number" id="teamBattleDefenderTeammateFullnessCost" min="0" value={teamBattleDefenderTeammateFullnessCost} onChange={(e) => setTeamBattleDefenderTeammateFullnessCost(Number(e.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-slate-200 pt-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={teamBattleMinFullnessEnabled}
                        onChange={(e) => setTeamBattleMinFullnessEnabled(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Enable team minimum fullness gate' : '隊伍賽啟用最低飽食度限制'}
                      </span>
                    </label>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="teamBattleMinFullness" className="text-sm font-medium text-slate-700">
                        {lang === 'en' ? 'Team Minimum Fullness' : '隊伍賽最低飽食度'}
                      </label>
                      <input
                        type="number"
                        id="teamBattleMinFullness"
                        min="0"
                        value={teamBattleMinFullness}
                        disabled={!teamBattleMinFullnessEnabled}
                        onChange={(e) => setTeamBattleMinFullness(Number(e.target.value))}
                        className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 sm:text-sm border p-2"
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {teamBattleMinFullnessEnabled
                        ? (lang === 'en'
                            ? 'Only members meeting this fullness value can enter team battles.'
                            : '只有達到此飽食度的成員才能參與隊伍賽。')
                        : (lang === 'en'
                            ? 'When disabled, team battles ignore the minimum fullness requirement.'
                            : '關閉後，隊伍賽將忽略最低飽食度限制。')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 段位與賽季設定 */}
          <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
              {lang === 'en' ? 'Rank & Season Settings' : '段位與賽季設定'}
            </h4>
            
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Rank Thresholds' : '排位門檻 (RP)'}</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.diamond}</span><input type="number" value={bracketDiamond} onChange={(e) => setBracketDiamond(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.platinum}</span><input type="number" value={bracketPlatinum} onChange={(e) => setBracketPlatinum(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.gold}</span><input type="number" value={bracketGold} onChange={(e) => setBracketGold(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
                <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.silver}</span><input type="number" value={bracketSilver} onChange={(e) => setBracketSilver(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 mt-2">
              <label className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={enableSeasonResetRewards} onChange={(e) => setEnableSeasonResetRewards(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                <span className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Enable Season Reset Rewards' : '啟用賽季結算獎勵'}</span>
              </label>
              
              {enableSeasonResetRewards && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.diamond}</span><input type="number" value={rewardDiamond} onChange={(e) => setRewardDiamond(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.platinum}</span><input type="number" value={rewardPlatinum} onChange={(e) => setRewardPlatinum(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.gold}</span><input type="number" value={rewardGold} onChange={(e) => setRewardGold(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.silver}</span><input type="number" value={rewardSilver} onChange={(e) => setRewardSilver(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                  <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{tLang.bronze}</span><input type="number" value={rewardBronze} onChange={(e) => setRewardBronze(Number(e.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-5">
          <button
            onClick={handleSaveSettings}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Save className="h-4 w-4 mr-2" />
            {tLang.saveSettings}
          </button>
        </div>
      </div>

      {/* Add Class Modal */}
      {showAddClass && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">{tLang.addClass}</h3>
              <div className="mb-4">
                <label htmlFor="className" className="block text-sm font-medium text-slate-700 mb-1">{tLang.className}</label>
                <input
                  type="text"
                  id="className"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddClass()}
                  className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                  placeholder={tLang.enterClassName}
                  autoFocus
                />
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setShowAddClass(false); setNewClassName(''); }} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={handleAddClass} 
                disabled={!newClassName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
              >
                {tLang.add}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Class Modal */}
      {classToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4 mx-auto">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{tLang.deleteClass}</h3>
              <p className="text-slate-600 text-sm text-center mb-4">
                {tLang.deleteClassWarning.replace('{name}', data.classes.find((c: any) => c.id === classToDelete)?.name || '')}
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => setClassToDelete(null)} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={() => {
                  store.deleteClass(classToDelete);
                  setClassToDelete(null);
                }} 
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700"
              >
                {tLang.delete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Class Airdrop Modal */}
      {showAirdrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Gift className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">{tLang.airdropTitle}</h3>
              <p className="mt-2 text-sm text-slate-600">
                {tLang.airdropDesc.replace('{count}', currentStudents.length.toString())}
              </p>
              <label className="mt-5 block text-sm font-medium text-slate-700">
                {tLang.airdropAmount}
                <input
                  type="number"
                  value={airdropAmount}
                  onChange={(e) => setAirdropAmount(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder={tLang.airdropAmountPlaceholder}
                  autoFocus
                />
              </label>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                {tLang.airdropReason}
                <input
                  type="text"
                  value={airdropReason}
                  onChange={(e) => setAirdropReason(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder={tLang.airdropReasonPlaceholder}
                />
              </label>
            </div>
            <div className="flex justify-end gap-3 bg-slate-50 px-6 py-4">
              <button
                onClick={() => { setShowAirdrop(false); setAirdropAmount(''); setAirdropReason(''); }}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {tLang.cancel}
              </button>
              <button
                onClick={() => {
                  store.airdropPoints(Number(airdropAmount), airdropReason);
                  setShowAirdrop(false);
                  setAirdropAmount('');
                  setAirdropReason('');
                }}
                disabled={!Number.isFinite(Number(airdropAmount)) || Number(airdropAmount) === 0}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {tLang.confirmAirdrop}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Points Modal */}
      {customPoints && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">{tLang.manualAdjustTitle}</h3>
              <p className="text-slate-600 text-sm mb-4">
                {tLang.manualAdjustDesc.replace('{name}', customPoints.name)}
              </p>
              <input
                type="number"
                min="1"
                value={pointsAmount}
                onChange={(e) => setPointsAmount(e.target.value)}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                placeholder={tLang.manualAdjustPlaceholder}
                autoFocus
              />
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setCustomPoints(null); setPointsAmount(''); }} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={() => {
                  const amount = parseInt(pointsAmount, 10);
                  if (!isNaN(amount) && amount > 0) {
                    store.addPoints(customPoints.id, -amount, 'manual');
                    setCustomPoints(null);
                    setPointsAmount('');
                  }
                }} 
                disabled={!pointsAmount || isNaN(parseInt(pointsAmount, 10)) || parseInt(pointsAmount, 10) <= 0}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 border border-transparent rounded-md hover:bg-rose-700 disabled:bg-rose-300"
              >
                {tLang.deduct}
              </button>
              <button 
                onClick={() => {
                  const amount = parseInt(pointsAmount, 10);
                  if (!isNaN(amount) && amount > 0) {
                    store.addPoints(customPoints.id, amount, 'manual');
                    setCustomPoints(null);
                    setPointsAmount('');
                  }
                }} 
                disabled={!pointsAmount || isNaN(parseInt(pointsAmount, 10)) || parseInt(pointsAmount, 10) <= 0}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
              >
                {tLang.increase}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {studentToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4 mx-auto">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-center text-slate-900 mb-2">{tLang.confirmDelete}</h3>
              <p className="text-center text-slate-500 text-sm">
                {tLang.deleteWarning.replace('{name}', currentClass?.students.find((s: any) => s.id === studentToDelete)?.name || '')}
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => setStudentToDelete(null)} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={() => {
                  store.deleteStudent(studentToDelete);
                  setStudentToDelete(null);
                }} 
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700"
              >
                {tLang.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
