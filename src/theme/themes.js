// Light / Dark palettes for the app-wide theme switch.
//
// Both objects MUST expose the exact same set of keys. The first ten keys are the
// original `colors` contract (see src/lib/format.js) so screens can swap
// `colors.x` -> `theme.x` with no other change. The remaining keys were added for
// the Pixel-inspired polish pass and are safe to use anywhere.
//
// DARK is intentionally identical to the historical static palette, so dark mode
// looks exactly like the app always has.

export const DARK = {
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

  // polish tokens
  card: '#131d33',       // a hair lighter than panel for layered surfaces
  chip: '#0f1a30',       // inactive chip / input fill
  onAccent: '#ffffff',   // text/icon on an accent-filled surface
  scrim: 'rgba(3,7,18,0.66)',
  shadow: '#000000',
};

export const LIGHT = {
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

  // polish tokens
  card: '#ffffff',
  chip: '#eef1f6',
  onAccent: '#ffffff',
  scrim: 'rgba(15,23,42,0.32)',
  shadow: '#1a1c1e',
};

export const THEMES = { light: LIGHT, dark: DARK };
