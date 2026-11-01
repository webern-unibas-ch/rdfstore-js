var Store = require("../src/store");

// The error contract: every operation calls its callback exactly once, errors arrive as `err`
// (an Error instance), and nothing is thrown synchronously or from inside async code.

var XSD_INTEGER = "<http://www.w3.org/2001/XMLSchema#integer>";

var withStore = function(data, cb) {
    new Store.Store(function(err, store) {
        expect(err).toBe(null);
        if(data == null) {
            cb(store);
        } else {
            store.execute("INSERT DATA { " + data + " }", function(err) {
                expect(err).toBe(null);
                cb(store);
            });
        }
    });
};

// Runs `run(callback)`, then checks that `callback` was invoked exactly once and hands its arguments to `verify`.
var callsBackOnce = function(run, verify, done) {
    var calls = 0;
    var args = null;
    var guard = setTimeout(function() {
        fail("callback was never called");
        done();
    }, 2000);
    var finish = function() {
        clearTimeout(guard);
        expect(calls).toBe(1);
        verify.apply(null, args);
        done();
    };
    try {
        run(function() {
            calls++;
            if(calls === 1) {
                args = arguments;
                setTimeout(finish, 50);
            }
        });
    } catch(e) {
        clearTimeout(guard);
        fail("threw instead of calling back: " + (e && e.message));
        done();
    }
};

// enough rows that the engine yields to the event loop (utils.nextTick) while evaluating expressions
var manyTriples = (function() {
    var triples = [];
    for(var i = 0; i < 300; i++) {
        triples.push('<http://s' + i + '> <http://p> "' + i + '"');
    }
    return triples.join(" . ");
})();

var expectError = function(err) {
    expect(err instanceof Error).toBe(true);
};

var expectNoError = function(err) {
    expect(err == null).toBe(true);
};

describe("Error contract", function() {

    describe("query errors", function() {

        it("reports a syntax error via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.execute("SELECT * WHERE { ?s ", cb);
                }, expectError, done);
            });
        });

        it("reports a syntax error in an update via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.execute('INSERT DATA { <http://c> <http://p> ', cb);
                }, expectError, done);
            });
        });

        it("reports an unsupported feature via the callback", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
                callsBackOnce(function(cb) {
                    store.execute('SELECT * { ?s ?p ?o MINUS { ?s ?p "1" } }', cb);
                }, function(err) {
                    expectError(err);
                    expect(err.name).toBe("NonSupportedSparqlFeatureError");
                }, done);
            });
        });

        it("reports a query error issued from inside a load callback", function(done) {
            withStore(null, function(store) {
                store.load("text/turtle", '<http://a> <http://p> "1" .', function(err) {
                    expectNoError(err);
                    callsBackOnce(function(cb) {
                        store.execute("SELECT * WHERE { ?s ", cb);
                    }, expectError, done);
                });
            });
        });

        it("resets the pending graph modification when an update fails", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
                callsBackOnce(function(cb) {
                    store.execute('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o MINUS { ?s ?p "1" } }', cb);
                }, function(err) {
                    expectError(err);
                    expect(store.engine.callbacksBackend.updateInProgress == null).toBe(true);
                }, done);
            });
        });

        it("does not call back a second time when the user callback throws", async function() {
            var store = await new Promise(function(resolve) {
                withStore('<http://a> <http://p> "1"', resolve);
            });
            await jasmine.spyOnGlobalErrorsAsync(async function(globalErrorSpy) {
                var calls = 0;
                var sentinel = new Error("thrown by the user callback");
                var caught = null;
                try {
                    store.execute("SELECT * { ?s ?p ?o }", function() {
                        calls++;
                        throw sentinel;
                    });
                } catch(e) {
                    caught = e;
                }
                await new Promise(function(resolve) { setTimeout(resolve, 50); });
                expect(calls).toBe(1);
                // the exception surfaces from execute() or, if the engine yielded to the event loop first, as an uncaught error
                var uncaught = globalErrorSpy.calls.allArgs().map(function(args) { return args[0]; });
                expect(caught === sentinel || uncaught.indexOf(sentinel) !== -1).toBe(true);
            });
        });
    });

    describe("event handlers", function() {

        // graph_callbacks.js catches exceptions from subscribe/observe handlers; the update must still succeed
        it("reports the update as successful when an event handler throws", function(done) {
            withStore(null, function(store) {
                var handlerCalls = 0;
                store.subscribe("http://a", null, null, null, function() {
                    handlerCalls++;
                    throw new Error("thrown by an event handler");
                }, function() {
                    callsBackOnce(function(cb) {
                        store.execute('INSERT DATA { <http://a> <http://p> "1" }', cb);
                    }, function(err, result) {
                        expectNoError(err);
                        expect(result).toBe(true);
                        expect(handlerCalls).toBe(1);
                        store.execute("SELECT * { ?s ?p ?o }", function(err, results) {
                            expect(results.length).toBe(1);
                        });
                    }, done);
                });
            });
        });
    });

    describe("OPTIONAL with a filter", function() {

        it("keeps the left rows when the optional part's filter fails", function(done) {
            withStore('<http://a> <http://p> "1" . <http://a> <http://q> "2" . <http://b> <http://p> "3"', function(store) {
                callsBackOnce(function(cb) {
                    store.execute('SELECT * { ?s <http://p> ?o OPTIONAL { ?s <http://q> ?z FILTER(?z = "nope") } }', cb);
                }, function(err, results) {
                    expectNoError(err);
                    expect(results.map(function(r) { return r.s.value; }).sort()).toEqual(["http://a", "http://b"]);
                    results.forEach(function(row) {
                        expect(row.z == null).toBe(true);
                    });
                }, done);
            });
        });
    });

    describe("events around CLEAR", function() {

        it("announces the triples removed by CLEAR and keeps announcing later updates", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
                var events = [];
                store.subscribe("http://a", null, null, null, function(event, triples) {
                    events.push(event + ":" + triples.length);
                }, function() {
                    store.execute("CLEAR DEFAULT", function(err) {
                        expectNoError(err);
                        store.execute('INSERT DATA { <http://a> <http://p> "2" }', function(err) {
                            expectNoError(err);
                            expect(events).toEqual(["deleted:1", "added:1"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe("update operations", function() {

        var namedData = '<http://a> <http://p> "1" . GRAPH <http://g> { <http://b> <http://p> "2" }';

        it("CREATE GRAPH calls back with (null, true)", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.execute("CREATE GRAPH <http://g>", cb);
                }, function(err, result) {
                    expectNoError(err);
                    expect(result).toBe(true);
                }, done);
            });
        });

        ["CLEAR GRAPH <http://g>", "CLEAR DEFAULT", "CLEAR NAMED", "CLEAR ALL",
         "DROP GRAPH <http://g>", "DROP DEFAULT", "DROP NAMED", "DROP ALL"].forEach(function(query) {
            it(query + " calls back once without an error", function(done) {
                withStore(namedData, function(store) {
                    callsBackOnce(function(cb) {
                        store.execute(query, cb);
                    }, expectNoError, done);
                });
            });
        });

        it("INSERT ... WHERE calls back with (null, true)", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
                callsBackOnce(function(cb) {
                    store.execute('INSERT { ?s <http://q> ?o } WHERE { ?s <http://p> ?o }', cb);
                }, function(err, result) {
                    expectNoError(err);
                    expect(result).toBe(true);
                }, done);
            });
        });

        it("continues a multi-operation update after CLEAR DEFAULT", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
                callsBackOnce(function(cb) {
                    store.execute('CLEAR DEFAULT ; INSERT DATA { <http://c> <http://p> "3" }', cb);
                }, function(err) {
                    expectNoError(err);
                    store.execute("SELECT ?s { ?s ?p ?o }", function(err, results) {
                        expectNoError(err);
                        expect(results.map(function(r) { return r.s.value; })).toEqual(["http://c"]);
                    });
                }, done);
            });
        });

        it("runs a multi-operation update in order and calls back once", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
                callsBackOnce(function(cb) {
                    store.execute('INSERT DATA { <http://c> <http://p> "3" } ; DELETE DATA { <http://a> <http://p> "1" }', cb);
                }, function(err) {
                    expectNoError(err);
                    store.execute("SELECT ?s { ?s ?p ?o }", function(err, results) {
                        expectNoError(err);
                        expect(results.map(function(r) { return r.s.value; })).toEqual(["http://c"]);
                    });
                }, done);
            });
        });
    });

    describe("loading", function() {

        it("reports unparseable data via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.load("text/turtle", "not turtle @@", cb);
                }, expectError, done);
            });
        });

        it("reports invalid JSON-LD via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.load("application/ld+json", '{"@context": 5, "@id": "http://a"}', cb);
                }, expectError, done);
            });
        });

        it("reports a missing file via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.load("text/turtle", require("url").pathToFileURL(__dirname + "/does-not-exist.ttl").href, cb);
                }, expectError, done);
            });
        });

        it("reports a failure while storing parsed quads via the callback", function(done) {
            withStore(null, function(store) {
                // a parser that produces a quad without predicate and object
                store.registerParser("x-test/broken", {
                    parse: function(data, graph, options, callback) {
                        callback(null, [{subject: {token: 'uri', value: 'http://a'}, graph: graph}]);
                    }
                });
                callsBackOnce(function(cb) {
                    store.load("x-test/broken", "data", cb);
                }, expectError, done);
            });
        });

        it("stores nothing when one quad of the batch is broken", function(done) {
            withStore(null, function(store) {
                store.registerParser("x-test/half-broken", {
                    parse: function(data, graph, options, callback) {
                        callback(null, [
                            {subject: {token: 'uri', value: 'http://a'}, predicate: {token: 'uri', value: 'http://p'},
                             object: {token: 'uri', value: 'http://o'}, graph: graph},
                            {subject: {token: 'uri', value: 'http://b'}, graph: graph}
                        ]);
                    }
                });
                callsBackOnce(function(cb) {
                    store.load("x-test/half-broken", "data", cb);
                }, function(err) {
                    expectError(err);
                    store.execute("SELECT * { ?s ?p ?o }", function(err, results) {
                        expect(results.length).toBe(0);
                    });
                }, done);
            });
        });

        it("reports an unknown media type via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.load("foo/bar", "data", cb);
                }, expectError, done);
            });
        });
    });

    // SPARQL 1.1 §17.3: an expression error in a FILTER removes the row; unsupported builtins are reported
    describe("FILTER expression errors", function() {

        var data = manyTriples;

        it("drops the rows when a builtin fails on an unbound variable", function(done) {
            withStore(data, function(store) {
                callsBackOnce(function(cb) {
                    store.execute('SELECT * { ?s ?p ?o FILTER(LANG(?nope) = "en") }', cb);
                }, function(err, results) {
                    expectNoError(err);
                    expect(results.length).toBe(0);
                }, done);
            });
        });

        it("drops the rows when a custom function throws", function(done) {
            withStore(data, function(store) {
                store.registerCustomFunction("broken", function() {
                    throw new TypeError("bug in a custom function");
                });
                callsBackOnce(function(cb) {
                    store.execute('SELECT * { ?s ?p ?o FILTER(custom:broken(?o)) }', cb);
                }, function(err, results) {
                    expectNoError(err);
                    expect(results.length).toBe(0);
                }, done);
            });
        });

        it("reports an unsupported builtin as an error", function(done) {
            withStore(data, function(store) {
                callsBackOnce(function(cb) {
                    store.execute('SELECT * { ?s ?p ?o FILTER(COALESCE(?o) = "1") }', cb);
                }, function(err) {
                    expectError(err);
                    expect(err.name).toBe("NonSupportedSparqlFeatureError");
                }, done);
            });
        });

        it("reports an unsupported builtin in a BIND as an error", function(done) {
            withStore(data, function(store) {
                callsBackOnce(function(cb) {
                    store.execute('SELECT * { ?s ?p ?o BIND(COALESCE(?o) AS ?x) }', cb);
                }, function(err) {
                    expectError(err);
                    expect(err.name).toBe("NonSupportedSparqlFeatureError");
                }, done);
            });
        });
    });

    describe("expression errors outside FILTER and BIND", function() {

        var withBrokenFunction = function(cb) {
            withStore(manyTriples, function(store) {
                store.registerCustomFunction("broken", function() {
                    throw new Error("bug in a custom function");
                });
                cb(store);
            });
        };

        var noErrorCases = {
            "in a projected expression": 'SELECT (LANG(?nope) AS ?x) { ?s ?p ?o }',
            "in ORDER BY": 'SELECT ?s { ?s ?p ?o } ORDER BY LANG(?nope)',
            "from a custom function in ORDER BY": 'SELECT ?s { ?s ?p ?o } ORDER BY custom:broken(?o)',
            "from a custom function in an aggregate": 'SELECT (SUM(custom:broken(?o)) AS ?x) { ?s ?p ?o }',
            "from a custom function in GROUP BY": 'SELECT ?k { ?s ?p ?o } GROUP BY (custom:broken(?o) AS ?k)'
        };

        Object.keys(noErrorCases).forEach(function(name) {
            it("calls back without an error " + name, function(done) {
                withBrokenFunction(function(store) {
                    callsBackOnce(function(cb) {
                        store.execute(noErrorCases[name], cb);
                    }, expectNoError, done);
                });
            });
        });

        // SPARQL 1.1 §17.2: true || error is true
        it("keeps a row when the other operand of || is true", function(done) {
            withBrokenFunction(function(store) {
                callsBackOnce(function(cb) {
                    store.execute('SELECT ?o { ?s ?p ?o FILTER(?o = "1" || custom:broken(?o)) }', cb);
                }, function(err, results) {
                    expectNoError(err);
                    expect(results.map(function(r) { return r.o.value; })).toEqual(["1"]);
                }, done);
            });
        });

        var unsupportedCases = {
            "in a projected expression": 'SELECT (COALESCE(?o) AS ?x) { ?s ?p ?o }',
            "in ORDER BY": 'SELECT ?s { ?s ?p ?o } ORDER BY COALESCE(?o)'
        };

        Object.keys(unsupportedCases).forEach(function(name) {
            it("reports an unsupported builtin " + name, function(done) {
                withStore(manyTriples, function(store) {
                    callsBackOnce(function(cb) {
                        store.execute(unsupportedCases[name], cb);
                    }, function(err) {
                        expectError(err);
                        expect(err.name).toBe("NonSupportedSparqlFeatureError");
                    }, done);
                });
            });
        });
    });

    // SPARQL 1.1 §18.5 (Extend): an error in a BIND expression leaves the variable unbound
    describe("BIND expression errors", function() {

        var data = '<http://a> <http://p> "1" . <http://b> <http://p> "2"';

        var expectRowsWithUnboundX = function(err, results) {
            expectNoError(err);
            expect(results.length).toBe(2);
            results.forEach(function(row) {
                expect(row.x == null).toBe(true);
            });
        };

        var cases = {
            "in a basic graph pattern": 'SELECT * { ?s ?p ?o BIND(' + XSD_INTEGER + '("abc") AS ?x) }',
            "from an unbound variable": 'SELECT * { ?s ?p ?o BIND(LANG(?nope) AS ?x) }',
            "after OPTIONAL": 'SELECT * { ?s ?p ?o OPTIONAL { ?s <http://q> ?z } BIND(' + XSD_INTEGER + '("abc") AS ?x) }',
            "after UNION": 'SELECT * { { ?s ?p "1" } UNION { ?s ?p "2" } BIND(' + XSD_INTEGER + '("abc") AS ?x) }',
            "after a JOIN": 'SELECT * { { ?s ?p ?o } { ?s ?p ?o2 } BIND(' + XSD_INTEGER + '("abc") AS ?x) }'
        };

        Object.keys(cases).forEach(function(name) {
            it("keeps the rows and leaves the variable unbound " + name, function(done) {
                withStore(data, function(store) {
                    callsBackOnce(function(cb) {
                        store.execute(cases[name], cb);
                    }, expectRowsWithUnboundX, done);
                });
            });
        });
    });
});
