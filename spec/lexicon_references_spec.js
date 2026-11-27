var rdfstore = require("../src/store");
var countLexiconTerms = require("./helpers/engine").countLexiconTerms;

// The lexicon counts how many quads (and subscriptions) use each URI and literal, and removes a term
// once nothing uses it anymore. Its B-trees have order 2, so after a few inserts most terms sit in inner nodes.

var newStore = function (options) {
    return rdfstore.promises.create(Object.assign({ treeOrder: 2 }, options));
};

var termCount = function (store) {
    return new Promise(function (resolve) {
        countLexiconTerms(store.engine.lexicon, resolve);
    });
};

var registeredGraphs = function (store) {
    return new Promise(function (resolve) {
        store.engine.lexicon.registeredGraphs(true, resolve);
    });
};

var triples = function (n) {
    var lines = [];
    for (var i = 0; i < n; i++) {
        lines.push("<http://s" + i + '> <http://p> "literal ' + i + '" .');
    }
    return lines.join("\n");
};

var subscribe = function (store, s, listener) {
    return new Promise(function (resolve) {
        store.subscribe(s, null, null, null, listener, resolve);
    });
};

var observeQuery = function (store, query, listener) {
    return new Promise(function (resolve) {
        store.startObservingQuery(query, listener || function () {}, resolve);
    });
};

// resolves with the function registered as the node's listener, for stopObservingNode
var observeNode = function (store, uri) {
    return new Promise(function (resolve) {
        var listener = function () {
            if (first) {
                first = false;
                resolve(listener);
            }
        };
        var first = true;
        store.startObservingNode(uri, listener);
    });
};

// stops a listener or query, then runs an update that changes nothing: updates release the terms of
// stopped listeners and queries first
var released = async function (store, method, arg) {
    store[method](arg);
    await store.promises.execute("DELETE DATA { <http://none> <http://none> <http://none> }");
};

describe("Lexicon references", function () {
    it("removes the terms of many deleted triples, also those in inner B-tree nodes", async function () {
        var store = await newStore();
        await store.promises.execute("INSERT DATA { " + triples(20) + " }");
        expect(await termCount(store)).toBeGreaterThan(0);
        await store.promises.execute("DELETE DATA { " + triples(20) + " }");
        expect(await termCount(store)).toBe(0);
    });

    it("does not count a duplicate INSERT DATA as a reference", async function () {
        var store = await newStore();
        await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
        await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
        await store.promises.execute("DELETE DATA { <http://s> <http://p> <http://o> }");
        expect(await termCount(store)).toBe(0);
    });

    it("does not count a duplicate loaded triple as a reference", async function () {
        var store = await newStore();
        var data = '<http://s> <http://p> "o" .\n<http://s> <http://p> "o" .';
        await store.promises.load("text/turtle", data);
        await store.promises.load("text/turtle", data);
        await store.promises.execute('DELETE DATA { <http://s> <http://p> "o" }');
        expect(await termCount(store)).toBe(0);
    });

    it("keeps the terms another triple still uses", async function () {
        var store = await newStore();
        await store.promises.execute('INSERT DATA { <http://s> <http://p> "a" . <http://s> <http://p> "b" }');
        await store.promises.execute('DELETE DATA { <http://s> <http://p> "a" }');
        var results = await store.promises.execute("SELECT ?o { <http://s> <http://p> ?o }");
        expect(results.length).toBe(1);
        expect(results[0].o.value).toBe("b");
        await store.promises.execute('DELETE DATA { <http://s> <http://p> "b" }');
        expect(await termCount(store)).toBe(0);
    });

    it("does not use up an OID when it removes a literal", async function () {
        var store = await newStore();
        await store.promises.execute('INSERT DATA { <http://s> <http://p> "a" }');
        var before = store.engine.lexicon.oidCounter;
        await store.promises.execute('DELETE DATA { <http://s> <http://p> "a" }');
        expect(store.engine.lexicon.oidCounter).toBe(before);
    });

    describe("of graphs", function () {
        var graphData = function (n, object) {
            var parts = [];
            for (var i = 0; i < n; i++) {
                parts.push("GRAPH <http://g" + i + "> { <http://s> <http://p> <" + (object || "http://o") + "> }");
            }
            return parts.join(" ");
        };

        it("registers a graph once, and removes it with its last triple", async function () {
            var store = await newStore();
            await store.promises.execute("INSERT DATA { " + graphData(10) + " }");
            await store.promises.execute("INSERT DATA { " + graphData(10, "http://o2") + " }");
            var graphs = await registeredGraphs(store);
            expect(graphs.length).toBe(10);
            await store.promises.execute("DELETE DATA { " + graphData(10) + " }");
            expect((await registeredGraphs(store)).length).toBe(10);
            await store.promises.execute("DELETE DATA { " + graphData(10, "http://o2") + " }");
            expect(await registeredGraphs(store)).toEqual([]);
            expect(await termCount(store)).toBe(0);
        });

        it("keeps an empty graph listed while its IRI is used elsewhere", async function () {
            var store = await newStore();
            await store.promises.execute(
                "INSERT DATA { <http://g> <http://p> <http://o> . GRAPH <http://g> { <http://s> <http://p> <http://o> } }",
            );
            await store.promises.execute("DELETE DATA { GRAPH <http://g> { <http://s> <http://p> <http://o> } }");
            expect(await registeredGraphs(store)).toEqual(["http://g"]);
        });

        it("does not register the graph of a DELETE DATA that removes nothing", async function () {
            var store = await newStore();
            await store.promises.execute("INSERT DATA { <http://x> <http://p> <http://o> }");
            await store.promises.execute("DELETE DATA { GRAPH <http://x> { <http://s> <http://p> <http://o> } }");
            await store.promises.execute("DELETE DATA { GRAPH <http://y> { <http://s> <http://p> <http://o> } }");
            expect(await registeredGraphs(store)).toEqual([]);
        });

        ["CLEAR NAMED", "CLEAR ALL", "DROP ALL"].forEach(function (update) {
            it("runs " + update + " on graphs whose IRIs it removes", async function () {
                var store = await newStore();
                await store.promises.execute("INSERT DATA { " + graphData(5) + " }");
                await store.promises.execute(update);
                expect(await registeredGraphs(store)).toEqual([]);
                expect(await termCount(store)).toBe(0);
            });
        });
    });

    describe("of subscriptions", function () {
        it("keeps a subscribed IRI, so the subscription matches after its triple is deleted and re-inserted", async function () {
            var store = await newStore();
            var events = [];
            await new Promise(function (resolve) {
                store.subscribe(
                    "http://s",
                    null,
                    null,
                    null,
                    function (event) {
                        events.push(event);
                    },
                    resolve,
                );
            });
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            await store.promises.execute("DELETE DATA { <http://s> <http://p> <http://o> }");
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            expect(events).toEqual(["added", "deleted", "added"]);
        });

        it("keeps an observed query's IRIs, so it sees a triple re-inserted after its delete", async function () {
            var store = await newStore();
            var results = [];
            await new Promise(function (resolve) {
                store.startObservingQuery(
                    "SELECT ?o { <http://s> <http://p> ?o }",
                    function (bindings) {
                        results.push(bindings.length);
                    },
                    resolve,
                );
            });
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            await store.promises.execute("DELETE DATA { <http://s> <http://p> <http://o> }");
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            expect(results[results.length - 1]).toBe(1);
        });

        it("releases a subscribed IRI on unsubscribe", async function () {
            var store = await newStore();
            var listener = function () {};
            await subscribe(store, "http://s", listener);
            expect(await termCount(store)).toBeGreaterThan(0);
            await released(store, "unsubscribe", listener);
            expect(await termCount(store)).toBe(0);
        });

        it("keeps an IRI another listener still subscribes to", async function () {
            var store = await newStore();
            var events = [];
            var first = function () {};
            var second = function (event) {
                events.push(event);
            };
            await subscribe(store, "http://s", first);
            await subscribe(store, "http://s", second);
            await released(store, "unsubscribe", first);
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            expect(events).toEqual(["added"]);
            await store.promises.execute("DELETE DATA { <http://s> <http://p> <http://o> }");
            expect(await termCount(store)).toBeGreaterThan(0);
            await released(store, "unsubscribe", second);
            expect(await termCount(store)).toBe(0);
        });

        it("keeps the terms of a stored triple after unsubscribe", async function () {
            var store = await newStore();
            var listener = function () {};
            await subscribe(store, "http://s", listener);
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            await released(store, "unsubscribe", listener);
            var results = await store.promises.execute("SELECT ?o { <http://s> <http://p> ?o }");
            expect(results.length).toBe(1);
            await store.promises.execute("DELETE DATA { <http://s> <http://p> <http://o> }");
            expect(await termCount(store)).toBe(0);
        });

        it("releases the terms of an observed query, also when it is observed twice", async function () {
            var store = await newStore();
            var query = 'SELECT ?s { ?s <http://p> "a" . ?s <http://q> <http://o> }';
            await observeQuery(store, query);
            await observeQuery(store, query);
            expect(await termCount(store)).toBeGreaterThan(0);
            await released(store, "stopObservingQuery", query);
            expect(await termCount(store)).toBe(0);
        });

        it("releases the IRI of an observed node", async function () {
            var store = await newStore();
            var listener = await observeNode(store, "http://s");
            expect(await termCount(store)).toBeGreaterThan(0);
            await released(store, "stopObservingNode", listener);
            expect(await termCount(store)).toBe(0);
        });

        it("releases nothing more when a listener is removed twice", async function () {
            var store = await newStore();
            var listener = function () {};
            var query = "SELECT ?o { <http://s> <http://p> ?o }";
            await store.promises.execute("INSERT DATA { <http://s> <http://p> <http://o> }");
            await subscribe(store, "http://s", listener);
            await observeQuery(store, query);
            await released(store, "unsubscribe", listener);
            await released(store, "unsubscribe", listener);
            await released(store, "stopObservingQuery", query);
            await released(store, "stopObservingQuery", query);
            await released(store, "stopObservingNode", listener);
            var results = await store.promises.execute("SELECT ?o { <http://s> <http://p> ?o }");
            expect(results.length).toBe(1);
            await store.promises.execute("DELETE DATA { <http://s> <http://p> <http://o> }");
            expect(await termCount(store)).toBe(0);
        });

        it("keeps a stopped listener's terms until the next update or load", async function () {
            var store = await newStore();
            var listener = function () {};
            await subscribe(store, "http://s", listener);
            store.unsubscribe(listener);
            expect(await termCount(store)).toBeGreaterThan(0);
            await store.promises.load("text/turtle", "");
            expect(await termCount(store)).toBe(0);
        });

        it("drops a subscription that is unsubscribed before it is set up", async function () {
            var store = await newStore();
            var events = [];
            var listener = function (event) {
                events.push(event);
            };
            // subscribe usually sets up at once; Utils' throttled nextTick defers every 100th step,
            // so some of these subscriptions are still being set up when unsubscribe runs
            for (var i = 0; i < 300; i++) {
                var ready = subscribe(store, "http://s" + i, listener);
                store.unsubscribe(listener);
                await ready;
            }
            for (var j = 0; j < 300; j++) {
                await store.promises.execute("INSERT DATA { <http://s" + j + "> <http://p> <http://o> }");
            }
            expect(events).toEqual([]);
        });

        it("keeps the term of an INSERT right after unsubscribe", async function () {
            // the tree sizes vary the B-tree depth, and with it how the two operations would interleave
            for (var size of [0, 1, 3, 7, 15, 30, 60, 120]) {
                var store = await newStore();
                if (size > 0) await store.promises.execute("INSERT DATA { " + triples(size) + " }");
                var listener = function () {};
                await subscribe(store, "http://x", listener);
                store.unsubscribe(listener);
                await store.promises.execute("INSERT DATA { <http://x> <http://p> <http://o> }");
                var results = await store.promises.execute("SELECT ?o { <http://x> <http://p> ?o }");
                expect(results.length).toBe(1);
            }
        });
    });
});
