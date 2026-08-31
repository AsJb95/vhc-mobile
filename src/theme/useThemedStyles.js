import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

// Turns a module-scope `makeStyles(theme)` factory into a live stylesheet that
// re-computes whenever the active theme changes. `factory` is expected to be a
// stable reference (defined once at module scope), so the memo only really keys
// on `theme`.
export function useThemedStyles(factory) {
  const { theme } = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
