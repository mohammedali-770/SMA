/**
 * Auth/session state, backed by Supabase Auth (GoTrue) with the RN AsyncStorage
 * session store configured in lib/supabase.ts. Mirrors the web app's model:
 * GoTrue is the authentication source; `profiles.role` is the authorization
 * source. The customer app expects role === 'customer' but does not gate on it
 * (staff simply have no admin UI here).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { auth } from '../services/api';
import { mapProfile } from '../lib/mappers';
import type { UserProfile } from '../types/models';

type AuthStatus = 'loading' | 'signed_in' | 'signed_out';

interface AuthValue {
  status: AuthStatus;
  userId: string | null;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const mounted = useRef(true);

  const loadProfile = useCallback(async () => {
    try {
      const row = await auth.myProfile();
      if (mounted.current) setProfile(row ? mapProfile(row) : null);
    } catch {
      if (mounted.current) setProfile(null);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;

    // Initial session check (reads the persisted AsyncStorage session).
    (async () => {
      try {
        const session = await auth.getSession();
        if (!mounted.current) return;
        if (session?.user?.id) {
          setUserId(session.user.id);
          await loadProfile();
          if (mounted.current) setStatus('signed_in');
        } else {
          setStatus('signed_out');
        }
      } catch {
        if (mounted.current) setStatus('signed_out');
      }
    })();

    // React to sign-in / sign-out / token refresh.
    const { data: sub } = auth.onChange(async (uid) => {
      if (!mounted.current) return;
      setUserId(uid);
      if (uid) {
        await loadProfile();
        if (mounted.current) setStatus('signed_in');
      } else {
        setProfile(null);
        setStatus('signed_out');
      }
    });

    return () => {
      mounted.current = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    // onChange fires and clears state, but set eagerly for snappy UI.
    setProfile(null);
    setUserId(null);
    setStatus('signed_out');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, userId, profile, refreshProfile: loadProfile, signOut }),
    [status, userId, profile, loadProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
