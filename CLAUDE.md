# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Fork of Antonio Garrote's `rdfstore-js` (maintained by musicEnfanthen): an RDF graph store in plain CommonJS JavaScript that supports SPARQL 1.0 and most of SPARQL 1.1 Update. It runs in Node (`^22.22.3 || >= 24.15.0`) and in the browser (esbuild bundle). The package manager is Yarn 4 via corepack (`packageManager: yarn@4.16.0`).

## Commands

```bash
yarn install --immutable     # install (as CI does)
yarn unit                    # regenerate parser, then run all Jasmine specs
yarn specs                   # run Jasmine specs only (skips parser regeneration)
yarn e2e                     # all e2e scripts in e2e/ (basic, comprehensive, readme, esm)
yarn test                    # parse-grammar + specs + e2e
yarn build                   # parse-grammar + esbuild bundle -> dist/rdfstore.js + dist/rdfstore_min.js
yarn parse-grammar           # regenerate src/parser.js from grammar/sparql_query.grammar
yarn lint                    # ESLint (no-undef only) over src/, without parser.js and perftest/
```

Run a single spec file, or filter by spec name:

```bash
yarn jasmine spec/store_spec.js
yarn jasmine spec/query_engine_spec.js --filter="some describe/it text"
```

A single e2e script: `yarn e2e:basic`, `yarn e2e:comprehensive`, `yarn e2e:readme`, `yarn e2e:esm`. `e2e:esm` imports `dist/rdfstore_min.js`, so run `yarn build` first if `src/` changed.

CI ([.github/workflows/main.yml](.github/workflows/main.yml)) runs `yarn lint`, `yarn unit`, `yarn e2e`, then `yarn build` on Node 22.22, 24.16 and 26.x.

## Generated / committed artifacts

- [src/parser.js](src/parser.js) (~16k lines) is **generated** by [Peggy](https://peggyjs.org/) from [grammar/sparql_query.grammar](grammar/sparql_query.grammar) via [grammar/parse_grammar.js](grammar/parse_grammar.js). Never edit it by hand: change the grammar and run `yarn parse-grammar`. It is committed. `yarn unit`, `yarn test` and `yarn build` regenerate it on every run.
- `dist/rdfstore.js` and `dist/rdfstore_min.js` are build outputs and are also committed, but **only rebuilt when cutting a release**. If you run `yarn build` to verify a change, discard the output with `git checkout -- dist`. The package `exports` map points `require` to `src/store.js` and `import` to `dist/rdfstore_min.js`, so ESM consumers (and `e2e:esm`) only see changes after a rebuild.
- [esbuild.config.mjs](esbuild.config.mjs) bundles `src/store.js` as an IIFE with global `rdfstore`. It aliases Node built-ins (`http`, `https`, `url`, `fs`, `path`) to [stubs/empty.js](stubs/empty.js).

## Architecture

Everything is callback-based (`callback(err, result)`) and asynchronous. There are no Promises in the core.

**Every `src/` module is strict mode** (`"use strict";` at the top), so the CommonJS entry behaves like the ES module bundle. Declare every name with `var`: an implicit global throws in strict mode. [eslint.config.mjs](eslint.config.mjs) enables only `no-undef` to catch this statically, including on paths the specs never run. It cannot see `this` inside plain callbacks, which is `undefined` in strict mode: capture `var that = this;` in the method instead.

**Layering** (from the public API down to storage):

1. **[src/store.js](src/store.js)**: the public `Store` facade (`execute`, `load`, `insert`/`delete`, `graph`/`node`, events and subscriptions, `registerCustomFunction`, prefixes). The constructor picks either the in-memory backend (`Lexicon` + `QuadBackend`) or the IndexedDB backend (`PersistentLexicon` + `PersistentQuadBackend`) when `persistent: true` is set. It then builds a `QueryEngine`. Persistence works only where a native IndexedDB exists (browser window or worker). There is no Node.js backend, and persistence is not covered by specs.
2. **[src/query_engine.js](src/query_engine.js)**: the main executor. `execute()` normalizes the query string, parses it via `AbstractQueryTree`, then sends it to `executeQuery` (SELECT/CONSTRUCT/ASK) or `executeUpdate` (INSERT/DELETE/LOAD/CLEAR/...). Update queries are wrapped in `callbacksBackend.start/end/cancelGraphModification` so that events fire.
3. **[src/abstract_query_tree.js](src/abstract_query_tree.js)**: wraps the PEG parser and rewrites the syntax tree into SPARQL algebra (BGP, JOIN, LEFT_JOIN, UNION, FILTER, ...). It raises `NonSupportedSparqlFeatureError` for unsupported features.
4. **[src/query_plan.js](src/query_plan.js)**: BGP join planning and execution against the backend. **[src/query_filters.js](src/query_filters.js)**: FILTER expressions, built-in functions, aggregates and custom functions.
5. **[src/lexicon.js](src/lexicon.js)**: maps URIs, literals and blank nodes to numeric OIDs, so that quads are stored as IDs. `QueryEngine.normalizeQuad`/`denormalizeBindings` translate between terms and OIDs.
6. **[src/quad_backend.js](src/quad_backend.js)** and **[src/quad_index.js](src/quad_index.js)**: six B-tree indices (SPOG, GP, OGS, POG, GSP, OS) over [src/btree.js](src/btree.js). The planner chooses an index by which components are bound.

**Other modules:**
- [src/graph_callbacks.js](src/graph_callbacks.js): the events API (node/query observers and subscriptions).
- [src/rdf_loader.js](src/rdf_loader.js), [src/network_transport.js](src/network_transport.js), [src/rvn3_parser.js](src/rvn3_parser.js) (N3.js) and [src/jsonld_parser.js](src/jsonld_parser.js) (jsonld): load data by media type, either from a string, a remote URL or a local file.
- [src/rdf_model.js](src/rdf_model.js): the RDF Interfaces API (`store.rdf`, graphs, nodes).

**[src/utils.js](src/utils.js) is the core's own async/collection library.** Source files import it under the names `_` and `async` (`var async = require('./utils')`), not the real `lodash`/`async` packages. Those two packages are devDependencies used only by the specs. `eachSeries` and `whilst` iterate through a throttled `nextTick` that yields only every `yieldFrequency` calls (default 100), to avoid stack overflows. B-tree traversals in [src/quad_index.js](src/quad_index.js) and [src/btree.js](src/btree.js) depend on this. Without it, a full scan over ~100k triples threw `RangeError: Maximum call stack size exceeded` ([spec/large_dataset_spec.js](spec/large_dataset_spec.js) guards against that). New loops over large data should use these helpers, not direct synchronous recursion.

## Tests

- Jasmine config: [spec/support/jasmine.json](spec/support/jasmine.json). It sets `random: false`, but Jasmine 7 still runs the specs in random order (the output prints the seed). Pass `--random=false` or `--seed=<n>` to reproduce an order-dependent failure.
- [spec/w3c_spec.js](spec/w3c_spec.js) runs the W3C SPARQL 1.1 syntax suites (`syntax-query`, `syntax-update-1`, `syntax-update-2` in `spec/w3c/`) via [spec/w3c_suite_helper.js](spec/w3c_suite_helper.js). The helper supports only syntax tests. Use them to check parser and grammar changes. For SPARQL evaluation cases, take individual tests from [w3c/rdf-tests](https://github.com/w3c/rdf-tests) and turn them into regular specs.
- Specs import the real `async` package (v3), whose `whilst` expects an async test function: `function(cb){ cb(null, cond); }`. A test that returns a boolean never calls back, and the spec times out.

## Repo conventions

- Git-flow branching: day-to-day work goes on `develop`, releases go through `release/vX.Y.Z-alpha.N` branches merged to `main` and tagged. PRs target `develop`.
- Commit messages follow Conventional Commits (`build(deps): ...`, `test(e2e): ...`, `fix: ...`).
- The maintainer reviews and commits each step personally. Do not commit; stop after each step and suggest a commit message.
- Line endings are LF everywhere ([.gitattributes](.gitattributes) `* text=auto eol=lf`, [.editorconfig](.editorconfig)).
