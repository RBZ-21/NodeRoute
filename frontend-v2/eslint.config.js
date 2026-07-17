import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', '*.config.js', '*.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Surface dead code. Allow leading-underscore as an explicit "intentionally unused" opt-out.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` is widespread in the existing API-boundary types — surface as a warning
      // to chip away at over time rather than blocking the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty `catch {}` is an intentional fail-open pattern throughout the codebase.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // List endpoints must go through fetchListWithAuth/fetchPortalList, which
      // validate the array contract at the boundary. `fetchWithAuth<T[]>` has no
      // such guard, so a malformed 200 would reach `.map()` and crash.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name=/^(fetchWithAuth|fetchWithPortalAuth)$/] > TSTypeParameterInstantiation > TSArrayType",
          message: 'Use fetchListWithAuth/fetchPortalList for list endpoints — it validates the array contract at the boundary.',
        },
        {
          selector: "CallExpression[callee.name=/^(fetchWithAuth|fetchWithPortalAuth)$/] > TSTypeParameterInstantiation > TSTypeReference[typeName.name='Array']",
          message: 'Use fetchListWithAuth/fetchPortalList for list endpoints — it validates the array contract at the boundary.',
        },
      ],
    },
  },
  // Test files: relax rules that are noisy in test setups.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/setupTests.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
