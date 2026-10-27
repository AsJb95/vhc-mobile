// Centralized Semantic Theme System for VHC Mobile
//
// All six themes expose the exact same token interface so every screen,
// card, modal, and component renders seamlessly across all themes.

export const MODERN_DARK = {
  key: 'modern_dark',
  name: 'Modern Dark',
  description: 'Deep navy slate palette with comfortable night contrast',
  isDark: true,
  bg: '#0a0f1e',
  panel: '#111a2e',
  panelBorder: '#1e293b',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  purple: '#a855f7',
  card: '#131d33',
  chip: '#0f1a30',
  onAccent: '#ffffff',
  scrim: 'rgba(3,7,18,0.66)',
  shadow: '#000000',
  contrastBorder: 'transparent',
};

export const MODERN_LIGHT = {
  key: 'modern_light',
  name: 'Modern Light',
  description: 'Crisp cool-grey palette with clear daytime readability',
  isDark: false,
  bg: '#f4f6f9',
  panel: '#ffffff',
  panelBorder: '#e3e7ee',
  text: '#1a1c1e',
  muted: '#5f6470',
  accent: '#2563eb',
  success: '#0f9d58',
  warning: '#d97706',
  danger: '#d93025',
  purple: '#8b3fd9',
  card: '#ffffff',
  chip: '#eef1f6',
  onAccent: '#ffffff',
  scrim: 'rgba(15,23,42,0.32)',
  shadow: '#1a1c1e',
  contrastBorder: 'transparent',
};

export const MIDNIGHT_AMOLED = {
  key: 'midnight_amoled',
  name: 'Midnight AMOLED',
  description: 'True black 0-pixel luminance for OLED battery savings',
  isDark: true,
  bg: '#000000',
  panel: '#000000',
  panelBorder: '#222222',
  text: '#ffffff',
  muted: '#888888',
  accent: '#38bdf8',
  success: '#10b981',
  warning: '#fbbf24',
  danger: '#f87171',
  purple: '#c084fc',
  card: '#0a0a0a',
  chip: '#141414',
  onAccent: '#000000',
  scrim: 'rgba(0,0,0,0.85)',
  shadow: '#000000',
  contrastBorder: '#27272a',
};

export const CLASSIC_LIGHT = {
  key: 'classic_light',
  name: 'Classic Light',
  description: 'Traditional clinical healthcare palette with reassuring teal tones',
  isDark: false,
  bg: '#eef5f3',
  panel: '#ffffff',
  panelBorder: '#ccdeda',
  text: '#0f2922',
  muted: '#4a6b63',
  accent: '#00796b',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  purple: '#7c3aed',
  card: '#ffffff',
  chip: '#e2eeeb',
  onAccent: '#ffffff',
  scrim: 'rgba(15,41,34,0.38)',
  shadow: '#0f2922',
  contrastBorder: 'transparent',
};

export const HIGH_CONTRAST = {
  key: 'high_contrast',
  name: 'High Contrast',
  description: 'Maximum WCAG AAA accessibility with bold stark borders',
  isDark: true,
  bg: '#000000',
  panel: '#000000',
  panelBorder: '#ffffff',
  text: '#ffffff',
  muted: '#e2e8f0',
  accent: '#00ffff',
  success: '#00ff66',
  warning: '#ffff00',
  danger: '#ff3333',
  purple: '#ff66ff',
  card: '#000000',
  chip: '#1a1a1a',
  onAccent: '#000000',
  scrim: 'rgba(0,0,0,0.92)',
  shadow: '#ffffff',
  contrastBorder: '#ffffff',
};

// Aliases for historical backwards compatibility
export const DARK = MODERN_DARK;
export const LIGHT = MODERN_LIGHT;

export const THEMES = {
  modern_dark: MODERN_DARK,
  modern_light: MODERN_LIGHT,
  midnight_amoled: MIDNIGHT_AMOLED,
  classic_light: CLASSIC_LIGHT,
  high_contrast: HIGH_CONTRAST,
  // Backward compatibility keys
  dark: MODERN_DARK,
  light: MODERN_LIGHT,
};
