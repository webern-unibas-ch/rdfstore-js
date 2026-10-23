# E2E Tests

End-to-end tests for rdfstore-js that validate the entire system working together.

## Tests

### `test-basic.js`
Basic integration test covering:
- Store creation
- Data loading (Turtle format)
- Simple SPARQL query execution
- Result validation

**Run:** `yarn e2e:basic` or `node e2e/test-basic.js`

### `test-comprehensive.js`  
Comprehensive integration test covering:
- Store creation and data loading
- SELECT queries with filtering
- ASK queries (boolean results) 
- CONSTRUCT queries (graph building)
- Multiple data types and relationships
- Full SPARQL feature validation

**Run:** `yarn e2e:comprehensive` or `node e2e/test-comprehensive.js`

### `test-esm.mjs`
ES module test covering:
- Node.js entry: `import('rdfstore')` resolves to `src/store.js` and provides named exports
- Browser export condition (used by bundlers) resolves to `dist/rdfstore.mjs`
- ES module bundle: named and default exports
- In both entries: Turtle loading, a SELECT and a CONSTRUCT query with checked results
- A 15 s watchdog, so a store that never calls back fails the test instead of hanging

Needs the ES module bundle: run `yarn build` first.

**Run:** `yarn e2e:esm` or `node e2e/test-esm.mjs`

## Usage

From the project root directory:

```bash
# Run individual tests
yarn e2e:basic         # Basic integration test
yarn e2e:comprehensive # Full system validation  
yarn e2e:esm           # ESM compatibility test

# Run all e2e tests
yarn e2e

# Or run directly with Node.js
node e2e/test-basic.js
node e2e/test-comprehensive.js
node e2e/test-esm.mjs
```

## Test Overview

- **Basic**: Quick smoke test for essential functionality
- **Comprehensive**: Full SPARQL feature validation
- **ESM**: Node.js and bundler entry points, ES module bundle

These tests validate that all components work together correctly and serve as integration validation for the entire rdfstore-js system. The ESM test checks that Node.js and browser bundlers each get a working entry point.
