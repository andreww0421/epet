import { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { deleteCurrentAccount } from '../services/backendApi';
import { ModalDialog } from './ModalDialog';

type AccountDeletionDialogProps = {
  language: 'zh' | 'en';
  onClose: () => void;
  flushChanges: () => Promise<boolean>;
};

export const AccountDeletionDialog = ({
  language,
  onClose,
  flushChanges,
}: AccountDeletionDialogProps) => {
  const { invalidateSession } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = language === 'en'
    ? {
        title: 'Delete account',
        hint: 'You must transfer or delete every workspace you own first. Account deletion removes your memberships, sessions, and password-reset data.',
        password: 'Current password',
        confirmation: 'Type DELETE',
        submit: 'Delete my account permanently',
        close: 'Close',
        sync: 'Unsaved workspace changes must finish synchronizing first.',
      }
    : {
        title: '刪除帳號',
        hint: '請先移轉或刪除你擁有的所有工作區。刪除帳號會移除成員關係、session 與密碼重設資料。',
        password: '目前密碼',
        confirmation: '輸入 DELETE',
        submit: '永久刪除我的帳號',
        close: '關閉',
        sync: '請先完成尚未同步的工作區變更。',
      };

  const errorMessage = (submitError: unknown) => {
    const code = submitError instanceof Error
      ? submitError.message.toUpperCase()
      : 'UNKNOWN_ERROR';
    if (code.includes('OWNER_TRANSFER_REQUIRED')) {
      return language === 'en'
        ? 'Transfer or delete every workspace you own before deleting the account.'
        : '請先移轉或刪除你擁有的所有工作區。';
    }
    if (code.includes('INVALID_CREDENTIALS')) {
      return language === 'en' ? 'The password is incorrect.' : '密碼不正確。';
    }
    if (code.includes('ACCOUNT_CONFIRMATION_MISMATCH')) {
      return language === 'en' ? 'Type DELETE exactly.' : '請完整輸入 DELETE。';
    }
    return language === 'en'
      ? 'The account could not be deleted. Please retry.'
      : '帳號刪除未完成，請稍後再試。';
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!(await flushChanges())) {
        setError(copy.sync);
        return;
      }
      await deleteCurrentAccount({ password, confirmation });
      invalidateSession();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      labelledBy="delete-account-title"
      describedBy="delete-account-description"
      onClose={onClose}
      closeDisabled={busy}
      className="max-w-md rounded-2xl p-6 shadow-2xl"
    >
        <div className="flex items-start justify-between gap-4">
          <div>
            <AlertTriangle className="h-8 w-8 text-rose-700" aria-hidden="true" />
            <h2 id="delete-account-title" className="mt-3 text-xl font-black text-slate-950">{copy.title}</h2>
          </div>
          <button autoFocus type="button" onClick={onClose} disabled={busy} aria-label={copy.close} className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p id="delete-account-description" className="mt-3 text-sm leading-6 text-slate-600">{copy.hint}</p>
        {error && <p role="alert" className="mt-4 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">{error}</p>}
        <label className="mt-5 block text-sm font-bold text-slate-800">
          {copy.password}
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="mt-4 block text-sm font-bold text-slate-800">
          {copy.confirmation}
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <button type="button" onClick={() => void submit()} disabled={busy || !password || confirmation !== 'DELETE'} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-rose-700 px-4 py-3 font-black text-white disabled:bg-slate-300">
          <Trash2 className="mr-2 h-5 w-5" aria-hidden="true" />
          {copy.submit}
        </button>
    </ModalDialog>
  );
};
