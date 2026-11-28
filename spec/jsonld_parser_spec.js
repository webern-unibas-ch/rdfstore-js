var JSONLDParser = require("../src/jsonld_parser").JSONLDParser;

describe("JSONLDParser", function () {
    describe("parse", function () {
        it("should coerce values to IRIs by the context placed after the properties", function (done) {
            var input = {
                "@type": "foaf:Person",
                "foaf:name": "Manu Sporny",
                "foaf:homepage": "http://manu.sporny.org/",
                "sioc:avatar": "http://twitter.com/account/profile_image/manusporny",
                "@context": {
                    foaf: "http://xmlns.com/foaf/0.1/",
                    sioc: "http://rdfs.org/sioc/ns#",
                    "sioc:avatar": { "@type": "@id" },
                    "foaf:homepage": { "@type": "@id" },
                },
            };

            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                expect(err).toBe(null);
                expect(result.length).toBe(4);
                for (var i = 0; i < result.length; i++) {
                    var triple = result[i];
                    expect(triple.subject["blank"] != null).toBe(true);
                    expect(triple.subject["blank"].indexOf("_:")).toBe(0);
                    if (triple.predicate["value"] === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
                        expect(triple.object.value).toBe("http://xmlns.com/foaf/0.1/Person");
                    } else if (triple.predicate.value === "http://xmlns.com/foaf/0.1/name") {
                        expect(triple.object.literal).toBe('"Manu Sporny"^^<http://www.w3.org/2001/XMLSchema#string>');
                    } else if (triple.predicate.value === "http://xmlns.com/foaf/0.1/homepage") {
                        // uri because of the context's @id coercion
                        expect(triple.object.value).toBe("http://manu.sporny.org/");
                    } else if (triple.predicate.value === "http://rdfs.org/sioc/ns#avatar") {
                        expect(triple.object.value).toBe("http://twitter.com/account/profile_image/manusporny");
                    } else {
                        expect(false).toBe(true);
                    }
                }
                done();
            });
        });

        it("should coerce values to IRIs and keep an uncoerced property a literal", function (done) {
            var input = {
                "@context": {
                    foaf: "http://xmlns.com/foaf/0.1/",
                    sioc: "http://rdfs.org/sioc/ns#",
                    myvocab: "http://example.org/myvocab#",
                    "sioc:avatar": {
                        "@type": "@id",
                    },
                    "foaf:homepage": {
                        "@type": "@id",
                    },
                },
                "@type": "foaf:Person",
                "foaf:name": "Manu Sporny",
                "foaf:homepage": "http://manu.sporny.org/",
                "sioc:avatar": "http://twitter.com/account/profile_image/manusporny",
                "myvocab:personality": "friendly",
            };

            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                expect(err).toBe(null);
                expect(result.length).toBe(5);
                for (var i = 0; i < result.length; i++) {
                    var triple = result[i];
                    expect(triple.subject.blank.indexOf("_:")).toBe(0);
                    if (triple.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
                        expect(triple.object.value).toBe("http://xmlns.com/foaf/0.1/Person");
                    } else if (triple.predicate.value === "http://xmlns.com/foaf/0.1/name") {
                        expect(triple.object.literal).toBe('"Manu Sporny"^^<http://www.w3.org/2001/XMLSchema#string>');
                    } else if (triple.predicate.value === "http://xmlns.com/foaf/0.1/homepage") {
                        // uri because of the context's @id coercion
                        expect(triple.object.value).toBe("http://manu.sporny.org/");
                    } else if (triple.predicate.value === "http://rdfs.org/sioc/ns#avatar") {
                        expect(triple.object.value).toBe("http://twitter.com/account/profile_image/manusporny");
                    } else if (triple.predicate.value === "http://example.org/myvocab#personality") {
                        expect(triple.object.literal).toBe('"friendly"^^<http://www.w3.org/2001/XMLSchema#string>');
                    } else {
                        fail("unexpected predicate " + triple.predicate.value);
                    }
                }

                done();
            });
        });

        it("should relabel blank nodes and keep compact IRIs without a context", function (done) {
            var input = [
                {
                    "@id": "_:bnode1",
                    "@type": "foaf:Person",
                    "foaf:homepage": "http://example.com/bob/",
                    "foaf:name": "Bob",
                },
                {
                    "@id": "_:bnode2",
                    "@type": "foaf:Person",
                    "foaf:homepage": "http://example.com/eve/",
                    "foaf:name": "Eve",
                },
                {
                    "@id": "_:bnode3",
                    "@type": "foaf:Person",
                    "foaf:homepage": "http://example.com/manu/",
                    "foaf:name": "Manu",
                },
            ];

            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                expect(err).toBeNull();
                expect(result.length).toBe(9);

                // blank node labels are relabeled; without a context foaf: stays a compact IRI and the homepage a string
                var nodes = {};
                for (var i = 0; i < result.length; i++) {
                    var triple = result[i];
                    var node = (nodes[triple.subject.blank] = nodes[triple.subject.blank] || {});
                    node[triple.predicate.value] = triple.object.literal || triple.object.value;
                }
                var homepages = {};
                for (var label in nodes) {
                    homepages[nodes[label]["foaf:name"]] = nodes[label]["foaf:homepage"];
                }
                expect(homepages).toEqual({
                    '"Bob"^^<http://www.w3.org/2001/XMLSchema#string>':
                        '"http://example.com/bob/"^^<http://www.w3.org/2001/XMLSchema#string>',
                    '"Eve"^^<http://www.w3.org/2001/XMLSchema#string>':
                        '"http://example.com/eve/"^^<http://www.w3.org/2001/XMLSchema#string>',
                    '"Manu"^^<http://www.w3.org/2001/XMLSchema#string>':
                        '"http://example.com/manu/"^^<http://www.w3.org/2001/XMLSchema#string>',
                });

                done();
            });
        });

        it("should parse a blank node subject with a context", function (done) {
            var input = {
                "@context": {
                    vcard: "http://microformats.org/profile/hcard#vcard",
                    url: { "@id": "http://microformats.org/profile/hcard#url", "@type": "@id" },
                    fn: "http://microformats.org/profile/hcard#fn",
                },
                "@id": "_:bnode1",
                "@type": "vcard",
                url: "http://tantek.com/",
                fn: "Tantek Çelik",
            };

            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                expect(result.length).toBe(3);

                for (var i = 0; i < result.length; i++) {
                    expect(result[i].subject.blank[0]).toBe("_");
                    if (result[i].predicate.value === "http://microformats.org/profile/hcard#url") {
                        expect(result[i].object.value).toBe("http://tantek.com/");
                    } else if (result[i].predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
                        expect(result[i].object.value).toBe("http://microformats.org/profile/hcard#vcard");
                    }
                }

                done();
            });
        });

        it("should parse an array of objects with their own contexts", function (done) {
            var input = [
                {
                    "@id": "http://purl.oreilly.com/works/45U8QJGZSQKDH8N",
                    "@type": "http://purl.org/vocab/frbr/core#Work",
                    "http://purl.org/dc/terms/title": "Just a Geek",
                    "http://purl.org/dc/terms/creator": "Whil Wheaton",
                    "http://purl.org/vocab/frbr/core#realization": [
                        "http://purl.oreilly.com/products/9780596007683.BOOK",
                        "http://purl.oreilly.com/products/9780596802189.EBOOK",
                    ],
                    "@context": { "http://purl.org/vocab/frbr/core#realization": { "@type": "@id" } },
                },
                {
                    "@id": "http://purl.oreilly.com/products/9780596007683.BOOK",
                    "@type": "http://purl.org/vocab/frbr/core#Expression",
                    "http://purl.org/dc/terms/type": "http://purl.oreilly.com/product-types/BOOK",
                    "@context": { "http://purl.org/dc/terms/type": { "@type": "@id" } },
                },
                {
                    "@id": "http://purl.oreilly.com/products/9780596802189.EBOOK",
                    "@type": "http://purl.org/vocab/frbr/core#Expression",
                    "http://purl.org/dc/terms/type": "http://purl.oreilly.com/product-types/EBOOK",
                    "@context": { "http://purl.org/dc/terms/type": { "@type": "@id" } },
                },
            ];

            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                var counter = 0;
                var previous = null;

                for (var i = 0; i < result.length; i++) {
                    var triple = result[i];

                    if (triple.predicate.value === "http://purl.org/vocab/frbr/core#realization") {
                        counter++;
                        expect(
                            triple.object.value === "http://purl.oreilly.com/products/9780596007683.BOOK" ||
                                triple.object.value === "http://purl.oreilly.com/products/9780596802189.EBOOK",
                        ).toBe(true);
                        expect(triple.object.value).not.toBe(previous);
                        previous = triple.object.value;
                    }
                }

                expect(counter).toBe(2);
                done();
            });
        });

        it("should parse IRIs and language-tagged and typed literals", function (done) {
            var input = { "http://xmlns.com/foaf/0.1/name": "Manu Sporny" };
            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                expect(result.length).toBe(1);
                expect(result[0].predicate.value).toBe("http://xmlns.com/foaf/0.1/name");

                input = { "foaf:homepage": { "@id": "http://manu.sporny.org" } };
                JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                    expect(result.length).toBe(1);
                    expect(result[0].object.value).toBe("http://manu.sporny.org");

                    input = {
                        "@context": { "foaf:homepage": { "@type": "@id" } },
                        "foaf:homepage": "http://manu.sporny.org",
                    };

                    JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                        expect(result.length).toBe(1);
                        expect(result[0].object.value).toBe("http://manu.sporny.org");

                        input = { "foaf:name": { "@value": "花澄", "@language": "ja" } };
                        JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                            expect(result.length).toBe(1);
                            expect(result[0].object.literal).toBe('"花澄"@ja');

                            input = {
                                "@context": { "dc:modified": { "@type": "http://www.w3.org/2001/XMLSchema#dateTime" } },
                                "dc:modified": "2010-05-29T14:17:39+02:00",
                            };

                            JSONLDParser.parser.parse(input, null, {}, function (err, result) {
                                expect(result.length).toBe(1);
                                expect(result[0].object.literal).toBe(
                                    '"2010-05-29T14:17:39+02:00"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
                                );

                                input = {
                                    "@context": {
                                        rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
                                        xsd: "http://www.w3.org/2001/XMLSchema#",
                                        name: "http://xmlns.com/foaf/0.1/name",
                                        age: { "@id": "http://xmlns.com/foaf/0.1/age", "@type": "xsd:integer" },
                                        homepage: {
                                            "@id": "http://xmlns.com/foaf/0.1/homepage",
                                            "@type": "xsd:anyURI",
                                        },
                                    },
                                    name: "John Smith",
                                    age: "41",
                                    homepage: "http://example.org/home/",
                                };

                                JSONLDParser.parser.parse(
                                    input,
                                    { uri: "http://test.com/graph" },
                                    {},
                                    function (err, result) {
                                        var found = false;
                                        for (var i = 0; i < result.length; i++) {
                                            if (result[i].predicate.value === "http://xmlns.com/foaf/0.1/age") {
                                                found = true;
                                                expect(result[i].object.literal).toBe(
                                                    '"41"^^<http://www.w3.org/2001/XMLSchema#integer>',
                                                );
                                                expect(result[i].graph.uri).toBe("http://test.com/graph");
                                            }
                                        }
                                        expect(found).toBe(true);
                                        done();
                                    },
                                );
                            });
                        });
                    });
                });
            });
        });
    });
});
