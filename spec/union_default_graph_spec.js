var rdfstore = require("../src/store");

describe("Default graph", function () {
    var prefixes = "PREFIX : <http://example/> ";

    var load = function (store, turtle, graph) {
        return store.promises.load("text/turtle", "@prefix : <http://example/> . " + turtle, graph);
    };

    // the solutions as sorted "var=localName" strings
    var rows = function (results) {
        return results
            .map(function (solution) {
                return Object.keys(solution)
                    .sort()
                    .map(function (name) {
                        var term = solution[name];
                        return name + "=" + (term == null ? "" : String(term.value).replace("http://example/", ""));
                    })
                    .join(" ");
            })
            .sort();
    };

    var select = async function (store, query, defaultGraphs, namedGraphs) {
        if (defaultGraphs == null) {
            return rows(await store.promises.execute(prefixes + query));
        }
        return rows(await store.promises.execute(prefixes + query, defaultGraphs, namedGraphs));
    };

    // :shared is in both named graphs
    var layers = async function (options) {
        var store = await rdfstore.promises.create(options);
        await load(store, ":d :p :x .");
        await load(store, ":w1 a :Work . :shared :p :y .", "http://example/g1");
        await load(store, ":w1 :p :o1 . :shared :p :y .", "http://example/g2");
        return store;
    };

    describe("from several graphs", function () {
        it("is their merge: a triple in several of them comes back once", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * FROM :g1 FROM :g2 { ?s :p ?o }")).toEqual([
                "o=o1 s=w1",
                "o=y s=shared",
            ]);
            expect(await select(store, "SELECT (COUNT(*) AS ?n) FROM :g1 FROM :g2 { ?s ?p ?o }")).toEqual(["n=3"]);
            expect(
                await select(store, "SELECT * { ?s :p ?o }", ["http://example/g1", "http://example/g2"], []),
            ).toEqual(["o=o1 s=w1", "o=y s=shared"]);
        });

        it("joins across the graphs", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * FROM :g1 FROM :g2 { ?w a :Work . ?w :p ?o }")).toEqual(["o=o1 w=w1"]);
        });

        it("applies to ASK", async function () {
            var store = await layers();
            expect(await store.promises.execute(prefixes + "ASK FROM :g1 { :w1 a :Work }")).toBe(true);
            expect(await store.promises.execute(prefixes + "ASK FROM :g1 FROM :g2 { :w1 a :Work ; :p :o1 }")).toBe(
                true,
            );
            expect(await store.promises.execute(prefixes + "ASK FROM :g1 { :d :p :x }")).toBe(false);
            expect(await store.promises.execute(prefixes + "ASK FROM NAMED :g1 { GRAPH ?g { :w1 a :Work } }")).toBe(
                true,
            );
        });

        it("keeps the triples of a single graph", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * FROM :g1 FROM :g1 { ?s :p ?o }")).toEqual(["o=y s=shared"]);
        });
    });

    describe("without the option", function () {
        it("is the store's default graph only, and GRAPH ?g needs FROM NAMED", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * { ?s :p ?o }")).toEqual(["o=x s=d"]);
            expect(await select(store, "SELECT ?g { GRAPH ?g {} }")).toEqual([]);
        });
    });

    describe("with unionDefaultGraph", function () {
        var union = function () {
            return layers({ unionDefaultGraph: true });
        };

        it("is the merge of all graphs in a query without a dataset", async function () {
            var store = await union();
            expect(await select(store, "SELECT * { ?s :p ?o }")).toEqual(["o=o1 s=w1", "o=x s=d", "o=y s=shared"]);
            expect(await select(store, "SELECT (COUNT(*) AS ?n) { ?s ?p ?o }")).toEqual(["n=4"]);
            expect(await select(store, "SELECT * { ?w a :Work . ?w :p ?o }")).toEqual(["o=o1 w=w1"]);
            expect(await select(store, "SELECT * { ?w a :Work OPTIONAL { ?w :p ?o } }")).toEqual(["o=o1 w=w1"]);
            expect(await select(store, "SELECT * { { ?s a :Work } UNION { :d :p ?s } }")).toEqual(["s=w1", "s=x"]);
            expect(await store.promises.execute(prefixes + "ASK { :d :p :x . :w1 :p :o1 }")).toBe(true);
            var graph = await store.promises.execute(prefixes + "CONSTRUCT { ?s :p ?o } WHERE { ?s :p ?o }");
            expect(graph.length).toBe(3);
        });

        it("follows property paths and subproperties across graphs", async function () {
            var store = await union();
            await load(store, ":o1 :p :o2 .", "http://example/g1");
            await load(store, ":q <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> :p .", "http://example/g2");
            await load(store, ":w1 :q :o3 .");
            expect(await select(store, "SELECT ?o { :w1 :p+ ?o }")).toEqual(["o=o1", "o=o2"]);
            expect(
                await select(
                    store,
                    "SELECT ?o { ?sub <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> :p . :w1 ?sub ?o }",
                ),
            ).toEqual(["o=o3"]);
        });

        it("sees every named graph in GRAPH without FROM NAMED", async function () {
            var store = await union();
            expect(await select(store, "SELECT ?g { GRAPH ?g {} }")).toEqual(["g=g1", "g=g2"]);
            expect(await select(store, "SELECT ?g ?s { GRAPH ?g { ?s :p :y } }")).toEqual([
                "g=g1 s=shared",
                "g=g2 s=shared",
            ]);
            expect(await select(store, "SELECT ?s { GRAPH :g2 { ?s :p ?o } }")).toEqual(["s=shared", "s=w1"]);
            expect(await select(store, "SELECT ?s { GRAPH :g3 { ?s :p ?o } }")).toEqual([]);
        });

        it("gives way to a dataset the query names", async function () {
            var store = await union();
            expect(await select(store, "SELECT * FROM :g2 { ?s :p ?o }")).toEqual(["o=o1 s=w1", "o=y s=shared"]);
            expect(await select(store, "SELECT ?g FROM :g2 { GRAPH ?g {} }")).toEqual([]);
            expect(await select(store, "SELECT * FROM NAMED :g1 { ?s :p ?o }")).toEqual([]);
            expect(await select(store, "SELECT ?g FROM NAMED :g1 { GRAPH ?g {} }")).toEqual(["g=g1"]);
            expect(await select(store, "SELECT * { ?s :p ?o }", ["http://example/g1"], [])).toEqual(["o=y s=shared"]);
            expect(
                await select(
                    store,
                    "SELECT * FROM <https://github.com/antoniogarrote/rdfstore-js#default_graph> { ?s :p ?o }",
                ),
            ).toEqual(["o=x s=d"]);
        });

        it("keeps store.graph() and store.node() on the store's default graph", async function () {
            var store = await union();
            expect((await store.promises.graph()).length).toBe(1);
            expect((await store.promises.graph("http://example/g2")).length).toBe(2);
            expect((await store.promises.node("http://example/w1")).length).toBe(0);
            expect((await store.promises.node("http://example/w1", "http://example/g1")).length).toBe(1);
        });

        it("leaves updates on the store's default graph", async function () {
            var store = await union();
            await store.promises.execute(prefixes + "INSERT DATA { :n :p :z }");
            var defaultGraph = await store.promises.graph();
            expect(defaultGraph.length).toBe(2);
            expect(await select(store, "SELECT ?g { GRAPH ?g { :n :p :z } }")).toEqual([]);

            // the WHERE of an update reads the default graph only, so the layers stay as they are
            await store.promises.execute(prefixes + "INSERT { ?s :copied true } WHERE { ?s :p :y }");
            expect(await select(store, "SELECT * { ?s :copied ?o }")).toEqual([]);
            await store.promises.execute("DELETE WHERE { ?s ?p ?o }");
            expect((await store.promises.graph()).length).toBe(0);
            expect(await select(store, "SELECT * { ?s :p ?o }")).toEqual(["o=o1 s=w1", "o=y s=shared"]);
            await store.promises.execute("CLEAR DEFAULT");
            expect(await select(store, "SELECT (COUNT(*) AS ?n) { ?s ?p ?o }")).toEqual(["n=3"]);
        });

        it("notifies an observed query of changes in a named graph", function (done) {
            union().then(function (store) {
                var calls = [];
                store.startObservingQuery(prefixes + "SELECT ?o { :w1 :p ?o }", function (results) {
                    calls.push(rows(results));
                    if (calls.length === 1) {
                        expect(calls[0]).toEqual(["o=o1"]);
                        store.execute(prefixes + "INSERT DATA { GRAPH :g1 { :w1 :p :o4 } }", function (err) {
                            expect(err).toBe(null);
                        });
                    } else {
                        expect(calls[1]).toEqual(["o=o1", "o=o4"]);
                        store.stopObservingQuery(prefixes + "SELECT ?o { :w1 :p ?o }");
                        done();
                    }
                });
            });
        });

        it("does not notify an observed query with FROM of changes in other graphs", function (done) {
            union().then(function (store) {
                var query = prefixes + "SELECT ?o FROM :g2 { :w1 :p ?o }";
                var calls = 0;
                store.startObservingQuery(
                    query,
                    function () {
                        calls++;
                    },
                    function () {
                        store.execute(prefixes + "INSERT DATA { GRAPH :g1 { :w1 :p :o4 } }", function (err) {
                            expect(err).toBe(null);
                            expect(calls).toBe(1);
                            store.stopObservingQuery(query);
                            done();
                        });
                    },
                );
            });
        });
    });
});
