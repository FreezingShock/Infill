import globals from 'globals';

// Correctness only: the modules share a lot of names, so an unresolved or unused import is the bug to catch.
export default [
  { ignores: ['dist/', 'node_modules/', 'tools/'] },
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-import-assign': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'warn' },
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'vite.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-undef': 'error' },
  },
];
