import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, LogOut, MailCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

export const readEmailVerificationRoute = () => {
  if (typeof window === 'undefined') return { active: false, token: '' };
  const hashValue = window.location.hash.replace(/^#/, '');
  const [hashPath = '', hashQuery = ''] = hashValue.split('?');
  const hashParams = new URLSearchParams(hashQuery);
  // Verification links intentionally accept tokens only from the fragment so
  // the browser never sends the raw token in the HTTP request or server logs.
  const token = (hashParams.get('token') ?? '').trim();
  return { active: hashPath === '/verify-email', token };
};

const removeVerificationTokenFromUrl = () => {
  const searchParams = new URLSearchParams(window.location.search);
  searchParams.delete('token');
  const search = searchParams.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${search ? `?${search}` : ''}#/verify-email`,
  );
};

export const EmailVerificationScreen = ({ token }: { token: string }) => {
  const {
    session,
    emailVerificationEnabled,
    verifyEmail,
    resendVerification,
    logout,
  } = useAuth();
  const startedRef = useRef(false);
  const [state, setState] = useState<
    'waiting' | 'verifying' | 'verified' | 'error'
  >(token ? 'verifying' : 'waiting');
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token || startedRef.current) return;
    startedRef.current = true;
    removeVerificationTokenFromUrl();
    void verifyEmail(token)
      .then(() => {
        setState('verified');
        setMessage('Email 已完成驗證。');
      })
      .catch(() => {
        setState('error');
        setMessage('此驗證連結無效、已使用或已逾期。');
      });
  }, [token, verifyEmail]);

  const handleResend = async () => {
    setResending(true);
    setMessage('');
    try {
      await resendVerification();
      setState('waiting');
      setMessage('驗證信已重新排程寄送，請稍候並檢查垃圾郵件匣。');
    } catch {
      setMessage('目前無法重寄驗證信，請稍後再試。');
    } finally {
      setResending(false);
    }
  };

  const continueToApp = () => {
    window.history.replaceState(null, '', `${window.location.pathname}#/login`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f1e8] px-4 py-10">
      <section className="w-full max-w-xl rounded-[2rem] border border-white bg-white p-7 shadow-[0_28px_90px_rgba(15,23,42,0.13)] sm:p-10">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-100 text-teal-900">
          {state === 'verifying'
            ? <LoaderCircle aria-hidden="true" className="h-7 w-7 motion-safe:animate-spin" />
            : <MailCheck aria-hidden="true" className="h-7 w-7" />}
        </span>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-teal-800">
          帳號安全
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
          {state === 'verifying'
            ? '正在驗證 Email'
            : state === 'verified'
              ? 'Email 驗證完成'
              : '請先驗證 Email'}
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {state === 'verified'
            ? '帳號已可安全存取工作區。'
            : session
              ? `驗證信會寄到 ${session.user.email}。完成前，班級與學生資料會保持鎖定。`
              : '請開啟驗證信中的一次性連結；完成後即可登入。'}
        </p>
        {message && (
          <p
            className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-bold leading-6 ${
              state === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-950'
            }`}
            role={state === 'error' ? 'alert' : 'status'}
          >
            {message}
          </p>
        )}
        {state === 'verified' ? (
          <button
            type="button"
            onClick={continueToApp}
            className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 font-black text-white"
          >
            {session ? '繼續進入工作區' : '前往登入'}
            <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {session && emailVerificationEnabled && (
              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={resending || state === 'verifying'}
                className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 font-black text-white disabled:opacity-50"
              >
                {resending
                  ? <LoaderCircle aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
                  : <RefreshCw aria-hidden="true" className="h-5 w-5" />}
                重新寄送
              </button>
            )}
            {session && (
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-5 font-black text-slate-800"
              >
                <LogOut aria-hidden="true" className="h-5 w-5" />
                登出
              </button>
            )}
            {!session && (
              <button
                type="button"
                onClick={continueToApp}
                className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 font-black text-white sm:col-span-2"
              >
                前往登入
                <ArrowRight aria-hidden="true" className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
};
