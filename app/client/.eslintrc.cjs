/**
 * ESLint configuration.
 *
 * package.json already carried a "lint" script, but no ESLint or config was ever installed, so
 * `npm run lint` failed with "'eslint' is not recognized". This restores it.
 *
 * The rule set is deliberately small: correctness rules that catch real defects (unused bindings,
 * missing hook dependencies, invalid JSX) rather than stylistic ones, which would flood a
 * long-standing codebase with noise on the first run.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',      // the new JSX transform: React need not be in scope
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  rules: {
    // Unused values are errors; unused ARGUMENTS and intentionally discarded destructured
    // properties are not. The DSR entry page deliberately drops workDate with a rest spread.
    'no-unused-vars': ['error', {
      args: 'none',
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_',
    }],
    // Prop validation is not used in this codebase; components document props in JSDoc instead.
    'react/prop-types': 'off',
    'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
  },
};
