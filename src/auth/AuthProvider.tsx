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
  requestPasswordReset,
  resetPassword as resetPasswordAccount,
  setActiveWorkspaceId,
  type AuthSession,
} from '../services/backendApi';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = LoginInput & {
  displayName: string;
  claimLegacyWorkspace?: boolean;
};

type AuthContextValue = {
  claimableLegacyWorkspace: boolean;
  registrationEnabled: boolean;
  invitationEnabled: boolean;
  status: AuthStatus;
  session: AuthSession | null;
  refreshSession: () => Promise<AuthSession | null>;
  login: (input: LoginInput) => Promise<AuthSession>;
  register: (input: RegisterInput) => Promise<AuthSession>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
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
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [invitationEnabled, setInvitationEnabled] = useState(false);

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

  const forgotPassword = useCallback(async (email: string) => {
    await requestPasswordReset({
      email: email.trim().toLocaleLowerCase(),
    });
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
    registrationEnabled,
    invitationEnabled,
    status,
    session,
    refreshSession,
    login,
    register,
    logout,
    forgotPassword,
    resetPassword,
    acceptInvitation,
    createWorkspace,
    selectWorkspace,
    invalidateSession,
  }), [
    status,
    registrationEnabled,
    invitationEnabled,
    session,
    refreshSession,
    login,
    register,
    logout,
    forgotPassword,
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
