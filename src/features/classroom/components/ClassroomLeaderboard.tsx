import React, { useMemo } from 'react';
import { Dog, Trophy } from 'lucide-react';
import { PET_TYPES } from '../../../store/constants';
import type {
  LearningEvidenceRecord,
  PublicLeaderboardMode,
  Student,
} from '../../../store/types';
import { getWeeklyStudentGrowth } from '../../../educationInsights';
import { sortStudentsByRank } from '../model/classroomModels';
import type { ClassroomTranslations, GetClassroomRankInfo } from '../types';

type ClassroomLeaderboardProps = {
  mode: Exclude<PublicLeaderboardMode, 'hidden'>;
  students: Student[];
  learningEvidenceRecords: LearningEvidenceRecord[];
  translations: ClassroomTranslations;
  displayStudentName: (name: string) => string;
  getRankInfo: GetClassroomRankInfo;
};

export const ClassroomLeaderboard: React.FC<ClassroomLeaderboardProps> = ({
  mode,
  students,
  learningEvidenceRecords,
  translations: tLang,
  displayStudentName,
  getRankInfo,
}) => {
  const weeklyStudentGrowth = useMemo(
    () => mode === 'growth'
      ? getWeeklyStudentGrowth(students, Date.now(), 7, learningEvidenceRecords)
      : [],
    [learningEvidenceRecords, mode, students],
  );
  const studentsById = useMemo(
    () => mode === 'growth'
      ? new Map(students.map((student) => [student.id, student]))
      : new Map<string, Student>(),
    [mode, students],
  );
  const sortedByRank = useMemo(
    () => mode === 'rank' ? sortStudentsByRank(students) : [],
    [mode, students],
  );

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden max-w-4xl mx-auto">
      <div className="px-6 py-5 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
        <h2 className="text-lg leading-6 font-medium text-amber-900 flex items-center">
          <Trophy className="h-5 w-5 mr-2 text-amber-500" />
          {mode === 'growth' ? tLang.leaderboardGrowthTitle : tLang.leaderboard}
        </h2>
      </div>
      <div className="overflow-x-auto">
        {mode === 'growth' ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.studentName}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.weeklyPositiveFeedback}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.competenciesReached}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.netPointChange}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {weeklyStudentGrowth.map((growth, index) => {
                const student = studentsById.get(growth.studentId);
                if (!student) return null;
                const PetIcon = PET_TYPES.find((pet) =>
                  pet.id === student.pet.type)?.icon || Dog;
                return (
                  <tr key={growth.studentId}>
                    <td className="px-6 py-4 text-sm font-bold text-slate-500">{index + 1}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                          <PetIcon className="h-4 w-4 text-emerald-700" />
                        </div>
                        <span className="ml-3 text-sm font-medium text-gray-900">
                          {displayStudentName(student.name)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-black text-emerald-700">
                      {growth.positiveFeedbackCount}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-sky-700">
                      {growth.competencyCount}
                    </td>
                    <td className={`px-6 py-4 font-mono text-sm font-bold ${
                      growth.netPoints >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {growth.netPoints > 0 ? '+' : ''}{growth.netPoints}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
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
              {sortedByRank.map((student, index) => {
                const rankInfo = getRankInfo(student.rankPoints ?? 0);
                const RankIcon = rankInfo.icon;
                const wins = student.stats?.wins ?? 0;
                const losses = student.stats?.losses ?? 0;
                const totalBattles = wins + losses;
                const winRate = totalBattles > 0
                  ? Math.round((wins / totalBattles) * 100)
                  : 0;
                const PetIcon = PET_TYPES.find((pet) =>
                  pet.id === student.pet.type)?.icon || Dog;

                return (
                  <tr key={student.id} className={index < 3 ? 'bg-amber-50/30' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{index + 1}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
                          <PetIcon className="h-4 w-4 text-gray-600" />
                        </div>
                        <span className="ml-3 text-sm font-medium text-gray-900">
                          {displayStudentName(student.name)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rankInfo.bg} ${rankInfo.color}`}>
                        <RankIcon className="h-3 w-3 mr-1" />
                        {rankInfo.name}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{student.rankPoints ?? 0}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {winRate}% <span className="text-xs text-gray-400">({wins}W {losses}L)</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">Lv. {student.pet.level || 1}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
