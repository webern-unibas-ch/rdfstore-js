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

        it("does not call back a second time when the user callback throws", function(done) {
            withStore('<http://a> <http://p> "1"', function(store) {
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
                setTimeout(function() {
                    expect(calls).toBe(1);
                    // small stores run synchronously, so the user's exception surfaces from execute()
                    expect(caught).toBe(sentinel);
                    done();
                }, 50);
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

        it("reports an unknown media type via the callback", function(done) {
            withStore(null, function(store) {
                callsBackOnce(function(cb) {
                    store.load("foo/bar", "data", cb);
                }, expectError, done);
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
