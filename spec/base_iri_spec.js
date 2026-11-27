var rdfstore = require("../src/store");
var Utils = require("../src/utils");

describe("Relative IRIs", function () {
    describe("Utils.resolveIri", function () {
        // RFC 3986 section 5.4
        var base = "http://a/b/c/d;p?q";
        var examples = {
            "g:h": "g:h",
            g: "http://a/b/c/g",
            "./g": "http://a/b/c/g",
            "g/": "http://a/b/c/g/",
            "/g": "http://a/g",
            "//g": "http://g",
            "?y": "http://a/b/c/d;p?y",
            "g?y": "http://a/b/c/g?y",
            "#s": "http://a/b/c/d;p?q#s",
            "g#s": "http://a/b/c/g#s",
            "g?y#s": "http://a/b/c/g?y#s",
            ";x": "http://a/b/c/;x",
            "g;x": "http://a/b/c/g;x",
            "g;x?y#s": "http://a/b/c/g;x?y#s",
            "": "http://a/b/c/d;p?q",
            ".": "http://a/b/c/",
            "./": "http://a/b/c/",
            "..": "http://a/b/",
            "../": "http://a/b/",
            "../g": "http://a/b/g",
            "../..": "http://a/",
            "../../": "http://a/",
            "../../g": "http://a/g",
            // abnormal
            "../../../g": "http://a/g",
            "../../../../g": "http://a/g",
            "/./g": "http://a/g",
            "/../g": "http://a/g",
            "g.": "http://a/b/c/g.",
            ".g": "http://a/b/c/.g",
            "g..": "http://a/b/c/g..",
            "..g": "http://a/b/c/..g",
            "./../g": "http://a/b/g",
            "./g/.": "http://a/b/c/g/",
            "g/./h": "http://a/b/c/g/h",
            "g/../h": "http://a/b/c/h",
            "g;x=1/./y": "http://a/b/c/g;x=1/y",
            "g;x=1/../y": "http://a/b/c/y",
            "g?y/./x": "http://a/b/c/g?y/./x",
            "g?y/../x": "http://a/b/c/g?y/../x",
            "g#s/./x": "http://a/b/c/g#s/./x",
            "g#s/../x": "http://a/b/c/g#s/../x",
            "http:g": "http:g",
        };

        it("resolves the examples of RFC 3986", function () {
            Object.keys(examples).forEach(function (reference) {
                expect(reference + " -> " + Utils.resolveIri(base, reference)).toBe(
                    reference + " -> " + examples[reference],
                );
            });
        });

        it("keeps IRIs as written", function () {
            // no percent-encoding, no case change (unlike WHATWG URL)
            expect(Utils.resolveIri("http://Example.org/dir/", "ä b")).toBe("http://Example.org/dir/ä b");
            expect(Utils.resolveIri("http://example.org/", "HTTP://Example.org/../x")).toBe("HTTP://Example.org/../x");
            expect(Utils.resolveIri("http://example.org", "x")).toBe("http://example.org/x");
            // a colon in the first segment but no valid scheme: not a relative reference, kept
            expect(Utils.resolveIri("http://x/dir/q", "a_b:c")).toBe("a_b:c");
            // without a base, or with a base without a scheme
            expect(Utils.resolveIri(null, "x")).toBe("x");
            expect(Utils.resolveIri("rel/", "x")).toBe("rel/x");
        });
    });

    describe("in queries", function () {
        var store;

        beforeEach(async function () {
            store = await rdfstore.promises.create();
            await store.promises.execute(
                "INSERT DATA { <http://x/dir/s> <http://x/dir/p> <http://x/o> . " +
                    "GRAPH <http://x/dir/g.ttl> { <http://x/dir/s> <http://x/dir/p> <http://x/dir/sub/o#f> } }",
            );
        });

        var values = async function (query, variable) {
            var results = await store.promises.execute(query);
            return results
                .map(function (solution) {
                    return solution[variable].value;
                })
                .sort();
        };

        it("resolve against a BASE that does not end with /", async function () {
            var base = "BASE <http://x/dir/q.rq> ";
            expect(await values(base + "SELECT ?o { <s> <p> ?o }", "o")).toEqual(["http://x/o"]);
            expect(await values(base + "SELECT ?o { GRAPH <g.ttl> { <s> <p> ?o } }", "o")).toEqual([
                "http://x/dir/sub/o#f",
            ]);
            expect(await values(base + "SELECT ?s { ?s <p> <../o> }", "s")).toEqual(["http://x/dir/s"]);
            expect(await values(base + "SELECT ?s { GRAPH <g.ttl> { ?s </dir/p> <sub/o#f> } }", "s")).toEqual([
                "http://x/dir/s",
            ]);
            expect(await values(base + "SELECT (<#frag> AS ?x) {}", "x")).toEqual(["http://x/dir/q.rq#frag"]);
        });

        it("resolve each BASE and PREFIX against the BASE before it", async function () {
            expect(await values("BASE <http://x/> BASE <dir/> SELECT ?o { <s> <p> ?o }", "o")).toEqual(["http://x/o"]);
            expect(await values("BASE <http://x/> PREFIX : <dir/> SELECT ?o { :s :p ?o }", "o")).toEqual([
                "http://x/o",
            ]);
            // a PREFIX keeps the BASE in effect where it is declared
            expect(
                await values("BASE <http://x/dir/> PREFIX : <> BASE <http://other/> SELECT ?o { :s :p ?o }", "o"),
            ).toEqual(["http://x/o"]);
        });

        it("resolve in updates", async function () {
            await store.promises.execute("BASE <http://x/dir/q.rq> INSERT DATA { <s> <q> <../new> }");
            expect(await values("SELECT ?o { <http://x/dir/s> <http://x/dir/q> ?o }", "o")).toEqual(["http://x/new"]);
            // the declarations of an operation also apply to the ones after it, not to those before
            await store.promises.execute(
                "INSERT DATA { <http://x/a> <http://x/b> <first> }; " +
                    "BASE <http://x/dir/> PREFIX ex: <http://ex/> INSERT DATA { <s> ex:p <o> }; INSERT DATA { <s> ex:p <o2> }",
            );
            expect(await values("SELECT ?o { <http://x/dir/s> <http://ex/p> ?o }", "o")).toEqual([
                "http://x/dir/o",
                "http://x/dir/o2",
            ]);
            expect(await values("SELECT ?o { <http://x/a> <http://x/b> ?o }", "o")).toEqual(["first"]);
        });

        it("keep an undeclared prefixed name as written", async function () {
            await store.promises.execute("BASE <http://x/dir/> INSERT DATA { <s> my_ns:p <o> }");
            expect(await values("SELECT ?p { <http://x/dir/s> ?p <http://x/dir/o> }", "p")).toEqual(["my_ns:p"]);
        });

        it("are not resolved again when a stored IRI is cast to xsd:string", async function () {
            await store.promises.execute("INSERT DATA { <http://x/dir/s> <http://x/dir/r> <a/../c> }");
            var results = await store.promises.execute(
                "BASE <http://other/> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> " +
                    "SELECT (xsd:string(?o) AS ?v) (xsd:string(<rel>) AS ?k) { <http://x/dir/s> <http://x/dir/r> ?o }",
            );
            expect(results[0].v.value).toBe("a/../c");
            expect(results[0].k.value).toBe("http://other/rel");
        });
    });
});
