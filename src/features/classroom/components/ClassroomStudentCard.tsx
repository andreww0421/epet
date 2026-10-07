import React from 'react';
import { PetCard } from '../../../components/PetCard';
import type { GetClassroomRankInfo } from '../types';

type ClassroomStudentCardProps = {
  studentId: string;
  onBattle: (studentId: string) => void;
  onTeamUp: (studentId: string) => void;
  getRankInfo: GetClassroomRankInfo;
};

/** Classroom-specific wiring around the shared interactive pet card. */
export const ClassroomStudentCard: React.FC<ClassroomStudentCardProps> = ({
  studentId,
  onBattle,
  onTeamUp,
  getRankInfo,
}) => (
  <PetCard
    studentId={studentId}
    onBattle={onBattle}
    onTeamUp={onTeamUp}
    getRankInfo={getRankInfo}
  />
);
