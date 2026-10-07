import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Edit2,
  Gift,
  Trash2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DeleteConfirmationDialog } from '../../../components/ui/DeleteConfirmationDialog';
import {
  StudentPenaltyControls,
  StudentPenaltyStatus,
} from '../../penalties/components/StudentPenaltyControls';
import {
  PointAdjustmentDialog,
  type PointAdjustmentEntry,
} from './PointAdjustmentDialog';
import type { TodayPointEntryRequest } from '../../teacher-console/model/todayActions';
import { PointFairnessSummary } from './PointGuardrailPanel';
import { PointReasonSettings } from './PointReasonSettings';
import { getDailyPointFairnessInsights } from '../../../educationInsights';
import {
  DEFAULT_CATCH_UP_GAP_THRESHOLD,
  DEFAULT_DAILY_CATCH_UP_BONUS,
  DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
  DEFAULT_SCHOOL_TIME_ZONE,
} from '../../../gameRules';
import { petNames, POINT_REASON_OPTIONS, translations } from '../../../i18n/translations';
import { PET_TYPES } from '../../../store/constants';
import type { Language, Student } from '../../../store/types';
import { useStore } from '../../../store/useStore';
import { getCompetencyLabels } from '../../learning/model/getCompetencyLabels';
import { useWorkspaceMutationGuard } from '../../workspace/hooks/useWorkspaceMutationGuard';
import { buildPointReasonOptions } from '../model/buildPointReasonOptions';

type RewardsSectionProps = {
  canAdministerWorkspace: boolean;
  canWrite: boolean;
  mode?: 'points' | 'settings' | 'all';
  reasonLanguage: Language;
  visible: boolean;
  todayPointEntry?: TodayPointEntryRequest | null;
  todayActive?: boolean;
};

/** One selection/dialog owner; mode separates point operations from reason configuration. */
export const RewardsSection = ({
  canAdministerWorkspace,
  canWrite,
  mode = 'all',
  reasonLanguage,
  visible,
  todayPointEntry,
  todayActive = false,
}: RewardsSectionProps) => {
  const {
    addPoints,
    adjustPointsForStudents,
    airdropPoints,
    data,
    decreaseLevel,
    deleteStudent,
    disciplineStudent,
    editStudentName,
    removePenalty,
    removeWarning,
    replacePointReasons,
    safetyUndoAction,
    showToast,
    togglePinnedReason,
    warnStudent,
  } = useStore(useShallow((state) => ({
    addPoints: state.addPoints,
    adjustPointsForStudents: state.adjustPointsForStudents,
    airdropPoints: state.airdropPoints,
    data: state.data,
    decreaseLevel: state.decreaseLevel,
    deleteStudent: state.deleteStudent,
    disciplineStudent: state.disciplineStudent,
    editStudentName: state.editStudentName,
    removePenalty: state.removePenalty,
    removeWarning: state.removeWarning,
    replacePointReasons: state.replacePointReasons,
    safetyUndoAction: state.safetyUndoAction,
    showToast: state.showToast,
    togglePinnedReason: state.togglePinnedReason,
    warnStudent: state.warnStudent,
  })));
  const lang = data.settings?.language || 'zh';
  const tLang = translations[lang];
  const currentClass = data.classes.find((classData) => classData.id === data.currentClassId);
  const currentStudents = useMemo(() => currentClass?.students ?? [], [currentClass]);
  const competencyLabels = useMemo(() => getCompetencyLabels(lang), [lang]);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [pointAdjustmentTarget, setPointAdjustmentTarget] = useState<PointAdjustmentEntry | null>(null);
  const consumedTodayEntry = useRef<number | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<Record<string, string>>({});
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const runMutation = useWorkspaceMutationGuard(canWrite);
  const currentStudentIds = useMemo(
    () => new Set(currentStudents.map((student) => student.id)),
    [currentStudents],
  );
  const selectedStudentIdsInClass = useMemo(
    () => selectedStudentIds.filter((studentId) => currentStudentIds.has(studentId)),
    [currentStudentIds, selectedStudentIds],
  );
  const selectedStudentIdSet = useMemo(
    () => new Set(selectedStudentIdsInClass),
    [selectedStudentIdsInClass],
  );
  const allStudentsSelected = currentStudents.length > 0 &&
    selectedStudentIdsInClass.length === currentStudents.length;
  const someStudentsSelected = selectedStudentIdsInClass.length > 0 && !allStudentsSelected;
  const dailyPointFairness = useMemo(
    () => getDailyPointFairnessInsights(
      currentStudents,
      Date.now(),
      data.settings?.schoolTimeZone ?? DEFAULT_SCHOOL_TIME_ZONE,
      data.settings?.positiveFeedbackRatioTarget ?? DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET,
      data.settings?.catchUpGapThreshold ?? DEFAULT_CATCH_UP_GAP_THRESHOLD,
      data.settings?.dailyCatchUpBonus ?? DEFAULT_DAILY_CATCH_UP_BONUS,
    ),
    [
      currentStudents,
      data.settings?.positiveFeedbackRatioTarget,
      data.settings?.catchUpGapThreshold,
      data.settings?.dailyCatchUpBonus,
      data.settings?.schoolTimeZone,
    ],
  );
  const configuredPointReasons = data.settings?.pointReasonOptions?.length
    ? data.settings.pointReasonOptions
    : POINT_REASON_OPTIONS;
  const pointReasonOptions = useMemo(
    () => buildPointReasonOptions({
      configuredReasons: configuredPointReasons,
      language: reasonLanguage,
      pinnedReasonIds: data.settings?.pinnedReasonIds,
      recentReasonIds: data.settings?.recentReasonIds,
    }),
    [
      configuredPointReasons,
      data.settings?.pinnedReasonIds,
      data.settings?.recentReasonIds,
      reasonLanguage,
    ],
  );
  const defaultPointReasonId = pointReasonOptions[0]?.id ??
    configuredPointReasons[0]?.id ?? POINT_REASON_OPTIONS[0].id;
  const feedbackReasonHistory = data.settings?.feedbackReasonHistory ?? [];
  // Both entry points use the same existing store action and configured reason.
  const applyPointReason = (studentId: string, reasonId: string) => {
    const selectedReason = pointReasonOptions.find((option) => option.id === reasonId);
    if (!selectedReason || !currentStudentIds.has(studentId)) return;
    runMutation(() => addPoints(studentId, selectedReason.amount, 'quick', {
      id: selectedReason.id,
      label: selectedReason.label,
      competency: selectedReason.competency,
    }));
  };
  const isPointReasonDisabled = (studentId: string, reasonId: string) => {
    const student = currentStudents.find((item) => item.id === studentId);
    const reason = pointReasonOptions.find((item) => item.id === reasonId);
    return !student || !reason || (reason.amount < 0 && student.points < Math.abs(reason.amount));
  };

  useEffect(() => {
    setSelectedStudentIds([]);
    setPointAdjustmentTarget(null);
  }, [currentClass?.id]);

  useEffect(() => {
    if (!todayActive || !canWrite || !todayPointEntry || consumedTodayEntry.current === todayPointEntry.id) return;
    consumedTodayEntry.current = todayPointEntry.id;
    if (currentStudents.length > 0) setPointAdjustmentTarget({ kind: 'picker', direction: todayPointEntry.direction });
  }, [canWrite, currentStudents.length, todayActive, todayPointEntry]);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someStudentsSelected;
    }
  }, [someStudentsSelected]);

  return (
    <>
      <div className={`${visible ? '' : 'hidden'} bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200`}>
        <div hidden={mode === 'settings'}>
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{tLang.pointManagement}</h2>
              <p className="mt-1 text-xs text-slate-500">{tLang.airdropHint}</p>
            </div>
            <button
              onClick={() => setPointAdjustmentTarget({ kind: 'class', count: currentStudents.length })}
              disabled={currentStudents.length === 0}
              className="inline-flex items-center justify-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Gift className="mr-2 h-4 w-4" />
              {tLang.airdropAll}
            </button>
          </div>
          <PointFairnessSummary
            lang={lang}
            insights={dailyPointFairness}
            guardrailsEnabled={data.settings?.pointGuardrailsEnabled !== false}
            participationSupportEnabled={data.settings?.participationSupportEnabled !== false}
          />
        </div>
        <div hidden={mode === 'points'}>
          <PointReasonSettings
            options={pointReasonOptions}
            configuredReasons={configuredPointReasons}
            competencyLabels={competencyLabels}
            labels={tLang}
            editable={canAdministerWorkspace}
            onTogglePinned={(reasonId) => runMutation(() => togglePinnedReason(reasonId))}
            onSave={(reasons) => runMutation(() => replacePointReasons(reasons))}
          />
        </div>
        <div hidden={mode === 'settings'}>
          {selectedStudentIdsInClass.length > 0 && (
            <div className="flex flex-col gap-3 border-b border-indigo-200 bg-indigo-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-bold text-indigo-950">
                {tLang.selectedStudents.replace('{count}', selectedStudentIdsInClass.length.toString())}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setSelectedStudentIds([])} className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                  {tLang.clearSelection}
                </button>
                <button
                  type="button"
                  onClick={() => setPointAdjustmentTarget({ kind: 'batch', ids: selectedStudentIdsInClass, count: selectedStudentIdsInClass.length })}
                  className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-700"
                >
                  <Edit2 className="mr-2 h-4 w-4" />
                  {tLang.batchAdjust}
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="w-12 px-4 py-3 text-center">
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={allStudentsSelected}
                      aria-checked={someStudentsSelected ? 'mixed' : allStudentsSelected}
                      aria-label={tLang.selectAllStudents}
                      onChange={() => setSelectedStudentIds(
                        allStudentsSelected ? [] : currentStudents.map((student) => student.id),
                      )}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.studentName}</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petType}</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.level}</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.points}</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petFullness}</th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.actions}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {currentStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500">{tLang.noStudents}</td>
                  </tr>
                ) : currentStudents.map((student: Student) => {
                  const petConfig = PET_TYPES.find((pet) => pet.id === student.pet.type) || PET_TYPES[0];
                  const PetIcon = petConfig.icon;
                  return (
                    <tr key={student.id} className={`transition-colors ${selectedStudentIdSet.has(student.id) ? 'bg-indigo-50/70 hover:bg-indigo-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedStudentIdSet.has(student.id)}
                          aria-label={`${tLang.batchAdjust}: ${student.name}`}
                          onChange={() => setSelectedStudentIds((current) => current.includes(student.id)
                            ? current.filter((studentId) => studentId !== student.id)
                            : [...current, student.id])}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-slate-900">{student.name}</div>
                          <button
                            onClick={() => {
                              const newName = window.prompt(lang === 'en' ? 'Enter new name' : '輸入新姓名', student.name);
                              if (newName !== null) {
                                runMutation(() => editStudentName(student.id, newName));
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded-md transition-colors"
                            title={lang === 'en' ? 'Edit name' : '修改姓名'}
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                          <StudentPenaltyStatus
                            language={lang}
                            onRemovePenalty={(studentId) => runMutation(() => removePenalty(studentId))}
                            onRemoveWarning={(studentId) => runMutation(() => removeWarning(studentId))}
                          student={student}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-slate-600">
                          <PetIcon className="h-4 w-4 mr-2 text-slate-400" />
                          {petNames[lang][petConfig.id as keyof typeof petNames.zh]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-amber-700">Lv. {student.pet.level || 1}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-indigo-600">{student.points} / {data.settings?.maxPoints ?? 700}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="flex items-center">
                            <div className="w-full bg-slate-200 rounded-full h-2.5 mr-2 max-w-[100px]">
                              <div className={`h-2.5 rounded-full ${student.pet.fullness > 70 ? 'bg-green-500' : student.pet.fullness >= 30 ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${student.pet.fullness}%` }} />
                            </div>
                            <span className="text-sm text-slate-600">{student.pet.fullness}/100</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{tLang.happiness}: {student.pet.happiness ?? 80}/100</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end items-center space-x-3">
                          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <label htmlFor={`point-reason-${student.id}`} className="text-xs text-slate-700">{tLang.fixedReason ?? '固定原因'}</label>
                            <select
                              id={`point-reason-${student.id}`}
                              value={selectedReasons[student.id] ?? defaultPointReasonId}
                              onChange={(event) => setSelectedReasons((current) => ({ ...current, [student.id]: event.target.value }))}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                              title={tLang.fixedReason ?? '固定原因'}
                            >
                              {pointReasonOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.isPinned
                                    ? `${tLang.pinnedReason} · ${option.displayLabel}`
                                    : option.isRecent
                                      ? `${tLang.recentReason} · ${option.displayLabel}`
                                      : option.displayLabel}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                const selectedReasonId = selectedReasons[student.id] ?? defaultPointReasonId;
                                const selectedReason = pointReasonOptions.find((option) => option.id === selectedReasonId) ?? pointReasonOptions[0];
                                applyPointReason(student.id, selectedReason.id);
                              }}
                              disabled={(() => {
                                const selectedReasonId = selectedReasons[student.id] ?? defaultPointReasonId;
                                const selectedReason = pointReasonOptions.find((option) => option.id === selectedReasonId) ?? pointReasonOptions[0];
                                return isPointReasonDisabled(student.id, selectedReason.id);
                              })()}
                              className="inline-flex items-center rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              title={tLang.applyReason ?? '套用'}
                            >
                              {tLang.applyReason ?? '套用'}
                            </button>
                            <button onClick={() => setPointAdjustmentTarget({ kind: 'student', id: student.id, name: student.name })} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 transition-colors" title={tLang.manualAdjust}>
                              <Edit2 className="h-3 w-3" /> {tLang.manual}
                            </button>
                          </div>

                          <StudentPenaltyControls
                            language={lang}
                            onDecreaseLevel={(studentId) => runMutation(() => decreaseLevel(studentId))}
                            onDiscipline={(studentId, reason) => runMutation(
                              () => disciplineStudent(studentId, reason),
                            )}
                            onMissingReason={() => showToast(
                              lang === 'en' ? 'A reason is required.' : '理由不可留白。',
                              'error',
                            )}
                            onWarn={(studentId) => runMutation(() => warnStudent(studentId))}
                            safetyUndoPending={Boolean(safetyUndoAction)}
                            student={student}
                          />

                          <button onClick={() => setStudentToDelete(student.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title={tLang.deleteStudent}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PointAdjustmentDialog
        competencyLabels={competencyLabels}
        feedbackReasonHistory={feedbackReasonHistory}
        onCancel={() => setPointAdjustmentTarget(null)}
        onConfirm={({ amount, competency, reason, target }) => {
          if (target.kind === 'class') {
            runMutation(() => airdropPoints(amount, reason, competency));
          } else if (target.kind === 'batch') {
            runMutation(() => adjustPointsForStudents(target.ids, amount, 'manual', {
                label: reason.trim() || undefined,
                competency,
              }));
            setSelectedStudentIds([]);
          } else {
            runMutation(() => addPoints(target.id, amount, 'manual', {
              label: reason.trim() || undefined,
              competency,
            }));
          }
          setPointAdjustmentTarget(null);
        }}
        pointReasonOptions={pointReasonOptions}
        quickReasons={pointReasonOptions}
        isPresetDisabled={isPointReasonDisabled}
        onApplyPreset={(studentId, reasonId) => {
          applyPointReason(studentId, reasonId);
          setPointAdjustmentTarget(null);
        }}
        students={currentStudents}
        target={!canWrite || mode === 'settings' || (!visible && !(todayActive && pointAdjustmentTarget?.kind === 'picker')) ? null : pointAdjustmentTarget}
        tLang={tLang}
      />

      <DeleteConfirmationDialog
        cancelLabel={tLang.cancel}
        confirmLabel={tLang.confirmDeleteBtn}
        message={tLang.deleteWarning.replace(
          '{name}',
          currentStudents.find((student) => student.id === studentToDelete)?.name ?? '',
        )}
        onCancel={() => setStudentToDelete(null)}
        onConfirm={() => {
          if (!studentToDelete) return;
          runMutation(() => deleteStudent(studentToDelete));
          setStudentToDelete(null);
        }}
        open={visible && canWrite && mode !== 'settings' && Boolean(studentToDelete)}
        title={tLang.confirmDelete}
      />
    </>
  );
};
