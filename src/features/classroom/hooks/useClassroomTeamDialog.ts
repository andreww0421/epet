import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Student } from '../../../store/types';
import { getTeamMembers } from '../../../store/utils';

type UseClassroomTeamDialogOptions = {
  students: Student[];
  maxTeamSize: number;
  setTeammate: (studentId: string, teammateIds?: string[]) => void;
};

export const useClassroomTeamDialog = ({
  students,
  maxTeamSize,
  setTeammate,
}: UseClassroomTeamDialogOptions) => {
  const [studentId, setStudentId] = useState<string | null>(null);
  const [selectedTeammateIds, setSelectedTeammateIds] = useState<string[]>([]);

  const student = useMemo(
    () => studentId
      ? students.find((candidate) => candidate.id === studentId) ?? null
      : null,
    [studentId, students],
  );
  const currentTeamMembers = useMemo(
    () => student
      ? getTeamMembers(students, student, maxTeamSize)
          .filter((member) => member.id !== student.id)
      : [],
    [maxTeamSize, student, students],
  );
  const availableTeammates = useMemo(
    () => student
      ? students.filter((candidate) => candidate.id !== student.id)
      : [],
    [student, students],
  );

  useEffect(() => {
    if (!student) {
      setSelectedTeammateIds([]);
      return;
    }
    setSelectedTeammateIds(currentTeamMembers.map((member) => member.id));
  }, [currentTeamMembers, student]);

  const close = useCallback(() => {
    setStudentId(null);
    setSelectedTeammateIds([]);
  }, []);
  const open = useCallback((nextStudentId: string) => {
    setStudentId(nextStudentId);
  }, []);
  const toggleTeammate = useCallback((candidateId: string) => {
    setSelectedTeammateIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }
      if (current.length >= maxTeamSize - 1) return current;
      return [...current, candidateId];
    });
  }, [maxTeamSize]);
  const clear = useCallback(() => {
    if (!student) return;
    setTeammate(student.id, []);
    close();
  }, [close, setTeammate, student]);
  const save = useCallback(() => {
    if (!student) return;
    setTeammate(student.id, selectedTeammateIds);
    close();
  }, [close, selectedTeammateIds, setTeammate, student]);

  return {
    availableTeammates,
    close,
    clear,
    currentTeamMembers,
    isOpen: student !== null,
    open,
    save,
    selectedTeammateIds,
    student,
    toggleTeammate,
  };
};
