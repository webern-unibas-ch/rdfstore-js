// ES module entry for the browser bundle (dist/rdfstore.mjs).
// esbuild exposes a CommonJS entry only as a default export, so the API is re-exported by name here.
import rdfstore from './store.js';

export const { Store, create, connect, promises } = rdfstore;
export default rdfstore;
