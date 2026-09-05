import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import {
  deleteActiveWorkspace,
  createWorkspaceInvitation,
  loadWorkspaceInvitations,
  loadWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMember,
  type WorkspaceMember,
  type WorkspaceInvitation,
  type WorkspaceRole,
} from '../../services/backendApi';

type WorkspaceAccessPanelProps = {
  classes: Array<{ id: string; name: string }>;
  language: 'zh' | 'en';
};

type MemberDraft = {
  role: Exclude<WorkspaceRole, 'owner'>;
  classIds: string[];
};

const errorCode = (error: unknown) =>
  error instanceof Error ? error.message : 'UNKNOWN_ERROR';

const accessErrorMessage = (error: unknown, language: 'zh' | 'en') => {
  const code = errorCode(error).toUpperCase();
  const messages: Record<string, [string, string]> = {
    INVALID_CLASS_SCOPE: ['請至少選擇一個有效班級。', 'Select at least one valid class.'],
    INVALID_CREDENTIALS: ['密碼不正確。', 'The password is incorrect.'],
    WORKSPACE_CONFIRMATION_MISMATCH: ['工作區名稱與確認內容不符。', 'The workspace confirmation does not match.'],
    MEMBER_ALREADY_EXISTS: ['這個帳號已是工作區成員。', 'This account is already a workspace member.'],
    FORBIDDEN: ['你沒有執行此操作的權限。', 'You do not have permission for this action.'],
    INVALID_WORKSPACE_INVITATION: ['邀請已失效或無法操作。', 'The invitation is no longer valid.'],
    INVITATION_DELIVERY_UNAVAILABLE: ['邀請寄送服務尚未啟用。', 'Invitation delivery is not available.'],
  };
  const matched = Object.entries(messages).find(([key]) => code.includes(key));
  return matched ? matched[1][language === 'en' ? 1 : 0] : (
    language === 'en'
      ? 'The operation could not be completed. Please retry.'
      : '操作未完成，請稍後再試。'
  );
};

export const WorkspaceAccessPanel = ({
  classes,
  language,
}: WorkspaceAccessPanelProps) => {
  const { session, refreshSession, invitationEnabled } = useAuth();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [workspacePassword, setWorkspacePassword] = useState('');
  const [workspaceConfirmation, setWorkspaceConfirmation] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<WorkspaceRole, 'owner'>>('teacher');
  const [inviteClassIds, setInviteClassIds] = useState<string[]>([]);
  const activeWorkspace = session?.workspaces.find(
    (workspace) => workspace.id === session.activeWorkspaceId,
  );
  const isOwner = activeWorkspace?.role === 'owner';

  const copy = language === 'en'
    ? {
        title: 'Workspace access',
        hint: 'Owners and admins can review roles and class access. Only an owner can manage admins or transfer ownership.',
        role: 'Role',
        classes: 'Class access',
        allClasses: 'All classes',
        save: 'Save access',
        remove: 'Remove',
        transfer: 'Transfer ownership',
        reload: 'Reload',
        empty: 'No workspace members were found.',
        danger: 'Workspace deletion',
        dangerHint: 'This permanently deletes the live workspace, revision history, memberships, and normalized student records.',
        password: 'Current password',
        confirmation: 'Type the workspace name',
        deleteWorkspace: 'Delete workspace permanently',
        removeConfirm: 'Remove this member from the workspace?',
        transferConfirm: 'Transfer ownership to this member? Your role will become admin.',
        deleteConfirm: 'Permanently delete this workspace and all of its data?',
        invite: 'Invite member',
        inviteHint: 'The recipient receives a one-time link that expires in seven days.',
        email: 'Email',
        sendInvite: 'Send invitation',
        invitationUnavailable: 'Configure the approved email sender before invitations can be sent.',
        pendingInvitations: 'Invitation history',
        revoke: 'Revoke',
      }
    : {
        title: '工作區權限',
        hint: '擁有者與管理員可檢查角色和班級範圍；只有擁有者能管理 admin 或移轉所有權。',
        role: '角色',
        classes: '可存取班級',
        allClasses: '全部班級',
        save: '儲存權限',
        remove: '移除',
        transfer: '移轉所有權',
        reload: '重新載入',
        empty: '目前沒有可顯示的工作區成員。',
        danger: '刪除工作區',
        dangerHint: '此操作會永久刪除目前資料、revision 歷史、成員關係與正規化學生紀錄。',
        password: '目前密碼',
        confirmation: '輸入工作區名稱',
        deleteWorkspace: '永久刪除工作區',
        removeConfirm: '確定要把這位成員移出工作區？',
        transferConfirm: '確定移轉所有權？你的角色將改為 admin。',
        deleteConfirm: '確定永久刪除此工作區及所有資料？',
        invite: '邀請成員',
        inviteHint: '收件者會收到七天內有效、只能使用一次的加入連結。',
        email: 'Email',
        sendInvite: '寄送邀請',
        invitationUnavailable: '請先完成核准寄件服務設定，才能寄送邀請。',
        pendingInvitations: '邀請紀錄',
        revoke: '撤銷',
      };

  const syncDrafts = useCallback((nextMembers: WorkspaceMember[]) => {
    setMembers(nextMembers);
    setDrafts(Object.fromEntries(nextMembers.flatMap((member) =>
      member.role === 'owner'
        ? []
        : [[member.userId, {
            role: member.role,
            classIds: member.classIds,
          } satisfies MemberDraft]],
    )));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [memberResult, invitationResult] = await Promise.all([
        loadWorkspaceMembers(),
        loadWorkspaceInvitations(),
      ]);
      syncDrafts(memberResult.members);
      setInvitations(invitationResult.invitations);
    } catch (loadError) {
      setError(accessErrorMessage(loadError, language));
    } finally {
      setLoading(false);
    }
  }, [syncDrafts]);

  useEffect(() => {
    void load();
  }, [load, session?.activeWorkspaceId]);

  const classNames = useMemo(
    () => new Map(classes.map((classroom) => [classroom.id, classroom.name])),
    [classes],
  );

  const saveMember = async (member: WorkspaceMember) => {
    const draft = drafts[member.userId];
    if (!draft) return;
    if (
      (draft.role === 'teacher' || draft.role === 'viewer') &&
      draft.classIds.length === 0
    ) {
      setError(accessErrorMessage(new Error('INVALID_CLASS_SCOPE'), language));
      return;
    }
    setBusyUserId(member.userId);
    setError('');
    try {
      syncDrafts((await updateWorkspaceMember(member.userId, draft)).members);
      await refreshSession();
    } catch (saveError) {
      setError(accessErrorMessage(saveError, language));
    } finally {
      setBusyUserId(null);
    }
  };

  const removeMember = async (member: WorkspaceMember) => {
    if (!window.confirm(copy.removeConfirm)) return;
    setBusyUserId(member.userId);
    setError('');
    try {
      syncDrafts((await removeWorkspaceMember(member.userId)).members);
    } catch (removeError) {
      setError(accessErrorMessage(removeError, language));
    } finally {
      setBusyUserId(null);
    }
  };

  const transferOwnership = async (member: WorkspaceMember) => {
    if (!window.confirm(copy.transferConfirm)) return;
    setBusyUserId(member.userId);
    setError('');
    try {
      await transferWorkspaceOwnership(member.userId);
      await refreshSession();
      await load();
    } catch (transferError) {
      setError(accessErrorMessage(transferError, language));
    } finally {
      setBusyUserId(null);
    }
  };

  const destroyWorkspace = async () => {
    if (!isOwner || !window.confirm(copy.deleteConfirm)) return;
    setBusyUserId('workspace-delete');
    setError('');
    try {
      await deleteActiveWorkspace({
        password: workspacePassword,
        confirmation: workspaceConfirmation,
      });
      setWorkspacePassword('');
      setWorkspaceConfirmation('');
      await refreshSession();
    } catch (deleteError) {
      setError(accessErrorMessage(deleteError, language));
    } finally {
      setBusyUserId(null);
    }
  };

  const sendInvitation = async () => {
    setBusyUserId('invitation-create');
    setError('');
    try {
      await createWorkspaceInvitation({
        email: inviteEmail.trim(),
        role: inviteRole,
        classIds: inviteRole === 'admin' ? [] : inviteClassIds,
      });
      setInviteEmail('');
      setInviteClassIds([]);
      setInvitations((await loadWorkspaceInvitations()).invitations);
    } catch (invitationError) {
      setError(accessErrorMessage(invitationError, language));
    } finally {
      setBusyUserId(null);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    setBusyUserId(invitationId);
    setError('');
    try {
      setInvitations((await revokeWorkspaceInvitation(invitationId)).invitations);
    } catch (revokeError) {
      setError(accessErrorMessage(revokeError, language));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center text-base font-black text-slate-900">
            <Users className="mr-2 h-5 w-5 text-indigo-600" aria-hidden="true" />
            {copy.title}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{copy.hint}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-10 items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {copy.reload}
        </button>
      </div>

      {error && <p className="mt-4 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900" role="alert">{error}</p>}

      <div className="mt-5 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <h4 className="font-black text-indigo-950">{copy.invite}</h4>
        <p className="mt-1 text-sm text-indigo-800">
          {invitationEnabled ? copy.inviteHint : copy.invitationUnavailable}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px]">
          <label className="text-xs font-bold text-slate-700">
            {copy.email}
            <input type="email" value={inviteEmail} disabled={!invitationEnabled} onChange={(event) => setInviteEmail(event.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-slate-700">
            {copy.role}
            <select value={inviteRole} disabled={!invitationEnabled} onChange={(event) => setInviteRole(event.target.value as Exclude<WorkspaceRole, 'owner'>)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              {isOwner && <option value="admin">admin</option>}
              <option value="teacher">teacher</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
        </div>
        {(inviteRole === 'teacher' || inviteRole === 'viewer') && (
          <div className="mt-3 flex flex-wrap gap-2">
            {classes.map((classroom) => (
              <label key={classroom.id} className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={inviteClassIds.includes(classroom.id)} disabled={!invitationEnabled} onChange={(event) => setInviteClassIds((current) => event.target.checked ? [...new Set([...current, classroom.id])] : current.filter((id) => id !== classroom.id))} />
                {classroom.name}
              </label>
            ))}
          </div>
        )}
        <button type="button" onClick={() => void sendInvitation()} disabled={!invitationEnabled || busyUserId === 'invitation-create' || !inviteEmail.trim() || ((inviteRole === 'teacher' || inviteRole === 'viewer') && inviteClassIds.length === 0)} className="mt-4 rounded-md bg-indigo-700 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">{copy.sendInvite}</button>
      </div>

      {invitations.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-black text-slate-800">{copy.pendingInvitations}</h4>
          <div className="mt-2 space-y-2">
            {invitations.map((invitation) => {
              const active = invitation.acceptedAt == null && invitation.revokedAt == null && invitation.expiresAt > Date.now();
              return (
                <div key={invitation.id} className="flex flex-col gap-2 rounded-md border border-slate-200 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{invitation.email}</p>
                    <p className="text-xs text-slate-500">{invitation.role} · {active ? new Date(invitation.expiresAt).toLocaleDateString() : invitation.acceptedAt ? 'accepted' : 'closed'}</p>
                  </div>
                  {active && (isOwner || invitation.role !== 'admin') && (
                    <button type="button" onClick={() => void revokeInvitation(invitation.id)} disabled={busyUserId === invitation.id} className="self-start rounded-md border border-rose-300 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">{copy.revoke}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {!loading && members.length === 0 && <p className="text-sm text-slate-500">{copy.empty}</p>}
        {members.map((member) => {
          const draft = drafts[member.userId];
          const scoped = draft?.role === 'teacher' || draft?.role === 'viewer';
          const canManageMember = member.role !== 'owner' &&
            (isOwner || member.role !== 'admin');
          return (
            <article key={member.userId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-900">{member.displayName}</p>
                  <p className="truncate text-sm text-slate-600">{member.email}</p>
                </div>
                {member.role === 'owner' ? (
                  <span className="inline-flex items-center self-start rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    owner
                  </span>
                ) : draft && (
                  <div className="flex flex-1 flex-col gap-3 lg:max-w-3xl">
                    <label className="text-xs font-bold text-slate-700">
                      {copy.role}
                      <select
                        value={draft.role}
                        disabled={!canManageMember || busyUserId === member.userId}
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [member.userId]: {
                            ...draft,
                            role: event.target.value as MemberDraft['role'],
                          },
                        }))}
                        className="mt-1 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        {isOwner && <option value="admin">admin</option>}
                        <option value="teacher">teacher</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </label>
                    <div>
                      <p className="text-xs font-bold text-slate-700">{copy.classes}</p>
                      {scoped ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {classes.map((classroom) => (
                            <label key={classroom.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                              <input
                                type="checkbox"
                                checked={draft.classIds.includes(classroom.id)}
                                disabled={!canManageMember || busyUserId === member.userId}
                                onChange={(event) => setDrafts((current) => ({
                                  ...current,
                                  [member.userId]: {
                                    ...draft,
                                    classIds: event.target.checked
                                      ? [...new Set([...draft.classIds, classroom.id])]
                                      : draft.classIds.filter((id) => id !== classroom.id),
                                  },
                                }))}
                              />
                              {classroom.name}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-sm font-bold text-emerald-700">{copy.allClasses}</p>
                      )}
                    </div>
                    {!canManageMember && member.classIds.length > 0 && (
                      <p className="text-xs text-slate-500">
                        {member.classIds.map((id) => classNames.get(id) ?? id).join(', ')}
                      </p>
                    )}
                    {canManageMember && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void saveMember(member)} disabled={busyUserId === member.userId || (scoped && draft.classIds.length === 0)} className="rounded-md bg-indigo-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{copy.save}</button>
                        <button type="button" onClick={() => void removeMember(member)} disabled={busyUserId === member.userId} className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">{copy.remove}</button>
                        {isOwner && (
                          <button type="button" onClick={() => void transferOwnership(member)} disabled={busyUserId === member.userId} className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-50">{copy.transfer}</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {isOwner && activeWorkspace && (
        <div className="mt-6 border-t border-rose-200 pt-5">
          <h4 className="flex items-center font-black text-rose-900">
            <AlertTriangle className="mr-2 h-5 w-5" aria-hidden="true" />
            {copy.danger}
          </h4>
          <p className="mt-1 text-sm leading-6 text-rose-800">{copy.dangerHint}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-slate-700">
              {copy.password}
              <input type="password" autoComplete="current-password" value={workspacePassword} onChange={(event) => setWorkspacePassword(event.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-bold text-slate-700">
              {copy.confirmation}: <span className="font-black text-rose-800">{activeWorkspace.name}</span>
              <input value={workspaceConfirmation} onChange={(event) => setWorkspaceConfirmation(event.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void destroyWorkspace()}
            disabled={busyUserId === 'workspace-delete' || !workspacePassword || workspaceConfirmation !== activeWorkspace.name}
            className="mt-3 inline-flex min-h-11 items-center rounded-md bg-rose-700 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300"
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.deleteWorkspace}
          </button>
        </div>
      )}
    </section>
  );
};
