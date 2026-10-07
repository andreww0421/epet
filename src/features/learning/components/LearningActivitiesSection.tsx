import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Edit2, Plus, Save, Shield, Star, Target, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  getClassGoalCoverage,
  getClassGoalProgress,
} from '../../../educationInsights';
import {
  getActiveClassGoals,
  getWeekEndDate,
  getWeekStartDate,
} from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import type { ClassGoal, LearningCompetency, PetCareMode } from '../../../store/types';
import { useStore } from '../../../store/useStore';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';
import { getCompetencyLabels } from '../model/getCompetencyLabels';

type LearningActivitiesSectionProps = {
  canWrite: boolean;
  petCareMode: PetCareMode;
  visible: boolean;
  guideVisible?: boolean;
};

const resetGoalDraft = {
  competency: 'collaboration' as LearningCompetency,
  target: 20,
  title: '',
};

/** Owns weekly learning-goal editing and the non-mutating usage guide. */
export const LearningActivitiesSection = ({
  canWrite,
  petCareMode,
  visible,
  guideVisible = visible,
}: LearningActivitiesSectionProps) => {
  const { data, setClassGoal } = useStore(useShallow((state) => ({
    data: state.data,
    setClassGoal: state.setClassGoal,
  })));
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  const currentClass = data.classes.find((classData) => classData.id === data.currentClassId);
  const currentStudents = useMemo(() => currentClass?.students ?? [], [currentClass]);
  const competencyLabels = useMemo(() => getCompetencyLabels(lang), [lang]);
  const [classGoalTitle, setClassGoalTitle] = useState(resetGoalDraft.title);
  const [classGoalCompetency, setClassGoalCompetency] = useState<LearningCompetency>(
    resetGoalDraft.competency,
  );
  const [classGoalTarget, setClassGoalTarget] = useState(resetGoalDraft.target);
  const [editingClassGoalId, setEditingClassGoalId] = useState<string | null>(null);
  const runMutation = useWorkspaceMutationGuard(canWrite);
  const classGoalNow = useMemo(() => Date.now(), [currentClass?.id]);
  const classGoalWeekStart = getWeekStartDate(classGoalNow, data.settings?.schoolTimeZone);
  const classGoalWeekEnd = getWeekEndDate(classGoalNow, data.settings?.schoolTimeZone);
  const activeClassGoals = useMemo(
    () => getActiveClassGoals(
      currentClass?.classGoals,
      classGoalNow,
      data.settings?.schoolTimeZone,
    ),
    [classGoalNow, currentClass?.classGoals, data.settings?.schoolTimeZone],
  );
  const formatGoalWeekDate = (dateKey: string) =>
    new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString(
      lang === 'en' ? 'en-US' : 'zh-TW',
      { month: 'numeric', day: 'numeric', timeZone: 'UTC' },
    );
  const classGoalWeekLabel = tLang.classGoalWeekRange
    .replace('{start}', formatGoalWeekDate(classGoalWeekStart))
    .replace('{end}', formatGoalWeekDate(classGoalWeekEnd));
  const archivedClassGoalCount = Math.max(
    0,
    (currentClass?.classGoals?.length ?? 0) - activeClassGoals.length,
  );
  const classGoalMetrics = useMemo(
    () => activeClassGoals.map((goal: ClassGoal) => ({
      goal,
      progress: getClassGoalProgress(
        currentStudents,
        goal,
        currentClass?.learningEvidenceRecords ?? [],
      ),
      coverage: getClassGoalCoverage(
        currentStudents,
        goal,
        currentClass?.learningEvidenceRecords ?? [],
      ),
    })),
    [activeClassGoals, currentClass?.learningEvidenceRecords, currentStudents],
  );

  const clearGoalDraft = () => {
    setEditingClassGoalId(null);
    setClassGoalTitle(resetGoalDraft.title);
    setClassGoalCompetency(resetGoalDraft.competency);
    setClassGoalTarget(resetGoalDraft.target);
  };

  useEffect(() => {
    clearGoalDraft();
  }, [currentClass?.id]);

  const handleSaveClassGoal = () => {
    if (!classGoalTitle.trim()) return;
    runMutation(() => setClassGoal({
      title: classGoalTitle.trim(),
      competency: classGoalCompetency,
      targetCount: Math.max(1, Number(classGoalTarget)),
    }, editingClassGoalId ?? undefined));
    clearGoalDraft();
  };

  const handleEditClassGoal = (goal: ClassGoal) => {
    setEditingClassGoalId(goal.id);
    setClassGoalTitle(goal.title);
    setClassGoalCompetency(goal.competency);
    setClassGoalTarget(goal.targetCount);
  };

  const handleClearClassGoal = (goalId: string) => {
    runMutation(() => setClassGoal(null, goalId));
    if (editingClassGoalId === goalId) clearGoalDraft();
  };

  const guideStudentItems = lang === 'en'
    ? [
        'Students use points for feeding, upgrades, revives, and gacha; importing a backup preserves saved pet status and restarts its decay clock.',
        'Students can build teams from 2 to 6 members depending on the current system setting.',
        'Battle mode is controlled in System Settings and can run as solo only, team only, or automatic fallback.',
        'Team battles use a weighted support formula, so larger teams help without multiplying total power linearly.',
        'Winning as a full team grants an exclusive bonus of +10 points and +6 mood to each winning member.',
        petCareMode === 'death'
          ? 'Free reroll milestones are consumed at levels 2, 4, 6, then 8. Dead pets must be revived before acting again.'
          : 'Free reroll milestones are consumed at levels 2, 4, 6, then 8. At zero fullness, pets rest until they are fed.',
      ]
    : [
        '學生可用積分餵食、升級、復活與扭蛋；匯入備份會完整保留寵物狀態，並從匯入時間重新計算衰減。',
        '雙方互相選定隊友後會形成隊伍；若兩邊都有可出戰隊友，對戰會自動切換成隊伍模式。',
        '隊伍對戰採用主將全額、隊友加權的戰力公式，隊友能支援但不會直接把總戰力翻倍。',
        '完整雙人隊伍獲勝時，每位獲勝成員都會獲得隊伍專屬獎勵：+10 積分、+6 心情。',
        petCareMode === 'death'
          ? '免費重抽會依序在 2、4、6、8 級觸發；寵物死亡後必須先復活，才能再次行動。'
          : '免費重抽會依序在 2、4、6、8 級觸發；飽食度歸零時寵物會休息，餵食後即可恢復。',
      ];
  const guideTeacherItems = lang === 'en'
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

  return (
    <>
      <section className={`${visible ? '' : 'hidden'} border border-emerald-200 bg-white p-5 shadow-sm`}>
        <div className="mb-5 flex flex-col gap-2 border-b border-emerald-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center text-lg font-semibold text-slate-900">
              <Target className="mr-2 h-5 w-5 text-emerald-600" />
              {tLang.classGoal}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{tLang.classGoalHint}</p>
          </div>
          <div className="text-sm font-bold text-emerald-700">
            <p>{classGoalWeekLabel}</p>
            <p className="mt-1 text-xs font-medium text-emerald-600">
              {tLang.classGoalCount.replace('{current}', classGoalMetrics.length.toString())}
            </p>
          </div>
        </div>

        {classGoalMetrics.length === 0 && (
          <div className="mb-5 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
            <p className="font-bold">{tLang.classGoalNoGoal}</p>
            <p className="mt-1 text-xs text-amber-800">{classGoalWeekLabel}</p>
          </div>
        )}

        {archivedClassGoalCount > 0 && (
          <p className="mb-4 text-xs text-slate-500">
            {tLang.classGoalArchivedCount.replace('{count}', archivedClassGoalCount.toString())}
          </p>
        )}

        {classGoalMetrics.length > 0 && (
          <div className="mb-5 divide-y divide-emerald-100 border-y border-emerald-100">
            {classGoalMetrics.map(({ goal, progress, coverage }) => {
              const completed = progress >= goal.targetCount;
              const progressPercent = Math.min(100, Math.round((progress / goal.targetCount) * 100));
              return (
                <div key={goal.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.6fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{goal.title}</p>
                    <p className="mt-1 text-xs font-medium text-emerald-700">{competencyLabels[goal.competency]}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-600">
                      <span>
                        {completed
                          ? tLang.classGoalCompleted
                          : tLang.classGoalProgress
                              .replace('{current}', progress.toString())
                              .replace('{target}', goal.targetCount.toString())}
                      </span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-emerald-100">
                      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {tLang.classGoalCoverage
                        .replace('{current}', coverage.studentsReached.toString())
                        .replace('{total}', coverage.totalStudents.toString())}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 md:justify-end">
                    <button type="button" onClick={() => handleEditClassGoal(goal)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-emerald-50 hover:text-emerald-700" title={tLang.editClassGoal}>
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleClearClassGoal(goal.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700" title={tLang.clearClassGoal}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.8fr)_minmax(150px,0.5fr)]">
          <label className="text-sm font-medium text-slate-700">
            {tLang.classGoalTitle}
            <input type="text" value={classGoalTitle} onChange={(event) => setClassGoalTitle(event.target.value)} placeholder={tLang.classGoalTitlePlaceholder} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {tLang.classGoalCompetency}
            <select value={classGoalCompetency} onChange={(event) => setClassGoalCompetency(event.target.value as LearningCompetency)} className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500">
              {(Object.keys(competencyLabels) as LearningCompetency[]).map((competency) => (
                <option key={competency} value={competency}>{competencyLabels[competency]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            {tLang.classGoalTarget}
            <input type="number" min="1" value={classGoalTarget} onChange={(event) => setClassGoalTarget(Number(event.target.value))} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500" />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">{tLang.classGoalTargetHint}</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSaveClassGoal}
            disabled={!classGoalTitle.trim() || classGoalTarget < 1 || (!editingClassGoalId && classGoalMetrics.length >= 3)}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {editingClassGoalId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
            {editingClassGoalId ? tLang.updateClassGoal : tLang.addClassGoal}
          </button>
          {editingClassGoalId && (
            <button type="button" onClick={clearGoalDraft} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <X className="mr-2 h-4 w-4" />
              {tLang.cancel}
            </button>
          )}
        </div>
      </section>

      <div className={`${guideVisible ? '' : 'hidden'} mt-6 bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 p-5`}>
        <h2 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <BookOpen className="h-5 w-5 mr-2 text-emerald-500" />
          {tLang.guideTitle}
        </h2>
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
    </>
  );
};
