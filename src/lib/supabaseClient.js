import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Publishable/anon key — safe to ship in the built app. Real access control
// is enforced by Postgres Row-Level Security (see C:\New VHC\supabase\migrations).
//
// These come from EXPO_PUBLIC_* env vars, which are inlined into the JS bundle
// at build time. For local dev they're read from .env; for EAS builds they're
// set in eas.json -> build.<profile>.env (or the EAS project's env vars).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loud and actionable if the build was produced without Supabase config,
// instead of the cryptic "Invalid URL" deep inside supabase-js. This runs at
// module import (before any UI), so a misconfigured build is obvious immediately.
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl && 'EXPO_PUBLIC_SUPABASE_URL',
    !supabaseAnonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(', ');
  throw new Error(
    `Supabase is not configured: missing ${missing}. ` +
    'Set these in .env for local dev, or in eas.json build.<profile>.env / the EAS project env for builds.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
