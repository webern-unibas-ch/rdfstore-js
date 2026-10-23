import globals from 'globals';

// Only guards against undeclared names: ES module builds run in strict mode,
// where an implicit global throws instead of silently landing on `window`.
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
      'no-undef': 'error'
    }
  }
];
