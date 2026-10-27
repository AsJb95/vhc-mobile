import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MODERN_DARK, THEMES } from '../theme/themes';

export const THEME_LIST = [
  {
    key: 'system',
    name: 'System Default',
    category: 'Dynamic',
    description: 'Auto-adapts to Android light/dark system setting',
    icon: 'phone-portrait-outline',
    previewColors: ['#0a0f1e', '#111a2e', '#3b82f6', '#f4f6f9'],
  },
  {
    key: 'modern_dark',
    name: 'Modern Dark',
    category: 'Night',
    description: 'Deep navy slate palette with comfortable contrast',
    icon: 'moon-outline',
    previewColors: ['#0a0f1e', '#111a2e', '#3b82f6', '#10b981'],
  },
  {
    key: 'modern_light',
    name: 'Modern Light',
    category: 'Day',
    description: 'Crisp cool-grey palette with clear daytime readability',
    icon: 'sunny-outline',
    previewColors: ['#f4f6f9', '#ffffff', '#2563eb', '#0f9d58'],
  },
  {
    key: 'midnight_amoled',
    name: 'Midnight AMOLED',
    category: 'OLED',
    description: 'True black 0-pixel luminance for max battery savings',
    icon: 'contrast-outline',
    previewColors: ['#000000', '#0a0a0a', '#38bdf8', '#10b981'],
  },
  {
    key: 'classic_light',
    name: 'Classic Light',
    category: 'Clinical',
    description: 'Traditional clinical healthcare palette with reassuring teal',
    icon: 'medkit-outline',
    previewColors: ['#eef5f3', '#ffffff', '#00796b', '#059669'],
  },
  {
    key: 'high_contrast',
    name: 'High Contrast',
    category: 'Accessibility',
    description: 'Stark black/white contrast with bold cyan/yellow accents',
    icon: 'eye-outline',
    previewColors: ['#000000', '#ffffff', '#00ffff', '#ffff00'],
  },
];

const STORAGE_KEY = 'vhc.mobile.theme';
const DEFAULT_SCHEME = 'modern_dark';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemColor = useColorScheme();
  const [scheme, setSchemeState] = useState(DEFAULT_SCHEME);
  const [hydrated, setHydrated] = useState(false);

  // Load saved preference on startup
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!alive || !saved) return;
        if (
          saved === 'system' ||
          saved === 'modern_dark' ||
          saved === 'modern_light' ||
          saved === 'midnight_amoled' ||
          saved === 'classic_light' ||
          saved === 'high_contrast' ||
          saved === 'dark' ||
          saved === 'light'
        ) {
          setSchemeState(saved);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next) => {
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const setScheme = useCallback((next) => {
    setSchemeState(next);
    persist(next);
  }, [persist]);

  const toggle = useCallback(() => {
    setSchemeState((prev) => {
      const next = prev === 'modern_light' || prev === 'light' ? 'modern_dark' : 'modern_light';
      persist(next);
      return next;
    });
  }, [persist]);

  const resolvedScheme = useMemo(() => {
    if (scheme === 'system') {
      return systemColor === 'light' ? 'modern_light' : 'modern_dark';
    }
    if (scheme === 'dark') return 'modern_dark';
    if (scheme === 'light') return 'modern_light';
    return scheme;
  }, [scheme, systemColor]);

  const theme = useMemo(() => {
    return THEMES[resolvedScheme] || MODERN_DARK;
  }, [resolvedScheme]);

  const value = useMemo(() => ({
    scheme,
    resolvedScheme,
    theme,
    isDark: theme.isDark,
    hydrated,
    themeList: THEME_LIST,
    setScheme,
    toggle,
  }), [scheme, resolvedScheme, theme, hydrated, setScheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Safe fallback when used outside a provider
const FALLBACK = {
  scheme: 'modern_dark',
  resolvedScheme: 'modern_dark',
  theme: MODERN_DARK,
  isDark: true,
  hydrated: true,
  themeList: THEME_LIST,
  setScheme: () => {},
  toggle: () => {},
};

export function useTheme() {
  return useContext(ThemeContext) || FALLBACK;
}
