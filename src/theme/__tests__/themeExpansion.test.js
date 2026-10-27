import {
  THEMES,
  MODERN_DARK,
  MODERN_LIGHT,
  MIDNIGHT_AMOLED,
  CLASSIC_LIGHT,
  HIGH_CONTRAST,
  DARK,
  LIGHT,
} from '../themes';
import { THEME_LIST } from '../../context/ThemeContext';

describe('Theme System Expansion', () => {
  const REQUIRED_TOKENS = [
    'key',
    'name',
    'description',
    'isDark',
    'bg',
    'panel',
    'panelBorder',
    'text',
    'muted',
    'accent',
    'success',
    'warning',
    'danger',
    'purple',
    'card',
    'chip',
    'onAccent',
    'scrim',
    'shadow',
    'contrastBorder',
  ];

  it('exposes all 5 semantic theme palettes in THEMES', () => {
    expect(THEMES.modern_dark).toBeDefined();
    expect(THEMES.modern_light).toBeDefined();
    expect(THEMES.midnight_amoled).toBeDefined();
    expect(THEMES.classic_light).toBeDefined();
    expect(THEMES.high_contrast).toBeDefined();
  });

  it('maintains backwards-compatible DARK and LIGHT aliases', () => {
    expect(DARK).toEqual(MODERN_DARK);
    expect(LIGHT).toEqual(MODERN_LIGHT);
    expect(THEMES.dark).toBeDefined();
    expect(THEMES.light).toBeDefined();
  });

  it('contains all required tokens in every theme palette', () => {
    const palettes = [
      MODERN_DARK,
      MODERN_LIGHT,
      MIDNIGHT_AMOLED,
      CLASSIC_LIGHT,
      HIGH_CONTRAST,
    ];

    palettes.forEach((palette) => {
      REQUIRED_TOKENS.forEach((token) => {
        expect(palette[token]).toBeDefined();
      });
      expect(typeof palette.isDark).toBe('boolean');
    });
  });

  it('verifies Midnight AMOLED uses pure black background (#000000)', () => {
    expect(MIDNIGHT_AMOLED.bg).toBe('#000000');
    expect(MIDNIGHT_AMOLED.isDark).toBe(true);
  });

  it('verifies High Contrast uses high-contrast tokens', () => {
    expect(HIGH_CONTRAST.bg).toBe('#000000');
    expect(HIGH_CONTRAST.text).toBe('#ffffff');
    expect(HIGH_CONTRAST.panelBorder).toBe('#ffffff');
  });

  it('verifies THEME_LIST includes all 6 user options with categories', () => {
    expect(THEME_LIST).toHaveLength(6);
    const keys = THEME_LIST.map((t) => t.key);
    expect(keys).toEqual([
      'system',
      'modern_dark',
      'modern_light',
      'midnight_amoled',
      'classic_light',
      'high_contrast',
    ]);
  });
});
