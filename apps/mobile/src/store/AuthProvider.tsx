/**
 * Auth/session state, backed by Supabase Auth (GoTrue) with the RN AsyncStorage
 * session store configured in lib/supabase.ts. Mirrors the web app's model:
 * GoTrue is the authentication source; `profiles.role` is the authorization
 * source. The customer app expects role === 'customer' but does not gate on it
 * (staff simply have no admin UI here).
 *
 * Profile stability: the last known profile is held in a cache governed by the
 * pure policy in profileCache.ts — a transient fetch failure keeps the cached
 * profile (no silent Guest / 0-points downgrade) while a bounded backoff
 * retries in the background; sign-out and user switches clear it immediately.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { auth } from '../services/api';
import { mapProfile } from '../lib/mappers';
import { applyProfileEvent, EMPTY_PROFILE_CACHE, profileRetryDelayMs, type ProfileCache, type ProfileEvent } from './profileCache';
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

  // Source of truth for the cached profile; `profile` state mirrors it for
  // rendering. All transitions go through the pure reducer so the
  // keep-on-failure / clear-on-switch rules stay unit-tested.
  const cacheRef = useRef<ProfileCache>(EMPTY_PROFILE_CACHE);
  // Epoch counter: bumped on every new fetch cycle and on sign-out so an
  // in-flight fetch or scheduled retry from a previous cycle cancels itself.
  const fetchSeq = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const dispatch = useCallback((event: ProfileEvent) => {
    const next = applyProfileEvent(cacheRef.current, event);
    if (next !== cacheRef.current) {
      cacheRef.current = next;
      setProfile(next.profile);
    }
  }, []);

  /**
   * One fetch cycle: the first attempt is awaited (callers like the startup
   * gate keep their existing timing); on transient failure the cached profile
   * stays and bounded retries continue in the background via setTimeout.
   * Starting a new cycle (or signing out) cancels the previous one.
   */
  const loadProfile = useCallback(async () => {
    clearRetry();
    const seq = ++fetchSeq.current;
    const attempt = async (n: number): Promise<void> => {
      const uid = cacheRef.current.userId;
      if (!mounted.current || seq !== fetchSeq.current || !uid) return;
      try {
        const row = await auth.myProfile();
        if (!mounted.current || seq !== fetchSeq.current) return;
        // `null` here is authoritative (no profile row) — the reducer applies it.
        dispatch({ type: 'fetch_success', userId: uid, profile: row ? mapProfile(row) : null });
      } catch {
        if (!mounted.current || seq !== fetchSeq.current) return;
        // Transient failure: reducer keeps the last known profile.
        dispatch({ type: 'fetch_failure', userId: uid });
        const delay = profileRetryDelayMs(n);
        if (delay !== null) {
          retryTimer.current = setTimeout(() => { void attempt(n + 1); }, delay);
        }
        // Schedule exhausted → stop; the next auth event or manual
        // refreshProfile() starts a fresh cycle.
      }
    };
    await attempt(1);
  }, [clearRetry, dispatch]);

  useEffect(() => {
    mounted.current = true;

    // Initial session check (reads the persisted AsyncStorage session).
    (async () => {
      try {
        const session = await auth.getSession();
        if (!mounted.current) return;
        if (session?.user?.id) {
          setUserId(session.user.id);
          dispatch({ type: 'auth_user', userId: session.user.id });
          await loadProfile();
          if (mounted.current) setStatus('signed_in');
        } else {
          setStatus('signed_out');
        }
      } catch {
        if (mounted.current) setStatus('signed_out');
      }
    })();

    // React to sign-in / sign-out / token refresh. IMPORTANT: this callback must
    // stay SYNCHRONOUS and must not call another Supabase (GoTrue) method inline.
    // GoTrue holds an internal lock while the handler runs; loadProfile() issues
    // another Supabase request, so awaiting it here can deadlock auth on native.
    // Flip the cheap synchronous state now and defer the profile fetch to a
    // macrotask that runs after the lock is released.
    const { data: sub } = auth.onChange((uid) => {
      if (!mounted.current) return;
      setUserId(uid);
      if (uid) {
        setStatus('signed_in');
        // Refetch only when the user actually changed or nothing is cached.
        // TOKEN_REFRESHED for the same user keeps the cached profile and does
        // NOT issue a duplicate Supabase call.
        const prev = cacheRef.current;
        const needsFetch = prev.userId !== uid || !prev.profile;
        dispatch({ type: 'auth_user', userId: uid });
        if (needsFetch) setTimeout(() => { if (mounted.current) void loadProfile(); }, 0);
      } else {
        fetchSeq.current += 1; // cancel any in-flight fetch/retry cycle
        clearRetry();
        dispatch({ type: 'signed_out' });
        setStatus('signed_out');
      }
    });

    return () => {
      mounted.current = false;
      clearRetry();
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, dispatch, clearRetry]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    // onChange fires and clears state, but set eagerly for snappy UI.
    fetchSeq.current += 1; // cancel any in-flight fetch/retry cycle
    clearRetry();
    dispatch({ type: 'signed_out' });
    setUserId(null);
    setStatus('signed_out');
  }, [clearRetry, dispatch]);

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
