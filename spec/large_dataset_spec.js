var Store = require("../src/store");

describe("Store with a large dataset", function () {
    // Traversing large BTree ranges (e.g. a full scan) used to overflow the call stack
    // (RangeError: Maximum call stack size exceeded), see utils.whilst.
    it("should load and query 100000 triples", async function () {
        var numTriples = 100000;
        var numPredicates = 10;

        var turtle = "@prefix ex: <http://example.org/> .\n";
        for (var i = 0; i < numTriples; i++) {
            turtle += "ex:s" + i + " ex:p" + (i % numPredicates) + ' "v' + i + '" .\n';
        }

        var store = await Store.promises.create();

        var loaded = await store.promises.load("text/turtle", turtle);
        expect(loaded).toBe(numTriples);

        var results = await store.promises.execute("SELECT ?s ?o WHERE { ?s <http://example.org/p3> ?o }");
        expect(results.length).toBe(numTriples / numPredicates);

        results = await store.promises.execute("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
        expect(results.length).toBe(numTriples);

        results = await store.promises.execute("SELECT ?s ?o2 WHERE { ?s <http://example.org/p3> ?o . ?s ?p ?o2 }");
        expect(results.length).toBe(numTriples / numPredicates);

        await store.promises.close();
    }, 60000);

    // Guards the hash lookup in leftOuterJoinBindings: a nested loop takes about 11 s here.
    it("should evaluate OPTIONAL over 32000 solutions", async function () {
        var numSubjects = 32000;

        var turtle = "@prefix ex: <http://example.org/> .\n";
        for (var i = 0; i < numSubjects; i++) {
            turtle += "ex:s" + i + ' ex:p "v' + i + '" .\n';
            if (i % 2 === 0) {
                turtle += "ex:s" + i + ' ex:q "w' + i + '" .\n';
            }
        }

        var store = await Store.promises.create();

        await store.promises.load("text/turtle", turtle);

        var results = await store.promises.execute(
            "SELECT ?s ?o ?x WHERE { ?s <http://example.org/p> ?o OPTIONAL { ?s <http://example.org/q> ?x } }",
        );
        expect(results.length).toBe(numSubjects);

        var bound = 0;
        for (i = 0; i < results.length; i++) {
            if (results[i].x != null) {
                expect(results[i].x.value).toBe("w" + results[i].o.value.substring(1));

                bound++;
            }
        }
        expect(bound).toBe(numSubjects / 2);

        await store.promises.close();
    }, 60000);
});
