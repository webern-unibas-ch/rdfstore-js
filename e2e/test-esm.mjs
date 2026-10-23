// ES module test for rdfstore-js
// Imports the package the way its consumers do and runs real queries:
//   1. Node.js: import('rdfstore') resolves to the CommonJS source (src/store.js)
//   2. Bundlers: the `browser` export condition resolves to the ES module bundle (dist/rdfstore.mjs)
//   3. The ES module bundle itself runs the same queries
// Steps 2 and 3 need the bundle: run `yarn build` first.

import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { relative } from 'path';
import { fileURLToPath } from 'url';

console.log('🔧 E2E Test 4/4: ES Modules');
console.log('================================\n');

function fail(message) {
  console.log(`   ❌ ${message}`);
  process.exit(1);
}

function check(condition, message) {
  if (!condition) fail(message);
  console.log(`   ✅ ${message}`);
}

// A module whose `create` never calls back must fail the test, not hang it
const watchdog = setTimeout(() => fail('Timed out after 15s (store did not call back)'), 15000);

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = fileURLToPath(new URL('../dist/rdfstore.mjs', import.meta.url));

// Package-relative path of a resolved file:// URL, for the log
const display = (url) => (url.startsWith('file:') ? relative(rootDir, fileURLToPath(url)).replace(/\\/g, '/') : url);

const turtle = `@prefix ex: <http://example.org/> .
ex:alice ex:knows ex:bob .
ex:bob ex:knows ex:carol .
ex:alice ex:name "Alice" .`;

// Turns the store's callback API into a promise, for this test only
function call(target, method, ...args) {
  return new Promise((resolve, reject) => {
    target[method](...args, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

async function runScenario(mod) {
  check(['create', 'Store', 'connect'].every((name) => typeof mod[name] === 'function'),
    'Named exports create, Store, connect');
  check(mod.default != null && typeof mod.default.create === 'function', 'Default export with create');

  const store = await call(mod, 'create');
  const count = await call(store, 'load', 'text/turtle', turtle);
  check(count === 3, `Loaded ${count} triples`);

  const rows = await call(store, 'execute',
    'SELECT ?s ?o WHERE { ?s <http://example.org/knows> ?o } ORDER BY ?s');
  const pairs = rows.map((row) => `${row.s.value} ${row.o.value}`);
  check(JSON.stringify(pairs) === JSON.stringify([
    'http://example.org/alice http://example.org/bob',
    'http://example.org/bob http://example.org/carol'
  ]), `SELECT returned ${rows.length} expected bindings`);

  const graph = await call(store, 'execute',
    'CONSTRUCT { ?o <http://example.org/knownBy> ?s } WHERE { ?s <http://example.org/knows> ?o }');
  const subjects = graph.toArray().map((triple) => triple.subject.nominalValue).sort();
  check(graph.length === 2 &&
    JSON.stringify(subjects) === JSON.stringify(['http://example.org/bob', 'http://example.org/carol']),
    `CONSTRUCT returned ${graph.length} expected triples`);

  store.close();
}

try {
  // Step 1: Node.js entry
  console.log('📦 Step 1: Node.js entry (import \'rdfstore\')');
  const nodeEntry = import.meta.resolve('rdfstore');
  check(nodeEntry.endsWith('/src/store.js'), `Resolves to ${display(nodeEntry)}`);
  await runScenario(await import('rdfstore'));
  console.log('');

  // Step 2: browser condition, as used by bundlers
  console.log('🧭 Step 2: Browser export condition');
  if (!existsSync(bundlePath)) {
    fail('dist/rdfstore.mjs is missing. Run "yarn build" first');
  }
  const resolved = spawnSync(process.execPath,
    ['-C', 'browser', '--input-type=module', '-e', "process.stdout.write(import.meta.resolve('rdfstore'))"],
    { cwd: rootDir, encoding: 'utf8' });
  check(resolved.status === 0 && resolved.stdout.endsWith('/dist/rdfstore.mjs'),
    `Resolves to ${display(resolved.stdout) || resolved.stderr.trim()}`);
  console.log('');

  // Step 3: the ES module bundle
  console.log('🔄 Step 3: ES module bundle (dist/rdfstore.mjs)');
  await runScenario(await import('../dist/rdfstore.mjs'));
} catch (error) {
  fail(`Unexpected error: ${error && error.message ? error.message : error}`);
}

clearTimeout(watchdog);
console.log('\n✅ ES module E2E test passed!\n');
