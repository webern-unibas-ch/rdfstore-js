// Type check for rdfstore.d.ts from a CommonJS consumer; compiled by `yarn types`, never run.
import rdfstore = require('rdfstore');

async function main(): Promise<void> {
    const store: rdfstore.Store = await rdfstore.promises.create();
    const rows = await store.promises.execute<rdfstore.SelectResult>('SELECT * { ?s ?p ?o }');
    console.log(rows.length);
    rdfstore.create(function(err, other) {
        if (!err) other.close();
    });
}

export = main;
