import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { accessFor } from '../lib/management';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null);
  // false until the profile for the current user has been resolved once, so the
  // app can wait for the role before rendering role-gated UI (no flash of "no
  // Admin tab" / read-only for an admin right after sign-in). NOT reset on a
  // token refresh — only when the user actually changes.
  const [profileResolved, setProfileResolved] = useState(false);
  const profileReqRef = useRef(0);
  const loadedForUserRef = useRef(undefined);
  // Common VHC auth: which clinic (if any) this login is staffed to. Platform
  // admins have no staff row and therefore no clinic — that is expected.
  const [clinic, setClinic] = useState(null); // { id, name } | null

  const loadProfile = useCallback(async (userId) => {
    const reqId = profileReqRef.current + 1;
    profileReqRef.current = reqId;
    const isStale = () => profileReqRef.current !== reqId;

    if (!userId) {
      loadedForUserRef.current = null;
      setProfile(null);
      setProfileResolved(true);
      return;
    }

    // Only show the "resolving role" state on a genuine user change, not on a
    // token refresh for the same user.
    if (loadedForUserRef.current !== userId) setProfileResolved(false);

    // maybeSingle: a missing profile row is a valid "no role yet" state, not an
    // error. Retry once on a transient network error so a flaky connection at
    // sign-in doesn't strand the user with role=null until an app restart.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', userId).maybeSingle();
      if (isStale()) return; // a newer session/profile load superseded this one
      if (!error) {
        loadedForUserRef.current = userId;
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
    let mountedUserId; // track the current user so we skip no-op reloads

    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      mountedUserId = uid;
      setSession(data.session);
      loadProfile(uid);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const uid = newSession?.user?.id ?? null;
      setSession(newSession);
      // Skip reloading the profile on TOKEN_REFRESHED / same-user events.
      if (uid !== mountedUserId) {
        mountedUserId = uid;
        loadProfile(uid);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // Resolve the clinic for the current login (staff -> clinics). Isolated from
  // the profile-resolution machinery above so it can't affect roleResolved.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setClinic(null); return undefined; }
    let alive = true;
    supabase
      .from('staff')
      .select('clinic_id, clinics(name)')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setClinic(data ? { id: data.clinic_id, name: data.clinics?.name || 'Clinic' } : null);
      });
    return () => { alive = false; };
  }, [session?.user?.id]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, []);

  const signOut = useCallback(async () => {
    // supabase-js clears the local session and emits SIGNED_OUT before the
    // network call, and onAuthStateChange (above) then drops us back to the
    // Login screen with no restart. Swallow a network failure on the server
    // revoke so it can't surface as an unhandled rejection or block the UI.
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('signOut network error (local session already cleared):', e);
    }
  }, []);

  const role = profile?.role || null;
  // Personal ("platform") VHC Admin — the real privilege boundary. The shared
  // clinic login can be app-level role='admin' without being a platform admin,
  // so admin-only screens (backups, config) must gate on this, not on role.
  const isPlatformAdmin = profile?.is_platform_admin === true;

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    profile,
    role,
    isPlatformAdmin,
    clinicId: clinic?.id || null,
    clinicName: clinic?.name || null,
    ...accessFor(profile),
    loading: session === undefined,
    // signed in but role not yet known — callers gate role-dependent UI on this
    roleResolved: session != null && profileResolved,
    signIn,
    signOut,
  }), [session, profile, role, isPlatformAdmin, clinic, profileResolved, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
