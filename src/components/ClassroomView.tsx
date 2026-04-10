import React, { useState, useEffect } from 'react';
import { 
  Users, BarChart3, Trophy, Skull, Swords, Dog, Crown, Sparkles, Medal, Award, Shield, X, Trash2 
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { translations } from '../i18n/translations';
import { PET_TYPES, DEFAULT_BATTLE_MODE, DEFAULT_MAX_TEAM_SIZE } from '../store/constants';
import { Language } from '../store/types';
import { getTeamMembers } from '../store/utils';
import { isBattleReady } from '../gameRules';
import { PetCard } from './PetCard';

export const ClassroomView: React.FC = () => {
  const store = useStore();
  const data = store.data;
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  
  const [battleModalOpen, setBattleModalOpen] = useState(false);
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [teamModalStudentId, setTeamModalStudentId] = useState<string | null>(null);
  const [selectedTeammateIds, setSelectedTeammateIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'leaderboard' | 'teams'>('grid');

  const currentClass = data.classes.find((c: any) => c.id === data.currentClassId);
  const students = currentClass?.students || [];
  const attackerStudent = attackerId ? students.find((student: any) => student.id === attackerId) : null;
  const renderNow = Date.now();
  const currentBattleMode = data.settings?.battleMode ?? DEFAULT_BATTLE_MODE;
  const currentMaxTeamSize = data.settings?.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;

  const handleOpenBattle = (id: string) => {
    setAttackerId(id);
    setBattleModalOpen(true);
  };

  const handleBattle = () => {
    if (attackerId && defenderId) {
      store.battle(attackerId, defenderId);
      setBattleModalOpen(false);
      setAttackerId(null);
      setDefenderId(null);
    }
  };

  const teamModalStudent = teamModalStudentId
    ? students.find((student: any) => student.id === teamModalStudentId)
    : null;
  const currentTeamMembers = teamModalStudent
    ? getTeamMembers(students, teamModalStudent, currentMaxTeamSize).filter((member) => member.id !== teamModalStudent.id)
    : [];
  const availableTeammates = teamModalStudent
    ? students.filter((candidate: any) => candidate.id !== teamModalStudent.id)
    : [];
  const availableOpponents = students.filter(
    (student: any) => student.id !== attackerId && (!attackerStudent?.teamId || student.teamId !== attackerStudent.teamId),
  );

  useEffect(() => {
    if (!teamModalStudent) {
      setSelectedTeammateIds([]);
      return;
    }
    setSelectedTeammateIds(currentTeamMembers.map((member) => member.id));
  }, [teamModalStudentId, currentTeamMembers.length]);

  const sortedByRank = [...students].sort((a, b) => (b.rankPoints || 0) - (a.rankPoints || 0));
  const teamIds = Array.from(new Set(students.map((student: any) => student.teamId).filter(Boolean)));
  const teams = teamIds
    .map((teamId) => {
      const members = students.filter((student: any) => student.teamId === teamId).slice(0, currentMaxTeamSize);
      if (members.length < 2) return null;
      const wins = members.reduce((total: number, member: any) => total + (member.stats?.wins || 0), 0);
      const losses = members.reduce((total: number, member: any) => total + (member.stats?.losses || 0), 0);
      const totalBattles = wins + losses;
      const totalRankPoints = members.reduce((total: number, member: any) => total + (member.rankPoints || 0), 0);
      const averageLevel = members.reduce((total: number, member: any) => total + (member.pet.level || 1), 0) / members.length;
      const readyMembers = members.filter((member: any) => isBattleReady(member, renderNow)).length;
      const averageMood = Math.round(
        members.reduce((total: number, member: any) => total + (member.pet.happiness || 0), 0) / members.length,
      );

      return {
        id: teamId,
        members,
        name: members.map((member: any) => member.name).join(' / '),
        totalRankPoints,
        totalBattles,
        wins,
        losses,
        winRate: totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0,
        averageLevel,
        readyMembers,
        averageMood,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) =>
      b.totalRankPoints - a.totalRankPoints ||
      b.winRate - a.winRate ||
      b.averageLevel - a.averageLevel,
    );

  const getRankInfo = (rp: number = 0) => {
    if (rp >= 400) return { name: tLang.diamond, color: 'text-cyan-500', bg: 'bg-cyan-100', icon: Crown };
    if (rp >= 300) return { name: tLang.platinum, color: 'text-teal-500', bg: 'bg-teal-100', icon: Sparkles };
    if (rp >= 200) return { name: tLang.gold, color: 'text-yellow-500', bg: 'bg-yellow-100', icon: Medal };
    if (rp >= 100) return { name: tLang.silver, color: 'text-gray-400', bg: 'bg-gray-100', icon: Award };
    return { name: tLang.bronze, color: 'text-amber-700', bg: 'bg-amber-100', icon: Shield };
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-amber-50/50">
      {/* ── Fixed Header Zone (Title + Boss Banner) ── */}
      <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 pt-8">
        <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-extrabold text-amber-900 tracking-tight">{tLang.classroomTitle}</h1>
          <p className="mt-3 max-w-2xl mx-auto text-xl text-amber-700 sm:mt-4">
            {tLang.classroomDesc}
          </p>
          <div className="mt-6 flex justify-center space-x-4">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'grid' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <Users className="h-4 w-4 inline mr-2" />
              {tLang.classroomTitle}
            </button>
            <button
              onClick={() => setViewMode('leaderboard')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'leaderboard' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <BarChart3 className="h-4 w-4 inline mr-2" />
              {tLang.leaderboard}
            </button>
            <button
              onClick={() => setViewMode('teams')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'teams' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <Users className="h-4 w-4 inline mr-2" />
              {lang === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}
            </button>
          </div>
        </div>

        {store.showBossVictory && (
           <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-500">
             <div className="relative flex flex-col items-center justify-center animate-[bounce_1s_ease-in-out]">
                <Sparkles className="absolute -inset-x-12 -inset-y-12 w-full h-full text-amber-500 animate-[pulse_1.5s_ease-in-out_infinite] opacity-50" />
                <Trophy className="w-32 h-32 text-amber-400 mb-6 drop-shadow-[0_0_30px_rgba(251,191,36,0.8)] animate-[spin_3s_linear_infinite]" />
                <h1 className="text-5xl md:text-7xl font-black text-amber-400 drop-shadow-[0_0_20px_rgba(251,191,36,0.8)] uppercase tracking-widest text-center animate-[pulse_1s_ease-in-out_infinite]">
                  {tLang.bossDefeatedTitle ?? '討伐成功'}
                </h1>
                <p className="mt-4 text-amber-200 text-xl font-bold tracking-wide drop-shadow-md">
                  {tLang.bossDefeatedSubtitle ?? 'Epic Victory!'}
                </p>
             </div>
           </div>
        )}

        {currentClass?.activeBoss?.isActive && (
          <div className={`mb-4 rounded-2xl bg-slate-900 border-2 ${store.bossHitFeedback ? 'border-red-500 bg-red-950 animate-[bounce_0.2s_ease-in-out_2]' : 'border-red-900/50'} p-6 shadow-2xl relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Skull className="w-32 h-32 text-red-500" />
            </div>
            <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
              <div className="flex-shrink-0 flex items-center justify-center w-16 h-16 rounded-full bg-red-950 border border-red-800 relative">
                <Swords className="w-8 h-8 text-red-500 animate-pulse" />
                {store.bossHitFeedback && (
                  <div key={store.bossHitFeedback.id} className="absolute -top-8 text-red-400 font-black text-3xl animate-[bounce_0.8s_ease-out_forwards] drop-shadow-lg whitespace-nowrap z-20">
                    -{store.bossHitFeedback.damage}
                  </div>
                )}
              </div>
              <div className="flex-1 w-full text-center md:text-left">
                <h2 className="text-2xl font-black text-rose-100 tracking-wider mb-2 drop-shadow-md">
                  {currentClass.activeBoss.name}
                </h2>
                <div className="w-full bg-slate-800 rounded-full h-6 relative overflow-hidden ring-1 ring-white/10">
                  <div 
                    className="bg-gradient-to-r from-red-600 to-rose-500 h-6 rounded-full transition-all duration-500 relative overflow-hidden" 
                    style={{ width: `${Math.max(0, (currentClass.activeBoss.currentHp / currentClass.activeBoss.maxHp) * 100)}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-[pulse_2s_ease-in-out_infinite]"></div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white shadow-black drop-shadow-md">
                    {currentClass.activeBoss.currentHp} / {currentClass.activeBoss.maxHp}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>{/* end max-w-7xl header */}
      </div>{/* end flex-shrink-0 header zone */}

      {/* ── Scrollable Content Zone ── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="max-w-7xl mx-auto">
        {students.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl shadow-sm border-2 border-amber-100">
            <Dog className="h-16 w-16 text-amber-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-amber-900">{tLang.noPets}</h3>
            <p className="text-amber-700 mt-1">{tLang.addStudentFirst}</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {students.map((student: any) => (
              <PetCard 
                key={student.id} 
                studentId={student.id}
                onBattle={handleOpenBattle}
                onTeamUp={(id) => setTeamModalStudentId(id)}
                getRankInfo={getRankInfo}
              />
            ))}
          </div>
        ) : viewMode === 'leaderboard' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden max-w-4xl mx-auto">
            <div className="px-6 py-5 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
              <h3 className="text-lg leading-6 font-medium text-amber-900 flex items-center">
                <Trophy className="h-5 w-5 mr-2 text-amber-500" />
                {tLang.leaderboard}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.studentName}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.rank}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.rankPoints}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.winRate}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.level}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedByRank.map((student: any, idx: number) => {
                    const rankInfo = getRankInfo(student.rankPoints);
                    const RankIcon = rankInfo.icon;
                    const wins = student.stats?.wins || 0;
                    const losses = student.stats?.losses || 0;
                    const totalBattles = wins + losses;
                    const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;
                    
                    return (
                      <tr key={student.id} className={idx < 3 ? 'bg-amber-50/30' : ''}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 bg-gray-100 rounded-full flex items-center justify-center">
                              {(() => {
                                const PetIcon = PET_TYPES.find(p => p.id === student.pet.type)?.icon || Dog;
                                return <PetIcon className="h-4 w-4 text-gray-600" />;
                              })()}
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">{student.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rankInfo.bg} ${rankInfo.color}`}>
                            <RankIcon className="h-3 w-3 mr-1" />
                            {rankInfo.name}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                          {student.rankPoints || 0}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <div className="flex items-center">
                            <span className="mr-2">{winRate}%</span>
                            <span className="text-xs text-gray-400">({wins}W {losses}L)</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          Lv. {student.pet.level || 1}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-w-5xl mx-auto">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-sky-900 flex items-center">
                    <Users className="h-5 w-5 mr-2 text-sky-600" />
                    {lang === 'en' ? 'Team Leaderboard' : '隊伍排行榜'}
                  </h3>
                  <p className="mt-1 text-sm text-sky-800">
                    {lang === 'en'
                      ? 'Team wins grant an exclusive +10 pts / +6 mood bonus to each winning teammate.'
                      : '完整雙人隊伍獲勝時，每位獲勝成員都會獲得 +10 積分 / +6 心情的隊伍獎勵。'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-sky-900 shadow-sm">
                  {lang === 'en' ? 'Active Teams' : '目前隊伍'}: {teams.length}
                </div>
              </div>
            </div>

            {teams.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sky-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
                {lang === 'en'
                  ? 'No teams yet. Use the teammate button on a pet card to create one.'
                  : '目前還沒有隊伍，請先在寵物卡片中選擇隊友。'}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-sky-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">#</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Team' : '隊伍'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Total RP' : '總 RP'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {tLang.winRate}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Avg Lv.' : '平均等級'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Ready Members' : '可出戰人數'}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                          {lang === 'en' ? 'Avg Mood' : '平均心情'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {teams.map((team: any, idx: number) => (
                        <tr key={team.id} className={idx < 3 ? 'bg-sky-50/40' : ''}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                            {idx + 1}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-semibold text-slate-900">{team.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {team.members.map((member: any) => member.name).join(' / ')}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-700">
                            {team.totalRankPoints}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            {team.winRate}% ({team.wins}W {team.losses}L)
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            {team.averageLevel.toFixed(1)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                              team.readyMembers === 2 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {team.readyMembers}/{team.members.length}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                            {team.averageMood}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Battle Modal */}
      {battleModalOpen && attackerId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-slate-900 flex items-center">
                <Swords className="h-5 w-5 mr-2 text-rose-500" />
                {tLang.selectOpponent}
              </h3>
              <button onClick={() => { setBattleModalOpen(false); setDefenderId(null); }} className="text-gray-400 hover:text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 space-y-2 text-sm text-gray-600">
                <p>{tLang.battleRules}</p>
                <p className="rounded-xl bg-sky-50 px-3 py-2 text-sky-800">
                  {lang === 'en'
                    ? `If battle mode allows teams and both sides have ready members, this fight switches to team mode. Teams can include up to ${currentMaxTeamSize} members.`
                    : `若目前設定允許隊伍賽，且雙方都有可出戰隊員，這場對戰會切換為隊伍模式；每隊最多 ${currentMaxTeamSize} 人。`}
                </p>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {availableOpponents.map((student: any) => (
                  <button
                    key={student.id}
                    onClick={() => setDefenderId(student.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg border flex justify-between items-center transition-colors ${
                      defenderId === student.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center">
                      <div className="bg-white p-2 rounded-full shadow-sm mr-3">
                        {(() => {
                          const PetIcon = PET_TYPES.find(p => p.id === student.pet.type)?.icon || Dog;
                          return <PetIcon className="h-5 w-5 text-gray-600" />;
                        })()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{student.name}</div>
                        <div className="text-xs text-gray-500">
                          Lv. {student.pet.level || 1} | {tLang.petFullness}: {student.pet.fullness}
                          {student.teamId
                            ? ` | ${lang === 'en' ? 'Team' : '隊伍'}: ${getTeamMembers(students, student, currentMaxTeamSize).length} ${lang === 'en' ? 'members' : '人'}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {availableOpponents.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    {tLang.noOpponents}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setBattleModalOpen(false); setDefenderId(null); }} 
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={handleBattle} 
                disabled={!defenderId}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 border border-transparent rounded-md hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed"
              >
                {tLang.startBattle}
              </button>
            </div>
          </div>
        </div>
      )}

      {teamModalStudent && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-slate-900 flex items-center">
                <Users className="h-5 w-5 mr-2 text-indigo-500" />
                {lang === 'en' ? 'Manage Team' : '管理隊伍'}
              </h3>
              <button onClick={() => setTeamModalStudentId(null)} className="text-gray-400 hover:text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                {lang === 'en'
                  ? `${teamModalStudent.name} can build a team of up to ${currentMaxTeamSize} members.`
                  : `${teamModalStudent.name} 可建立最多 ${currentMaxTeamSize} 人的隊伍。`}
              </p>
              {currentTeamMembers.length > 0 && (
                <div className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  {lang === 'en' ? 'Current Team' : '目前隊伍'}: {currentTeamMembers.map((member: any) => member.name).join(', ')}
                </div>
              )}
              {currentTeamMembers.length > 0 && (
                <button
                  onClick={() => {
                    store.setTeammate(teamModalStudent.id, []);
                    setTeamModalStudentId(null);
                  }}
                  className="mb-4 inline-flex items-center rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {lang === 'en' ? 'Clear current team' : '解除目前隊伍'}
                </button>
              )}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {availableTeammates.map((candidate: any) => (
                  <button
                    key={candidate.id}
                    onClick={() => {
                      setSelectedTeammateIds((current) => {
                        if (current.includes(candidate.id)) {
                          return current.filter((id) => id !== candidate.id);
                        }
                        if (current.length >= currentMaxTeamSize - 1) {
                          return current;
                        }
                        return [...current, candidate.id];
                      });
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedTeammateIds.includes(candidate.id)
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-slate-900">{candidate.name}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        selectedTeammateIds.includes(candidate.id) ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {selectedTeammateIds.includes(candidate.id)
                          ? (lang === 'en' ? 'Selected' : '已選取')
                          : candidate.teamId
                            ? (lang === 'en' ? 'In Team' : '已有隊伍')
                            : (lang === 'en' ? 'Available' : '可加入')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      Lv. {candidate.pet.level || 1} | {tLang.petFullness}: {candidate.pet.fullness}
                    </div>
                  </button>
                ))}
                {availableTeammates.length === 0 && (
                  <div className="text-center py-6 text-sm text-slate-500">
                    {lang === 'en' ? 'No available teammates.' : '目前沒有可選的隊友。'}
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => setTeamModalStudentId(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  {tLang.cancel}
                </button>
                <button
                  onClick={() => {
                    store.setTeammate(teamModalStudent.id, selectedTeammateIds);
                    setTeamModalStudentId(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700"
                >
                  {lang === 'en' ? 'Save Team' : '儲存隊伍'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </div>{/* end max-w-7xl content */}
      </div>{/* end scrollable zone */}
    </div>
  );
};
