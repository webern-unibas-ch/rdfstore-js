var Store = require("../src/store");
var Lexicon = require("../src/lexicon").Lexicon;

describe("Language tags", function () {
    var withStore = async function (turtle) {
        var store = await Store.promises.create();
        if (turtle != null) {
            await store.promises.load("text/turtle", turtle);
        }
        return store;
    };

    it("should parse stored literals whose tag has digits or several subtags", async function () {
        var lexicon = await new Promise(function (resolve) {
            new Lexicon(resolve);
        });
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
    });

    it("should return loaded literals with a tag that has digits", async function () {
        var store = await withStore('<http://b> <http://p> "y"@es-419 .');

        var results = await store.promises.execute("SELECT ?o (LANG(?o) AS ?l) { ?s <http://p> ?o }");
        expect(results.length).toBe(1);
        expect(results[0].o.value).toBe("y");
        expect(results[0].o.lang).toBe("es-419");
        expect(results[0].l.value).toBe("es-419");
    });

    it("should keep every subtag of a tag in a query", async function () {
        var store = await withStore('<http://b> <http://p> "y"@sr-Latn-RS .');

        var results = await store.promises.execute('SELECT ?s { ?s <http://p> "y"@sr-Latn-RS }');
        expect(results.length).toBe(1);

        results = await store.promises.execute('SELECT ?s { ?s <http://p> ?o FILTER(?o = "y"@SR-latn-rs) }');
        expect(results.length).toBe(1);

        results = await store.promises.execute('SELECT ("a"@de-CH-1901 AS ?x) {}');
        expect(results[0].x.lang).toBe("de-ch-1901");
    });

    it("should match the range or the range followed by '-' with LANGMATCHES", async function () {
        var store = await withStore(
            '<http://a> <http://p> "a"@en . <http://b> <http://p> "b"@en-GB . ' +
                '<http://c> <http://p> "c"@eng . <http://d> <http://p> "d" .',
        );

        var results = await store.promises.execute(
            'SELECT ?s { ?s <http://p> ?o FILTER(LANGMATCHES(LANG(?o), "EN")) } ORDER BY ?s',
        );
        expect(
            results.map(function (r) {
                return r.s.value;
            }),
        ).toEqual(["http://a", "http://b"]);

        results = await store.promises.execute(
            'SELECT ?s { ?s <http://p> ?o FILTER(LANGMATCHES(LANG(?o), "*")) } ORDER BY ?s',
        );
        expect(
            results.map(function (r) {
                return r.s.value;
            }),
        ).toEqual(["http://a", "http://b", "http://c"]);
    });

    it("should store a tag from a custom parser in lower case", async function () {
        var store = await withStore(null);

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
        await store.promises.load("x-test/lang", "data");

        var results = await store.promises.execute(
            'SELECT ?s (LANG(?o) AS ?l) { ?s <http://p> ?o . ?s <http://p> "x"@en-gb }',
        );
        expect(results.length).toBe(1);
        expect(results[0].l.value).toBe("en-gb");
    });

    it("should keep tag and datatype of token-form literals from a custom parser", async function () {
        var store = await withStore(null);

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
        await store.promises.load("x-test/token", "data");

        var results = await store.promises.execute("SELECT ?s ?o { ?s <http://p> ?o } ORDER BY ?s");
        expect(
            results.map(function (r) {
                return [r.s.value, r.o.value, r.o.lang, r.o.type];
            }),
        ).toEqual([
            ["http://a", "x", "en", undefined],
            ["http://b", "1", undefined, "http://www.w3.org/2001/XMLSchema#integer"],
            ["http://c", "z", undefined, undefined],
        ]);
    });

    it("should find a loaded xsd:hexBinary value in any case", async function () {
        var store = await withStore('<http://b> <http://h> "0A"^^<http://www.w3.org/2001/XMLSchema#hexBinary> .');

        var results = await store.promises.execute(
            'SELECT ?s { ?s <http://h> "0a"^^<http://www.w3.org/2001/XMLSchema#hexBinary> }',
        );
        expect(results.length).toBe(1);

        results = await store.promises.execute(
            'SELECT ?s { ?s <http://h> "0A"^^<http://www.w3.org/2001/XMLSchema#hexBinary> }',
        );
        expect(results.length).toBe(1);
    });
});
