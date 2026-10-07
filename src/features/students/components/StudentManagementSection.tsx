import { useState } from 'react';
import { Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DeleteConfirmationDialog } from '../../../components/ui/DeleteConfirmationDialog';
import { AddClassDialog } from './AddClassDialog';
import { RosterImportPanel } from './RosterImportPanel';
import { translations } from '../../../i18n/translations';
import { useStore } from '../../../store/useStore';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';
import { createDashboardStudent } from '../model/createDashboardStudent';

type StudentManagementSectionProps = {
  canAdministerWorkspace: boolean;
  canWrite: boolean;
  visible: boolean;
  showClassSelector?: boolean;
};

/** Owns class and roster enrollment UI. Domain mutations remain in the store. */
export const StudentManagementSection = ({
  canAdministerWorkspace,
  canWrite,
  visible,
  showClassSelector = true,
}: StudentManagementSectionProps) => {
  const {
    addClass,
    addStudent,
    addStudentsByName,
    data,
    deleteClass,
    resetSeason,
    switchClass,
  } = useStore(useShallow((state) => ({
    addClass: state.addClass,
    addStudent: state.addStudent,
    addStudentsByName: state.addStudentsByName,
    data: state.data,
    deleteClass: state.deleteClass,
    resetSeason: state.resetSeason,
    switchClass: state.switchClass,
  })));
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  const currentClass = data.classes.find((classData) => classData.id === data.currentClassId);
  const currentStudents = currentClass?.students ?? [];
  const [newStudentName, setNewStudentName] = useState('');
  const [showAddClass, setShowAddClass] = useState(false);
  const [classToDelete, setClassToDelete] = useState<string | null>(null);
  const runMutation = useWorkspaceMutationGuard(canWrite);

  const handleAddStudent = () => {
    if (!newStudentName.trim()) return;
    runMutation(() => addStudent(createDashboardStudent(newStudentName)));
    setNewStudentName('');
  };

  return (
    <>
      <div className={`${visible ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div hidden={!showClassSelector} className="flex-1 w-full sm:max-w-xs">
            <label htmlFor={showClassSelector ? 'classSelect' : 'rosterClassSelect'} className="block text-sm font-medium text-slate-700 mb-1">{tLang.classManagement}</label>
            <select
              id={showClassSelector ? 'classSelect' : 'rosterClassSelect'}
              value={data.currentClassId}
              onChange={(event) => runMutation(() => switchClass(event.target.value))}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              {data.classes.map((classData) => (
                <option key={classData.id} value={classData.id}>{classData.name}</option>
              ))}
            </select>
          </div>
          {canAdministerWorkspace && (
            <div className="flex flex-wrap gap-3 items-end">
              <button
                onClick={() => setShowAddClass(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                <Plus className="h-4 w-4 mr-2" />
                {tLang.addClass}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`${tLang.resetSeason}?`)) {
                    runMutation(resetSeason);
                  }
                }}
                className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-amber-700 bg-white hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {tLang.resetSeason}
              </button>
              <button
                onClick={() => setClassToDelete(data.currentClassId)}
                disabled={data.classes.length <= 1}
                className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {tLang.deleteClass}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`${visible ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5`}>
        <h2 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <Users className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.addStudent}
        </h2>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="studentName" className="block text-sm font-medium text-slate-700 mb-1">{tLang.studentName}</label>
            <input
              type="text"
              id="studentName"
              value={newStudentName}
              onChange={(event) => setNewStudentName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleAddStudent()}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              placeholder={tLang.enterName}
            />
          </div>
          <button
            onClick={handleAddStudent}
            disabled={!newStudentName.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            {tLang.add}
          </button>
        </div>
        <RosterImportPanel
          lang={lang}
          students={currentStudents}
          onImport={(names) => runMutation(() => addStudentsByName(names)) ?? 0}
        />
      </div>

      <AddClassDialog
        open={visible && canWrite && showAddClass}
        onAdd={(name) => {
          runMutation(() => addClass(name));
          setShowAddClass(false);
        }}
        onClose={() => setShowAddClass(false)}
        tLang={tLang}
      />

      <DeleteConfirmationDialog
        cancelLabel={tLang.cancel}
        confirmLabel={tLang.delete}
        message={tLang.deleteClassWarning.replace(
          '{name}',
          data.classes.find((classData) => classData.id === classToDelete)?.name ?? '',
        )}
        onCancel={() => setClassToDelete(null)}
        onConfirm={() => {
          if (!classToDelete) return;
          runMutation(() => deleteClass(classToDelete));
          setClassToDelete(null);
        }}
        open={visible && canWrite && Boolean(classToDelete)}
        title={tLang.deleteClass}
      />
    </>
  );
};
