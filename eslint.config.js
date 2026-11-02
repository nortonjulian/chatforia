import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';

import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier'; // disables rules that conflict with Prettier

export default defineConfig([
  // Ignore build artifacts, vendor, and uploads
  globalIgnores([
    'dist',
    'build',
    'coverage',
    'node_modules',
    'client/dist',
    'server/uploads',
    '**/.vite',
    '*.min.js',
  ]),

  // Base for all JS/JSX
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      reactHooks.configs['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
      importPlugin.flatConfigs.recommended,
      reactRefresh.configs.vite,
      prettierConfig,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        node: { extensions: ['.js', '.jsx'] },
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Server-side overrides
  {
    files: ['server/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off', // logs are often intentional server-side
    },
  },

  // Client-side overrides
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Config files run in Node
  {
    files: ['**/*.config.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests (Jest + Node)
  {
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.test.{js,jsx}', '**/*.spec.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
]);
