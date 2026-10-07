import React from 'react';
import { Dog } from 'lucide-react';
import type { Student } from '../../../store/types';
import type { ClassroomTranslations, GetClassroomRankInfo } from '../types';
import { ClassroomStudentCard } from './ClassroomStudentCard';

type ClassroomStudentGridProps = {
  students: Student[];
  translations: ClassroomTranslations;
  onBattle: (studentId: string) => void;
  onTeamUp: (studentId: string) => void;
  getRankInfo: GetClassroomRankInfo;
};

export const ClassroomStudentGrid: React.FC<ClassroomStudentGridProps> = ({
  students,
  translations: tLang,
  onBattle,
  onTeamUp,
  getRankInfo,
}) => {
  if (students.length === 0) {
    return (
      <div className="text-center py-20 bg-white rounded-2xl shadow-sm border-2 border-amber-100">
        <Dog className="h-16 w-16 text-amber-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-amber-900">{tLang.noPets}</h2>
        <p className="text-amber-700 mt-1">{tLang.addStudentFirst}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {students.map((student) => (
        <ClassroomStudentCard
          key={student.id}
          studentId={student.id}
          onBattle={onBattle}
          onTeamUp={onTeamUp}
          getRankInfo={getRankInfo}
        />
      ))}
    </div>
  );
};
