import React, { useMemo } from 'react';
import { Users } from 'lucide-react';
import type { Language, Student } from '../../../store/types';
import {
  TEAM_BATTLE_TEAM_BONUS_HAPPINESS,
  TEAM_BATTLE_TEAM_BONUS_POINTS,
} from '../../../gameRules';
import {
  buildClassroomTeamSummaries,
  type ClassroomBattleSettings,
} from '../model/classroomModels';
import type { ClassroomTranslations } from '../types';

type ClassroomTeamLeaderboardProps = {
  students: Student[];
  settings: Pick<ClassroomBattleSettings, 'maxTeamSize' | 'teamReadyOptions'>;
  language: Language;
  translations: ClassroomTranslations;
  displayStudentName: (name: string) => string;
};

export const ClassroomTeamLeaderboard: React.FC<ClassroomTeamLeaderboardProps> = ({
  students,
  settings,
  language,
  translations: tLang,
  displayStudentName,
}) => {
  const readinessNow = useMemo(() => Date.now(), [students]);
  const teams = useMemo(
    () => buildClassroomTeamSummaries(
      students,
      readinessNow,
      settings,
      displayStudentName,
    ),
    [displayStudentName, readinessNow, settings, students],
  );

  return (
    <section className="space-y-5 max-w-5xl mx-auto">
      <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-sky-900 flex items-center">
              <Users className="h-5 w-5 mr-2 text-sky-600" />
              {language === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}
            </h2>
            <p className="mt-1 text-sm text-sky-800">
              {language === 'en'
                ? `Team wins grant an exclusive +${TEAM_BATTLE_TEAM_BONUS_POINTS} pts / +${TEAM_BATTLE_TEAM_BONUS_HAPPINESS} mood bonus to each winning teammate.`
                : `完整雙人隊伍獲勝時，每位獲勝成員都會獲得 +${TEAM_BATTLE_TEAM_BONUS_POINTS} 積分 / +${TEAM_BATTLE_TEAM_BONUS_HAPPINESS} 心情的隊伍獎勵。`}
            </p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-sky-900 shadow-sm">
            {language === 'en' ? 'Active Teams' : '目前隊伍'}: {teams.length}
          </div>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sky-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
          {language === 'en'
            ? 'No teams yet. Use the teammate button on a pet card to create one.'
            : '目前還沒有隊伍，請先在寵物卡片中選擇隊友。'}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-sky-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">#</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    {language === 'en' ? 'Team' : '隊伍'}
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    {language === 'en' ? 'Total RP' : '總 RP'}
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">{tLang.winRate}</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    {language === 'en' ? 'Avg Lv.' : '平均等級'}
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    {language === 'en' ? 'Ready Members' : '可出戰人數'}
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    {language === 'en' ? 'Avg Mood' : '平均心情'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {teams.map((team, index) => (
                  <tr key={team.id} className={index < 3 ? 'bg-sky-50/40' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">{index + 1}</td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-slate-900">{team.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{team.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-700">{team.totalRankPoints}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      {team.winRate}% ({team.wins}W {team.losses}L)
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{team.averageLevel.toFixed(1)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                        team.readyMembers === team.members.length
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {team.readyMembers}/{team.members.length}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{team.averageMood}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
