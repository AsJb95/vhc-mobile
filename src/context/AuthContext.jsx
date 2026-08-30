import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null);
  // false until the profile for the current session has been resolved once, so
  // the app can wait for the role before rendering role-gated UI (no flash of
  // "no Admin tab" / read-only for an admin right after sign-in).
  const [profileResolved, setProfileResolved] = useState(false);
  const profileReqRef = useRef(0);

  const loadProfile = useCallback(async (userId) => {
    const reqId = profileReqRef.current + 1;
    profileReqRef.current = reqId;
    const isStale = () => profileReqRef.current !== reqId;

    if (!userId) {
      if (!isStale()) {
        setProfile(null);
        setProfileResolved(true);
      }
      return;
    }

    setProfileResolved(false);
    // maybeSingle: a missing profile row is a valid "no role yet" state, not an
    // error. Retry once on a transient network error so a flaky connection at
    // sign-in doesn't strand the user with role=null until an app restart.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', userId).maybeSingle();
      if (isStale()) return; // a newer session/profile load superseded this one
      if (!error) {
        setProfile(data || null);
        setProfileResolved(true);
        return;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
      } else {
        // Give up after one retry but keep any profile we already had, rather
        // than downgrading a signed-in user to role=null on a blip.
        console.error('Failed to load profile:', error);
        setProfileResolved(true);
      }
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session?.user?.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadProfile(newSession?.user?.id);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const role = profile?.role || null;

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    profile,
    role,
    canWriteWarehouse: role === 'admin' || role === 'warehouse_manager',
    canWritePharmacy: role === 'admin' || role === 'pharmacist',
    loading: session === undefined,
    // signed in but role not yet known — callers gate role-dependent UI on this
    roleResolved: session != null && profileResolved,
    signIn,
    signOut,
  }), [session, profile, role, profileResolved, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
