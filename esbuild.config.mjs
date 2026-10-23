import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const common = {
  bundle: true,
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
