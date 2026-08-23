import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArchiveRestore,
  ArrowDownToLine,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileClock,
  FileJson2,
  Filter,
  Fingerprint,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import type { ClassData } from '../../store/types';
import {
  exportStudentPrivacyData,
  loadWorkspaceAuditEvents,
  loadWorkspaceMembers,
  loadWorkspaceRevision,
  loadWorkspaceRevisions,
  restoreWorkspaceRevision,
  type WorkspaceAuditEvent,
  type WorkspaceAuditQuery,
  type WorkspaceMember,
  type WorkspaceRevision,
  type WorkspaceRevisionSnapshot,
} from '../../services/backendApi';

type GovernanceView = 'revisions' | 'student-export' | 'audit';

type DataGovernancePanelProps = {
  classes: ClassData[];
  language: 'zh' | 'en';
  flushChanges: () => Promise<boolean>;
};

type AuditFilters = {
  action: string;
  actorUserId: string;
  targetType: string;
  fromDate: string;
  toDate: string;
};

const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: '',
  actorUserId: '',
  targetType: '',
  fromDate: '',
  toDate: '',
};

const ACTION_OPTIONS = [
  'workspace.revision.restore',
  'student.privacy.export',
  'workspace.privacy.export',
  'workspace.state.put',
  'workspace.member.update',
  'workspace.member.remove',
  'workspace.owner.transfer',
  'workspace.invitation.create',
  'workspace.invitation.accept',
  'workspace.invitation.revoke',
  'workspace.create',
  'workspace.delete',
  'audit.query',
] as const;

const ACTION_LABELS: Record<string, [string, string]> = {
  'workspace.revision.restore': ['復原工作區版本', 'Workspace revision restored'],
  'student.privacy.export': ['匯出單一學生資料', 'Student data exported'],
  'workspace.privacy.export': ['匯出完整工作區', 'Workspace data exported'],
  'workspace.state.put': ['儲存工作區資料', 'Workspace state saved'],
  'workspace.member.update': ['變更成員權限', 'Member access changed'],
  'workspace.member.remove': ['移除工作區成員', 'Workspace member removed'],
  'workspace.owner.transfer': ['移轉工作區所有權', 'Workspace ownership transferred'],
  'workspace.invitation.create': ['建立工作區邀請', 'Workspace invitation created'],
  'workspace.invitation.accept': ['接受工作區邀請', 'Workspace invitation accepted'],
  'workspace.invitation.revoke': ['撤銷工作區邀請', 'Workspace invitation revoked'],
  'workspace.create': ['建立工作區', 'Workspace created'],
  'workspace.delete': ['刪除工作區', 'Workspace deleted'],
  'audit.query': ['查詢稽核紀錄', 'Audit log queried'],
};

const TARGET_LABELS: Record<string, [string, string]> = {
  account: ['帳號', 'Account'],
  invitation: ['邀請', 'Invitation'],
  student: ['學生', 'Student'],
  user: ['使用者', 'User'],
  workspace: ['工作區', 'Workspace'],
};

const hiddenMetadataKey = /token|password|secret|authorization|cookie/i;

const errorCode = (error: unknown) =>
  error instanceof Error ? error.message.toUpperCase() : 'UNKNOWN_ERROR';

const formatBytes = (bytes: number, language: 'zh' | 'en') => {
  if (bytes < 1024) return `${bytes} B`;
  const units = language === 'en' ? ['KB', 'MB'] : ['KB', 'MB'];
  const kilobytes = bytes / 1024;
  return kilobytes < 1024
    ? `${kilobytes.toFixed(1)} ${units[0]}`
    : `${(kilobytes / 1024).toFixed(1)} ${units[1]}`;
};

const safeFileSegment = (value: string) =>
  value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'record';

const downloadJson = (value: unknown, fileName: string) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const localDateBoundary = (date: string, endOfDay: boolean) => {
  if (!date) return undefined;
  const value = new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    .getTime();
  return Number.isFinite(value) ? value : undefined;
};

const toAuditQuery = (
  filters: AuditFilters,
  cursor?: string,
): WorkspaceAuditQuery => {
  const from = localDateBoundary(filters.fromDate, false);
  const to = localDateBoundary(filters.toDate, true);
  return {
    limit: 30,
    ...(cursor ? { cursor } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.targetType ? { targetType: filters.targetType } : {}),
    ...(from != null ? { from } : {}),
    ...(to != null ? { to } : {}),
  };
};

const formatMetadataValue = (value: unknown) => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) return String(value).slice(0, 100);
  return (JSON.stringify(value) ?? String(value)).slice(0, 100);
};

export const DataGovernancePanel = ({
  classes,
  language,
  flushChanges,
}: DataGovernancePanelProps) => {
  const { session } = useAuth();
  const [view, setView] = useState<GovernanceView>('revisions');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [revisions, setRevisions] = useState<WorkspaceRevision[]>([]);
  const [currentRevision, setCurrentRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceRevisionSnapshot | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [revisionError, setRevisionError] = useState('');
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');

  const [exportClassId, setExportClassId] = useState(classes[0]?.id ?? '');
  const initialStudentId = classes[0]?.students[0]?.id ?? '';
  const [exportStudentId, setExportStudentId] = useState(initialStudentId);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  const [auditFilters, setAuditFilters] = useState<AuditFilters>(
    EMPTY_AUDIT_FILTERS,
  );
  const [appliedAuditFilters, setAppliedAuditFilters] = useState<AuditFilters>(
    EMPTY_AUDIT_FILTERS,
  );
  const [auditEvents, setAuditEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | undefined>();
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditError, setAuditError] = useState('');

  const copy = language === 'en'
    ? {
        eyebrow: 'Operations ledger',
        title: 'Data governance console',
        description: 'Controlled recovery, scoped exports, and an accountable history for this workspace.',
        revisions: 'Revision recovery',
        studentExport: 'Student export',
        audit: 'Audit trail',
        current: 'Current',
        preview: 'Snapshot preview',
        selectRevision: 'Select a revision to inspect its contents before restoring.',
        restore: 'Restore as a new revision',
        restoreHint: 'History is never rewritten. Restoring creates a new revision from this snapshot.',
        restoreTitle: 'Confirm controlled recovery',
        restoreDanger: 'Current workspace data will be replaced by the selected snapshot. A new recovery revision and audit event will be created.',
        confirmation: 'Type the confirmation phrase',
        cancel: 'Cancel',
        restoring: 'Restoring…',
        classes: 'Classes',
        students: 'Students',
        assessments: 'Assessments',
        evidence: 'Evidence records',
        actor: 'Actor',
        systemActor: 'System / deleted user',
        exportTitle: 'Export one student, and only one student',
        exportHint: 'The server rebuilds a scoped file containing this student’s profile, evidence, assessment results, and boss participation. Other students are excluded.',
        classLabel: 'Class',
        studentLabel: 'Student',
        exportButton: 'Download scoped JSON',
        exportSafety: 'Treat the downloaded file as student data. Store it only in an approved encrypted location and delete it when the request is complete.',
        auditTitle: 'Queryable accountability trail',
        auditHint: 'Every query is itself recorded. Filters run on the server and never expose authentication secrets.',
        action: 'Action',
        allActions: 'All actions',
        allActors: 'All actors',
        target: 'Target',
        allTargets: 'All targets',
        from: 'From',
        to: 'To',
        search: 'Run query',
        clear: 'Clear',
        noEvents: 'No audit events match these filters.',
        loadMore: 'Load older events',
        reload: 'Reload',
      }
    : {
        eyebrow: '營運紀錄台',
        title: '資料治理控制台',
        description: '以受控復原、限縮匯出與可追溯紀錄，管理目前工作區的高風險資料操作。',
        revisions: 'Revision 復原',
        studentExport: '單生匯出',
        audit: '稽核軌跡',
        current: '目前版本',
        preview: '快照預覽',
        selectRevision: '先選擇 revision 檢查內容摘要，再執行復原。',
        restore: '復原成新的 revision',
        restoreHint: '系統不會改寫歷史；復原會用所選快照建立一個新的 revision。',
        restoreTitle: '確認受控復原',
        restoreDanger: '目前工作區資料會改為所選快照，並建立新的復原 revision 與 audit event。',
        confirmation: '輸入確認文字',
        cancel: '取消',
        restoring: '復原中…',
        classes: '班級',
        students: '學生',
        assessments: '評量',
        evidence: '學習證據',
        actor: '操作人',
        systemActor: '系統／已刪除使用者',
        exportTitle: '只匯出一位學生，也只包含這位學生',
        exportHint: '伺服器會重新產生限縮檔案，只包含所選學生的狀態、學習證據、個別評量結果與魔王參與；不夾帶同班其他學生。',
        classLabel: '班級',
        studentLabel: '學生',
        exportButton: '下載限縮 JSON',
        exportSafety: '下載檔屬於學生資料，只能保存於核准的加密位置，案件完成後應依期限刪除。',
        auditTitle: '可查詢的責任軌跡',
        auditHint: '每次查詢本身也會被記錄；篩選在伺服器執行，不會顯示驗證 secret。',
        action: '動作',
        allActions: '全部動作',
        allActors: '全部操作人',
        target: '對象',
        allTargets: '全部對象',
        from: '開始日期',
        to: '結束日期',
        search: '執行查詢',
        clear: '清除',
        noEvents: '沒有符合條件的稽核紀錄。',
        loadMore: '載入更早紀錄',
        reload: '重新載入',
      };

  const activeWorkspaceId = session?.activeWorkspaceId;
  const memberNames = useMemo(() => {
    const names = new Map(members.map((member) => [
      member.userId,
      `${member.displayName} · ${member.email}`,
    ]));
    if (session?.user.id) {
      names.set(
        session.user.id,
        `${session.user.displayName} · ${session.user.email}`,
      );
    }
    return names;
  }, [members, session?.user.displayName, session?.user.email, session?.user.id]);

  const selectedClass = classes.find((classroom) => classroom.id === exportClassId)
    ?? classes[0];
  const selectedStudent = selectedClass?.students.find(
    (student) => student.id === exportStudentId,
  ) ?? selectedClass?.students[0];

  useEffect(() => {
    if (classes.some((classroom) => classroom.id === exportClassId)) return;
    const nextClass = classes[0];
    setExportClassId(nextClass?.id ?? '');
    setExportStudentId(nextClass?.students[0]?.id ?? '');
  }, [classes, exportClassId]);

  useEffect(() => {
    if (!selectedClass) {
      setExportStudentId('');
      return;
    }
    if (selectedClass.students.some((student) => student.id === exportStudentId)) {
      return;
    }
    setExportStudentId(selectedClass.students[0]?.id ?? '');
  }, [exportStudentId, selectedClass]);

  const revisionErrorMessage = useCallback((error: unknown) => {
    const code = errorCode(error);
    if (code.includes('REVISION_NOT_FOUND')) {
      return language === 'en'
        ? 'That revision is no longer retained.'
        : '這個 revision 已不在保留範圍內。';
    }
    if (code.includes('REVISION_CONFLICT')) {
      return language === 'en'
        ? 'The workspace changed during recovery. Reload and review again.'
        : '復原期間工作區已有新版本，請重新載入後再檢查。';
    }
    return language === 'en'
      ? 'Revision data could not be loaded. Retry before taking action.'
      : '無法載入 revision 資料，請重試後再操作。';
  }, [language]);

  const refreshRevisions = useCallback(async () => {
    setRevisionLoading(true);
    setRevisionError('');
    try {
      const result = await loadWorkspaceRevisions(25);
      setCurrentRevision(result.currentRevision);
      setRevisions(result.revisions);
      const nextSelection = result.revisions.some(
        (revision) => revision.revision === selectedRevision,
      ) ? selectedRevision : result.revisions[0]?.revision ?? null;
      setSelectedRevision(nextSelection);
    } catch (error) {
      setRevisionError(revisionErrorMessage(error));
    } finally {
      setRevisionLoading(false);
    }
  }, [revisionErrorMessage, selectedRevision]);

  const refreshMembers = useCallback(async () => {
    try {
      setMembers((await loadWorkspaceMembers()).members);
    } catch {
      setMembers([]);
    }
  }, []);

  const runAuditQuery = useCallback(async (
    filters: AuditFilters,
    cursor?: string,
  ) => {
    if (cursor) setAuditLoadingMore(true);
    else setAuditLoading(true);
    setAuditError('');
    try {
      const result = await loadWorkspaceAuditEvents(
        toAuditQuery(filters, cursor),
      );
      setAuditEvents((current) => cursor
        ? [...current, ...result.events.filter((event) =>
            !current.some((candidate) => candidate.id === event.id)
          )]
        : result.events);
      setAuditCursor(result.nextCursor);
      if (!cursor) setAppliedAuditFilters(filters);
    } catch (error) {
      setAuditError(language === 'en'
        ? 'The audit query could not be completed.'
        : '稽核查詢未完成，請稍後再試。');
    } finally {
      setAuditLoading(false);
      setAuditLoadingMore(false);
    }
  }, [language]);

  useEffect(() => {
    setSnapshot(null);
    setSelectedRevision(null);
    void Promise.all([
      refreshRevisions(),
      refreshMembers(),
      runAuditQuery(EMPTY_AUDIT_FILTERS),
    ]);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (selectedRevision == null) {
      setSnapshot(null);
      return;
    }
    let disposed = false;
    setSnapshotLoading(true);
    setRevisionError('');
    void loadWorkspaceRevision(selectedRevision)
      .then((result) => {
        if (!disposed) setSnapshot(result.snapshot);
      })
      .catch((error) => {
        if (!disposed) {
          setSnapshot(null);
          setRevisionError(revisionErrorMessage(error));
        }
      })
      .finally(() => {
        if (!disposed) setSnapshotLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [revisionErrorMessage, selectedRevision]);

  const snapshotCounts = useMemo(() => {
    const snapshotClasses = snapshot?.data.classes ?? [];
    return {
      classes: snapshotClasses.length,
      students: snapshotClasses.reduce(
        (sum, classroom) => sum + classroom.students.length,
        0,
      ),
      assessments: snapshotClasses.reduce(
        (sum, classroom) => sum + (classroom.examRecords?.length ?? 0),
        0,
      ),
      evidence: snapshotClasses.reduce(
        (sum, classroom) =>
          sum + (classroom.learningEvidenceRecords?.length ?? 0),
        0,
      ),
    };
  }, [snapshot]);

  const confirmRestore = async () => {
    if (restoreRevision == null) return;
    const phrase = `RESTORE ${restoreRevision}`;
    if (restoreConfirmation.trim() !== phrase) return;
    setRestoreBusy(true);
    setRevisionError('');
    setRestoreMessage('');
    try {
      if (!(await flushChanges())) {
        setRevisionError(language === 'en'
          ? 'Unsynchronized changes could not be saved. Recovery was cancelled.'
          : '目前變更無法同步，已取消復原以避免資料遺失。');
        return;
      }
      const result = await restoreWorkspaceRevision(restoreRevision);
      setRestoreMessage(language === 'en'
        ? `Revision ${restoreRevision} was restored as revision ${result.revision}. Reloading…`
        : `已將 revision ${restoreRevision} 復原為新的 revision ${result.revision}，正在重新載入…`);
      setRestoreRevision(null);
      setRestoreConfirmation('');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setRevisionError(revisionErrorMessage(error));
    } finally {
      setRestoreBusy(false);
    }
  };

  const exportStudent = async () => {
    if (!selectedClass || !selectedStudent) return;
    setExportBusy(true);
    setExportError('');
    setExportMessage('');
    try {
      const result = await exportStudentPrivacyData(
        selectedClass.id,
        selectedStudent.id,
      );
      downloadJson(
        result,
        `epet-student-${safeFileSegment(selectedStudent.id)}-` +
          `${new Date().toISOString().slice(0, 10)}.json`,
      );
      setExportMessage(language === 'en'
        ? 'The scoped file was created. The export is recorded in the audit trail.'
        : '限縮檔案已建立，此次匯出也已寫入稽核軌跡。');
    } catch (error) {
      const code = errorCode(error);
      setExportError(code.includes('STUDENT_NOT_FOUND')
        ? (language === 'en'
            ? 'The student no longer exists in the current workspace.'
            : '這位學生已不在目前工作區中。')
        : (language === 'en'
            ? 'The scoped export could not be created.'
            : '無法建立單生限縮匯出。'));
    } finally {
      setExportBusy(false);
    }
  };

  const actionLabel = (action: string) =>
    ACTION_LABELS[action]?.[language === 'en' ? 1 : 0] ?? action;
  const targetLabel = (target?: string) => target
    ? TARGET_LABELS[target]?.[language === 'en' ? 1 : 0] ?? target
    : '—';

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-slate-800 bg-[#09131f] text-slate-100 shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
      <header className="relative overflow-hidden border-b border-white/10 px-6 py-7 sm:px-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(34,211,238,0.16),transparent_34%),linear-gradient(115deg,transparent_55%,rgba(245,158,11,0.08))]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">
              {copy.eyebrow}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-black tracking-tight text-white sm:text-4xl">
              {copy.title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              {copy.description}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3">
            <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden="true" />
            <div>
              <p className="text-xs font-black text-emerald-100">
                {language === 'en' ? 'Admin access verified' : '管理權限已驗證'}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-emerald-300/80">
                {activeWorkspaceId ?? 'workspace-unavailable'}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="grid border-b border-white/10 sm:grid-cols-3" role="tablist">
        {([
          ['revisions', copy.revisions, History],
          ['student-export', copy.studentExport, UserRoundSearch],
          ['audit', copy.audit, Fingerprint],
        ] as const).map(([itemView, label, Icon]) => (
          <button
            key={itemView}
            type="button"
            role="tab"
            aria-selected={view === itemView}
            onClick={() => setView(itemView)}
            className={`group relative flex min-h-16 items-center justify-center gap-3 border-white/10 px-4 text-sm font-black transition sm:border-r ${
              view === itemView
                ? 'bg-white text-slate-950'
                : 'bg-slate-950/30 text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon className={`h-5 w-5 ${view === itemView ? 'text-amber-600' : 'text-cyan-400'}`} />
            {label}
            {view === itemView && <span className="absolute inset-x-0 bottom-0 h-1 bg-amber-500" />}
          </button>
        ))}
      </div>

      <div className="bg-[#f2efe6] text-slate-950">
        {view === 'revisions' && (
          <div className="grid min-h-[34rem] lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.4fr)]">
            <aside className="border-b border-slate-300 bg-[#e9e4d8] p-5 lg:border-b-0 lg:border-r lg:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    25 REVISION RETENTION
                  </p>
                  <h3 className="mt-1 font-serif text-xl font-black">{copy.revisions}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshRevisions()}
                  disabled={revisionLoading}
                  aria-label={copy.reload}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:border-slate-500 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${revisionLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="mt-5 max-h-[31rem] space-y-2 overflow-y-auto pr-1">
                {revisionLoading && revisions.length === 0 ? (
                  <div className="flex min-h-32 items-center justify-center text-sm text-slate-500">
                    <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                    {language === 'en' ? 'Loading history…' : '載入版本歷史…'}
                  </div>
                ) : revisions.map((revision) => (
                  <button
                    key={revision.revision}
                    type="button"
                    onClick={() => setSelectedRevision(revision.revision)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedRevision === revision.revision
                        ? 'border-slate-900 bg-slate-950 text-white shadow-lg'
                        : 'border-slate-300 bg-white/70 hover:border-slate-500 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-black">REV {revision.revision}</span>
                      {revision.revision === currentRevision && (
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${
                          selectedRevision === revision.revision
                            ? 'bg-emerald-300 text-emerald-950'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {copy.current}
                        </span>
                      )}
                    </div>
                    <p className={`mt-2 text-xs ${selectedRevision === revision.revision ? 'text-slate-300' : 'text-slate-500'}`}>
                      {new Intl.DateTimeFormat(language === 'en' ? 'en' : 'zh-TW', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(revision.updatedAt)}
                    </p>
                    <p className={`mt-1 font-mono text-[10px] ${selectedRevision === revision.revision ? 'text-cyan-300' : 'text-slate-500'}`}>
                      {formatBytes(revision.dataSizeBytes, language)}
                    </p>
                  </button>
                ))}
              </div>
            </aside>

            <div className="p-5 sm:p-7 lg:p-9">
              {revisionError && (
                <p role="alert" className="mb-5 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
                  {revisionError}
                </p>
              )}
              {restoreMessage && (
                <p role="status" className="mb-5 border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
                  {restoreMessage}
                </p>
              )}
              {!selectedRevision ? (
                <div className="flex min-h-80 flex-col items-center justify-center text-center text-slate-500">
                  <FileClock className="h-12 w-12 text-slate-400" />
                  <p className="mt-4 max-w-sm text-sm leading-6">{copy.selectRevision}</p>
                </div>
              ) : snapshotLoading || !snapshot ? (
                <div className="flex min-h-80 items-center justify-center text-sm font-bold text-slate-500">
                  <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                  {language === 'en' ? 'Reading snapshot…' : '讀取快照內容…'}
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-4 border-b border-slate-300 pb-6 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">
                        {copy.preview}
                      </p>
                      <h3 className="mt-2 font-serif text-3xl font-black">Revision {snapshot.revision}</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        {new Intl.DateTimeFormat(language === 'en' ? 'en' : 'zh-TW', {
                          dateStyle: 'full',
                          timeStyle: 'medium',
                        }).format(snapshot.updatedAt)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-right">
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{copy.actor}</p>
                      <p className="mt-1 max-w-xs truncate text-sm font-bold text-slate-800">
                        {snapshot.actorUserId
                          ? memberNames.get(snapshot.actorUserId) ?? snapshot.actorUserId
                          : copy.systemActor}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {([
                      [copy.classes, snapshotCounts.classes, 'CL'],
                      [copy.students, snapshotCounts.students, 'ST'],
                      [copy.assessments, snapshotCounts.assessments, 'EX'],
                      [copy.evidence, snapshotCounts.evidence, 'EV'],
                    ] as const).map(([label, count, code]) => (
                      <div key={label} className="relative overflow-hidden rounded-2xl border border-slate-300 bg-white p-4">
                        <span className="absolute right-3 top-2 font-mono text-3xl font-black text-slate-100">{code}</span>
                        <p className="relative text-3xl font-black text-slate-950">{count}</p>
                        <p className="relative mt-1 text-xs font-bold text-slate-500">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-7 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                    <div className="flex gap-3">
                      <ArchiveRestore className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                      <div>
                        <p className="text-sm font-black text-amber-950">{copy.restore}</p>
                        <p className="mt-1 text-xs leading-6 text-amber-900">{copy.restoreHint}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreRevision(snapshot.revision);
                        setRestoreConfirmation('');
                      }}
                      disabled={snapshot.revision === currentRevision}
                      className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-600 px-5 text-sm font-black text-white shadow-lg shadow-amber-900/10 transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      {snapshot.revision === currentRevision ? copy.current : copy.restore}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {view === 'student-export' && (
          <div className="grid min-h-[34rem] lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <div className="p-6 sm:p-9 lg:p-12">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-800">DATA MINIMIZATION</p>
              <h3 className="mt-3 max-w-2xl font-serif text-3xl font-black leading-tight sm:text-4xl">{copy.exportTitle}</h3>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">{copy.exportHint}</p>
              {exportError && <p role="alert" className="mt-5 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{exportError}</p>}
              {exportMessage && <p role="status" className="mt-5 border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{exportMessage}</p>}
              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-black text-slate-800">
                  {copy.classLabel}
                  <select
                    value={selectedClass?.id ?? ''}
                    onChange={(event) => {
                      const nextClass = classes.find((item) => item.id === event.target.value);
                      setExportClassId(event.target.value);
                      setExportStudentId(nextClass?.students[0]?.id ?? '');
                      setExportMessage('');
                      setExportError('');
                    }}
                    className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    {classes.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-black text-slate-800">
                  {copy.studentLabel}
                  <select
                    value={selectedStudent?.id ?? ''}
                    onChange={(event) => {
                      setExportStudentId(event.target.value);
                      setExportMessage('');
                      setExportError('');
                    }}
                    disabled={!selectedClass?.students.length}
                    className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                  >
                    {(selectedClass?.students ?? []).map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                  </select>
                </label>
              </div>
              <button
                type="button"
                onClick={() => void exportStudent()}
                disabled={exportBusy || !selectedStudent}
                className="mt-6 inline-flex min-h-13 items-center gap-3 rounded-xl bg-slate-950 px-6 text-sm font-black text-white shadow-xl shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-cyan-950 disabled:translate-y-0 disabled:bg-slate-300"
              >
                {exportBusy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowDownToLine className="h-5 w-5" />}
                {copy.exportButton}
              </button>
            </div>
            <aside className="border-t border-slate-300 bg-[#dfd8c8] p-6 lg:border-l lg:border-t-0 lg:p-9">
              <div className="rounded-[1.5rem] border border-slate-400/50 bg-white/75 p-6 shadow-sm">
                <FileJson2 className="h-9 w-9 text-cyan-800" />
                <p className="mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">EXPORT MANIFEST</p>
                <h4 className="mt-2 text-xl font-black text-slate-950">{selectedStudent?.name ?? '—'}</h4>
                <dl className="mt-5 space-y-3 text-xs">
                  <div className="flex justify-between gap-4 border-b border-slate-200 pb-3">
                    <dt className="font-bold text-slate-500">{copy.classLabel}</dt>
                    <dd className="text-right font-black text-slate-800">{selectedClass?.name ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-200 pb-3">
                    <dt className="font-bold text-slate-500">Student ID</dt>
                    <dd className="max-w-48 truncate font-mono text-slate-800">{selectedStudent?.id ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-200 pb-3">
                    <dt className="font-bold text-slate-500">{copy.evidence}</dt>
                    <dd className="font-black text-slate-800">{(selectedClass?.learningEvidenceRecords ?? []).filter((record) => record.studentId === selectedStudent?.id).length}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="font-bold text-slate-500">{copy.assessments}</dt>
                    <dd className="font-black text-slate-800">{(selectedClass?.examRecords ?? []).filter((exam) => exam.results.some((result) => result.studentId === selectedStudent?.id)).length}</dd>
                  </div>
                </dl>
              </div>
              <div className="mt-5 flex gap-3 rounded-2xl border border-amber-400/60 bg-amber-100 p-4 text-amber-950">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-xs font-bold leading-6">{copy.exportSafety}</p>
              </div>
            </aside>
          </div>
        )}

        {view === 'audit' && (
          <div className="min-h-[34rem] p-5 sm:p-7 lg:p-9">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-800">IMMUTABLE ACCOUNTABILITY</p>
                <h3 className="mt-2 font-serif text-3xl font-black">{copy.auditTitle}</h3>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">{copy.auditHint}</p>
              </div>
              <button
                type="button"
                onClick={() => void runAuditQuery(appliedAuditFilters)}
                disabled={auditLoading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:border-slate-500 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${auditLoading ? 'animate-spin' : ''}`} />
                {copy.reload}
              </button>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-300 bg-white p-4 shadow-sm sm:p-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <label className="text-xs font-black text-slate-600">
                  {copy.action}
                  <select value={auditFilters.action} onChange={(event) => setAuditFilters((current) => ({ ...current, action: event.target.value }))} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                    <option value="">{copy.allActions}</option>
                    {ACTION_OPTIONS.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
                  </select>
                </label>
                <label className="text-xs font-black text-slate-600">
                  {copy.actor}
                  <select value={auditFilters.actorUserId} onChange={(event) => setAuditFilters((current) => ({ ...current, actorUserId: event.target.value }))} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                    <option value="">{copy.allActors}</option>
                    {members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName} · {member.email}</option>)}
                  </select>
                </label>
                <label className="text-xs font-black text-slate-600">
                  {copy.target}
                  <select value={auditFilters.targetType} onChange={(event) => setAuditFilters((current) => ({ ...current, targetType: event.target.value }))} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                    <option value="">{copy.allTargets}</option>
                    {Object.keys(TARGET_LABELS).map((target) => <option key={target} value={target}>{targetLabel(target)}</option>)}
                  </select>
                </label>
                <label className="text-xs font-black text-slate-600">
                  {copy.from}
                  <input type="date" value={auditFilters.fromDate} max={auditFilters.toDate || undefined} onChange={(event) => setAuditFilters((current) => ({ ...current, fromDate: event.target.value }))} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" />
                </label>
                <label className="text-xs font-black text-slate-600">
                  {copy.to}
                  <input type="date" value={auditFilters.toDate} min={auditFilters.fromDate || undefined} onChange={(event) => setAuditFilters((current) => ({ ...current, toDate: event.target.value }))} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => void runAuditQuery(auditFilters)} disabled={auditLoading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white disabled:bg-slate-300">
                  {auditLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {copy.search}
                </button>
                <button type="button" onClick={() => { setAuditFilters(EMPTY_AUDIT_FILTERS); void runAuditQuery(EMPTY_AUDIT_FILTERS); }} disabled={auditLoading} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-700">
                  <X className="h-4 w-4" />
                  {copy.clear}
                </button>
              </div>
            </div>

            {auditError && <p role="alert" className="mt-5 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{auditError}</p>}
            <div className="relative mt-7">
              <div className="absolute bottom-0 left-[1.15rem] top-0 w-px bg-slate-300 sm:left-[1.35rem]" aria-hidden="true" />
              {auditLoading && auditEvents.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center text-sm font-bold text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />{language === 'en' ? 'Querying ledger…' : '查詢稽核紀錄…'}</div>
              ) : auditEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-400 bg-white/50 px-6 py-12 text-center text-sm text-slate-500">{copy.noEvents}</div>
              ) : (
                <ol className="space-y-4">
                  {auditEvents.map((event) => {
                    const safeMetadata = Object.entries(event.metadata ?? {})
                      .filter(([key]) => !hiddenMetadataKey.test(key))
                      .slice(0, 8);
                    return (
                      <li key={event.id} className="relative pl-12 sm:pl-14">
                        <span className="absolute left-2 top-5 flex h-7 w-7 items-center justify-center rounded-full border-4 border-[#f2efe6] bg-cyan-800 text-white sm:left-3">
                          <ChevronRight className="h-3 w-3" />
                        </span>
                        <article className="rounded-2xl border border-slate-300 bg-white p-4 shadow-sm sm:p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-black text-slate-950">{actionLabel(event.action)}</p>
                              <p className="mt-1 font-mono text-[10px] text-slate-500">{event.action}</p>
                            </div>
                            <time className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-bold text-slate-500">
                              <Clock3 className="h-3.5 w-3.5" />
                              {new Intl.DateTimeFormat(language === 'en' ? 'en' : 'zh-TW', { dateStyle: 'medium', timeStyle: 'medium' }).format(event.createdAt)}
                            </time>
                          </div>
                          <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 text-xs sm:grid-cols-2">
                            <div className="flex items-start gap-2">
                              <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-cyan-800" />
                              <div className="min-w-0"><p className="font-black text-slate-500">{copy.actor}</p><p className="mt-1 truncate font-bold text-slate-800">{event.actorUserId ? memberNames.get(event.actorUserId) ?? event.actorUserId : copy.systemActor}</p></div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Filter className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                              <div className="min-w-0"><p className="font-black text-slate-500">{copy.target}</p><p className="mt-1 truncate font-bold text-slate-800">{targetLabel(event.targetType)}{event.targetId ? ` · ${event.targetId}` : ''}</p></div>
                            </div>
                          </div>
                          {safeMetadata.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {safeMetadata.map(([key, value]) => (
                                <span key={key} className="max-w-full rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600">
                                  {key}={formatMetadataValue(value)}
                                </span>
                              ))}
                            </div>
                          )}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              )}
              {auditCursor && (
                <button type="button" onClick={() => void runAuditQuery(appliedAuditFilters, auditCursor)} disabled={auditLoadingMore} className="ml-12 mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-slate-700 hover:border-slate-500 disabled:opacity-50 sm:ml-14">
                  {auditLoadingMore ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                  {copy.loadMore}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {restoreRevision != null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !restoreBusy) {
              setRestoreRevision(null);
              setRestoreConfirmation('');
            }
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="restore-title" className="w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-amber-300 bg-[#f7f2e7] text-slate-950 shadow-2xl">
            <div className="border-b border-amber-300 bg-amber-100 px-6 py-5">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white"><ShieldAlert className="h-5 w-5" /></span>
                <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">CONTROLLED RECOVERY</p><h3 id="restore-title" className="mt-1 font-serif text-2xl font-black">{copy.restoreTitle}</h3></div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm font-bold leading-7 text-slate-700">{copy.restoreDanger}</p>
              <div className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm font-black text-slate-950">RESTORE {restoreRevision}</div>
              <label className="mt-5 block text-sm font-black text-slate-800">
                {copy.confirmation}
                <input autoFocus value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} autoComplete="off" spellCheck={false} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm" />
              </label>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => { setRestoreRevision(null); setRestoreConfirmation(''); }} disabled={restoreBusy} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-50">{copy.cancel}</button>
                <button type="button" onClick={() => void confirmRestore()} disabled={restoreBusy || restoreConfirmation.trim() !== `RESTORE ${restoreRevision}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:bg-slate-300">
                  {restoreBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                  {restoreBusy ? copy.restoring : copy.restore}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};
