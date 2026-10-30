// Type check for rdfstore.d.ts from an ES module consumer; compiled by `yarn types`, never run.
import rdfstore, { create, promises, Store } from 'rdfstore';
import type { Bindings, Graph, LiteralValue, SelectResult, Triple } from 'rdfstore';

async function usePromises(): Promise<void> {
    const store: Store = await promises.create({ treeOrder: 15 });
    const count: number = await store.promises.load('text/turtle', '<http://a> <http://p> "1" .');
    await store.promises.load('text/turtle', '<a> <http://p> "1" .', { graph: 'http://g', baseURI: 'http://base/' });
    await store.promises.load('remote', 'http://example.org/data.ttl', 'http://g');

    const rows = await store.promises.execute<SelectResult>('SELECT * { ?s ?p ?o }');
    rows.forEach((row: Bindings) => {
        const o = row['o'];
        if (o != null && o.token === 'literal') {
            const literal: LiteralValue = o;
            console.log(literal.value, literal.type, literal.lang);
        }
    });

    const graph = await store.promises.execute<Graph>('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
    graph.forEach((triple: Triple) => console.log(triple.subject.nominalValue, triple.object.toNT()));
    const asked = await store.promises.execute('ASK { ?s ?p ?o }', ['http://g'], []);
    if (typeof asked === 'boolean') console.log(asked);

    const triples = store.rdf.createGraph([
        store.rdf.createTriple(store.rdf.createNamedNode('http://x'), store.rdf.createNamedNode('http://p'), store.rdf.createLiteral('3'))
    ]);
    const inserted: true = await store.promises.insert(triples, 'http://g');
    await store.promises.delete(triples);
    await store.promises.clear();
    const node: Graph = await store.promises.node('http://x', 'http://g');
    const graphs = await store.promises.registeredGraphs();
    console.log(count, inserted, node.length, graphs.map((g) => g.valueOf()));
    await store.promises.close();
}

function useCallbacks(): void {
    create(function(err, store) {
        if (err) return;
        store.execute<SelectResult>('SELECT * { ?s ?p ?o }', function(err, rows) {
            if (!err) console.log(rows.length);
        });
        store.load('text/turtle', '<http://a> <http://p> "1" .', function(err, count) {
            if (!err) console.log(count + 1);
        });
        store.subscribe('http://a', null, null, null, function(event, triples) {
            console.log(event === 'added', triples.length);
        });
        store.close();
    });
    rdfstore.create({ treeOrder: 4 }, function(err, store) { if (!err) store.close(); });
    new rdfstore.Store(function(err, store) { if (!err) console.log(Store.VERSION, store.rdf.resolve('rdf:type')); });
}

// @ts-expect-error a graph URI alone is not a callback
create({}, 'http://g');

async function wrongUse(store: Store): Promise<void> {
    // @ts-expect-error insert needs a Graph, not an array
    await store.promises.insert([]);
}

export { usePromises, useCallbacks, wrongUse };
