import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// src/rvn3_parser.js only needs N3.Parser, but a CommonJS `require('n3')` keeps all of n3
// (writer, store, streams) in the bundle. Routing it through a module that re-exports just
// `Parser` from n3's public entry lets esbuild drop the rest. If n3 ever stops exporting
// `Parser`, the build fails with "No matching export". Node (src/store.js) is not affected.
const n3ParserOnly = {
  name: 'n3-parser-only',
  setup(build) {
    build.onResolve({ filter: /^n3$/ }, (args) => {
      if (args.namespace === 'n3-parser-only' || !args.importer.endsWith('rvn3_parser.js')) {
        return undefined;
      }
      return { path: 'n3', namespace: 'n3-parser-only', pluginData: { resolveDir: args.resolveDir } };
    });
    build.onLoad({ filter: /.*/, namespace: 'n3-parser-only' }, (args) => ({
      contents: 'export { Parser } from "n3";',
      loader: 'js',
      resolveDir: args.pluginData.resolveDir
    }));
  }
};

const common = {
  bundle: true,
  plugins: [n3ParserOnly],
  platform: 'browser',
  target: 'es2022',
  alias: {
    'http': resolve(__dirname, 'stubs/empty.js'),
    'https': resolve(__dirname, 'stubs/empty.js'),
    'url': resolve(__dirname, 'stubs/empty.js'),
    'fs': resolve(__dirname, 'stubs/empty.js'),
    'path': resolve(__dirname, 'stubs/empty.js')
  }
};

// Script-tag build: defines the global `rdfstore`
await esbuild.build({
  ...common,
  entryPoints: ['src/store.js'],
  format: 'iife',
  globalName: 'rdfstore',
  outfile: 'dist/rdfstore.js'
});

// ES module build for bundlers: named exports Store, create, connect (plus default)
await esbuild.build({
  ...common,
  entryPoints: ['src/index.mjs'],
  format: 'esm',
  outfile: 'dist/rdfstore.mjs'
});

console.log('✅ Bundles created successfully');
