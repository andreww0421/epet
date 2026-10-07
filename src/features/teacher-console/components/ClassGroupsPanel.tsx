import { useStore } from '../../../store/useStore';
import { translations } from '../../../i18n/translations';
import type { ClassData, Language, Student } from '../../../store/types';
import { getTeamMembers } from '../../../store/utils';
import { ClassroomTeamDialog, getClassroomBattleSettings, useClassroomTeamDialog } from '../../classroom';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';

type Props = { classData?: ClassData; language: Language; canWrite: boolean; visible: boolean };
const EMPTY_STUDENTS: Student[] = [];
/** Groups are the existing game teams, not a new persisted class-group system. */
export const ClassGroupsPanel = ({ classData, language, canWrite, visible }: Props) => {
  const settings = useStore((state) => state.data.settings);
  const setTeammate = useStore((state) => state.setTeammate);
  const runMutation = useWorkspaceMutationGuard(canWrite);
  const students = classData?.students ?? EMPTY_STUDENTS;
  const { maxTeamSize } = getClassroomBattleSettings(settings);
  const dialog = useClassroomTeamDialog({ students, maxTeamSize, setTeammate: (id, teammates) => runMutation(() => setTeammate(id, teammates)) });
  return (
    <div hidden={!visible}>
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-base font-bold text-slate-900">{language === 'en' ? 'Class teams' : '班級隊伍'}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{language === 'en' ? 'Manage the same teams used in the classroom. Team size and battle rules remain unchanged.' : '管理學生大廳使用的同一組隊伍；隊伍人數上限與對戰規則維持不變。'}</p>
        {students.length === 0 ? <p className="mt-4 text-sm text-slate-600">{language === 'en' ? 'Add students before creating teams.' : '請先加入學生，再建立隊伍。'}</p> : (
          <ul className="mt-4 divide-y divide-slate-100">
            {students.map((student) => <li key={student.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="break-words text-sm font-bold text-slate-900">{student.name}</p>
                <p className="mt-1 break-words text-xs text-slate-600">{getTeamMembers(students, student, maxTeamSize).filter((member) => member.id !== student.id).map((member) => member.name).join(' · ') || (language === 'en' ? 'No teammates' : '尚無隊友')}</p>
              </div>
              <button type="button" onClick={() => dialog.open(student.id)} aria-label={`${language === 'en' ? 'Manage team' : '管理隊伍'}：${student.name}`} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-50">
                {language === 'en' ? 'Manage team' : '管理隊伍'}
              </button>
            </li>)}
          </ul>
        )}
      </section>
      <ClassroomTeamDialog open={visible && dialog.isOpen} student={dialog.student} currentTeamMembers={dialog.currentTeamMembers}
        availableTeammates={dialog.availableTeammates} selectedTeammateIds={dialog.selectedTeammateIds} maxTeamSize={maxTeamSize}
        language={language} translations={translations[language]} displayStudentName={(name) => name}
        onClose={dialog.close} onClear={dialog.clear} onSave={dialog.save} onToggleTeammate={dialog.toggleTeammate} />
    </div>
  );
};
