import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  hasClaimableLegacyWorkspace,
  acceptWorkspaceInvitation,
  createWorkspace as createWorkspaceAccount,
  loadBackendPublicConfig,
  loadAuthSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  resendEmailVerification,
  requestPasswordReset,
  resetPassword as resetPasswordAccount,
  setActiveWorkspaceId,
  type AuthSession,
  verifyEmail as verifyEmailAccount,
} from '../services/backendApi';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export type LoginInput = {
  email: string;
  password: string;
  turnstileToken?: string;
};

export type RegisterInput = LoginInput & {
  displayName: string;
  claimLegacyWorkspace?: boolean;
};

type AuthContextValue = {
  claimableLegacyWorkspace: boolean;
  authenticationEnabled: boolean;
  registrationEnabled: boolean;
  invitationEnabled: boolean;
  emailVerificationEnabled: boolean;
  botProtectionEnabled: boolean;
  turnstileSiteKey: string;
  status: AuthStatus;
  session: AuthSession | null;
  refreshSession: () => Promise<AuthSession | null>;
  login: (input: LoginInput) => Promise<AuthSession>;
  register: (input: RegisterInput) => Promise<AuthSession>;
  logout: () => Promise<void>;
  forgotPassword: (email: string, turnstileToken?: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  acceptInvitation: (
    token: string,
    displayName: string,
    password: string,
  ) => Promise<AuthSession>;
  createWorkspace: (name: string) => Promise<AuthSession>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  invalidateSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
  children: ReactNode;
  onSessionCleared?: () => void;
};

export const AuthProvider = ({
  children,
  onSessionCleared,
}: AuthProviderProps) => {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authenticationEnabled, setAuthenticationEnabled] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [invitationEnabled, setInvitationEnabled] = useState(false);
  const [emailVerificationEnabled, setEmailVerificationEnabled] =
    useState(false);
  const [botProtectionEnabled, setBotProtectionEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');

  const invalidateSession = useCallback(() => {
    onSessionCleared?.();
    setSession(null);
    setStatus('unauthenticated');
  }, [onSessionCleared]);

  const applySession = useCallback((nextSession: AuthSession | null) => {
    if (!nextSession) {
      invalidateSession();
      return;
    }
    setSession(nextSession);
    setStatus('authenticated');
  }, [invalidateSession]);

  const refreshSession = useCallback(async () => {
    setStatus('checking');
    try {
      const nextSession = await loadAuthSession();
      applySession(nextSession);
      return nextSession;
    } catch (error) {
      applySession(null);
      throw error;
    }
  }, [applySession]);

  useEffect(() => {
    let disposed = false;

    const bootstrap = async () => {
      const [sessionResult, configResult] = await Promise.allSettled([
        loadAuthSession(),
        loadBackendPublicConfig(),
      ]);
      if (disposed) return;
      setAuthenticationEnabled(
        configResult.status === 'fulfilled'
          ? configResult.value.authenticationEnabled !== false
          : false,
      );
      setRegistrationEnabled(
        configResult.status === 'fulfilled'
          ? configResult.value.registrationEnabled === true
          : false,
      );
      setInvitationEnabled(
        configResult.status === 'fulfilled'
          ? configResult.value.invitationEnabled === true
          : false,
      );
      setEmailVerificationEnabled(
        configResult.status === 'fulfilled'
          ? configResult.value.emailVerificationEnabled === true
          : false,
      );
      setBotProtectionEnabled(
        configResult.status === 'fulfilled'
          ? configResult.value.botProtectionEnabled === true
          : false,
      );
      setTurnstileSiteKey(
        configResult.status === 'fulfilled' &&
        typeof configResult.value.turnstileSiteKey === 'string'
          ? configResult.value.turnstileSiteKey
          : '',
      );
      applySession(
        sessionResult.status === 'fulfilled' ? sessionResult.value : null,
      );
    };

    void bootstrap();
    return () => {
      disposed = true;
    };
  }, [applySession]);

  const login = useCallback(async (input: LoginInput) => {
    const nextSession = await loginAccount({
      email: input.email.trim().toLocaleLowerCase(),
      password: input.password,
      turnstileToken: input.turnstileToken,
    });
    applySession(nextSession);
    return nextSession;
  }, [applySession]);

  const register = useCallback(async (input: RegisterInput) => {
    const nextSession = await registerAccount({
      displayName: input.displayName.trim(),
      email: input.email.trim().toLocaleLowerCase(),
      password: input.password,
      claimLegacyWorkspace: input.claimLegacyWorkspace,
      turnstileToken: input.turnstileToken,
    });
    applySession(nextSession);
    return nextSession;
  }, [applySession]);

  const logout = useCallback(async () => {
    // Clear account-scoped client state before the network request so backend
    // synchronization unmounts immediately and cannot save after sign-out.
    invalidateSession();
    await logoutAccount();
  }, [invalidateSession]);

  const forgotPassword = useCallback(async (
    email: string,
    turnstileToken?: string,
  ) => {
    await requestPasswordReset({
      email: email.trim().toLocaleLowerCase(),
      turnstileToken,
    });
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    await verifyEmailAccount(token);
    const nextSession = await loadAuthSession();
    applySession(nextSession);
  }, [applySession]);

  const resendVerification = useCallback(async () => {
    await resendEmailVerification();
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    await resetPasswordAccount({ token, password });
    invalidateSession();
  }, [invalidateSession]);

  const acceptInvitation = useCallback(async (
    token: string,
    displayName: string,
    password: string,
  ) => {
    const nextSession = await acceptWorkspaceInvitation({
      token,
      displayName: displayName.trim(),
      password,
    });
    applySession(nextSession);
    return nextSession;
  }, [applySession]);

  const createWorkspace = useCallback(async (name: string) => {
    const nextSession = await createWorkspaceAccount(name.trim());
    applySession(nextSession);
    return nextSession;
  }, [applySession]);

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    const selectedWorkspace = session?.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    );
    if (!selectedWorkspace) {
      throw new Error('WORKSPACE_NOT_AVAILABLE');
    }

    await setActiveWorkspaceId(workspaceId);
    setSession((currentSession) => {
      if (!currentSession) return currentSession;
      return {
        ...currentSession,
        activeWorkspaceId: workspaceId,
        user: {
          ...currentSession.user,
          role: selectedWorkspace.role,
        },
      };
    });
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    claimableLegacyWorkspace: hasClaimableLegacyWorkspace,
    authenticationEnabled,
    registrationEnabled,
    invitationEnabled,
    emailVerificationEnabled,
    botProtectionEnabled,
    turnstileSiteKey,
    status,
    session,
    refreshSession,
    login,
    register,
    logout,
    forgotPassword,
    verifyEmail,
    resendVerification,
    resetPassword,
    acceptInvitation,
    createWorkspace,
    selectWorkspace,
    invalidateSession,
  }), [
    status,
    authenticationEnabled,
    registrationEnabled,
    invitationEnabled,
    emailVerificationEnabled,
    botProtectionEnabled,
    turnstileSiteKey,
    session,
    refreshSession,
    login,
    register,
    logout,
    forgotPassword,
    verifyEmail,
    resendVerification,
    resetPassword,
    acceptInvitation,
    createWorkspace,
    selectWorkspace,
    invalidateSession,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
