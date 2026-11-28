var Store = require("../src/store");

describe("Store", function () {
    describe("execute", function () {
        it("should insert a triple and select it", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                "INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }",
            );

            var results = await store.promises.execute("SELECT * { ?s ?p ?o }");

            expect(results.length).toBe(1);
            expect(results[0].s.value).toBe("http://example/book3");
            expect(results[0].p.value).toBe("http://example.com/vocab#title");
            expect(results[0].o.value).toBe("http://test.com/example");
            await store.promises.close();
        });

        it("should insert a triple and select it with B-tree order 50", async function () {
            var store = await Store.promises.create({ treeOrder: 50, name: "test", overwrite: true });

            await store.promises.execute(
                "INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }",
            );

            var results = await store.promises.execute("SELECT * { ?s ?p ?o }");

            expect(results.length).toBe(1);
            expect(results[0].s.value).toBe("http://example/book3");
            expect(results[0].p.value).toBe("http://example.com/vocab#title");
            expect(results[0].o.value).toBe("http://test.com/example");

            await store.promises.close();
        });

        it("should store a triple inserted twice once (DuplicatedInsert)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                "INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }",
            );

            await store.promises.execute(
                "INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }",
            );

            var results = await store.promises.execute("SELECT * { ?s ?p ?o }");

            expect(results.length).toBe(1);
            expect(results[0].s.value).toBe("http://example/book3");
            expect(results[0].p.value).toBe("http://example.com/vocab#title");
            expect(results[0].o.value).toBe("http://test.com/example");

            await store.promises.close();
        });

        it("should return one blank node per solution from a CONSTRUCT template (ConstructBlankNodes)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var uriGraph = "http://www.example.com/data.ttl";
            var triplesTTL =
                "@prefix foaf: <http://xmlns.com/foaf/0.1/> . <http://www.example.com/resource/12645> a foaf:Person . ";

            await store.promises.load("text/turtle", triplesTTL, uriGraph);

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                         PREFIX test: <http://vocab.netlabs.org/test#>\
                         CONSTRUCT {\
                            ?s test:item [\
                              a test:Item;\
                              test:prop1 "Value of property 1";\
                              test:prop2 "Value of property 2"\
                            ] .\
                         }\
                         FROM <' +
                uriGraph +
                ">\
                         WHERE {\
                           ?s a foaf:Person .\
                         }";

            var graph = await store.promises.execute(query);

            var distinctBlankSubjects = {};
            var triples = graph.toArray();
            var triple;
            expect(triples.length).toBe(4);
            for (var i = 0; i < triples.length; i++) {
                triple = triples[i];
                if (triple.subject.interfaceName === "BlankNode") {
                    distinctBlankSubjects[triple.subject.bnodeId] = true;
                } else {
                    expect(triple.subject.valueOf()).toBe("http://www.example.com/resource/12645");
                    expect(triple.object.interfaceName).toBe("BlankNode");
                    distinctBlankSubjects[triple.object.bnodeId] = true;
                }
            }

            var numDistinctBlankSujects = Object.keys(distinctBlankSubjects).length;

            expect(numDistinctBlankSujects).toBe(1);
            await store.promises.close();
        });

        it("should match a variable used twice in a pattern only to equal terms (RedundantVars1)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load("text/n3", "<http://A> <http://B> <http://C>.");

            var results = await store.promises.execute("SELECT *  WHERE { ?x ?p ?x }");

            expect(results.length).toBe(0);
        });

        it("should select the triples whose subject equals their object (RedundantVars2)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                "<http://C> <http://B> <http://C>.\
                 <http://D> <http://E> <http://F>.",
            );

            var results = await store.promises.execute("SELECT *  WHERE { ?x ?p ?x }");

            expect(results.length).toBe(1);
        });

        it("should construct nothing when a repeated variable matches no triple (RedundantVars3)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load("text/n3", "<http://A> <http://B> <http://C>.");

            var results = await store.promises.execute("CONSTRUCT { ?x ?p ?x }  WHERE { ?x ?p ?x }");

            var counter = 0;
            results.triples.forEach(function (result) {
                counter++;
            });

            expect(counter).toBe(0);
        });

        it("should construct the triples whose subject equals their object (RedundantVars4)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                "<http://C> <http://B> <http://C>.\
                 <http://D> <http://E> <http://F>.",
            );

            var results = await store.promises.execute("CONSTRUCT { ?x ?p ?x }  WHERE { ?x ?p ?x }");

            var counter = 0;
            results.triples.forEach(function (result) {
                counter++;
            });

            expect(counter).toBe(1);
        });

        it("should execute requests that end in whitespace", async function () {
            var store = await Store.promises.create();
            var requests = [
                "INSERT DATA { <http://example/s> <http://example/p> <http://example/o> }\n",
                "CREATE SILENT GRAPH <http://example/g> ;\n# comment\n",
                "DELETE WHERE { ?s ?p ?o }\n",
                "CLEAR DEFAULT\n",
                "DROP SILENT GRAPH <http://example/g>\t\n",
                "CREATE GRAPH <http://example/g2> ;\nCLEAR SILENT GRAPH <http://example/g2>\n\n",
            ];
            for (var i = 0; i < requests.length; i++) {
                await expectAsync(store.promises.execute(requests[i]))
                    .withContext(JSON.stringify(requests[i]))
                    .toBeResolved();
            }
        });

        it("should report a VALUES block after the query as not supported, not as a syntax error", async function () {
            var store = await Store.promises.create();
            await store.promises.execute(
                "INSERT DATA { <http://example/a> <http://example/p> 1 . <http://example/b> <http://example/p> 2 }",
            );
            var queries = [
                "SELECT ?s { ?s ?p ?o } VALUES ?s { <http://example/a> }\n",
                "SELECT ?s { ?s ?p ?o } VALUES (?s) { (<http://example/a>) }",
            ];
            for (var i = 0; i < queries.length; i++) {
                await expectAsync(store.promises.execute(queries[i]))
                    .withContext(JSON.stringify(queries[i]))
                    .toBeRejectedWith(jasmine.objectContaining({ name: "NonSupportedSparqlFeatureError" }));
            }
        });
    });

    describe("graphs and nodes", function () {
        it("should return the default graph and filter it", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                     :alice\
                         rdf:type        foaf:Person ;\
                         foaf:name       "Alice" ;\
                         foaf:mbox       <mailto:alice@work> ;\
                         foaf:knows      :bob \
                         .\
                     :bob\
                         rdf:type        foaf:Person ;\
                         foaf:name       "Bob" ; \
                         foaf:knows      :alice ;\
                         foaf:mbox       <mailto:bob@home> \
                         .\
                     }';
            await store.promises.execute(query);

            var graph = await store.promises.graph();

            var results = graph.filter(store.rdf.filters.describes("http://example.org/people/alice"));

            var resultsCount = results.toArray().length;

            var resultsSubject = results.filter(store.rdf.filters.s("http://example.org/people/alice"));
            var resultsObject = results.filter(store.rdf.filters.o("http://example.org/people/alice"));

            expect(resultsObject.toArray().length).toBe(1);
            expect(resultsObject.toArray().length + resultsSubject.toArray().length).toBe(resultsCount);

            await store.promises.close();
        });

        it("should return the default graph and a named graph", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                       GRAPH :alice {\
                         :alice\
                             rdf:type        foaf:Person ;\
                             foaf:name       "Alice" ;\
                             foaf:mbox       <mailto:alice@work> ;\
                             foaf:knows      :bob \
                         .\
                       }\
                     }';
            await store.promises.execute(query);

            query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                         PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                         PREFIX : <http://example.org/people/>\
                         INSERT DATA {\
                           GRAPH :bob {\
                              :bob\
                                  rdf:type        foaf:Person ;\
                                  foaf:name       "Bob" ; \
                                  foaf:knows      :alice ;\
                                  foaf:mbox       <mailto:bob@home> \
                                  .\
                           }\
                         }';
            await store.promises.execute(query);

            var graph = await store.promises.graph();

            expect(graph.toArray().length).toBe(0);

            var results = await store.promises.graph("http://example.org/people/alice");

            expect(results.toArray().length).toBe(4);
            await store.promises.close();
        });

        it("should return the triples of a node", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                     :alice\
                         rdf:type        foaf:Person ;\
                         foaf:name       "Alice" ;\
                         foaf:mbox       <mailto:alice@work> ;\
                         foaf:knows      :bob \
                         .\
                     :bob\
                         rdf:type        foaf:Person ;\
                         foaf:name       "Bob" ; \
                         foaf:knows      :alice ;\
                         foaf:mbox       <mailto:bob@home> \
                         .\
                     }';
            await store.promises.execute(query);

            var graph = await store.promises.node("http://example.org/people/alice");

            expect(graph.toArray().length).toBe(4);
            await store.promises.close();
        });

        it("should return the triples of a node in a named graph", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                       GRAPH :alice {\
                         :alice\
                             rdf:type        foaf:Person ;\
                             foaf:name       "Alice" ;\
                             foaf:mbox       <mailto:alice@work> ;\
                             foaf:knows      :bob \
                         .\
                       }\
                     }';
            await store.promises.execute(query);

            query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                         PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                         PREFIX : <http://example.org/people/>\
                         INSERT DATA {\
                           GRAPH :bob {\
                              :bob\
                                  rdf:type        foaf:Person ;\
                                  foaf:name       "Bob" ; \
                                  foaf:knows      :alice ;\
                                  foaf:mbox       <mailto:bob@home> \
                                  .\
                           }\
                         }';
            await store.promises.execute(query);

            var graph = await store.promises.graph();

            expect(graph.toArray().length).toBe(0);

            var results = await store.promises.node(
                "http://example.org/people/alice",
                "http://example.org/people/alice",
            );

            expect(results.toArray().length).toBe(4);
            await store.promises.close();
        });

        it("should list the registered graphs (RegisteredGraph)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                       GRAPH :alice {\
                         :alice\
                             rdf:type        foaf:Person ;\
                             foaf:name       "Alice" ;\
                             foaf:mbox       <mailto:alice@work> ;\
                             foaf:knows      :bob \
                         .\
                       }\
                     }';
            await store.promises.execute(query);

            query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                         PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                         PREFIX : <http://example.org/people/>\
                         INSERT DATA {\
                           GRAPH :bob {\
                              :bob\
                                  rdf:type        foaf:Person ;\
                                  foaf:name       "Bob" ; \
                                  foaf:knows      :alice ;\
                                  foaf:mbox       <mailto:bob@home> \
                                  .\
                           }\
                         }';
            await store.promises.execute(query);

            var graphs = await store.promises.registeredGraphs();

            expect(graphs.length).toBe(2);
            var values = [];
            for (var i = 0; i < graphs.length; i++) {
                values.push(graphs[i].valueOf());
            }
            values.sort();
            expect(values[0]).toBe("http://example.org/people/alice");
            expect(values[1]).toBe("http://example.org/people/bob");
            await store.promises.close();
        });

        it("should bind GRAPH variables to the graph names", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                '@prefix dc: <http://purl.org/dc/elements/1.1/> .\
                 <http://example.org/bob>    dc:publisher  "Bob Hacker" .\
                <http://example.org/alice>  dc:publisher  "Alice Hacker" .',
            );

            await store.promises.load(
                "text/n3",
                '@prefix foaf: <http://xmlns.com/foaf/0.1/> .\
                            _:a foaf:name "Bob" .\
                        _:a foaf:mbox <mailto:bob@oldcorp.example.org> .',
                "http://example.org/bob",
            );

            await store.promises.load(
                "text/n3",
                '@prefix foaf: <http://xmlns.com/foaf/0.1/> .\
                                _:a foaf:name "Alice" .\
                                _:a foaf:mbox <mailto:alice@work.example.org> .',
                "http://example.org/alice",
            );

            var results = await store.promises.execute(
                "PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                                            PREFIX dc: <http://purl.org/dc/elements/1.1/>\
                                            SELECT ?who ?g ?mbox\
                                        FROM <http://example.org/dft.ttl>\
                                            FROM NAMED <http://example.org/alice>\
                                            FROM NAMED <http://example.org/bob>\
                                            WHERE\
                                        {\
                                            ?g dc:publisher ?who .\
                                            GRAPH ?g { ?x foaf:mbox ?mbox }\
                                    }",
                ["https://github.com/antoniogarrote/rdfstore-js#default_graph"],
                ["http://example.org/alice", "http://example.org/bob"],
            );
            expect(results.length).toBe(2);
            // no ORDER BY: the order of the rows is not defined
            results.sort(function (a, b) {
                return a.who.value < b.who.value ? -1 : 1;
            });
            expect(results[0].who.value).toBe("Alice Hacker");
            expect(results[0].g.value).toBe("http://example.org/alice");
            expect(results[0].mbox.value).toBe("mailto:alice@work.example.org");

            expect(results[1].who.value).toBe("Bob Hacker");
            expect(results[1].g.value).toBe("http://example.org/bob");
            expect(results[1].mbox.value).toBe("mailto:bob@oldcorp.example.org");
        });
    });

    describe("prefixes", function () {
        it("should resolve CURIEs with the prefixes set by setPrefix", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                       GRAPH :alice {\
                         :alice\
                             rdf:type        foaf:Person ;\
                             foaf:name       "Alice" ;\
                             foaf:mbox       <mailto:alice@work> ;\
                             foaf:knows      :bob \
                         .\
                       }\
                     }';
            await store.promises.execute(query);

            query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                         PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                         PREFIX : <http://example.org/people/>\
                         INSERT DATA {\
                           GRAPH :bob {\
                              :bob\
                                  rdf:type        foaf:Person ;\
                                  foaf:name       "Bob" ; \
                                  foaf:knows      :alice ;\
                                  foaf:mbox       <mailto:bob@home> \
                                  .\
                           }\
                         }';
            await store.promises.execute(query);

            store.setPrefix("ex", "http://example.org/people/");
            var graph = await store.promises.graph();

            expect(graph.toArray().length).toBe(0);

            var results = await store.promises.node("ex:alice", "ex:alice");

            expect(results.toArray().length).toBe(4);
            await store.promises.close();
        });

        it("should resolve CURIEs with the default prefix", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                     PREFIX : <http://example.org/people/>\
                     INSERT DATA {\
                       GRAPH :alice {\
                         :alice\
                             rdf:type        foaf:Person ;\
                             foaf:name       "Alice" ;\
                             foaf:mbox       <mailto:alice@work> ;\
                             foaf:knows      :bob \
                         .\
                       }\
                     }';
            await store.promises.execute(query);

            query =
                'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
                         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                         PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
                         PREFIX : <http://example.org/people/>\
                         INSERT DATA {\
                           GRAPH :bob {\
                              :bob\
                                  rdf:type        foaf:Person ;\
                                  foaf:name       "Bob" ; \
                                  foaf:knows      :alice ;\
                                  foaf:mbox       <mailto:bob@home> \
                                  .\
                           }\
                         }';
            await store.promises.execute(query);

            store.setDefaultPrefix("http://example.org/people/");
            var graph = await store.promises.graph();

            expect(graph.toArray().length).toBe(0);

            var results = await store.promises.node(":alice", ":alice");

            expect(results.toArray().length).toBe(4);
            await store.promises.close();
        });

        it("should register the default profile namespaces (DefaultPrefixes)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                'INSERT DATA {  <http://example/person1> <http://xmlns.com/foaf/0.1/name> "Celia" }',
            );

            var results = await store.promises.execute("SELECT * { ?s foaf:name ?name }");

            expect(results.length).toBe(0);

            store.registerDefaultProfileNamespaces();

            results = await store.promises.execute("SELECT * { ?s foaf:name ?name }");

            expect(results.length).toBe(1);
            expect(results[0].name.value).toBe("Celia");
            await store.promises.close();
        });
    });

    describe("insert, delete and clear", function () {
        it("should insert a graph into the default graph (Insert1)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/people/");

            var graph = store.rdf.createGraph();
            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:name")),
                    store.rdf.createLiteral("alice"),
                ),
            );

            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:knows")),
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Bob")),
                ),
            );

            await store.promises.insert(graph);

            graph = await store.promises.node("ex:Alice");

            expect(graph.toArray().length).toBe(2);
            await store.promises.close();
        });

        it("should insert a graph into a named graph (Insert2)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/people/");

            var graph = store.rdf.createGraph();
            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:name")),
                    store.rdf.createLiteral("alice"),
                ),
            );

            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:knows")),
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Bob")),
                ),
            );

            await store.promises.insert(graph, "ex:alice");

            graph = await store.promises.node("ex:Alice", "ex:alice");

            expect(graph.toArray().length).toBe(2);
            await store.promises.close();
        });

        it("should delete a graph from the default graph (Delete1)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/people/");

            var graph = store.rdf.createGraph();
            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:name")),
                    store.rdf.createLiteral("alice"),
                ),
            );

            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:knows")),
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Bob")),
                ),
            );

            await store.promises.insert(graph);

            graph = await store.promises.node("ex:Alice");

            expect(graph.toArray().length).toBe(2);
            await store.promises.delete(graph);

            graph = await store.promises.node("ex:Alice");

            expect(graph.toArray().length).toBe(0);
            await store.promises.close();
        });

        it("should delete a graph from a named graph (Delete2)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/people/");

            var graph = store.rdf.createGraph();
            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:name")),
                    store.rdf.createLiteral("alice"),
                ),
            );

            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:knows")),
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Bob")),
                ),
            );

            await store.promises.insert(graph, "ex:alice");

            graph = await store.promises.node("ex:Alice", "ex:alice");

            expect(graph.toArray().length).toBe(2);
            await store.promises.delete(graph, "ex:alice");

            graph = await store.promises.node("ex:Alice");

            expect(graph.toArray().length).toBe(0);
            await store.promises.close();
        });

        it("should clear the default graph (Clear)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/people/");

            var graph = store.rdf.createGraph();
            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:name")),
                    store.rdf.createLiteral("alice"),
                ),
            );

            graph.add(
                store.rdf.createTriple(
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Alice")),
                    store.rdf.createNamedNode(store.rdf.resolve("foaf:knows")),
                    store.rdf.createNamedNode(store.rdf.resolve("ex:Bob")),
                ),
            );

            await store.promises.insert(graph, "ex:alice");

            graph = await store.promises.node("ex:Alice", "ex:alice");

            expect(graph.toArray().length).toBe(2);
            await store.promises.clear("ex:alice");

            graph = await store.promises.node("ex:Alice");

            expect(graph.toArray().length).toBe(0);
            await store.promises.close();
        });
    });

    describe("load", function () {
        it("should load JSON-LD into a named graph (Load1)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/people/");

            var input = {
                "@context": {
                    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
                    xsd: "http://www.w3.org/2001/XMLSchema#",
                    name: "http://xmlns.com/foaf/0.1/name",
                    age: { "@id": "http://xmlns.com/foaf/0.1/age", "@type": "xsd:integer" },
                    homepage: { "@id": "http://xmlns.com/foaf/0.1/homepage", "@type": "@id" },
                    ex: "http://example.org/people/",
                },
                "@id": "ex:john_smith",
                name: "John Smith",
                age: "41",
                homepage: "http://example.org/home/",
            };
            await store.promises.load("application/json", input, "ex:test");

            var graph = await store.promises.node("ex:john_smith", "ex:test");

            expect(graph.toArray().length).toBe(3);
            await store.promises.close();
        });

        it("should load N3 into a named graph (Load3)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/examples/");

            var input =
                '_:a <http://test.com/p1> "test". _:a <http://test.com/p2> "test2". _:b <http://test.com/p1> "test" .';
            await store.promises.load("text/n3", input, "ex:test");

            var results = await store.promises.execute(
                "select ?s { GRAPH <http://example.org/examples/test> { ?s ?p ?o } }",
            );

            var blankIds = {};

            for (var i = 0; i < results.length; i++) {
                var blankId = results[i].s.value;
                blankIds[blankId] = true;
            }
            var counter = Object.keys(blankIds).length;

            expect(counter).toBe(2);
            await store.promises.close();
        });

        it("should load N3 into the graph given in the options (Load5)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/examples/");

            var input =
                '_:a <http://test.com/p1> "test". _:a <http://test.com/p2> "test2". _:b <http://test.com/p1> "test" .';
            await store.promises.load("text/n3", input, { graph: "ex:test" });

            var results = await store.promises.execute(
                "select ?s { GRAPH <http://example.org/examples/test> { ?s ?p ?o } }",
            );

            var blankIds = {};

            for (var i = 0; i < results.length; i++) {
                var blankId = results[i].s.value;
                blankIds[blankId] = true;
            }
            var counter = Object.keys(blankIds).length;

            expect(counter).toBe(2);
            await store.promises.close();
        });

        it("should resolve relative IRIs against the baseURI option (Load5b)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/examples/");

            var input =
                '<#me> <http://test.com/p1> "test". <http://test.com/something#me> <http://test.com/p2> "test2". _:b <http://test.com/p1> "test" .';
            await store.promises.load("text/n3", input, { baseURI: "http://test.com/something" });

            var results = await store.promises.execute("select ?s { ?s ?p ?o }");

            var blankIds = {};

            for (var i = 0; i < results.length; i++) {
                var blankId = results[i].s.value;
                blankIds[blankId] = true;
            }
            var counter = Object.keys(blankIds).length;

            expect(counter).toBe(2);
            await store.promises.close();
        });

        it("should load N3 with the baseURI and graph options (Load5c)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            store.setPrefix("ex", "http://example.org/examples/");

            var input =
                '<#me> <http://test.com/p1> "test". <http://test.com/something#me> <http://test.com/p2> "test2". _:b <http://test.com/p1> "test" .';
            await store.promises.load("text/n3", input, {
                baseURI: "http://test.com/something",
                graph: "ex:test",
            });

            var results = await store.promises.execute(
                "select ?s { GRAPH <http://example.org/examples/test> { ?s ?p ?o }  }",
            );

            var blankIds = {};

            for (var i = 0; i < results.length; i++) {
                var blankId = results[i].s.value;
                blankIds[blankId] = true;
            }
            var counter = Object.keys(blankIds).length;

            expect(counter).toBe(2);
            await store.promises.close();
        });

        it("should store a JSON-LD triple loaded twice once (DuplicatedParsing)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var data = { "@id": "http://test.com/me", "http://somproperty.org/prop": "data" };
            await store.promises.load("application/json", data);

            await store.promises.load("application/json", data);

            var results = await store.promises.execute("SELECT * { ?s ?p ?o }");

            expect(results.length).toBe(1);
            expect(results[0].s.value).toBe("http://test.com/me");
            await store.promises.close();
        });

        it("should load JSON-LD with every JSON-LD media type (ShouldLoadJSONLDWithAllMediaTypes)", async function () {
            var input = {
                "@type": "foaf:Person",
                "foaf:name": "Manu Sporny",
                "foaf:homepage": "http://manu.sporny.org/",
                "sioc:avatar": "http://twitter.com/account/profile_image/manusporny",
                "@context": {
                    "sioc:avatar": { "@type": "@id" },
                    "foaf:homepage": { "@type": "@id" },
                },
            };

            var jsonmedia = 0,
                jsonldmedia = 0;
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load("application/ld+json", input);

            var results = await store.promises.execute("SELECT * { ?s ?p ?o }");

            jsonmedia = results.length;
            expect(jsonmedia).toBeGreaterThan(0);

            store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load("application/json", input);

            results = await store.promises.execute("SELECT * { ?s ?p ?o }");

            jsonldmedia = results.length;
            expect(jsonldmedia).toBeGreaterThan(0);

            expect(jsonldmedia).toBe(jsonmedia);
        });
    });

    describe("events API", function () {
        it("should notify a node observer of changes (EventsAPI1)", async function () {
            var counter = 0;
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                "INSERT DATA {  <http://example/book> <http://example.com/vocab#title> <http://test.com/example> }",
            );

            await new Promise(function (resolve) {
                store.startObservingNode("http://example/book", function (graph) {
                    var observerFn = arguments.callee;
                    if (counter === 0) {
                        counter++;
                        expect(graph.toArray().length).toBe(1);
                        store.execute(
                            "INSERT DATA {  <http://example/book> <http://example.com/vocab#title2> <http://test.com/example2> }",
                        );
                    } else if (counter === 1) {
                        counter++;
                        expect(graph.toArray().length).toBe(2);
                        store.execute(
                            "DELETE DATA {  <http://example/book> <http://example.com/vocab#title2> <http://test.com/example2> }",
                        );
                    } else if (counter === 2) {
                        counter++;
                        expect(graph.toArray().length).toBe(1);
                        store.stopObservingNode(observerFn);
                        store.execute(
                            "INSERT DATA {  <http://example/book> <http://example.com/vocab#title2> <http://test.com/example3> }",
                        );
                        store.close(resolve);
                    } else if (counter === 3) {
                        expect(false).toBe(true);
                    }
                });
            });
        });

        it("should notify a node observer of changes in a named graph (EventsAPI2)", async function () {
            var counter = 0;
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                "INSERT DATA { GRAPH <http://example/graph> { <http://example/book> <http://example.com/vocab#title> <http://test.com/example> } }",
            );

            await new Promise(function (resolve) {
                store.startObservingNode("http://example/book", "http://example/graph", function (graph) {
                    var observerFn = arguments.callee;
                    if (counter === 0) {
                        counter++;
                        expect(graph.toArray().length).toBe(1);
                        store.execute(
                            "INSERT DATA { GRAPH <http://example/graph> { <http://example/book> <http://example.com/vocab#title2> <http://test.com/example2> } }",
                        );
                    } else if (counter === 1) {
                        counter++;
                        expect(graph.toArray().length).toBe(2);
                        store.execute(
                            "DELETE DATA { GRAPH <http://example/graph> { <http://example/book> <http://example.com/vocab#title2> <http://test.com/example2> } }",
                        );
                    } else if (counter === 2) {
                        counter++;
                        expect(graph.toArray().length).toBe(1);
                        store.stopObservingNode(observerFn);
                        store.execute(
                            "INSERT DATA { GRAPH <http://example/graph> { <http://example/book> <http://example.com/vocab#title2> <http://test.com/example3> } }",
                        );
                        store.close(resolve);
                    } else if (counter === 3) {
                        expect(false).toBe(true);
                    }
                });
            });
        });

        it("should notify a subscription of matching changes (EventsAPI3)", async function () {
            var counter = 0;
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await new Promise(function (resolve) {
                store.subscribe(
                    "http://example/book",
                    null,
                    null,
                    null,
                    function (event, triples) {
                        var observerFn = arguments.callee;
                        if (counter === 0) {
                            counter++;
                            expect(event).toBe("added");
                            expect(triples.length).toBe(1);

                            expect(triples[0].subject.valueOf()).toBe("http://example/book");
                            expect(triples[0].object.valueOf()).toBe("http://test.com/example");
                        } else if (counter === 1) {
                            counter++;
                            expect(event).toBe("added");
                            expect(triples.length).toBe(2);
                        } else if (counter === 2) {
                            counter++;
                            expect(event).toBe("deleted");
                            expect(triples.length).toBe(1);
                            store.unsubscribe(observerFn);
                        } else if (counter === 3) {
                            expect(false).toBe(true);
                        }
                    },
                    resolve,
                );
            });
            await store.promises.execute(
                "INSERT DATA {  <http://example/book> <http://example.com/vocab#title> <http://test.com/example> }",
            );
            await store.promises.execute(
                "INSERT DATA {  <http://example/book> <http://example.com/vocab#title2> <http://test.com/example2>.\
                                              <http://example/book> <http://example.com/vocab#title3> <http://test.com/example3> }",
            );
            await store.promises.execute(
                "DELETE DATA {  <http://example/book> <http://example.com/vocab#title2> <http://test.com/example2> }",
            );
            await store.promises.execute(
                "INSERT DATA {  <http://example/book> <http://example.com/vocab#title2> <http://test.com/example3> }",
            );
            await store.promises.close();
        });
    });

    describe("custom functions", function () {
        it("should call a registered custom function in a FILTER (RegisterCustomFunction)", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                "@prefix test: <http://test.com/> .\
                 test:A test:prop 5.\
                 test:B test:prop 4.\
                 test:C test:prop 1.\
                 test:D test:prop 3.",
            );

            store.registerCustomFunction("my_addition", function (engine, args) {
                var v1 = engine.effectiveTypeValue(args[0]);
                var v2 = engine.effectiveTypeValue(args[1]);
                return engine.ebvBoolean(v1 + v2 < 5);
            });
            var results = await store.promises.execute(
                "PREFIX test: <http://test.com/> SELECT * { ?x test:prop ?v1 . ?y test:prop ?v2 . filter(custom:my_addition(?v1,?v2)) }",
            );

            expect(results.length).toBe(3);
            for (var i = 0; i < results.length; i++) {
                expect(parseInt(results[i].v1.value) + parseInt(results[i].v2.value)).toBeLessThan(5);
            }
        });

        it("should call a custom function registered under a URI", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                "@prefix test: <http://test.com/> .\
                 test:A test:prop 5.\
                 test:B test:prop 4.\
                 test:C test:prop 1.\
                 test:D test:prop 3.",
            );

            store.registerCustomFunction("http://test.com/my_addition", function (engine, args) {
                var v1 = engine.effectiveTypeValue(args[0]);
                var v2 = engine.effectiveTypeValue(args[1]);
                return engine.ebvBoolean(v1 + v2 < 5);
            });
            var results = await store.promises.execute(
                "PREFIX test: <http://test.com/> SELECT * { ?x test:prop ?v1 . ?y test:prop ?v2 . filter(<http://test.com/my_addition>(?v1,?v2)) }",
            );

            expect(results.length).toBe(3);
            for (var i = 0; i < results.length; i++) {
                expect(parseInt(results[i].v1.value) + parseInt(results[i].v2.value)).toBeLessThan(5);
            }
        });

        it("should call a custom function registered under a CURIE", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                "@prefix test: <http://test.com/> .\
                 test:A test:prop 5.\
                 test:B test:prop 4.\
                 test:C test:prop 1.\
                 test:D test:prop 3.",
            );

            store.registerCustomFunction("http://test.com/my_addition2", function (engine, args) {
                var v1 = engine.effectiveTypeValue(args[0]);
                var v2 = engine.effectiveTypeValue(args[1]);
                return engine.ebvBoolean(v1 + v2 < 5);
            });
            var results = await store.promises.execute(
                "PREFIX test: <http://test.com/> SELECT * { ?x test:prop ?v1 . ?y test:prop ?v2 . filter(test:my_addition2(?v1,?v2)) }",
            );

            expect(results.length).toBe(3);
            for (var i = 0; i < results.length; i++) {
                expect(parseInt(results[i].v1.value) + parseInt(results[i].v2.value)).toBeLessThan(5);
            }
        });

        it("should call a custom function inside an aggregate", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.load(
                "text/n3",
                "@prefix test: <http://test.com/> .\
                 test:A test:prop 1.\
                 test:A test:prop 2.\
                 test:B test:prop 5.",
            );

            store.registerCustomFunction("http://test.com/my_double", function (engine, args) {
                var v = engine.effectiveTypeValue(args[0]);
                return {
                    token: "literal",
                    type: "http://www.w3.org/2001/XMLSchema#integer",
                    value: "" + v * 2,
                };
            });
            var results = await store.promises.execute(
                "PREFIX test: <http://test.com/> SELECT ?x (SUM(test:my_double(?v)) AS ?sum) { ?x test:prop ?v } GROUP BY ?x",
            );

            expect(results.length).toBe(2);
            var sums = {};
            for (var i = 0; i < results.length; i++) {
                sums[results[i].x.value] = results[i].sum.value;
            }
            expect(sums["http://test.com/A"]).toBe("6");
            expect(sums["http://test.com/B"]).toBe("10");
        });

        it("should evaluate a custom function in a BIND expression", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: false });

            await store.promises.load(
                "text/n3",
                "@prefix test: <http://test.com/> .\
                 test:A test:prop 5.\
                 test:B test:prop 4.\
                 test:C test:prop 1.\
                 test:D test:prop 3.",
            );

            store.registerCustomFunction("http://test.com/my_default_value", function (engine, args) {
                return {
                    token: "literal",
                    value: "test_value",
                    type: "http://www.w3.org/2001/XMLSchema#string",
                };
            });
            var results = await store.promises.execute(
                "PREFIX test: <http://test.com/> SELECT * { OPTIONAL { ?x test:prop ?v1 . BIND(test:my_default_value(?v1) AS ?default_value) } }",
            );

            expect(results.length).toBe(4);
            for (var i = 0; i < results.length; i++) {
                expect(results[i].default_value.value).toBe("test_value");
            }
        });
    });

    describe("filters", function () {
        it("should evaluate EXISTS and NOT EXISTS filters", async function () {
            var query =
                "SELECT ?s WHERE { \
                     FILTER NOT EXISTS {\
                       ?s <c> ?c\
                     }\
                     { ?s <b> ?a }\
                     UNION\
                     {\
                      ?s <d> ?a\
                     }\
                   }";

            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                "INSERT DATA {  <a> <b> <b1> . \
                                          <a> <c> <c1> . \
                                          <a2> <b> <b2> . \
                                          <a3> <d> <d1> . \
                                          <a4> <d> <d3> . \
                                          <a4> <b> <b> . \
                                          <a4> <c> <c1> }",
            );

            var results = await store.promises.execute(query);

            expect(results.length).toBe(2);
            var vars = {};
            for (var i = 0; i < results.length; i++) {
                vars[results[i]["s"].value] = true;
            }
            expect(vars["a2"]).toBe(true);
            expect(vars["a3"]).toBe(true);
        });

        it("should evaluate regex filters", async function () {
            var query =
                'SELECT ?s { \
                     ?s ?p ?o .\
                     FILTER regex(?o, "test")\
                   }';

            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                'INSERT DATA {  <a1> <b> "atestofsomething" . \
                                          <a11> <c> "test" . \
                                          <a2> <b> "other" . \
                                          <a3> <d> "someother" . \
                                          <a4> <d> 1 . \
                                          <a4> <b> 2 . \
                                          <a4> <c> 3 }',
            );

            var results = await store.promises.execute(query);

            expect(results.length).toBe(2);
            var vars = {};
            for (var i = 0; i < results.length; i++) {
                vars[results[i]["s"].value] = true;
            }
            expect(vars["a1"]).toBe(true);
            expect(vars["a11"]).toBe(true);
        });

        it("should evaluate numeric filters", async function () {
            var query =
                'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\
                   SELECT ?s { \
                     ?s ?p ?o .\
                     FILTER (xsd:double(?o) > "10.0"^^<http://www.w3.org/2001/XMLSchema#double>)\
                   }';

            var store = await Store.promises.create({ name: "test", overwrite: true });

            await store.promises.execute(
                'INSERT DATA {  <a1> <b> 16.0 . \
                                          <a2> <b> 3.0 . \
                                          <a3> <d> "11.4"^^<http://www.w3.org/2001/XMLSchema#double> . \
                                          <a4> <d> "0.3"^^<http://www.w3.org/2001/XMLSchema#double> . \
                                          <a5> <c> 13 .\
                                          <a6> <c> "3"^^<http://www.w3.org/2001/XMLSchema#integer> }',
            );

            var results = await store.promises.execute(query);

            expect(results.length).toBe(3);
            var vars = {};
            for (var i = 0; i < results.length; i++) {
                vars[results[i]["s"].value] = true;
            }
            expect(vars["a1"]).toBe(true);
            expect(vars["a3"]).toBe(true);
            expect(vars["a5"]).toBe(true);
        });

        it("should evaluate filters on variables and URIs", async function () {
            var store = await Store.promises.create({ name: "test", overwrite: true });

            var rdf =
                "@prefix test: <http://test.com/> .\
                       test:A test:prop 5.\
                       test:B test:prop 4.\
                       test:A test:prop 1.\
                       test:D test:prop 3.";

            await store.promises.load("text/turtle", rdf);

            var query = `SELECT ?s ?p ?o WHERE {
                    ?s ?p ?o.
             FILTER (?s=<http://test.com/A>)
             } `;

            var results = await store.promises.execute(query);

            expect(results.length).toBe(2);
        });
    });
});
