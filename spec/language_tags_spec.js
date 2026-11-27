var Store = require("../src/store");
var Lexicon = require("../src/lexicon").Lexicon;

describe("Language tags", function () {
    var withStore = function (turtle, callback) {
        new Store.Store(function (err, store) {
            expect(err).toBe(null);
            if (turtle == null) {
                return callback(store);
            }
            store.load("text/turtle", turtle, function (err) {
                expect(err).toBe(null);
                callback(store);
            });
        });
    };

    it("parses stored literals whose tag has digits or several subtags", function (done) {
        new Lexicon(function (lexicon) {
            var parsed = lexicon.parseLiteral('"y"@es-419');
            expect(parsed.value).toBe("y");
            expect(parsed.lang).toBe("es-419");

            parsed = lexicon.parseLiteral('"y"@de-ch-1901');
            expect(parsed.value).toBe("y");
            expect(parsed.lang).toBe("de-ch-1901");

            parsed = lexicon.parseLiteral('"y"@EN-GB');
            expect(parsed.lang).toBe("en-gb");

            // not a language tag: '-' at the end
            parsed = lexicon.parseLiteral('"y"@en-');
            expect(parsed.lang).toBeUndefined();
            done();
        });
    });

    it("returns loaded literals with a tag that has digits", function (done) {
        withStore('<http://b> <http://p> "y"@es-419 .', function (store) {
            store.execute("SELECT ?o (LANG(?o) AS ?l) { ?s <http://p> ?o }", function (err, results) {
                expect(err).toBe(null);
                expect(results.length).toBe(1);
                expect(results[0].o.value).toBe("y");
                expect(results[0].o.lang).toBe("es-419");
                expect(results[0].l.value).toBe("es-419");
                done();
            });
        });
    });

    it("keeps every subtag of a tag in a query", function (done) {
        withStore('<http://b> <http://p> "y"@sr-Latn-RS .', function (store) {
            store.execute('SELECT ?s { ?s <http://p> "y"@sr-Latn-RS }', function (err, results) {
                expect(err).toBe(null);
                expect(results.length).toBe(1);
                store.execute('SELECT ?s { ?s <http://p> ?o FILTER(?o = "y"@SR-latn-rs) }', function (err, results) {
                    expect(err).toBe(null);
                    expect(results.length).toBe(1);
                    store.execute('SELECT ("a"@de-CH-1901 AS ?x) {}', function (err, results) {
                        expect(err).toBe(null);
                        expect(results[0].x.lang).toBe("de-ch-1901");
                        done();
                    });
                });
            });
        });
    });

    it("LANGMATCHES matches the range or the range followed by '-'", function (done) {
        withStore(
            '<http://a> <http://p> "a"@en . <http://b> <http://p> "b"@en-GB . ' +
                '<http://c> <http://p> "c"@eng . <http://d> <http://p> "d" .',
            function (store) {
                store.execute(
                    'SELECT ?s { ?s <http://p> ?o FILTER(LANGMATCHES(LANG(?o), "EN")) } ORDER BY ?s',
                    function (err, results) {
                        expect(err).toBe(null);
                        expect(
                            results.map(function (r) {
                                return r.s.value;
                            }),
                        ).toEqual(["http://a", "http://b"]);
                        store.execute(
                            'SELECT ?s { ?s <http://p> ?o FILTER(LANGMATCHES(LANG(?o), "*")) } ORDER BY ?s',
                            function (err, results) {
                                expect(err).toBe(null);
                                expect(
                                    results.map(function (r) {
                                        return r.s.value;
                                    }),
                                ).toEqual(["http://a", "http://b", "http://c"]);
                                done();
                            },
                        );
                    },
                );
            },
        );
    });

    it("stores a tag from a custom parser in lower case", function (done) {
        withStore(null, function (store) {
            store.registerParser("x-test/lang", {
                parse: function (data, graph, options, callback) {
                    callback(null, [
                        {
                            subject: { token: "uri", value: "http://a" },
                            predicate: { token: "uri", value: "http://p" },
                            object: { literal: '"x"@EN-GB' },
                            graph: graph,
                        },
                    ]);
                },
            });
            store.load("x-test/lang", "data", function (err) {
                expect(err).toBe(null);
                store.execute(
                    'SELECT ?s (LANG(?o) AS ?l) { ?s <http://p> ?o . ?s <http://p> "x"@en-gb }',
                    function (err, results) {
                        expect(err).toBe(null);
                        expect(results.length).toBe(1);
                        expect(results[0].l.value).toBe("en-gb");
                        done();
                    },
                );
            });
        });
    });

    it("keeps tag and datatype of token-form literals from a custom parser", function (done) {
        withStore(null, function (store) {
            store.registerParser("x-test/token", {
                parse: function (data, graph, options, callback) {
                    var quad = function (s, o) {
                        return {
                            subject: { token: "uri", value: s },
                            predicate: { token: "uri", value: "http://p" },
                            object: o,
                            graph: graph,
                        };
                    };
                    callback(null, [
                        quad("http://a", { token: "literal", value: "x", lang: "EN" }),
                        quad("http://b", {
                            token: "literal",
                            value: "1",
                            type: "http://www.w3.org/2001/XMLSchema#integer",
                        }),
                        quad("http://c", { token: "literal", value: "z" }),
                    ]);
                },
            });
            store.load("x-test/token", "data", function (err) {
                expect(err).toBe(null);
                store.execute("SELECT ?s ?o { ?s <http://p> ?o } ORDER BY ?s", function (err, results) {
                    expect(err).toBe(null);
                    expect(
                        results.map(function (r) {
                            return [r.s.value, r.o.value, r.o.lang, r.o.type];
                        }),
                    ).toEqual([
                        ["http://a", "x", "en", undefined],
                        ["http://b", "1", undefined, "http://www.w3.org/2001/XMLSchema#integer"],
                        ["http://c", "z", undefined, undefined],
                    ]);
                    done();
                });
            });
        });
    });

    it("finds a loaded xsd:hexBinary value in any case", function (done) {
        withStore('<http://b> <http://h> "0A"^^<http://www.w3.org/2001/XMLSchema#hexBinary> .', function (store) {
            store.execute(
                'SELECT ?s { ?s <http://h> "0a"^^<http://www.w3.org/2001/XMLSchema#hexBinary> }',
                function (err, results) {
                    expect(err).toBe(null);
                    expect(results.length).toBe(1);
                    store.execute(
                        'SELECT ?s { ?s <http://h> "0A"^^<http://www.w3.org/2001/XMLSchema#hexBinary> }',
                        function (err, results) {
                            expect(err).toBe(null);
                            expect(results.length).toBe(1);
                            done();
                        },
                    );
                },
            );
        });
    });
});
