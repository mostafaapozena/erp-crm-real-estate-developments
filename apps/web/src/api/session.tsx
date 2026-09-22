import type { Permission, ScopeAssignment, SecurityAccount } from '@alola/contracts';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiRequest, setAccessToken, setSessionEndedListener } from './client';

/**
 * Who is signed in, and what they may see.
 *
 * `permissions` is used **only** to decide what to render. Every one of them is enforced again on the
 * server, inside the query (ADR-0006); hiding a menu item is a courtesy to the person using the
 * product, never a control. A test in the E2E suite calls a hidden endpoint directly and asserts the
 * API refuses it, which is what makes that claim checkable rather than a comment.
 */
export interface Session {
  account: SecurityAccount;
  permissions: Permission[];
  scope: ScopeAssignment;
  sessionId?: string;
}

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'mfaRequired';

interface SessionContextValue {
  status: SessionStatus;
  session: Session | undefined;
  /** Present while a second factor is outstanding. Never stored anywhere but memory. */
  mfaChallengeToken: string | undefined;
  signIn: (loginIdentifier: string, password: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface LoginResponse {
  status: 'authenticated' | 'mfaRequired';
  accessToken?: string;
  challengeToken?: string;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<Session | undefined>();
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | undefined>();

  const loadSession = useCallback(async () => {
    const loaded = await apiRequest<Session>('/api/v1/me');
    setSession(loaded);
    setMfaChallengeToken(undefined);
    setStatus('signedIn');
  }, []);

  /**
   * On first paint, try to restore the session from the refresh cookie.
   *
   * A failure here is the ordinary case — nobody is signed in — so it resolves to `signedOut` rather
   * than surfacing an error. Only a real sign-in attempt reports why it failed.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const refreshed = await apiRequest<{ accessToken: string }>('/api/v1/auth/refresh', {
          method: 'POST',
          skipRefresh: true,
        });
        setAccessToken(refreshed.accessToken);
        if (!cancelled) await loadSession();
      } catch {
        if (!cancelled) {
          setAccessToken(undefined);
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // The client tells us when a refresh failed mid-flight, so the shell can show the sign-in screen
  // rather than a page of empty tables.
  useEffect(() => {
    setSessionEndedListener(() => {
      setSession(undefined);
      setStatus('signedOut');
    });
    return () => setSessionEndedListener(undefined);
  }, []);

  const signIn = useCallback(
    async (loginIdentifier: string, password: string) => {
      const result = await apiRequest<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: { loginIdentifier, password },
        skipRefresh: true,
      });
      if (result.status === 'mfaRequired') {
        // A privileged account cannot sign in without its second factor (SEC-017).
        setMfaChallengeToken(result.challengeToken);
        setStatus('mfaRequired');
        return;
      }
      setAccessToken(result.accessToken);
      await loadSession();
    },
    [loadSession],
  );

  const verifyMfa = useCallback(
    async (code: string) => {
      if (!mfaChallengeToken) throw new ApiError(400, 'VALIDATION_FAILED');
      const result = await apiRequest<LoginResponse>('/api/v1/auth/mfa/verify', {
        method: 'POST',
        body: { challengeToken: mfaChallengeToken, code },
        skipRefresh: true,
      });
      setAccessToken(result.accessToken);
      await loadSession();
    },
    [loadSession, mfaChallengeToken],
  );

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      // Whatever the server said, this browser forgets the token.
      setAccessToken(undefined);
      setSession(undefined);
      setMfaChallengeToken(undefined);
      setStatus('signedOut');
    }
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const held = new Set(session?.permissions ?? []);
    return {
      status,
      session,
      mfaChallengeToken,
      signIn,
      verifyMfa,
      signOut,
      can: (permission) => held.has(permission),
      canAny: (permissions) => permissions.some((permission) => held.has(permission)),
    };
  }, [mfaChallengeToken, session, signIn, signOut, status, verifyMfa]);

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
