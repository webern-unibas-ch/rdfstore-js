// Comprehensive test script to verify all rdfstore-js functionality
var rdfstore = require("../src/store");

console.log("🔧 E2E Test 2/4: Comprehensive Integration");
console.log("==========================================");

// 1. Create store
rdfstore.create(function (err, store) {
    if (err) {
        console.error("❌ Error creating store:", err);
        return;
    }

    console.log("✅ Store created");

    // 2. Load some RDF data in Turtle format
    var turtleData = `
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix person: <http://example.org/person/> .
        
        person:john foaf:name "John Doe" .
        person:john foaf:age "30"^^<http://www.w3.org/2001/XMLSchema#integer> .
        person:jane foaf:name "Jane Smith" .
        person:jane foaf:knows person:john .
    `;

    store.load("text/turtle", turtleData, function (err, numTriples) {
        if (err) {
            console.error("❌ Error loading data:", err);
            return;
        }

        console.log(`✅ Loaded ${numTriples} triples`);

        // 3. Query the data with SPARQL
        console.log("\nRunning SPARQL queries...\n");

        // Query 1: Get all people and their names
        store.execute(
            "PREFIX foaf: <http://xmlns.com/foaf/0.1/> SELECT ?person ?name WHERE { ?person foaf:name ?name }",
            function (err, results) {
                if (err) {
                    console.error("❌ Error in query 1:", err);
                    return;
                }

                console.log("Query 1 - All people and names:");
                results.forEach(function (result, i) {
                    console.log(`  ${i + 1}. Person: ${result.person.value}, Name: ${result.name.value}`);
                });

                // Query 2: Get John's information
                store.execute(
                    "PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX person: <http://example.org/person/> SELECT ?property ?value WHERE { person:john ?property ?value }",
                    function (err, results) {
                        if (err) {
                            console.error("❌ Error in query 2:", err);
                            return;
                        }

                        console.log("\nQuery 2 - John's information:");
                        results.forEach(function (result, i) {
                            console.log(`  ${i + 1}. Property: ${result.property.value}, Value: ${result.value.value}`);
                        });

                        // Query 3: ASK query - Does Jane know John?
                        store.execute(
                            "PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX person: <http://example.org/person/> ASK { person:jane foaf:knows person:john }",
                            function (err, result) {
                                if (err) {
                                    console.error("❌ Error in ASK query:", err);
                                    return;
                                }

                                console.log(`\nQuery 3 - Does Jane know John? ${result ? "Yes" : "No"}`);

                                // Query 4: CONSTRUCT query - Build a new graph
                                store.execute(
                                    "PREFIX foaf: <http://xmlns.com/foaf/0.1/> CONSTRUCT { ?person a foaf:Person } WHERE { ?person foaf:name ?name }",
                                    function (err, graph) {
                                        if (err) {
                                            console.error("❌ Error in CONSTRUCT query:", err);
                                            return;
                                        }

                                        console.log(
                                            `\nQuery 4 - CONSTRUCT result: Built graph with ${graph.length} triples`,
                                        );
                                        graph.forEach(function (triple, i) {
                                            console.log(
                                                `  ${i + 1}. ${triple.subject.valueOf()} ${triple.predicate.valueOf()} ${triple.object.valueOf()}`,
                                            );
                                        });

                                        console.log("\n✅ Comprehensive E2E test passed!\n");

                                        // Clean up
                                        store.close();
                                    },
                                );
                            },
                        );
                    },
                );
            },
        );
    });
});
