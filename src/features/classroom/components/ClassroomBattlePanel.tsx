import React, { useId } from 'react';
import { Dog, Swords, X } from 'lucide-react';
import { ModalDialog } from '../../../components/ModalDialog';
import { PET_TYPES } from '../../../store/constants';
import type { Language, Student } from '../../../store/types';
import { getTeamMembers } from '../../../store/utils';
import type { ClassroomBattleSettings } from '../model/classroomModels';
import type { ClassroomTranslations } from '../types';

type ClassroomBattlePanelProps = {
  open: boolean;
  students: Student[];
  opponents: Student[];
  defenderId: string | null;
  settings: ClassroomBattleSettings;
  language: Language;
  translations: ClassroomTranslations;
  displayStudentName: (name: string) => string;
  onClose: () => void;
  onSelectDefender: (studentId: string) => void;
  onStart: () => void;
};

export const ClassroomBattlePanel: React.FC<ClassroomBattlePanelProps> = ({
  open,
  students,
  opponents,
  defenderId,
  settings,
  language,
  translations: tLang,
  displayStudentName,
  onClose,
  onSelectDefender,
  onStart,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;

  return (
    <ModalDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onClose}
      className="max-w-lg overflow-hidden"
    >
      <div className="flex justify-between items-center p-4 border-b border-gray-200">
        <h2 id={titleId} className="text-lg font-bold text-slate-900 flex items-center">
          <Swords className="h-5 w-5 mr-2 text-rose-500" />
          {tLang.selectOpponent}
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
        <div id={descriptionId} className="mb-4 space-y-2 text-sm text-gray-600">
          {settings.mode !== 'team' && (
            <p>
              {language === 'en'
                ? `Solo: attacker -${settings.soloAttackerFullnessCost} fullness, defender -${settings.soloDefenderFullnessCost}. Winner +${settings.soloWinPoints} points, loser -${settings.soloLossPoints} points.`
                : `個人賽：進攻方消耗 ${settings.soloAttackerFullnessCost} 飽食度，防守方消耗 ${settings.soloDefenderFullnessCost} 飽食度；勝方 +${settings.soloWinPoints} 積分，敗方 -${settings.soloLossPoints} 積分。`}
            </p>
          )}
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-sky-800">
            {settings.mode === 'solo'
              ? language === 'en'
                ? 'Current mode is solo only.'
                : '目前模式為僅個人賽。'
              : settings.mode === 'team'
                ? language === 'en'
                  ? `Current mode is team only. Each side needs at least 2 eligible members, and teams can include up to ${settings.maxTeamSize} members.`
                  : `目前模式為僅隊伍賽。雙方都需至少 2 位符合條件的成員，每隊最多 ${settings.maxTeamSize} 人。`
                : language === 'en'
                  ? `If both sides have at least 2 eligible members, this match becomes a team battle; otherwise it falls back to solo. Teams can include up to ${settings.maxTeamSize} members.`
                  : `若雙方都至少有 2 位符合條件的成員，這場對戰會切換為隊伍賽；否則會回到個人賽。每隊最多 ${settings.maxTeamSize} 人。`}
          </p>
          {settings.mode !== 'solo' && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
              {language === 'en'
                ? `Team: initiator -${settings.teamAttackerFullnessCost}, attacking teammates -${settings.teamAttackerTeammateFullnessCost}, target -${settings.teamDefenderFullnessCost}, defending teammates -${settings.teamDefenderTeammateFullnessCost} fullness. ${settings.teamMinFullnessEnabled ? `Minimum ${settings.teamMinFullness} fullness required.` : 'Minimum fullness gate is disabled.'}`
                : `隊伍賽：發動攻擊者消耗 ${settings.teamAttackerFullnessCost}、攻擊方隊友消耗 ${settings.teamAttackerTeammateFullnessCost}、被攻擊者消耗 ${settings.teamDefenderFullnessCost}、防守方隊友消耗 ${settings.teamDefenderTeammateFullnessCost} 飽食度。${settings.teamMinFullnessEnabled ? `出戰需至少 ${settings.teamMinFullness} 飽食度。` : '目前已關閉最低飽食度限制。'}`}
            </p>
          )}
        </div>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {opponents.map((student) => {
            const PetIcon = PET_TYPES.find((pet) =>
              pet.id === student.pet.type)?.icon || Dog;
            return (
              <button
                type="button"
                key={student.id}
                onClick={() => onSelectDefender(student.id)}
                aria-pressed={defenderId === student.id}
                className={`w-full text-left px-4 py-3 rounded-lg border flex justify-between items-center transition-colors ${
                  defenderId === student.id
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center">
                  <div className="bg-white p-2 rounded-full shadow-sm mr-3">
                    <PetIcon className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">
                      {displayStudentName(student.name)}
                    </div>
                    <div className="text-xs text-gray-500">
                      Lv. {student.pet.level || 1} | {tLang.petFullness}: {student.pet.fullness}
                      {student.teamId
                        ? ` | ${language === 'en' ? 'Team' : '隊伍'}: ${getTeamMembers(students, student, settings.maxTeamSize).length} ${language === 'en' ? 'members' : '人'}`
                        : ''}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
          {opponents.length === 0 && (
            <div className="text-center py-4 text-gray-500 text-sm">
              {tLang.noOpponents}
            </div>
          )}
        </div>
      </div>
      <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          {tLang.cancel}
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={!defenderId}
          className="px-4 py-2 text-sm font-medium text-white bg-rose-600 border border-transparent rounded-md hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed"
        >
          {tLang.startBattle}
        </button>
      </div>
    </ModalDialog>
  );
};
