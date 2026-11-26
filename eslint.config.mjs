import globals from 'globals';

// Guards against undeclared names: ES module builds run in strict mode,
// where an implicit global throws instead of silently landing on `window`.
// And against redeclared `var`s, which share one function-scoped variable.
export default [
  {
    ignores: ['src/parser.js', 'src/perftest/']
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      // Unused parameters keep shared callback signatures readable; unused
      // catch bindings belong to the question of swallowed exceptions.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      // An intentionally empty block (a swallowed exception) says so in a comment.
      'no-empty': 'error'
    }
  }
];
