var Store = require("../src/store");

describe("Store with a large dataset", function () {

    // Traversing large BTree ranges (e.g. a full scan) used to overflow the call stack
    // (RangeError: Maximum call stack size exceeded), see utils.whilst.
    it("Should load and query 100000 triples", function (done) {
        var numTriples = 100000;
        var numPredicates = 10;

        var turtle = '@prefix ex: <http://example.org/> .\n';
        for (var i = 0; i < numTriples; i++) {
            turtle += 'ex:s' + i + ' ex:p' + (i % numPredicates) + ' "v' + i + '" .\n';
        }

        new Store.Store(function (err, store) {
            expect(err).toBe(null);
            store.load('text/turtle', turtle, function (err, loaded) {
                expect(err).toBe(null);
                expect(loaded).toBe(numTriples);
                store.execute('SELECT ?s ?o WHERE { ?s <http://example.org/p3> ?o }', function (err, results) {
                    expect(err).toBe(null);
                    expect(results.length).toBe(numTriples / numPredicates);
                    store.execute('SELECT ?s ?p ?o WHERE { ?s ?p ?o }', function (err, results) {
                        expect(err).toBe(null);
                        expect(results.length).toBe(numTriples);
                        store.execute('SELECT ?s ?o2 WHERE { ?s <http://example.org/p3> ?o . ?s ?p ?o2 }', function (err, results) {
                            expect(err).toBe(null);
                            expect(results.length).toBe(numTriples / numPredicates);
                            store.close(function () {
                                done();
                            });
                        });
                    });
                });
            });
        });
    }, 60000);

    // Guards the hash lookup in leftOuterJoinBindings: a nested loop takes about 11 s here.
    it("Should evaluate OPTIONAL over 32000 solutions", function (done) {
        var numSubjects = 32000;

        var turtle = '@prefix ex: <http://example.org/> .\n';
        for (var i = 0; i < numSubjects; i++) {
            turtle += 'ex:s' + i + ' ex:p "v' + i + '" .\n';
            if (i % 2 === 0) {
                turtle += 'ex:s' + i + ' ex:q "w' + i + '" .\n';
            }
        }

        new Store.Store(function (err, store) {
            expect(err).toBe(null);
            store.load('text/turtle', turtle, function (err) {
                expect(err).toBe(null);
                store.execute('SELECT ?s ?o ?x WHERE { ?s <http://example.org/p> ?o OPTIONAL { ?s <http://example.org/q> ?x } }', function (err, results) {
                    expect(err).toBe(null);
                    expect(results.length).toBe(numSubjects);
                    var bound = 0;
                    for (var i = 0; i < results.length; i++) {
                        if (results[i].x != null) {
                            expect(results[i].x.value).toBe('w' + results[i].o.value.substring(1));
                            bound++;
                        }
                    }
                    expect(bound).toBe(numSubjects / 2);
                    store.close(function () {
                        done();
                    });
                });
            });
        });
    }, 60000);

});
