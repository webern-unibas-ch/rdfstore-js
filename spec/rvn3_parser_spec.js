var RVN3Parser = require("../src/rvn3_parser").RVN3Parser;
var Utils = require("../src/utils");
var fs = require("fs");
var path = require("path");

// Auxiliary functions
var compare = function (compa, compb) {
    if (compa == null) {
        expect(compb == null).toBe(true);
    } else if (compa.token && compa.token === "uri") {
        expect(compa.token).toBe(compb.token);
        expect(compa.value).toBe(compb.value);
    } else if (compa.literal) {
        expect(compa.literal).toBe(compb.literal);
    } else if (compa.blank) {
        expect(compa.blank).toBe(compb.blank);
    } else {
        fail("unexpected term " + JSON.stringify(compa));
    }
};

var compareTriple = function (ta, tb) {
    compare(ta.subject, tb.subject);
    compare(ta.predicate, tb.predicate);
    compare(ta.object, tb.object);
    compare(ta.graph, tb.graph);
};

// promise form of RVN3Parser.parser.parse: takes its arguments without the callback
var parse = function (...args) {
    return Utils.toPromise(function (cb) {
        RVN3Parser.parser.parse(...args, cb);
    });
};

var shouldParse = async function (input, output, options) {
    options = options || {};
    RVN3Parser.parser.resetBlankNodeIds();
    var result = await parse(input, options);
    expect(result.constructor).toBe(output.constructor);
    expect(result.length).toBe(output.length);

    for (var i = 0; i < result.length; i++) {
        compareTriple(result[i], output[i]);
    }
};

describe("RVN3Parser", function () {
    describe("parse", function () {
        describe("documents and graphs", function () {
            it("should parse N3 data with a provided graph", async function () {
                var data = await fs.promises.readFile(path.resolve(__dirname, "data/sp2b_10k.n3"));
                data = data.toString("utf8");
                var result = await parse(data, "http://test.com/graph1", {});
                expect(result.length).toBe(43);

                for (var i = 0; i < result.length; i++) {
                    expect(result[i].graph["value"]).toBe("http://test.com/graph1");
                }
            });

            it("should parse N3 data with a null graph", async function () {
                var data = await fs.promises.readFile(path.resolve(__dirname, "data/sp2b_10k.n3"));
                data = data.toString("utf8");
                var result = await parse(data, {});
                expect(result.length).toBe(43);

                for (var i = 0; i < result.length; i++) {
                    expect(result[i].graph).toBe(null);
                }
            });

            it("should parse N3 data with comments", async function () {
                var data = await fs.promises.readFile(path.resolve(__dirname, "./data/with_comments.n3"));
                data = data.toString("utf8");
                var result = await parse(data, {});
                expect(result.length).toBe(9);
            });

            it("should parse an empty string", async function () {
                await shouldParse("", []);
            });

            it("should parse spaces", async function () {
                await shouldParse(" \t \n  ", []);
            });

            it("should parse a single triple", async function () {
                await shouldParse("<a> <b> <c>.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "c", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse document triples", async function () {
                await shouldParse(
                    "<#a> <#b> <#c>.",
                    [
                        {
                            subject: { token: "uri", value: "http://test.com/something#a", prefix: null, suffix: null },
                            predicate: {
                                token: "uri",
                                value: "http://test.com/something#b",
                                prefix: null,
                                suffix: null,
                            },
                            object: { token: "uri", value: "http://test.com/something#c", prefix: null, suffix: null },
                            graph: null,
                        },
                    ],
                    { baseURI: "http://test.com/something" },
                );
            });

            it("should parse triples", async function () {
                await shouldParse("<a> <b> <c>.\n<d> <e> <f>.\n<g> <h> <i>.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "c", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "d", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "e", prefix: null, suffix: null },
                        object: { token: "uri", value: "f", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "g", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "h", prefix: null, suffix: null },
                        object: { token: "uri", value: "i", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });
        });

        describe("literals and prefixes", function () {
            it("should parse literals", async function () {
                await shouldParse('<a> <b> "string".', [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { literal: '"string"' },
                        graph: null,
                    },
                ]);
            });

            it("should parse numeric literals", async function () {
                await shouldParse("<a> <b> 3.0.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { literal: '"3.0"^^<http://www.w3.org/2001/XMLSchema#decimal>' },
                        graph: null,
                    },
                ]);
            });

            it("should parse literals with language tags", async function () {
                await shouldParse('<a> <b> "string"@en.', [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { literal: '"string"@en' },
                        graph: null,
                    },
                ]);
            });

            it("should parse literals with normalised language tags", async function () {
                await shouldParse('<a> <b> "string"@EN.', [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { literal: '"string"@en' },
                        graph: null,
                    },
                ]);
            });

            it("should parse a literal with a URI type", async function () {
                await shouldParse('<a> <b> "string"^^<type>.', [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { literal: '"string"^^<type>' },
                        graph: null,
                    },
                ]);
            });

            it("should parse a literal with a QName type", async function () {
                await shouldParse('@prefix x: <y#>. <a> <b> "string"^^x:z.', [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { literal: '"string"^^<y#z>' },
                        graph: null,
                    },
                ]);
            });

            it("should parse triples with SPARQL prefixes", async function () {
                await shouldParse("PREFIX : <#>\n" + "PrEfIX a: <a#> " + ":x a:a a:b.", [
                    {
                        subject: { token: "uri", value: "#x", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "a#a", prefix: null, suffix: null },
                        object: { token: "uri", value: "a#b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });
        });

        describe("shared subjects and predicates", function () {
            it("should parse statements with shared subjects", async function () {
                await shouldParse("<a> <b> <c>;\n<d> <e>.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "c", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "d", prefix: null, suffix: null },
                        object: { token: "uri", value: "e", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with shared subjects and trailing statements", async function () {
                await shouldParse("<a> <b> <c>;\n<d> <e>;\n.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "c", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "d", prefix: null, suffix: null },
                        object: { token: "uri", value: "e", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with shared subjects and multiple semicolons", async function () {
                await shouldParse("<a> <b> <c>;;\n<d> <e>.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "c", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "d", prefix: null, suffix: null },
                        object: { token: "uri", value: "e", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with shared subjects and predicates", async function () {
                await shouldParse("<a> <b> <c>, <d>.", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "c", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { token: "uri", value: "d", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });
        });

        describe("blank nodes", function () {
            it("should parse statements with named blank nodes", async function () {
                await shouldParse("_:a <b> _:c.", [
                    {
                        subject: { blank: "_:0_a" },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:1_c" },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with empty blank nodes", async function () {
                await shouldParse("[] <b> [].", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with unnamed blank nodes in the subject", async function () {
                await shouldParse("[<a> <b>] <c> <d>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "c", prefix: null, suffix: null },
                        object: { token: "uri", value: "d", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with unnamed blank nodes in the object", async function () {
                await shouldParse("<a> <b> [<c> <d>].", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "c", prefix: null, suffix: null },
                        object: { token: "uri", value: "d", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with unnamed blank nodes with a string object", async function () {
                await shouldParse('<a> <b> [<c> "x"].', [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "c", prefix: null, suffix: null },
                        object: { literal: '"x"' },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse a blank node with several statements", async function () {
                await shouldParse("<a> <b> [ <u> <v>; <w> <z> ].", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "u", prefix: null, suffix: null },
                        object: { token: "uri", value: "v", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "w", prefix: null, suffix: null },
                        object: { token: "uri", value: "z", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse a blank node with several statements and a trailing semicolon", async function () {
                await shouldParse("<a> <b> [ <u> <v>; <w> <z>; ].", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "u", prefix: null, suffix: null },
                        object: { token: "uri", value: "v", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "w", prefix: null, suffix: null },
                        object: { token: "uri", value: "z", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse a statement with nested blank nodes as subject", async function () {
                await shouldParse("[<a> [<x> <y>]] <c> <d>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "x", prefix: null, suffix: null },
                        object: { token: "uri", value: "y", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: { token: "uri", value: "c", prefix: null, suffix: null },
                        object: { token: "uri", value: "d", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with nested blank nodes as object", async function () {
                await shouldParse("<a> <b> [<c> [<d> <e>]].", [
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "d", prefix: null, suffix: null },
                        object: { token: "uri", value: "e", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: { token: "uri", value: "c", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                ]);
            });
        });

        describe("lists", function () {
            it("should parse an empty list as subject", async function () {
                await shouldParse("() <a> <b>.", [
                    {
                        subject: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse an empty list as object", async function () {
                await shouldParse("<a> <b> ().", [
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                ]);
            });

            it("should parse a list with one element as object", async function () {
                await shouldParse("<a> <b> (<x>).", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "x", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse a list with one element as subject", async function () {
                await shouldParse("(<x>) <a> <b>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "x", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with a list of several elements as subject", async function () {
                await shouldParse("(<x> <y>) <a> <b>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "x", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "y", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with a list of several elements as object", async function () {
                await shouldParse("<a> <b> (<x> <y>).", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "x", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "y", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse blank node statements with a list of several elements as object", async function () {
                await shouldParse('("y") <a> <b>.', [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { literal: '"y"' },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with a nested empty list", async function () {
                await shouldParse("<a> <b> (<x> ()).", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "x", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with a nested non-empty list", async function () {
                await shouldParse("<a> <b> (<x> (<y>)).", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "x", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:2" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "y", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:2" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:2" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { token: "uri", value: "a", prefix: null, suffix: null },
                        predicate: { token: "uri", value: "b", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                ]);
            });

            it("should parse a statement with a list containing an empty node", async function () {
                await shouldParse("([]) <a> <b>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with a list containing several empty nodes", async function () {
                await shouldParse("([] [<x> <y>]) <a> <b>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:1" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:2" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:2" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { blank: "_:3" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:3" },
                        predicate: { token: "uri", value: "x", prefix: null, suffix: null },
                        object: { token: "uri", value: "y", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:2" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });

            it("should parse statements with a list containing an empty node that contains a list", async function () {
                await shouldParse("[<a> (<b>)] <c> <d>.", [
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
                            prefix: null,
                            suffix: null,
                        },
                        object: { token: "uri", value: "b", prefix: null, suffix: null },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:0" },
                        predicate: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
                            prefix: null,
                            suffix: null,
                        },
                        object: {
                            token: "uri",
                            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
                            prefix: null,
                            suffix: null,
                        },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: { token: "uri", value: "a", prefix: null, suffix: null },
                        object: { blank: "_:0" },
                        graph: null,
                    },
                    {
                        subject: { blank: "_:1" },
                        predicate: { token: "uri", value: "c", prefix: null, suffix: null },
                        object: { token: "uri", value: "d", prefix: null, suffix: null },
                        graph: null,
                    },
                ]);
            });
        });
    });
});
