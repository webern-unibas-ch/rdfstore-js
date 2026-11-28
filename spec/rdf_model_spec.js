var RDFModel = require("../src/rdf_model");
var { newEngine } = require("./helpers/engine");

describe("RDFModel", function () {
    it("should filter graphs", function (done) {
        newEngine(function (engine) {
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
                             foaf:mbox       <mailto:bob@work> ;\
                             foaf:mbox       <mailto:bob@home> \
                             .\
                         }';
            engine.execute(query, function (err, result) {
                expect(err).toBe(null);
                engine.execute(
                    "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
                                PREFIX  foaf:       <http://xmlns.com/foaf/0.1/>\
                                CONSTRUCT { ?s ?p ?o . }\
                                WHERE {\
                                  ?s ?p ?o .\
                                }",
                    function (err, graph) {
                        expect(err).toBe(null);
                        expect(graph.length).toBe(9);

                        var rdf = RDFModel.rdf;

                        var results = graph.filter(rdf.filters.describes("http://example.org/people/alice"));

                        var resultsCount = results.toArray().length;

                        var resultsSubject = results.filter(rdf.filters.s("http://example.org/people/alice"));
                        var resultsObject = results.filter(rdf.filters.o("http://example.org/people/alice"));

                        expect(resultsObject.toArray().length).toBe(1);
                        expect(resultsObject.toArray().length + resultsSubject.toArray().length).toBe(resultsCount);

                        // filter the graph to find all subjects with an "rdf:type" of "foaf:Person"
                        var filter = rdf.filters.type(rdf.resolve("foaf:Person"));
                        results = graph.filter(filter);
                        var people = [];
                        results.forEach(function (t) {
                            // iterate over the results, creating a filtered graph for each subject found
                            // and pass that graph to a display function
                            people.push(graph.filter(rdf.filters.s(t.subject)));
                        });

                        expect(people.length).toBe(2);
                        done();
                    },
                );
            });
        });
    });

    it("should add actions to a graph", function () {
        var rdf = RDFModel.rdf;
        var graph = rdf.createGraph();
        graph.addAction(
            rdf.createAction(rdf.filters.p(rdf.resolve("foaf:name")), function (triple) {
                var name = triple.object.valueOf();
                name = name.slice(0, 1).toUpperCase() + name.slice(1, name.length);
                triple.object = rdf.createNamedNode(name);
                return triple;
            }),
        );

        rdf.setPrefix("ex", "http://example.org/people/");
        graph.add(
            rdf.createTriple(
                rdf.createNamedNode(rdf.resolve("ex:Alice")),
                rdf.createNamedNode(rdf.resolve("foaf:name")),
                rdf.createLiteral("alice"),
            ),
        );

        graph.add(
            rdf.createTriple(
                rdf.createNamedNode(rdf.resolve("ex:Alice")),
                rdf.createNamedNode(rdf.resolve("foaf:knows")),
                rdf.createNamedNode(rdf.resolve("ex:Bob")),
            ),
        );

        expect(graph.length).toBe(2);
        var triples = graph.match(null, rdf.createNamedNode(rdf.resolve("foaf:name")), null).toArray();
        expect(triples.length).toBe(1);
        expect(triples[0].object.valueOf()).toBe("Alice");

        triples = graph.match(null, rdf.createNamedNode(rdf.resolve("foaf:knows")), null).toArray();

        expect(triples.length).toBe(1);
        expect(triples[0].object.valueOf()).toBe("http://example.org/people/Bob");
    });

    it("should serialize a graph to N-Triples", function () {
        var rdf = RDFModel.rdf;
        var graph = new rdf.createGraph();

        rdf.setPrefix("earl", "http://www.w3.org/ns/earl#");
        rdf.setDefaultPrefix("http://www.w3.org/ns/earl#");
        rdf.setPrefix("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#");

        graph.add(
            rdf.createTriple(
                rdf.createBlankNode(),
                rdf.createNamedNode("rdf:type"),
                rdf.createNamedNode("http://test.com/MyClass"),
            ),
        );

        graph.add(
            rdf.createTriple(
                rdf.createNamedNode("earl:test"),
                rdf.createNamedNode("rdf:type"),
                rdf.createNamedNode("http://test.com/MyClass"),
            ),
        );

        graph.add(
            rdf.createTriple(
                rdf.createNamedNode("earl:test"),
                rdf.createNamedNode(":test"),
                rdf.createLiteral("alice"),
            ),
        );

        var parts = graph.toNT().split("\r\n");

        expect(parts[0]).toBe("_:0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://test.com/MyClass> . ");
        expect(parts[1]).toBe(
            "<http://www.w3.org/ns/earl#test> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://test.com/MyClass> . ",
        );
        expect(parts[2]).toBe('<http://www.w3.org/ns/earl#test> <http://www.w3.org/ns/earl#test> "alice" . ');
        expect(parts[3]).toBe("");
    });

    it("should serialize a literal", function () {
        var rdf = RDFModel.rdf;
        var literal = rdf.createLiteral("alice", null, "http://www.w3.org/2001/XMLSchema#string");
        expect(literal.toString()).toBe('"alice"^^<http://www.w3.org/2001/XMLSchema#string>');
    });

    it("should resolve URIs with the default namespace", function () {
        var rdf = RDFModel.rdf;
        rdf.prefixes.defaultNs = undefined;
        expect(rdf.prefixes.defaultNs).toBe(undefined);
        expect(rdf.prefixes.resolve(":test")).toBe(null);
        expect(rdf.prefixes.shrink("http://something.com/vocab/test")).toBe("http://something.com/vocab/test");
        rdf.prefixes.setDefault("http://something.com/vocab/");
        expect(rdf.prefixes.shrink("http://something.com/vocab/test")).toBe("http://something.com/vocab/test");
        expect(rdf.prefixes.resolve(":test")).toBe("http://something.com/vocab/test");
    });

    it("should serialize a named node", function () {
        var node = RDFModel.rdf.createNamedNode("http://www.w3.org/People/Berners-Lee/card#i");
        expect(node.toString()).toBe("http://www.w3.org/People/Berners-Lee/card#i");
    });
});
