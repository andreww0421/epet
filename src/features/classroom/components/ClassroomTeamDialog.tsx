import React, { useId } from 'react';
import { Trash2, Users, X } from 'lucide-react';
import { ModalDialog } from '../../../components/ModalDialog';
import type { Language, Student } from '../../../store/types';
import type { ClassroomTranslations } from '../types';

type ClassroomTeamDialogProps = {
  open: boolean;
  student: Student | null;
  currentTeamMembers: Student[];
  availableTeammates: Student[];
  selectedTeammateIds: string[];
  maxTeamSize: number;
  language: Language;
  translations: ClassroomTranslations;
  displayStudentName: (name: string) => string;
  onClose: () => void;
  onClear: () => void;
  onSave: () => void;
  onToggleTeammate: (studentId: string) => void;
};

export const ClassroomTeamDialog: React.FC<ClassroomTeamDialogProps> = ({
  open,
  student,
  currentTeamMembers,
  availableTeammates,
  selectedTeammateIds,
  maxTeamSize,
  language,
  translations: tLang,
  displayStudentName,
  onClose,
  onClear,
  onSave,
  onToggleTeammate,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  if (!open || !student) return null;

  return (
    <ModalDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onClose}
      className="max-w-lg overflow-hidden"
    >
      <div className="flex justify-between items-center p-4 border-b border-gray-200">
        <h2 id={titleId} className="text-lg font-bold text-slate-900 flex items-center">
          <Users className="h-5 w-5 mr-2 text-indigo-500" />
          {language === 'en' ? 'Manage Team' : '管理隊伍'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-500"
          aria-label={tLang.close}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="p-6">
        <p id={descriptionId} className="text-sm text-gray-600 mb-4">
          {language === 'en'
            ? `${displayStudentName(student.name)} can build a team of up to ${maxTeamSize} members.`
            : `${displayStudentName(student.name)} 可建立最多 ${maxTeamSize} 人的隊伍。`}
        </p>
        {currentTeamMembers.length > 0 && (
          <div className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
            {language === 'en' ? 'Current Team' : '目前隊伍'}: {' '}
            {currentTeamMembers
              .map((member) => displayStudentName(member.name))
              .join(', ')}
          </div>
        )}
        {currentTeamMembers.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="mb-4 inline-flex items-center rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {language === 'en' ? 'Clear current team' : '解除目前隊伍'}
          </button>
        )}
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {availableTeammates.map((candidate) => {
            const selected = selectedTeammateIds.includes(candidate.id);
            return (
              <button
                type="button"
                key={candidate.id}
                onClick={() => onToggleTeammate(candidate.id)}
                aria-pressed={selected}
                className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                  selected
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-900">
                    {displayStudentName(candidate.name)}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    selected
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {selected
                      ? language === 'en' ? 'Selected' : '已選取'
                      : candidate.teamId
                        ? language === 'en' ? 'In Team' : '已有隊伍'
                        : language === 'en' ? 'Available' : '可加入'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  Lv. {candidate.pet.level || 1} | {tLang.petFullness}: {candidate.pet.fullness}
                </div>
              </button>
            );
          })}
          {availableTeammates.length === 0 && (
            <div className="text-center py-6 text-sm text-slate-500">
              {language === 'en'
                ? 'No available teammates.'
                : '目前沒有可選的隊友。'}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            {tLang.cancel}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700"
          >
            {language === 'en' ? 'Save Team' : '儲存隊伍'}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
