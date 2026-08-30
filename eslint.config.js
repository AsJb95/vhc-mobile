// Flat config (ESLint 9). Expo's shared config brings in the React, React Hooks,
// and React Native rule sets.
//
// eslint-config-expo 57 pulls react-hooks v6, whose experimental React-Compiler
// model rules (refs-during-render, impure-call-during-render, set-state-in-effect)
// fire on idiomatic pre-Compiler patterns used throughout this app (Animated.Value
// in a ref, loading flags in effects). We keep the two rules that catch real bugs
// — rules-of-hooks (the conditional-hook crash class) and exhaustive-deps — and
// disable the Compiler-model rules rather than rewrite working components.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
      'android/**',
      'ios/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Experimental React-Compiler-model rules — off (see note above).
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/use-memo': 'off',

      // Stylistic, no correctness value in RN text nodes.
      'react/no-unescaped-entities': 'off',

      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' },
    },
  },
  {
    files: ['jest.setup.js', '*.config.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', process: 'readonly', __dirname: 'readonly', jest: 'readonly' },
    },
  },
];
