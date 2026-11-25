var rdfstore = require("../src/store");

describe("Property paths", function () {

    var prefixes = "PREFIX : <http://example/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ";

    var storeWith = async function (turtle) {
        var store = await rdfstore.promises.create();
        await store.promises.load("text/turtle", "@prefix : <http://example/> . " +
            "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . " + turtle);
        return store;
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

    var select = async function (store, query) {
        return rows(await store.promises.execute(prefixes + query));
    };

    describe("syntax", function () {
        it("allows whitespace around / and | and inside groups", async function () {
            var store = await storeWith(":a :p :b . :b :q :c .");
            expect(await select(store, "SELECT ?s ?o { ?s :p / :q ?o }")).toEqual(["o=c s=a"]);
            expect(await select(store, "SELECT ?s ?o { ?s ( :p / :q ) ?o }")).toEqual(["o=c s=a"]);
            // a triple pattern followed by another one or a FILTER still parses
            expect(await select(store, "SELECT * { ?s :p ?o . ?o :q ?x FILTER(?x = :c) }")).toEqual(["o=b s=a x=c"]);
        });
    });
});
