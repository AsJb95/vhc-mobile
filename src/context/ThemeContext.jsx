import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DARK, LIGHT } from '../theme/themes';

// Persisted user preference for the Light / Dark switch. The app has always been
// dark, so that stays the default until the user chooses otherwise.
const STORAGE_KEY = 'vhc.mobile.theme';
const DEFAULT_SCHEME = 'dark';

const ThemeContext = createContext(null);

const schemeToTheme = (scheme) => (scheme === 'light' ? LIGHT : DARK);

export function ThemeProvider({ children }) {
  const [scheme, setSchemeState] = useState(DEFAULT_SCHEME);
  const [hydrated, setHydrated] = useState(false);

  // Load the saved preference once on startup.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!alive) return;
        if (saved === 'light' || saved === 'dark') setSchemeState(saved);
      })
      .catch(() => {})
      .finally(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, []);

  const persist = useCallback((next) => {
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const setScheme = useCallback((next) => {
    const value = next === 'light' ? 'light' : 'dark';
    setSchemeState(value);
    persist(value);
  }, [persist]);

  const toggle = useCallback(() => {
    setSchemeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      persist(next);
      return next;
    });
  }, [persist]);

  const value = useMemo(() => ({
    scheme,
    theme: schemeToTheme(scheme),
    isDark: scheme !== 'light',
    hydrated,
    setScheme,
    toggle,
  }), [scheme, hydrated, setScheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Safe fallback (dark) when used outside a provider, so nothing can crash.
const FALLBACK = {
  scheme: 'dark',
  theme: DARK,
  isDark: true,
  hydrated: true,
  setScheme: () => {},
  toggle: () => {},
};

export function useTheme() {
  return useContext(ThemeContext) || FALLBACK;
}
