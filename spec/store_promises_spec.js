var rdfstore = require("../src/store");

// The promise API: rdfstore.promises.create() and store.promises.<method>() wrap the callback API.
// Each method resolves with the callback's result and rejects with its `err` (an Error instance);
// none of them throws synchronously.

var TURTLE = '<http://a> <http://p> "1" . <http://a> <http://q> <http://b> .';

var newStore = function() {
    return rdfstore.promises.create();
};

var tripleGraph = function(store, s, p, o) {
    var graph = store.rdf.createGraph();
    graph.add(store.rdf.createTriple(store.rdf.createNamedNode(s), store.rdf.createNamedNode(p), store.rdf.createLiteral(o)));
    return graph;
};

// Resolves with the rejection reason, or fails if the promise resolves.
var rejectionOf = async function(promise) {
    try {
        await promise;
    } catch(e) {
        return e;
    }
    fail("expected the promise to reject");
};

describe("Promise API", function() {

    describe("create", function() {

        it("resolves to a store with promise methods", async function() {
            var store = await rdfstore.promises.create();
            expect(store instanceof rdfstore.Store).toBe(true);
            expect(typeof store.promises.execute).toBe("function");
        });

        it("passes options to the store", async function() {
            var store = await rdfstore.promises.create({treeOrder: 4});
            expect(store instanceof rdfstore.Store).toBe(true);
            expect(await store.promises.load("text/turtle", TURTLE)).toBe(2);
        });
    });

    describe("load", function() {

        it("resolves with the number of loaded triples", async function() {
            var store = await newStore();
            expect(await store.promises.load("text/turtle", TURTLE)).toBe(2);
        });

        it("loads into a named graph", async function() {
            var store = await newStore();
            expect(await store.promises.load("text/turtle", '<http://c> <http://p> "2" .', "http://g")).toBe(1);
            var graph = await store.promises.graph("http://g");
            expect(graph.length).toBe(1);
        });

        it("accepts an options object with graph and baseURI", async function() {
            var store = await newStore();
            expect(await store.promises.load("text/turtle", '<d> <http://p> "3" .', {graph: "http://g", baseURI: "http://base/"})).toBe(1);
            var rows = await store.promises.execute("SELECT ?s { GRAPH <http://g> { ?s ?p ?o } }");
            expect(rows[0].s.value).toBe("http://base/d");
        });

        it("rejects bad Turtle with an Error", async function() {
            var store = await newStore();
            var err = await rejectionOf(store.promises.load("text/turtle", "not turtle @@"));
            expect(err instanceof Error).toBe(true);
        });

        it("rejects an unknown media type with an Error", async function() {
            var store = await newStore();
            var err = await rejectionOf(store.promises.load("foo/bar", TURTLE));
            expect(err instanceof Error).toBe(true);
        });
    });

    describe("execute", function() {

        var store;

        beforeEach(async function() {
            store = await newStore();
            await store.promises.load("text/turtle", TURTLE);
            await store.promises.load("text/turtle", '<http://c> <http://p> "2" .', "http://g");
        });

        it("resolves SELECT with bindings", async function() {
            var rows = await store.promises.execute("SELECT * { ?s <http://p> ?o }");
            expect(rows).toEqual([{s: {token: "uri", value: "http://a"}, o: {token: "literal", value: "1"}}]);
        });

        it("resolves CONSTRUCT with a graph", async function() {
            var graph = await store.promises.execute("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");
            expect(graph.length).toBe(2);
            expect(typeof graph.toArray).toBe("function");
        });

        it("resolves ASK with a boolean", async function() {
            expect(await store.promises.execute("ASK { <http://a> ?p ?o }")).toBe(true);
            expect(await store.promises.execute("ASK { <http://z> ?p ?o }")).toBe(false);
        });

        it("resolves an update with true", async function() {
            expect(await store.promises.execute('INSERT DATA { <http://x> <http://p> "9" }')).toBe(true);
        });

        it("uses the given default and named graphs", async function() {
            var query = "SELECT * { ?s <http://p> ?o }";
            var expected = await new Promise(function(resolve) {
                store.executeWithEnvironment(query, ["http://g"], [], function(err, result) {
                    expect(err).toBe(null);
                    resolve(result);
                });
            });
            expect(expected[0].s.value).toBe("http://c");
            expect(await store.promises.execute(query, ["http://g"], [])).toEqual(expected);
            expect(await store.promises.executeWithEnvironment(query, ["http://g"], [])).toEqual(expected);
        });

        it("rejects a syntax error with an Error", async function() {
            var err = await rejectionOf(store.promises.execute("SELECT * WHERE { ?s "));
            expect(err instanceof Error).toBe(true);
        });

        it("rejects an unsupported builtin with an Error", async function() {
            var err = await rejectionOf(store.promises.execute('SELECT (COALESCE(?o, "x") AS ?c) { ?s ?p ?o }'));
            expect(err instanceof Error).toBe(true);
        });
    });

    describe("insert, delete and clear", function() {

        var count = async function(store, graphUri) {
            var where = graphUri == null ? "{ ?s ?p ?o }" : "{ GRAPH <" + graphUri + "> { ?s ?p ?o } }";
            var rows = await store.promises.execute("SELECT * " + where);
            return rows.length;
        };

        it("inserts and deletes in the default graph", async function() {
            var store = await newStore();
            var triples = tripleGraph(store, "http://x", "http://p", "3");
            expect(await store.promises.insert(triples)).toBe(true);
            expect(await count(store)).toBe(1);
            expect(await store.promises.delete(triples)).toBe(true);
            expect(await count(store)).toBe(0);
        });

        it("inserts and deletes in a named graph", async function() {
            var store = await newStore();
            var triples = tripleGraph(store, "http://x", "http://p", "3");
            expect(await store.promises.insert(triples, "http://h")).toBe(true);
            expect(await count(store, "http://h")).toBe(1);
            expect(await count(store)).toBe(0);
            expect(await store.promises.delete(triples, "http://h")).toBe(true);
            expect(await count(store, "http://h")).toBe(0);
        });

        it("clears the default graph or a named graph", async function() {
            var store = await newStore();
            await store.promises.load("text/turtle", TURTLE);
            await store.promises.load("text/turtle", TURTLE, "http://h");
            expect(await store.promises.clear("http://h")).toBe(true);
            expect(await count(store, "http://h")).toBe(0);
            expect(await count(store)).toBe(2);
            expect(await store.promises.clear()).toBe(true);
            expect(await count(store)).toBe(0);
        });

        it("rejects instead of throwing when the triples are missing", async function() {
            var store = await newStore();
            var promise;
            expect(function() { promise = store.promises.insert(null); }).not.toThrow();
            var err = await rejectionOf(promise);
            expect(err instanceof Error).toBe(true);
        });
    });

    describe("graph, node, registeredGraphs and close", function() {

        var store;

        beforeEach(async function() {
            store = await newStore();
            await store.promises.load("text/turtle", TURTLE);
            await store.promises.load("text/turtle", '<http://c> <http://p> "2" .', "http://g");
        });

        it("resolves the default graph or a named graph", async function() {
            expect((await store.promises.graph()).length).toBe(2);
            expect((await store.promises.graph("http://g")).length).toBe(1);
        });

        it("resolves a node from the default graph or a named graph", async function() {
            expect((await store.promises.node("http://a")).length).toBe(2);
            expect((await store.promises.node("http://c", "http://g")).length).toBe(1);
        });

        it("resolves the registered graphs as named nodes", async function() {
            var graphs = await store.promises.registeredGraphs();
            expect(graphs.map(String)).toEqual(["http://g"]);
            expect(graphs[0].interfaceName).toBe("NamedNode");
        });

        it("resolves close", async function() {
            expect(await store.promises.close()).toBeUndefined();
        });
    });

    describe("callback API", function() {

        it("keeps working next to the promise methods", function(done) {
            rdfstore.create(function(err, store) {
                expect(err).toBe(null);
                expect(typeof store.promises.execute).toBe("function");
                store.load("text/turtle", TURTLE, function(err, count) {
                    expect(err).toBe(null);
                    expect(count).toBe(2);
                    store.execute("ASK { <http://a> ?p ?o }", function(err, result) {
                        expect(err).toBe(null);
                        expect(result).toBe(true);
                        done();
                    });
                });
            });
        });
    });

    describe("ES module entry", function() {

        it("exports promises by name", async function() {
            var mod = await import("../src/index.mjs");
            expect(typeof mod.promises.create).toBe("function");
            expect(mod.promises).toBe(mod.default.promises);
        });
    });
});
