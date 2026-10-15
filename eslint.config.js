/**
 * ESLint, flat config.
 *
 * The rules that earn their place here are the React hooks ones: this codebase routes
 * per-frame data through refs and mutable singletons on purpose, and the moment a hook
 * dependency goes stale the avatar starts lagging or the camera is acquired twice. Type
 * errors do not catch that; `exhaustive-deps` does.
 *
 * Everything else is stock typescript-eslint recommended, with two rules relaxed for
 * reasons stated inline.
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `tools/_`-prefixed files are throwaway probes: they are kept in the tree because
  // they document how a rig question was answered, but they are not maintained code.
  { ignores: ['dist', 'node_modules', 'public', 'tools/out', 'tools/_*.mjs'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat['recommended-latest']],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, __DEV_MODE__: 'readonly' },
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Underscore-prefixed arguments are intentional (unused parameters in signatures
      // that exist for shape-compatibility), which TS already enforces.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // `any` appears only at genuine interop boundaries; flag it but do not fail the
      // build on it, because the alternative is a cast that hides more.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Non-null assertions show up where a browser API guarantees a value the types
      // cannot express. They are reviewed by hand rather than banned.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Build scripts are Node ESM, not browser code.
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
)
