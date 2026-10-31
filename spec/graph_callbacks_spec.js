var Store = require("../src/store");

// Unsubscribing from the events API removes exactly the listener passed in. Listeners are told
// apart by identity: closures with the same source text (from a factory, or the store's own
// adapters and node observers) must not collide.

var withStore = function(cb) {
    new Store.Store(function(err, store) {
        expect(err).toBe(null);
        cb(store);
    });
};

var insertAB = function(store, cb) {
    store.execute("INSERT DATA { <http://a> <http://p> <http://o1> . <http://b> <http://p> <http://o2> }", function(err) {
        expect(err).toBe(null);
        cb();
    });
};

describe("Events API unsubscribing", function() {

    it("keeps notifying the other queries after stopObservingQuery", function(done) {
        withStore(function(store) {
            var queryA = "SELECT ?o { <http://a> <http://p> ?o }";
            var queryB = "SELECT ?o { <http://b> <http://p> ?o }";
            var resultsA = [];
            var resultsB = [];
            store.startObservingQuery(queryA, function(results) { resultsA.push(results); }, function() {
                store.startObservingQuery(queryB, function(results) { resultsB.push(results); }, function() {
                    store.stopObservingQuery(queryA);
                    resultsA = [];
                    resultsB = [];
                    insertAB(store, function() {
                        expect(resultsA.length).toBe(0);
                        expect(resultsB.length).toBe(1);
                        expect(resultsB[0].length).toBe(1);
                        expect(resultsB[0][0].o.value).toBe("http://o2");
                        done();
                    });
                });
            });
        });
    });

    it("keeps notifying the other nodes after stopObservingNode", function(done) {
        withStore(function(store) {
            var nodesA = [];
            var nodesB = [];
            var started = false;
            // each observer is first called with the current node, once it is registered
            var listenerA = function(node) {
                nodesA.push(node);
                if(!started) {
                    started = true;
                    store.startObservingNode("http://b", listenerB);
                }
            };
            var listenerB = function(node) {
                nodesB.push(node);
                if(nodesB.length === 1) {
                    store.stopObservingNode(listenerA);
                    nodesA = [];
                    insertAB(store, function() {
                        expect(nodesA.length).toBe(0);
                        expect(nodesB.length).toBe(2);
                        expect(nodesB[1].toArray().length).toBe(1);
                        done();
                    });
                }
            };
            store.startObservingNode("http://a", listenerA);
        });
    });

    it("removes only the given listener when listeners share their source text", function(done) {
        withStore(function(store) {
            var makeListener = function(log) {
                return function(event, triples) { log.push(event); };
            };
            var eventsA = [];
            var eventsB = [];
            var listenerA = makeListener(eventsA);
            var listenerB = makeListener(eventsB);
            store.subscribe("http://a", null, null, null, listenerA, function() {
                store.subscribe("http://b", null, null, null, listenerB, function() {
                    store.unsubscribe(listenerA);
                    insertAB(store, function() {
                        expect(eventsA).toEqual([]);
                        expect(eventsB).toEqual(["added"]);
                        done();
                    });
                });
            });
        });
    });

    describe("a listener registered more than once", function() {

        it("unsubscribe removes it from every pattern", function(done) {
            withStore(function(store) {
                var events = [];
                var listener = function(event) { events.push(event); };
                store.subscribe("http://a", null, null, null, listener, function() {
                    store.subscribe("http://b", null, null, null, listener, function() {
                        store.unsubscribe(listener);
                        insertAB(store, function() {
                            expect(events).toEqual([]);
                            done();
                        });
                    });
                });
            });
        });

        it("stopObservingNode removes it from every node", function(done) {
            withStore(function(store) {
                var calls = 0;
                var listener = function() {
                    calls++;
                    if(calls === 1) {
                        store.startObservingNode("http://b", listener);
                    } else if(calls === 2) {
                        store.stopObservingNode(listener);
                        insertAB(store, function() {
                            expect(calls).toBe(2);
                            done();
                        });
                    }
                };
                store.startObservingNode("http://a", listener);
            });
        });

        it("stopObservingQuery removes every callback of the query", function(done) {
            withStore(function(store) {
                var query = "SELECT ?o { <http://a> <http://p> ?o }";
                var calls = [];
                store.startObservingQuery(query, function() { calls.push(1); }, function() {
                    store.startObservingQuery(query, function() { calls.push(2); }, function() {
                        store.stopObservingQuery(query);
                        calls = [];
                        insertAB(store, function() {
                            expect(calls).toEqual([]);
                            done();
                        });
                    });
                });
            });
        });
    });
});
