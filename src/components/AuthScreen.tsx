import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ArrowLeft,
  Dog,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
type FieldErrors = Partial<Record<
  'displayName' | 'email' | 'password' | 'passwordConfirmation',
  string
>>;

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const routeForMode: Record<AuthMode, string> = {
  login: '/login',
  register: '/register',
  forgot: '/forgot-password',
  reset: '/reset-password',
};

const readLocationState = (): { mode: AuthMode; resetToken: string } => {
  if (typeof window === 'undefined') {
    return { mode: 'login', resetToken: '' };
  }

  const hashValue = window.location.hash.replace(/^#/, '');
  const [hashPath = '', hashQuery = ''] = hashValue.split('?');
  const hashParams = new URLSearchParams(hashQuery);
  const searchParams = new URLSearchParams(window.location.search);
  const resetToken = (
    hashParams.get('token') ??
    searchParams.get('token') ??
    searchParams.get('resetToken') ??
    ''
  ).trim();

  if (resetToken || hashPath === '/reset-password') {
    return { mode: 'reset', resetToken };
  }
  if (hashPath === '/register') return { mode: 'register', resetToken: '' };
  if (hashPath === '/forgot-password') return { mode: 'forgot', resetToken: '' };
  return { mode: 'login', resetToken: '' };
};

const replaceAuthRoute = (mode: AuthMode) => {
  if (typeof window === 'undefined') return;
  const searchParams = new URLSearchParams(window.location.search);
  searchParams.delete('token');
  searchParams.delete('resetToken');
  const sanitizedSearch = searchParams.toString();
  const nextUrl = `${window.location.pathname}${sanitizedSearch ? `?${sanitizedSearch}` : ''}#${routeForMode[mode]}`;
  window.history.replaceState(null, '', nextUrl);
};

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  if (typeof candidate.code === 'string') return candidate.code.toUpperCase();
  if (typeof candidate.status === 'number') return `HTTP_${candidate.status}`;
  if (typeof candidate.message === 'string') return candidate.message.toUpperCase();
  return '';
};

const authErrorMessage = (error: unknown, mode: AuthMode) => {
  const code = getErrorCode(error);
  if (code.includes('429') || code.includes('RATE_LIMIT')) {
    return '嘗試次數過多，請稍後再試。';
  }
  if (code.includes('NETWORK') || code.includes('ABORT') || code.includes('TIMEOUT')) {
    return '目前無法連線，請檢查網路後再試。';
  }
  if (mode === 'login') {
    return '電子信箱或密碼不正確，請重新輸入。';
  }
  if (mode === 'register' && (code.includes('409') || code.includes('CONFLICT'))) {
    return '無法建立此帳號。若你曾註冊，請直接登入或重設密碼。';
  }
  if (mode === 'reset' && (
    code.includes('400') ||
    code.includes('404') ||
    code.includes('410') ||
    code.includes('TOKEN')
  )) {
    return '此重設連結無效或已逾期，請重新申請。';
  }
  return '操作未完成，請稍後再試。';
};

const fieldClassName = (hasError: boolean) => [
  'mt-1 block min-h-11 w-full rounded-lg border bg-white px-3 py-2.5 text-base text-slate-900',
  'shadow-sm outline-none transition focus:ring-2 sm:text-sm',
  hasError
    ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100',
].join(' ');

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  hint?: string;
};

const PasswordField = ({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
}: PasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-bold text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? PASSWORD_MIN_LENGTH : undefined}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${fieldClassName(Boolean(error))} pr-12`}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `隱藏${label}` : `顯示${label}`}
          aria-pressed={visible}
          className="absolute inset-y-1 right-1 inline-flex w-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {visible
            ? <EyeOff aria-hidden="true" className="h-5 w-5" />
            : <Eye aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs leading-5 text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
};

export const AuthScreen = () => {
  const {
    claimableLegacyWorkspace,
    registrationEnabled,
    status,
    login,
    register,
    forgotPassword,
    resetPassword,
  } = useAuth();
  const initialLocation = useMemo(readLocationState, []);
  const [mode, setMode] = useState<AuthMode>(initialLocation.mode);
  const [resetToken, setResetToken] = useState(initialLocation.resetToken);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [claimLegacyWorkspace, setClaimLegacyWorkspace] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [pending, setPending] = useState(false);
  const [forgotComplete, setForgotComplete] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const pageCopy = {
    login: {
      title: '登入導師帳號',
      description: '安全存取你的班級、學習分析與獎勵紀錄。',
      submit: '登入',
    },
    register: {
      title: '建立導師帳號',
      description: '建立專屬工作空間，開始管理班級。',
      submit: '建立帳號',
    },
    forgot: {
      title: '忘記密碼',
      description: '輸入註冊信箱，我們會寄送重設密碼的說明。',
      submit: '寄送重設說明',
    },
    reset: {
      title: '設定新密碼',
      description: '請設定一組只有你知道的新密碼。',
      submit: '更新密碼',
    },
  }[mode];

  useEffect(() => {
    document.documentElement.lang = 'zh-Hant';
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [mode, forgotComplete, resetComplete]);

  useEffect(() => {
    if (submitError) errorRef.current?.focus();
  }, [submitError]);

  useEffect(() => {
    // Keep the one-time token only in component memory. Removing it from both
    // query and hash prevents referrer, history, screenshot, and log leakage.
    if (initialLocation.mode === 'reset') replaceAuthRoute('reset');
  }, [initialLocation.mode]);

  useEffect(() => {
    if (status === 'checking' || registrationEnabled || mode !== 'register') return;
    setMode('login');
    setClaimLegacyWorkspace(false);
    setSubmitError('目前採封閉試點，公開註冊尚未開放。');
    replaceAuthRoute('login');
  }, [mode, registrationEnabled, status]);

  const changeMode = (nextMode: AuthMode) => {
    if (pending) return;
    setMode(nextMode);
    setFieldErrors({});
    setSubmitError('');
    setPassword('');
    setPasswordConfirmation('');
    setClaimLegacyWorkspace(false);
    setForgotComplete(false);
    setResetComplete(false);
    if (nextMode !== 'reset') setResetToken('');
    replaceAuthRoute(nextMode);
  };

  const validate = () => {
    const errors: FieldErrors = {};
    const normalizedEmail = email.trim();

    if (mode === 'register') {
      if (displayName.trim().length < 2) {
        errors.displayName = '請輸入至少 2 個字的顯示名稱。';
      }
    }

    if (mode !== 'reset') {
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        errors.email = '請輸入有效的電子信箱。';
      }
    }

    if (mode === 'login' && !password) {
      errors.password = '請輸入密碼。';
    }

    if (mode === 'register' || mode === 'reset') {
      if (password.length < PASSWORD_MIN_LENGTH) {
        errors.password = `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元。`;
      } else if (password.length > PASSWORD_MAX_LENGTH) {
        errors.password = `密碼最多 ${PASSWORD_MAX_LENGTH} 個字元。`;
      }
      if (passwordConfirmation !== password) {
        errors.passwordConfirmation = '兩次輸入的密碼不一致。';
      }
    }

    setFieldErrors(errors);
    const firstInvalidField = (
      ['displayName', 'email', 'password', 'passwordConfirmation'] as const
    ).find((field) => errors[field]);
    if (firstInvalidField) {
      const fieldId = {
        displayName: 'auth-display-name',
        email: 'auth-email',
        password: 'auth-password',
        passwordConfirmation: 'auth-password-confirmation',
      }[firstInvalidField];
      window.requestAnimationFrame(() => {
        document.getElementById(fieldId)?.focus();
      });
    }
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');
    if (!validate()) return;
    if (mode === 'reset' && !resetToken) {
      setSubmitError('重設連結不完整，請重新申請。');
      return;
    }

    setPending(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else if (mode === 'register') {
        await register({
          displayName,
          email,
          password,
          claimLegacyWorkspace,
        });
      } else if (mode === 'forgot') {
        await forgotPassword(email);
        setForgotComplete(true);
      } else {
        await resetPassword(resetToken, password);
        setResetComplete(true);
        setResetToken('');
        replaceAuthRoute('login');
      }
    } catch (error) {
      setSubmitError(authErrorMessage(error, mode));
    } finally {
      setPending(false);
    }
  };

  if (status === 'checking') {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-slate-50 px-4"
        aria-busy="true"
        aria-label="正在確認登入狀態"
      >
        <div className="flex items-center gap-3 text-sm font-bold text-slate-600" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="h-5 w-5 motion-safe:animate-spin"
          />
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3 text-indigo-700">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100">
            <Dog aria-hidden="true" className="h-7 w-7" />
          </span>
          <span className="text-xl font-black tracking-tight text-slate-900">
            班級寵物養成系統
          </span>
        </div>

        <section
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60"
          aria-labelledby="auth-heading"
        >
          <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
            {mode !== 'login' && !forgotComplete && !resetComplete && (
              <button
                type="button"
                onClick={() => changeMode('login')}
                disabled={pending}
                className="mb-5 inline-flex min-h-10 items-center gap-2 rounded-md px-1 text-sm font-bold text-slate-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                返回登入
              </button>
            )}
            <h1
              id="auth-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-black tracking-tight text-slate-950 outline-none"
            >
              {forgotComplete
                ? '請查看你的信箱'
                : resetComplete
                  ? '密碼已更新'
                  : pageCopy.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {forgotComplete
                ? '若此信箱已註冊，我們會寄送重設密碼的說明。基於帳號安全，我們不會顯示信箱是否存在。'
                : resetComplete
                  ? '你現在可以使用新密碼登入。'
                  : pageCopy.description}
            </p>
          </div>

          {forgotComplete || resetComplete ? (
            <div className="px-6 py-7 sm:px-8">
              <div
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900"
                role="status"
                aria-live="polite"
              >
                {forgotComplete
                  ? '郵件可能需要幾分鐘才會送達，也請檢查垃圾郵件匣。'
                  : '為了保護帳號，其他裝置可能需要重新登入。'}
              </div>
              <button
                type="button"
                onClick={() => changeMode('login')}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                返回登入
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="space-y-5 px-6 py-7 sm:px-8"
              noValidate
              aria-busy={pending}
            >
              {submitError && (
                <div
                  ref={errorRef}
                  tabIndex={-1}
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-800 outline-none focus:ring-2 focus:ring-rose-400"
                >
                  {submitError}
                </div>
              )}

              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-display-name" className="block text-sm font-bold text-slate-700">
                    顯示名稱
                  </label>
                  <div className="relative">
                    <UserRound
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="auth-display-name"
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      autoComplete="name"
                      maxLength={80}
                      required
                      aria-invalid={Boolean(fieldErrors.displayName)}
                      aria-describedby={fieldErrors.displayName ? 'auth-display-name-error' : undefined}
                      className={`${fieldClassName(Boolean(fieldErrors.displayName))} pl-10`}
                    />
                  </div>
                  {fieldErrors.displayName && (
                    <p id="auth-display-name-error" className="mt-1.5 text-sm font-medium text-rose-700">
                      {fieldErrors.displayName}
                    </p>
                  )}
                </div>
              )}

              {mode !== 'reset' && (
                <div>
                  <label htmlFor="auth-email" className="block text-sm font-bold text-slate-700">
                    電子信箱
                  </label>
                  <div className="relative">
                    <Mail
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="auth-email"
                      type="email"
                      inputMode="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                      className={`${fieldClassName(Boolean(fieldErrors.email))} pl-10`}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p id="auth-email-error" className="mt-1.5 text-sm font-medium text-rose-700">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
              )}

              {(mode === 'login' || mode === 'register' || mode === 'reset') && (
                <PasswordField
                  id="auth-password"
                  label={mode === 'login' ? '密碼' : '新密碼'}
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  error={fieldErrors.password}
                  hint={mode === 'register' || mode === 'reset'
                    ? `請使用至少 ${PASSWORD_MIN_LENGTH} 個字元；可以使用容易記住的長句。`
                    : undefined}
                />
              )}

              {(mode === 'register' || mode === 'reset') && (
                <PasswordField
                  id="auth-password-confirmation"
                  label="再次輸入新密碼"
                  value={passwordConfirmation}
                  onChange={setPasswordConfirmation}
                  autoComplete="new-password"
                  error={fieldErrors.passwordConfirmation}
                />
              )}

              {mode === 'register' && claimableLegacyWorkspace && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm leading-6 text-indigo-950">
                  <input
                    type="checkbox"
                    checked={claimLegacyWorkspace}
                    onChange={(event) => setClaimLegacyWorkspace(event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <strong className="block font-black">認領這台裝置原有的雲端班級</strong>
                    只有確認舊班級屬於你時才勾選。未勾選時會建立新的空白工作區，
                    不會讀取或移轉舊學生資料。
                  </span>
                </label>
              )}

              {mode === 'login' && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => changeMode('forgot')}
                    disabled={pending}
                    className="min-h-10 rounded-md px-1 text-sm font-bold text-indigo-700 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                  >
                    忘記密碼？
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-indigo-300"
              >
                {pending && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 motion-safe:animate-spin"
                  />
                )}
                {pending ? '處理中…' : pageCopy.submit}
              </button>

              {mode === 'login' && registrationEnabled && (
                <p className="text-center text-sm text-slate-600">
                  還沒有帳號？{' '}
                  <button
                    type="button"
                    onClick={() => changeMode('register')}
                    disabled={pending}
                    className="min-h-10 rounded-md px-1 font-bold text-indigo-700 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                  >
                    建立導師帳號
                  </button>
                </p>
              )}
            </form>
          )}
        </section>

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs leading-5 text-slate-500">
          <LockKeyhole aria-hidden="true" className="h-4 w-4 shrink-0" />
          請勿與他人共用密碼；系統不會透過郵件索取密碼。
        </p>
      </div>
    </main>
  );
};
