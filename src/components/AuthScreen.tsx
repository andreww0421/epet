import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Check,
  Dog,
  Eye,
  EyeOff,
  HeartPulse,
  LoaderCircle,
  LockKeyhole,
  Mail,
  PawPrint,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { TurnstileWidget } from './TurnstileWidget';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'invite';
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
  invite: '/accept-invitation',
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

  if (hashPath === '/accept-invitation') {
    return { mode: 'invite', resetToken };
  }
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
  if (code.includes('BOT_CHALLENGE') || code.includes('BOT_PROTECTION')) {
    return '安全驗證未完成或已逾期，請重新驗證後再試。';
  }
  if (code.includes('REGISTRATION_DISABLED') || (mode === 'register' && code.includes('403'))) {
    return '目前暫停建立新帳號，請向學校管理者索取開通資訊。';
  }
  if (mode === 'login') {
    return '電子信箱或密碼不正確，請重新輸入。';
  }
  if (mode === 'register' && (
    code.includes('409') ||
    code.includes('CONFLICT') ||
    code.includes('EMAIL_ALREADY_EXISTS')
  )) {
    return '無法建立此帳號。若你曾註冊，請直接登入或重設密碼。';
  }
  if (mode === 'register' && code.includes('INVALID_EMAIL')) {
    return '電子信箱格式不正確，請檢查後再試。';
  }
  if (mode === 'register' && code.includes('INVALID_PASSWORD')) {
    return `密碼需介於 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 個字元。`;
  }
  if (mode === 'reset' && (
    code.includes('400') ||
    code.includes('404') ||
    code.includes('410') ||
    code.includes('TOKEN')
  )) {
    return '此重設連結無效或已逾期，請重新申請。';
  }
  if (mode === 'invite') {
    if (code.includes('CREDENTIAL')) {
      return '此信箱已有帳號，請輸入原本的帳號密碼接受邀請。';
    }
    return '邀請連結無效、已使用或已逾期，請聯絡工作區管理員重新邀請。';
  }
  return '操作未完成，請稍後再試。';
};

const fieldClassName = (hasError: boolean) => [
  'mt-2 block min-h-[3.25rem] w-full rounded-2xl border bg-white px-4 py-3 text-base text-slate-950',
  'shadow-[0_1px_0_rgba(15,23,42,0.02)] outline-none transition duration-200',
  'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
  hasError
    ? 'border-rose-400 focus:border-rose-500 focus:ring-4 focus:ring-rose-100'
    : 'border-slate-300 hover:border-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-100',
].join(' ');

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  error?: string;
  hint?: string;
};

const PasswordField = ({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  hint,
}: PasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-black tracking-wide text-slate-800">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={autoComplete === 'new-password' ? PASSWORD_MIN_LENGTH : undefined}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${fieldClassName(Boolean(error))} pr-14`}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `隱藏${label}` : `顯示${label}`}
          aria-pressed={visible}
          className="absolute inset-y-2 right-2 inline-flex w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
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
        <p id={errorId} className="mt-1.5 text-sm font-bold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
};

const BenefitItem = ({ children }: { children: ReactNode; key?: string }) => (
  <li className="flex items-start gap-3 text-sm leading-6 text-slate-700">
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
      <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
    <span>{children}</span>
  </li>
);

const BrandMark = () => (
  <div className="flex items-center gap-3">
    <span className="relative flex h-11 w-11 items-center justify-center rounded-[1.1rem] bg-slate-950 text-white shadow-lg shadow-slate-950/15">
      <Dog aria-hidden="true" className="h-6 w-6" />
      <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-[#f4f1e8] bg-amber-400" />
    </span>
    <span>
      <strong className="block text-base font-black tracking-tight text-slate-950">ePet 班級冒險</strong>
      <span className="block text-[0.68rem] font-bold uppercase tracking-[0.2em] text-teal-800">Teacher Studio</span>
    </span>
  </div>
);

const ClassroomPreview = () => (
  <div className="relative mt-10 max-w-md">
    <div className="absolute -inset-5 -z-10 rotate-2 rounded-[2.5rem] bg-teal-200/35 blur-2xl" />
    <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-teal-800">今日班級動態</p>
          <p className="mt-1 text-lg font-black text-slate-950">星光探索隊</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
          <Trophy aria-hidden="true" className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        {[
          { label: '參與任務', value: '28', tone: 'bg-teal-50 text-teal-900' },
          { label: '成長積分', value: '+146', tone: 'bg-amber-50 text-amber-900' },
          { label: '需要關注', value: '3', tone: 'bg-rose-50 text-rose-900' },
        ].map((item) => (
          <div key={item.label} className={`rounded-2xl px-3 py-3 ${item.tone}`}>
            <strong className="block text-lg font-black tracking-tight">{item.value}</strong>
            <span className="mt-0.5 block text-[0.68rem] font-bold leading-4 opacity-75">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-900 text-white">
          <BarChart3 aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-xs font-black text-slate-700">
            <span>本週學習任務</span>
            <span>82%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-[82%] rounded-full bg-teal-700" />
          </div>
        </div>
      </div>
    </div>

    <div className="absolute -bottom-5 -right-4 hidden items-center gap-2 rounded-2xl border border-white bg-slate-950 px-4 py-3 text-xs font-bold text-white shadow-xl sm:flex">
      <Sparkles aria-hidden="true" className="h-4 w-4 text-amber-300" />
      每個進步都值得被看見
    </div>
  </div>
);

export const AuthScreen = () => {
  const {
    claimableLegacyWorkspace,
    authenticationEnabled,
    registrationEnabled,
    botProtectionEnabled,
    turnstileSiteKey,
    status,
    login,
    register,
    forgotPassword,
    resetPassword,
    acceptInvitation,
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
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const pageCopy = {
    login: {
      kicker: '歡迎回到班級基地',
      title: '回來把今天的成長記下來',
      description: '登入後繼續查看班級任務、學習趨勢與每位學生的成長紀錄。',
      submit: '登入並繼續帶班',
      benefits: [
        '回到班級、學生與寵物的最新進度',
        '安全存取學習分析與導師紀錄',
      ],
    },
    register: {
      kicker: '建立你的導師工作室',
      title: '把每一份努力，變成看得見的成長',
      description: '建立專屬工作空間，從班級經營、學習分析到遊戲化獎勵，一次開始。',
      submit: '建立帳號，開始帶班',
      benefits: [
        '註冊後立即建立你的第一個班級工作空間',
        '成績趨勢、弱項與導師評語集中保存',
        '不會自動啟用付費方案或扣款',
      ],
    },
    forgot: {
      kicker: '帳號協助',
      title: '找回你的導師帳號',
      description: '輸入註冊信箱，我們會寄送重設密碼的說明。',
      submit: '寄送重設說明',
      benefits: ['基於帳號安全，我們不會顯示信箱是否已註冊'],
    },
    reset: {
      kicker: '保護你的帳號',
      title: '設定一組新的安全密碼',
      description: '請使用至少 12 個字元，建議採用容易記住、難以猜測的長句。',
      submit: '更新密碼',
      benefits: ['更新後，其他裝置可能需要重新登入'],
    },
    invite: {
      kicker: '工作區邀請',
      title: '加入你的教學團隊',
      description: '設定顯示名稱與安全密碼後，即可依管理員配置的角色和班級範圍加入工作區。若已有帳號，請輸入原密碼。',
      submit: '接受邀請並加入',
      benefits: ['邀請連結只能使用一次，並會在期限後失效'],
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
    if (initialLocation.mode === 'invite') replaceAuthRoute('invite');
  }, [initialLocation.mode]);

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
    setTurnstileToken('');
    setTurnstileNonce((current) => current + 1);
    if (nextMode !== 'reset' && nextMode !== 'invite') setResetToken('');
    replaceAuthRoute(nextMode);
  };

  const validate = () => {
    const errors: FieldErrors = {};
    const normalizedEmail = email.trim();

    if (
      (mode === 'register' && displayName.trim().length < 2) ||
      (mode === 'invite' && displayName.trim().length === 1)
    ) {
      errors.displayName = '請輸入至少 2 個字的顯示名稱。';
    }

    if (mode !== 'reset' && mode !== 'invite' && !EMAIL_PATTERN.test(normalizedEmail)) {
      errors.email = '請輸入有效的電子信箱。';
    }

    if (mode === 'login' && !password) {
      errors.password = '請輸入密碼。';
    }

    if (mode === 'register' || mode === 'reset' || mode === 'invite') {
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
    if (
      !authenticationEnabled &&
      (mode === 'login' || mode === 'register' || mode === 'forgot')
    ) {
      setSubmitError('帳號安全驗證服務暫時無法使用，請稍後再試。');
      return;
    }
    if (mode === 'register' && !registrationEnabled) {
      setSubmitError('目前暫停建立新帳號，請向學校管理者索取開通資訊。');
      return;
    }
    if (!validate()) return;
    if ((mode === 'reset' || mode === 'invite') && !resetToken) {
      setSubmitError(mode === 'reset'
        ? '重設連結不完整，請重新申請。'
        : '邀請連結不完整，請聯絡工作區管理員。');
      return;
    }
    const requiresBotChallenge =
      botProtectionEnabled &&
      (mode === 'login' || mode === 'register' || mode === 'forgot');
    if (requiresBotChallenge && !turnstileToken) {
      setSubmitError('請先完成安全驗證。');
      return;
    }

    setPending(true);
    try {
      if (mode === 'login') {
        await login({ email, password, turnstileToken });
      } else if (mode === 'register') {
        await register({
          displayName,
          email,
          password,
          claimLegacyWorkspace,
          turnstileToken,
        });
      } else if (mode === 'forgot') {
        await forgotPassword(email, turnstileToken);
        setForgotComplete(true);
      } else if (mode === 'reset') {
        await resetPassword(resetToken, password);
        setResetComplete(true);
        setResetToken('');
        replaceAuthRoute('login');
      } else {
        await acceptInvitation(resetToken, displayName, password);
        setResetToken('');
      }
    } catch (error) {
      setSubmitError(authErrorMessage(error, mode));
    } finally {
      setPending(false);
      if (requiresBotChallenge) {
        setTurnstileToken('');
        setTurnstileNonce((current) => current + 1);
      }
    }
  };

  if (status === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f1e8] px-4" aria-busy="true" aria-label="正在確認登入狀態">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm" role="status">
          <LoaderCircle aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  const completed = forgotComplete || resetComplete;
  const isRegister = mode === 'register';
  const isInvite = mode === 'invite';
  const isLogin = mode === 'login';

  return (
    <main className="auth-page relative min-h-screen overflow-hidden bg-[#f4f1e8] text-slate-950">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-24 h-80 w-80 rounded-full bg-teal-300/25 blur-3xl" />
        <div className="absolute -right-24 top-0 h-96 w-96 rounded-full bg-amber-200/45 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-white/70 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-[92rem] lg:grid-cols-[0.82fr_1.18fr]">
        <aside className="hidden min-h-screen flex-col justify-between border-r border-slate-900/[0.08] px-10 py-10 lg:flex xl:px-16 xl:py-12">
          <BrandMark />

          <div className="my-auto py-14">
            <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-teal-900">
              <PawPrint aria-hidden="true" className="h-4 w-4" />
              教師的班級成長工作室
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-black leading-[1.12] tracking-[-0.045em] text-slate-950 xl:text-5xl">
              讓班級經營像一場
              <span className="relative isolate mx-2 inline-block text-teal-800">
                共同冒險
                <span className="absolute -bottom-1 left-0 -z-10 h-2 w-full -rotate-1 rounded-full bg-amber-300/75" />
              </span>
            </h2>
            <p className="mt-5 max-w-lg text-base leading-8 text-slate-600">
              把成績、任務、獎勵與導師觀察放進同一個工作空間，
              讓每位學生的進步都有跡可循。
            </p>
            <ClassroomPreview />
          </div>

          <p className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-teal-800" />
            帳號、角色與班級資料依權限分開保護
          </p>
        </aside>

        <section className="flex min-h-screen items-center justify-center px-4 py-6 sm:px-8 sm:py-10 lg:px-12 xl:px-20" aria-labelledby="auth-heading">
          <div className={`auth-reveal w-full ${isRegister || isInvite ? 'max-w-3xl' : 'max-w-xl'}`}>
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <BrandMark />
              <span className="hidden items-center gap-2 rounded-full bg-white/80 px-3 py-2 text-xs font-bold text-slate-600 shadow-sm sm:flex">
                <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 text-teal-800" />
                安全連線
              </span>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-white/90 bg-white/[0.92] shadow-[0_28px_90px_rgba(15,23,42,0.13)] backdrop-blur-xl">
              <div className="px-6 pb-2 pt-7 sm:px-10 sm:pt-10">
                {mode !== 'login' && !completed && (
                  <button
                    type="button"
                    onClick={() => changeMode('login')}
                    disabled={pending}
                    className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:border-teal-300 hover:text-teal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50"
                  >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    返回登入
                  </button>
                )}

                <p className="text-xs font-black uppercase tracking-[0.18em] text-teal-800">
                  {completed ? '操作完成' : pageCopy.kicker}
                </p>
                <h1
                  id="auth-heading"
                  ref={headingRef}
                  tabIndex={-1}
                  className={`mt-3 font-black leading-[1.12] tracking-[-0.045em] text-slate-950 outline-none ${isRegister || isInvite ? 'text-3xl sm:text-4xl' : 'text-3xl sm:text-[2.65rem]'}`}
                >
                  {forgotComplete
                    ? '請查看你的信箱'
                    : resetComplete
                      ? '密碼已更新'
                      : pageCopy.title}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                  {forgotComplete
                    ? '若此信箱已註冊，我們會寄送重設密碼的說明。為了保護帳號，我們不會顯示信箱是否存在。'
                    : resetComplete
                      ? '你現在可以使用新密碼登入。'
                      : pageCopy.description}
                </p>
              </div>

              {completed ? (
                <div className="px-6 pb-8 pt-6 sm:px-10 sm:pb-10">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-5 text-sm leading-7 text-emerald-950" role="status" aria-live="polite">
                    {forgotComplete
                      ? '郵件可能需要幾分鐘才會送達，也請檢查垃圾郵件匣。'
                      : '為了保護帳號，其他裝置可能需要重新登入。'}
                  </div>
                  <button
                    type="button"
                    onClick={() => changeMode('login')}
                    className="mt-5 inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-base font-black text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-teal-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
                  >
                    返回登入
                    <ArrowRight aria-hidden="true" className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="px-6 pb-8 pt-6 sm:px-10 sm:pb-10" noValidate aria-busy={pending}>
                  {submitError && (
                    <div
                      ref={errorRef}
                      tabIndex={-1}
                      role="alert"
                      className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold leading-6 text-rose-900 outline-none focus:ring-2 focus:ring-rose-400"
                    >
                      {submitError}
                    </div>
                  )}

                  {isRegister && !registrationEnabled && (
                    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950" role="status">
                      <LockKeyhole aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                      <span>
                        <strong className="block font-black">目前採學校邀請制</strong>
                        註冊介面已開放查看，但此環境尚未允許建立新帳號。
                      </span>
                    </div>
                  )}

                  <div className={isRegister || isInvite ? 'grid gap-x-4 gap-y-5 sm:grid-cols-2' : 'space-y-5'}>
                    {(isRegister || isInvite) && (
                      <div>
                        <label htmlFor="auth-display-name" className="block text-sm font-black tracking-wide text-slate-800">
                          {isInvite ? '姓名（已有帳號可留白）' : '姓名'}
                        </label>
                        <div className="relative">
                          <UserRound aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400" />
                          <input
                            id="auth-display-name"
                            type="text"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            autoComplete="name"
                            placeholder="請輸入你的姓名"
                            minLength={2}
                            maxLength={80}
                            required={isRegister}
                            aria-invalid={Boolean(fieldErrors.displayName)}
                            aria-describedby={fieldErrors.displayName ? 'auth-display-name-error' : undefined}
                            className={`${fieldClassName(Boolean(fieldErrors.displayName))} pl-11`}
                          />
                        </div>
                        {fieldErrors.displayName && <p id="auth-display-name-error" className="mt-1.5 text-sm font-bold text-rose-700">{fieldErrors.displayName}</p>}
                      </div>
                    )}

                    {mode !== 'reset' && mode !== 'invite' && (
                      <div>
                        <label htmlFor="auth-email" className="block text-sm font-black tracking-wide text-slate-800">Email</label>
                        <div className="relative">
                          <Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400" />
                          <input
                            id="auth-email"
                            type="email"
                            inputMode="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="email"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="teacher@school.edu.tw"
                            maxLength={254}
                            required
                            aria-invalid={Boolean(fieldErrors.email)}
                            aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                            className={`${fieldClassName(Boolean(fieldErrors.email))} pl-11`}
                          />
                        </div>
                        {fieldErrors.email && <p id="auth-email-error" className="mt-1.5 text-sm font-bold text-rose-700">{fieldErrors.email}</p>}
                      </div>
                    )}

                    {(isLogin || isRegister || mode === 'reset' || isInvite) && (
                      <PasswordField
                        id="auth-password"
                        label="密碼"
                        value={password}
                        onChange={setPassword}
                        autoComplete={isLogin ? 'current-password' : 'new-password'}
                        placeholder={isLogin ? '輸入你的密碼' : `至少 ${PASSWORD_MIN_LENGTH} 個字元`}
                        error={fieldErrors.password}
                        hint={isRegister || mode === 'reset' || isInvite ? `請使用至少 ${PASSWORD_MIN_LENGTH} 個字元；可以使用容易記住的長句。` : undefined}
                      />
                    )}

                    {(isRegister || mode === 'reset' || isInvite) && (
                      <PasswordField
                        id="auth-password-confirmation"
                        label="確認密碼"
                        value={passwordConfirmation}
                        onChange={setPasswordConfirmation}
                        autoComplete="new-password"
                        placeholder="再次輸入密碼"
                        error={fieldErrors.passwordConfirmation}
                      />
                    )}
                  </div>

                  {isRegister && claimableLegacyWorkspace && (
                    <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-950">
                      <input
                        type="checkbox"
                        checked={claimLegacyWorkspace}
                        onChange={(event) => setClaimLegacyWorkspace(event.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-teal-300 text-teal-700 focus:ring-teal-700"
                      />
                      <span>
                        <strong className="block font-black">認領這台裝置原有的雲端班級</strong>
                        只有確認舊班級屬於你時才勾選。未勾選時會建立新的空白工作區，不會讀取或移轉舊學生資料。
                      </span>
                    </label>
                  )}

                  {isLogin && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => changeMode('forgot')}
                        disabled={pending}
                        className="min-h-11 rounded-xl px-2 text-sm font-black text-teal-800 transition hover:text-teal-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50"
                      >
                        忘記密碼？
                      </button>
                    </div>
                  )}

                  {botProtectionEnabled &&
                    turnstileSiteKey &&
                    (mode === 'login' || mode === 'register' || mode === 'forgot') && (
                      <div key={`${mode}-${turnstileNonce}`}>
                        <TurnstileWidget
                          siteKey={turnstileSiteKey}
                          action={mode}
                          onToken={setTurnstileToken}
                        />
                      </div>
                    )}

                  <button
                    type="submit"
                    disabled={
                      pending ||
                      (isRegister && !registrationEnabled) ||
                      (botProtectionEnabled &&
                        (mode === 'login' || mode === 'register' || mode === 'forgot') &&
                        !turnstileToken)
                    }
                    className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-slate-950 px-5 py-3 text-base font-black text-white shadow-lg shadow-slate-950/15 transition duration-200 hover:-translate-y-0.5 hover:bg-teal-950 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none"
                  >
                    {pending && <LoaderCircle aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />}
                    {pending ? '處理中…' : pageCopy.submit}
                    {!pending && <ArrowRight aria-hidden="true" className="h-5 w-5" />}
                  </button>

                  <p className="mt-4 text-center text-xs leading-5 text-slate-500">
                    {isRegister
                      ? '建立帳號代表你同意妥善保管帳號，並遵守學校的學生資料管理規範。'
                      : '系統不會透過電子郵件向你索取密碼。'}
                  </p>

                  <div className="my-6 h-px bg-slate-200" />

                  <ul className={`grid gap-3 ${isRegister ? 'sm:grid-cols-2' : ''}`}>
                    {pageCopy.benefits.map((benefit) => <BenefitItem key={benefit}>{benefit}</BenefitItem>)}
                  </ul>

                  {(isLogin || isRegister) && (
                    <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">
                      {isLogin ? '還沒有帳號？' : '已經有帳號了？'}{' '}
                      <button
                        type="button"
                        onClick={() => changeMode(isLogin ? 'register' : 'login')}
                        disabled={pending}
                        className="min-h-10 rounded-lg px-1 font-black text-teal-800 underline decoration-teal-300 decoration-2 underline-offset-4 transition hover:text-teal-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50"
                      >
                        {isLogin ? '立即註冊' : '立即登入'}
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[0.68rem] font-bold leading-4 text-slate-500 sm:text-xs lg:hidden">
              <span className="flex flex-col items-center gap-1.5"><UsersRound aria-hidden="true" className="h-4 w-4 text-teal-800" />班級管理</span>
              <span className="flex flex-col items-center gap-1.5"><BookOpenCheck aria-hidden="true" className="h-4 w-4 text-teal-800" />學習分析</span>
              <span className="flex flex-col items-center gap-1.5"><HeartPulse aria-hidden="true" className="h-4 w-4 text-teal-800" />成長陪伴</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};
