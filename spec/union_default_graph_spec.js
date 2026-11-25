var rdfstore = require("../src/store");

describe("Default graph", function () {

    var prefixes = "PREFIX : <http://example/> ";

    var load = function (store, turtle, graph) {
        return store.promises.load("text/turtle", "@prefix : <http://example/> . " + turtle, graph);
    };

    // the solutions as sorted "var=localName" strings
    var rows = function (results) {
        return results.map(function (solution) {
            return Object.keys(solution).sort().map(function (name) {
                var term = solution[name];
                return name + "=" + (term == null ? "" : String(term.value).replace("http://example/", ""));
            }).join(" ");
        }).sort();
    };

    var select = async function (store, query, defaultGraphs, namedGraphs) {
        if (defaultGraphs == null) {
            return rows(await store.promises.execute(prefixes + query));
        }
        return rows(await store.promises.execute(prefixes + query, defaultGraphs, namedGraphs));
    };

    // :shared is in both named graphs
    var layers = async function (options) {
        var store = await rdfstore.promises.create(options);
        await load(store, ":d :p :x .");
        await load(store, ":w1 a :Work . :shared :p :y .", "http://example/g1");
        await load(store, ":w1 :p :o1 . :shared :p :y .", "http://example/g2");
        return store;
    };

    describe("from several graphs", function () {
        it("is their merge: a triple in several of them comes back once", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * FROM :g1 FROM :g2 { ?s :p ?o }")).toEqual(
                ["o=o1 s=w1", "o=y s=shared"]);
            expect(await select(store, "SELECT (COUNT(*) AS ?n) FROM :g1 FROM :g2 { ?s ?p ?o }")).toEqual(["n=3"]);
            expect(await select(store, "SELECT * { ?s :p ?o }", ["http://example/g1", "http://example/g2"], [])).toEqual(
                ["o=o1 s=w1", "o=y s=shared"]);
        });

        it("joins across the graphs", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * FROM :g1 FROM :g2 { ?w a :Work . ?w :p ?o }")).toEqual(["o=o1 w=w1"]);
        });

        it("keeps the triples of a single graph", async function () {
            var store = await layers();
            expect(await select(store, "SELECT * FROM :g1 FROM :g1 { ?s :p ?o }")).toEqual(["o=y s=shared"]);
        });
    });
});
