var rdfstore = require("../src/store");

describe("Property paths", function () {
    var prefixes = "PREFIX : <http://example/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ";
    var chain = ":x1 :p :x2 . :x2 :p :x3 . :x3 :p :x4 . ";

    var storeWith = async function (turtle, graph) {
        var store = await rdfstore.promises.create();
        if (turtle != null) {
            await load(store, turtle, graph);
        }
        return store;
    };

    var load = function (store, turtle, graph) {
        return store.promises.load(
            "text/turtle",
            "@prefix : <http://example/> . " + "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . " + turtle,
            graph,
        );
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

    var select = async function (store, query) {
        return rows(await store.promises.execute(prefixes + query));
    };

    var ask = function (store, query) {
        return store.promises.execute(prefixes + query);
    };

    describe("syntax", function () {
        it("allows whitespace around / and | and inside groups", async function () {
            var store = await storeWith(":a :p :b . :b :q :c .");
            expect(await select(store, "SELECT ?s ?o { ?s :p / :q ?o }")).toEqual(["o=c s=a"]);
            expect(await select(store, "SELECT ?s ?o { ?s ( :p / :q ) ?o }")).toEqual(["o=c s=a"]);
            expect(await select(store, "SELECT ?s ?o { ?s ( :p | :q ) ?o }")).toEqual(["o=b s=a", "o=c s=b"]);
            expect(await select(store, "SELECT ?s ?o { ?s ^ :p ?o }")).toEqual(["o=a s=b"]);
            // a triple pattern followed by another one or a FILTER still parses
            expect(await select(store, "SELECT * { ?s :p ?o . ?o :q ?x FILTER(?x = :c) }")).toEqual(["o=b s=a x=c"]);
        });

        it("reports negated property sets and {n,m} as not supported", async function () {
            var store = await storeWith(chain);
            for (var pattern of ["?s !:p ?o", "?s !(:p|^:q) ?o", "?s :p{2} ?o", "?s :p{1,2} ?o"]) {
                var error = null;
                try {
                    await store.promises.execute(prefixes + "SELECT * { " + pattern + " }");
                } catch (e) {
                    error = e;
                }
                expect(pattern + ": " + (error && error.name)).toBe(pattern + ": NonSupportedSparqlFeatureError");
            }
        });
    });

    describe("one or more (+)", function () {
        it("follows a predicate any number of steps", async function () {
            var store = await storeWith(chain);
            expect(await select(store, "SELECT * { ?a :p+ ?b }")).toEqual([
                "a=x1 b=x2",
                "a=x1 b=x3",
                "a=x1 b=x4",
                "a=x2 b=x3",
                "a=x2 b=x4",
                "a=x3 b=x4",
            ]);
            expect(await select(store, "SELECT * { :x1 :p+ ?b }")).toEqual(["b=x2", "b=x3", "b=x4"]);
            expect(await select(store, "SELECT * { ?a :p+ :x4 }")).toEqual(["a=x1", "a=x2", "a=x3"]);
            expect(await ask(store, "ASK { :x1 :p+ :x4 }")).toBe(true);
            expect(await ask(store, "ASK { :x4 :p+ :x1 }")).toBe(false);
            expect(await ask(store, "ASK { :x1 :p+ :x1 }")).toBe(false);
        });

        it("ends on cycles and returns each pair once", async function () {
            var store = await storeWith(":a :next :b . :b :next :c . :c :next :a . :a :next :c .");
            var pairs = await select(store, "SELECT * { ?x :next+ ?y }");
            expect(pairs.length).toBe(9);
            expect(await select(store, "SELECT * { :a :next+ ?y }")).toEqual(["y=a", "y=b", "y=c"]);
            expect(await select(store, "SELECT * { ?x :next+ ?x }")).toEqual(["x=a", "x=b", "x=c"]);
        });

        it("walks a class hierarchy", async function () {
            var store = await storeWith(
                ":A rdfs:subClassOf :Root . :B rdfs:subClassOf :A . :C rdfs:subClassOf :Other . :i a :B .",
            );
            expect(await select(store, "SELECT ?c { ?c rdfs:subClassOf+ :Root }")).toEqual(["c=A", "c=B"]);
            expect(await select(store, "SELECT ?c { :i a/rdfs:subClassOf* ?c }")).toEqual(["c=A", "c=B", "c=Root"]);
            expect(await select(store, "SELECT ?i { ?i a/rdfs:subClassOf* :Root }")).toEqual(["i=i"]);
        });

        it("applies to groups", async function () {
            var store = await storeWith(chain + ":x4 :p :x5 .");
            expect(await select(store, "SELECT * { :x1 (:p/:p)+ ?b }")).toEqual(["b=x3", "b=x5"]);
            expect(await select(store, "SELECT * { :x3 (:p|^:p)+ ?b }")).toEqual([
                "b=x1",
                "b=x2",
                "b=x3",
                "b=x4",
                "b=x5",
            ]);
        });

        it("keeps a modifier inside brackets", async function () {
            var store = await storeWith(chain + ":x4 :q :end .");
            expect(await select(store, "SELECT * { :x2 (:p+) ?b }")).toEqual(["b=x3", "b=x4"]);
            expect(await select(store, "SELECT * { :x2 (:p*)+ ?b }")).toEqual(["b=x2", "b=x3", "b=x4"]);
            expect(await select(store, "SELECT * { :x2 (:p+)/:q ?b }")).toEqual(["b=end"]);
        });
    });

    describe("zero or more (*) and zero or one (?)", function () {
        it("includes the node itself", async function () {
            var store = await storeWith(chain);
            expect(await select(store, "SELECT * { :x1 :p* ?b }")).toEqual(["b=x1", "b=x2", "b=x3", "b=x4"]);
            expect(await select(store, "SELECT * { ?a :p* :x1 }")).toEqual(["a=x1"]);
            expect(await ask(store, "ASK { :x2 :p* :x2 }")).toBe(true);
            expect(await select(store, "SELECT * { :x1 :p? ?b }")).toEqual(["b=x1", "b=x2"]);
            expect(await select(store, "SELECT * { ?a :p? :x3 }")).toEqual(["a=x2", "a=x3"]);
        });

        it("pairs every node of the graph with itself if both ends are variables", async function () {
            var store = await storeWith(':x1 :p :x2 . :y :q "lit" .');
            expect(await select(store, "SELECT * { ?a :p* ?b }")).toEqual([
                "a=lit b=lit",
                "a=x1 b=x1",
                "a=x1 b=x2",
                "a=x2 b=x2",
                "a=y b=y",
            ]);
            expect(await select(store, "SELECT * { ?a :p? ?b }")).toEqual([
                "a=lit b=lit",
                "a=x1 b=x1",
                "a=x1 b=x2",
                "a=x2 b=x2",
                "a=y b=y",
            ]);
        });

        it("reaches a constant that is not in the store", async function () {
            var store = await storeWith(chain);
            var results = await store.promises.execute(prefixes + "SELECT * { :nowhere :p* ?b }");
            expect(rows(results)).toEqual(["b=nowhere"]);
            expect(results[0].b.token).toBe("uri");
            expect(await select(store, "SELECT * { :nowhere :p+ ?b }")).toEqual([]);
            expect(await select(store, 'SELECT * { "x" :p* ?b }')).toEqual(["b=x"]);
            // also through a zero-length step inside |, / or a modifier
            expect(await select(store, "SELECT * { :nowhere (:p?|:q) ?b }")).toEqual(["b=nowhere"]);
            expect(await select(store, "SELECT * { :nowhere :p?/:q* ?b }")).toEqual(["b=nowhere"]);
            expect(await select(store, "SELECT * { ?a (:p?|:q) :nowhere }")).toEqual(["a=nowhere"]);
            expect(await select(store, "SELECT * { :nowhere (:p?)+ ?b }")).toEqual(["b=nowhere"]);
        });
    });

    describe("inverse (^) and alternative (|)", function () {
        it("follows a predicate backwards", async function () {
            var store = await storeWith(chain);
            expect(await select(store, "SELECT * { :x2 ^:p ?a }")).toEqual(["a=x1"]);
            expect(await select(store, "SELECT * { :x4 ^:p+ ?a }")).toEqual(["a=x1", "a=x2", "a=x3"]);
            expect(await select(store, "SELECT * { :x4 (^:p)* ?a }")).toEqual(["a=x1", "a=x2", "a=x3", "a=x4"]);
            expect(await select(store, "SELECT * { ?a :p/^:p ?b }")).toEqual(["a=x1 b=x1", "a=x2 b=x2", "a=x3 b=x3"]);
        });

        it("matches relations stored in one direction from both sides", async function () {
            var store = await storeWith(":a :knows :b . :c :knows :a .");
            expect(await select(store, "SELECT ?x { :a (:knows|^:knows) ?x }")).toEqual(["x=b", "x=c"]);
            expect(await select(store, "SELECT ?x { :b (:knows|^:knows) ?x }")).toEqual(["x=a"]);
        });

        it("keeps duplicates of alternatives and sequences (no set semantics)", async function () {
            var store = await storeWith(":a :r :b . :a :s :b . :b :t :c .");
            expect(await select(store, "SELECT * { :a (:r|:s) ?x }")).toEqual(["x=b", "x=b"]);
            expect(await select(store, "SELECT * { :a (:r|:s)/:t ?x }")).toEqual(["x=c", "x=c"]);
            expect(await select(store, "SELECT * { :a (:r|:s)+ ?x }")).toEqual(["x=b"]);
        });
    });

    describe("in a query", function () {
        it("joins with the other patterns and filters", async function () {
            var store = await storeWith(chain + ':x1 a :Work . :x3 a :Work . :x4 :label "end" .');
            expect(await select(store, "SELECT ?w ?v { ?w a :Work . ?w :p+ ?v . ?v :label ?l }")).toEqual([
                "v=x4 w=x1",
                "v=x4 w=x3",
            ]);
            expect(await select(store, "SELECT ?b { :x1 :p+ ?b FILTER(?b != :x3) }")).toEqual(["b=x2", "b=x4"]);
            expect(await select(store, "SELECT ?w ?b { ?w a :Work OPTIONAL { ?w :p/:p ?b } }")).toEqual([
                "b= w=x3",
                "b=x3 w=x1",
            ]);
            expect(await select(store, "SELECT ?w { ?w a :Work FILTER EXISTS { ?w :p+ :x4 } }")).toEqual([
                "w=x1",
                "w=x3",
            ]);
            expect(await select(store, "SELECT ?w { ?w a :Work FILTER NOT EXISTS { ?w :p+ :x3 } }")).toEqual(["w=x3"]);
            expect(await select(store, "SELECT ?w { ?w a :Work { ?w :p* :x1 } UNION { ?w :p :x4 } }")).toEqual([
                "w=x1",
                "w=x3",
            ]);
        });

        it("scopes blank nodes and internal variables to the basic graph pattern", async function () {
            var store = await storeWith(chain + ":x1 :q :y1 . :x2 :q :y2 . :x3 a :C .");
            expect(await select(store, "SELECT ?y { [ :p+ :x4 ; :q ?y ] }")).toEqual(["y=y1", "y=y2"]);
            expect(await select(store, "SELECT ?x { ?x :p+ [ a :C ] }")).toEqual(["x=x1", "x=x2"]);
            expect(await select(store, "SELECT * { ?s :p/:p ?o }")).toEqual(["o=x3 s=x1", "o=x4 s=x2"]);
            expect(await select(store, "SELECT * { ?s :p/:p+ ?o . ?o a ?c }")).toEqual(["c=C o=x3 s=x1"]);
            expect(await select(store, "SELECT * { ?s :p/:p* ?o . ?o a ?c }")).toEqual([
                "c=C o=x3 s=x1",
                "c=C o=x3 s=x2",
            ]);
            var counted = await store.promises.execute(prefixes + "SELECT (COUNT(DISTINCT *) AS ?n) { ?s :p/:p ?o }");
            expect(counted[0].n.value).toBe("2");
        });

        it("works in CONSTRUCT and INSERT … WHERE", async function () {
            var store = await storeWith(chain);
            var graph = await store.promises.execute(prefixes + "CONSTRUCT { ?a :reaches ?b } WHERE { ?a :p+ ?b }");
            expect(graph.toArray().length).toBe(6);
            await store.promises.execute(prefixes + "INSERT { ?a :reaches ?b } WHERE { ?a :p+ ?b }");
            expect(await select(store, "SELECT ?b { :x1 :reaches ?b }")).toEqual(["b=x2", "b=x3", "b=x4"]);
        });

        it("notifies observers of changes to the path's predicates", function (done) {
            storeWith(chain).then(function (store) {
                var calls = [];
                store.startObservingQuery(prefixes + "SELECT ?b { :x1 :p+ ?b }", function (results) {
                    calls.push(rows(results));
                    if (calls.length === 1) {
                        // the first call has the current results; insert only after it, or the two calls may swap
                        expect(calls[0]).toEqual(["b=x2", "b=x3", "b=x4"]);
                        store.execute(prefixes + "INSERT DATA { :x4 :p :x5 }", function (err) {
                            expect(err).toBeNull();
                        });
                    } else if (calls.length === 2) {
                        expect(calls[1]).toEqual(["b=x2", "b=x3", "b=x4", "b=x5"]);
                        done();
                    }
                });
            });
        });
    });

    describe("graphs", function () {
        var namedChain = async function () {
            var store = await storeWith(":x1 :p :x2 .", "http://example/g1");
            await load(store, ":x2 :p :x3 .", "http://example/g2");
            return store;
        };

        it("evaluates several default graphs as one", async function () {
            var store = await namedChain();
            expect(await select(store, "SELECT * { ?a :p+ ?b }")).toEqual([]);
            expect(await select(store, "SELECT * FROM :g1 FROM :g2 { ?a :p+ ?b }")).toEqual([
                "a=x1 b=x2",
                "a=x1 b=x3",
                "a=x2 b=x3",
            ]);
        });

        it("evaluates each named graph on its own", async function () {
            var store = await namedChain();
            var named = "FROM NAMED :g1 FROM NAMED :g2 ";
            expect(await select(store, "SELECT * " + named + "{ GRAPH ?g { ?a :p+ ?b } }")).toEqual([
                "a=x1 b=x2 g=g1",
                "a=x2 b=x3 g=g2",
            ]);
            expect(await select(store, "SELECT * " + named + "{ GRAPH ?g { :x1 :p* ?y } }")).toEqual([
                "g=g1 y=x1",
                "g=g1 y=x2",
                "g=g2 y=x1",
            ]);
            expect(await select(store, "SELECT * " + named + "{ GRAPH ?g { :x1 :p* :x1 } }")).toEqual(["g=g1", "g=g2"]);
            expect(await select(store, "SELECT * { GRAPH :g2 { ?a :p* :x3 } }")).toEqual(["a=x2", "a=x3"]);
            expect(await select(store, "SELECT * { GRAPH :g3 { :x1 :p* ?y } }")).toEqual([]);
        });

        it("joins a path with the triple patterns of the same graph only", async function () {
            var store = await namedChain();
            await load(store, ":s :q :x1 .", "http://example/g1");
            var named = "FROM NAMED :g1 FROM NAMED :g2 ";
            expect(await select(store, "SELECT * " + named + "{ GRAPH ?g { ?s :q ?m . ?m :p* ?o } }")).toEqual([
                "g=g1 m=x1 o=x1 s=s",
                "g=g1 m=x1 o=x2 s=s",
            ]);
        });
    });

    it("handles long chains without a stack overflow, also joined with other patterns", async function () {
        var triples = [":start :q :n0 .", ":i a :n0 ."];
        for (var i = 0; i < 20000; i++) {
            triples.push(":n" + i + " :p :n" + (i + 1) + " .");
        }
        var store = await storeWith(triples.join("\n"));
        var count = async function (query) {
            var counted = await store.promises.execute(prefixes + "SELECT (COUNT(*) AS ?n) { " + query + " }");
            return counted[0].n.value;
        };
        expect(await count(":n0 :p+ ?b")).toBe("20000");
        expect(await ask(store, "ASK { :n20000 ^:p+ :n0 }")).toBe(true);
        // the path starts only at the values the triple pattern binds (else quadratic in the chain length)
        expect(await count(":start :q ?s . ?s :p+ ?o")).toBe("20000");
        expect(await count("?o ^:p+ ?s . ?s ^:q :start")).toBe("20000");
        expect(await count(":i a/:p* ?o")).toBe("20001");
    }, 60000);
});
