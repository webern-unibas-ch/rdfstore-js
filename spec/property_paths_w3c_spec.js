var rdfstore = require("../src/store");

// The evaluation tests of the W3C SPARQL 1.1 property path suite (w3c/rdf-tests, sparql/sparql11/property-path),
// without those for negated property sets (!), which are not supported. "values_and_path" binds ?v with BIND,
// as VALUES is not supported. Relative IRIs resolve against the directory of the suite. W3C test suite license:
// https://www.w3.org/Consortium/Legal/2008/04-testsuite-copyright.html

var base = "http://www.w3.org/2009/sparql/docs/tests/data-sparql11/property-path/";

var cases = [
    {
        "name": "(pp01) Simple path",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect * where {\nin:a ex:p1/ex:p2/ex:p3 ?x\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:a .\nin:a ex:p3 in:c .",
        "expected": [
            "x=<http://www.example.org/instance#c>"
        ]
    },
    {
        "name": "(pp02) Star path",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect * where {\nin:a (ex:p1/ex:p2/ex:p3)* ?x\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:a .\nin:a ex:p3 in:c .",
        "expected": [
            "x=<http://www.example.org/instance#a>",
            "x=<http://www.example.org/instance#c>"
        ]
    },
    {
        "name": "(pp03) Simple path with loop",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect * where {\nin:a ex:p1/ex:p2/ex:p3/ex:p4 ?x\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:a .\nin:a ex:p3 in:b .\nin:b ex:p4 in:a .",
        "expected": [
            "x=<http://www.example.org/instance#a>"
        ]
    },
    {
        "name": "(pp06) Path with two graphs",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect ?x where {\ngraph ?g {in:a ex:p1/ex:p2 ?x}\n}",
        "graphs": {
            "pp061.ttl": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .",
            "pp062.ttl": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:b ex:p2 in:c ."
        },
        "expected": []
    },
    {
        "name": "(pp07) Path with one graph",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect ?x where {\ngraph ?g {in:a ex:p1/ex:p2 ?x}\n}",
        "graphs": {
            "pp07.ttl": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:c ."
        },
        "expected": [
            "x=<http://www.example.org/instance#c>"
        ]
    },
    {
        "name": "(pp08) Reverse path",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nask {\nin:b ^ex:p in:a\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p in:b .",
        "expected": true
    },
    {
        "name": "(pp09) Reverse sequence path",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect  * where {\nin:c ^(ex:p1/ex:p2) ?x\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:c .",
        "expected": [
            "x=<http://www.example.org/instance#a>"
        ]
    },
    {
        "name": "(pp11) Simple path and two paths to same target node",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect * where {\nin:a ex:p1/ex:p2 ?x\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:c .\nin:a ex:p1 in:d .\nin:d ex:p2 in:c .",
        "expected": [
            "x=<http://www.example.org/instance#c>",
            "x=<http://www.example.org/instance#c>"
        ]
    },
    {
        "name": "(pp12) Variable length path and two paths to same target node",
        "query": "prefix ex:\t<http://www.example.org/schema#>\nprefix in:\t<http://www.example.org/instance#>\n\nselect * where {\nin:a (ex:p1/ex:p2)+ ?x\n}",
        "data": "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs:\t<http://www.w3.org/2000/01/rdf-schema#> .\n@prefix ex:\t<http://www.example.org/schema#>.\n@prefix in:\t<http://www.example.org/instance#>.\n\nin:a ex:p1 in:b .\nin:b ex:p2 in:c .\nin:a ex:p1 in:d .\nin:d ex:p2 in:c .",
        "expected": [
            "x=<http://www.example.org/instance#c>"
        ]
    },
    {
        "name": "(pp14) Star path over foaf:knows",
        "query": "PREFIX : <http://example.org/>\nPREFIX foaf: <http://xmlns.com/foaf/0.1/>\n\nSELECT *\nWHERE { ?X foaf:knows* ?Y } \nORDER BY ?X ?Y",
        "data": "@prefix : <http://example.org/> .\n@prefix foaf: <http://xmlns.com/foaf/0.1/> .\n\n:a foaf:knows :b .\n:b foaf:knows :c .",
        "expected": [
            "X=<http://example.org/a> Y=<http://example.org/a>",
            "X=<http://example.org/a> Y=<http://example.org/b>",
            "X=<http://example.org/a> Y=<http://example.org/c>",
            "X=<http://example.org/b> Y=<http://example.org/b>",
            "X=<http://example.org/b> Y=<http://example.org/c>",
            "X=<http://example.org/c> Y=<http://example.org/c>"
        ]
    },
    {
        "name": "(pp16) Duplicate paths and cycles through foaf:knows*",
        "query": "PREFIX : <http://example.org/>\nPREFIX foaf: <http://xmlns.com/foaf/0.1/>\n\nSELECT *\nWHERE { ?X foaf:knows* ?Y } \nORDER BY ?X ?Y",
        "data": "@prefix : <http://example.org/> .\n@prefix foaf: <http://xmlns.com/foaf/0.1/> .\n\n:a foaf:knows :b .\n:b foaf:knows :c .\n:a foaf:knows :c .\n:d foaf:knows :e .\n:e foaf:knows :f .\n:f foaf:knows :e .\n:f foaf:name \"test\" .\n:a foaf:homepage :h .",
        "expected": [
            "X=\"test\" Y=\"test\"",
            "X=<http://example.org/a> Y=<http://example.org/a>",
            "X=<http://example.org/a> Y=<http://example.org/b>",
            "X=<http://example.org/a> Y=<http://example.org/c>",
            "X=<http://example.org/b> Y=<http://example.org/b>",
            "X=<http://example.org/b> Y=<http://example.org/c>",
            "X=<http://example.org/c> Y=<http://example.org/c>",
            "X=<http://example.org/d> Y=<http://example.org/d>",
            "X=<http://example.org/d> Y=<http://example.org/e>",
            "X=<http://example.org/d> Y=<http://example.org/f>",
            "X=<http://example.org/e> Y=<http://example.org/e>",
            "X=<http://example.org/e> Y=<http://example.org/f>",
            "X=<http://example.org/f> Y=<http://example.org/e>",
            "X=<http://example.org/f> Y=<http://example.org/f>",
            "X=<http://example.org/h> Y=<http://example.org/h>"
        ]
    },
    {
        "name": "(pp21) Diamond -- :p+",
        "query": "prefix : <http://example/> \n\nselect * where {\n    :a :p+ ?z\n}",
        "data": "@prefix : <http://example/> .\n\n:a :p :b .\n:b :p :z .\n:a :p :c .\n:c :p :z .",
        "expected": [
            "z=<http://example/b>",
            "z=<http://example/c>",
            "z=<http://example/z>"
        ]
    },
    {
        "name": "(pp23) Diamond, with tail -- :p+",
        "query": "prefix : <http://example/> \n\nselect * where {\n    :a :p+ ?z\n}",
        "data": "@prefix : <http://example/> .\n\n:a :p :b .\n:b :p :z .\n:a :p :c .\n:c :p :z .\n\n:z :p :X .",
        "expected": [
            "z=<http://example/X>",
            "z=<http://example/b>",
            "z=<http://example/c>",
            "z=<http://example/z>"
        ]
    },
    {
        "name": "(pp25) Diamond, with loop -- :p+",
        "query": "prefix : <http://example/> \n\nselect * where {\n    :a :p+ ?z\n}",
        "data": "@prefix : <http://example/> .\n\n:a :p :b .\n:b :p :z .\n:a :p :c .\n:c :p :z .\n:c :p :c .",
        "expected": [
            "z=<http://example/b>",
            "z=<http://example/c>",
            "z=<http://example/z>"
        ]
    },
    {
        "name": "(pp28a) Diamond, with loop -- (:p/:p)?",
        "query": "prefix : <http://example/> \n\nselect * where {\n    :a (:p/:p)? ?t\n}",
        "data": "@prefix : <http://example/> .\n\n:a :p :b .\n:b :p :z .\n:a :p :c .\n:c :p :z .\n:c :p :c .",
        "expected": [
            "t=<http://example/a>",
            "t=<http://example/c>",
            "t=<http://example/z>"
        ]
    },
    {
        "name": "(pp30) Operator precedence 1",
        "query": "prefix :  <http://www.example.org/>\nselect ?t\nwhere {\n  :a :p1|:p2/:p3|:p4 ?t\n}",
        "data": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :b .\n:b :p4 :c .\n:a :p2 :d .\n:d :p3 :c .\n:a :p1 :e .",
        "expected": [
            "t=<http://www.example.org/b>",
            "t=<http://www.example.org/c>",
            "t=<http://www.example.org/e>"
        ]
    },
    {
        "name": "(pp31) Operator precedence 2",
        "query": "prefix :  <http://www.example.org/>\nselect ?t\nwhere {\n  :a (:p1|:p2)/(:p3|:p4) ?t\n}",
        "data": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :b .\n:b :p4 :c .\n:a :p2 :d .\n:d :p3 :c .\n:a :p1 :e .",
        "expected": [
            "t=<http://www.example.org/c>",
            "t=<http://www.example.org/c>"
        ]
    },
    {
        "name": "(pp32) Operator precedence 3",
        "query": "prefix :  <http://www.example.org/>\nselect ?t\nwhere {\n  :a :p0|^:p1/:p2|:p3 ?t\n}",
        "data": "@prefix :  <http://www.example.org/> .\n\n:a :p0 :c .\n:a :p3 :b .\n:d :p1 :a .\n:d :p2 :e .\n:c :p2 :f .\n:c :p3 :g .",
        "expected": [
            "t=<http://www.example.org/b>",
            "t=<http://www.example.org/c>",
            "t=<http://www.example.org/e>"
        ]
    },
    {
        "name": "(pp33) Operator precedence 4",
        "query": "prefix :  <http://www.example.org/>\nselect ?t\nwhere {\n  :a (:p0|^:p1)/:p2|:p3 ?t\n}",
        "data": "@prefix :  <http://www.example.org/> .\n\n:a :p0 :c .\n:a :p3 :b .\n:d :p1 :a .\n:d :p2 :e .\n:c :p2 :f .\n:c :p3 :g .",
        "expected": [
            "t=<http://www.example.org/b>",
            "t=<http://www.example.org/e>",
            "t=<http://www.example.org/f>"
        ]
    },
    {
        "name": "(pp34) Named Graph 1",
        "query": "prefix :  <http://www.example.org/>\nselect ?t\nwhere {\n  GRAPH <ng-01.ttl> {\n    ?s :p1* ?t }\n}",
        "graphs": {
            "ng-01.ttl": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :b .",
            "ng-02.ttl": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :c .",
            "ng-03.ttl": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :d ."
        },
        "expected": [
            "t=<http://www.example.org/a>",
            "t=<http://www.example.org/b>",
            "t=<http://www.example.org/b>"
        ]
    },
    {
        "name": "(pp35) Named Graph 2",
        "query": "prefix :  <http://www.example.org/>\nselect ?t\nwhere {\n  GRAPH ?g {\n    ?s :p1* ?t }\n  FILTER (?g = <ng-01.ttl>)\n}",
        "graphs": {
            "ng-01.ttl": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :b .",
            "ng-02.ttl": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :c .",
            "ng-03.ttl": "@prefix :  <http://www.example.org/> .\n\n:a :p1 :d ."
        },
        "expected": [
            "t=<http://www.example.org/a>",
            "t=<http://www.example.org/b>",
            "t=<http://www.example.org/b>"
        ]
    },
    {
        "name": "(pp36) Arbitrary path with bound endpoints",
        "query": "PREFIX : <http://example.org/>\nSELECT * WHERE { :a0 (:p)* :a1 }",
        "data": "@prefix : <http://example.org/> .\n\n:a0 :p :a1, :a2 .\n:a1 :p :a0, :a2 .\n:a2 :p :a0, :a1 .",
        "expected": [
            ""
        ]
    },
    {
        "name": "(pp37) Nested (*)*",
        "query": "prefix : <http://example.org/>\nselect ?X where { :A0 ((:P)*)* ?X }\norder by ?X",
        "data": "@prefix : <http://example.org/> .\n :A0 :P :A1, :A2 .\n :A1 :P :A0, :A2 .\n :A2 :P :A0, :A1 .",
        "expected": [
            "X=<http://example.org/A0>",
            "X=<http://example.org/A1>",
            "X=<http://example.org/A2>"
        ]
    },
    {
        "name": "ZeroOrX property paths should only return terms in the graph and not also terms defined in the query",
        "query": "SELECT * WHERE {\n   BIND(1 AS ?v)\n   ?v <http://example.com/p>? ?v\n}",
        "data": "",
        "expected": []
    },
    {
        "name": "* with start being a constant on the empty dataset",
        "query": "PREFIX : <http://example/>\nSELECT ?s WHERE { ?s :p* :o }",
        "data": "",
        "expected": [
            "s=<http://example/o>"
        ]
    },
    {
        "name": "* with end being a constant on the empty dataset",
        "query": "PREFIX : <http://example/>\nSELECT ?o WHERE { :s :p* ?o }",
        "data": "",
        "expected": [
            "o=<http://example/s>"
        ]
    },
    {
        "name": "? with start being a constant on the empty dataset",
        "query": "PREFIX : <http://example/>\nSELECT ?s WHERE { ?s :p? :o }",
        "data": "",
        "expected": [
            "s=<http://example/o>"
        ]
    },
    {
        "name": "? with end being a constant on the empty dataset",
        "query": "PREFIX : <http://example/>\nSELECT ?o WHERE { :s :p? ?o }",
        "data": "",
        "expected": [
            "o=<http://example/s>"
        ]
    }
];

// a term as in the expected results: <iri>, "literal" (with ^^<datatype> unless xsd:string), _ for a blank node
var termKey = function (term) {
    if (term.token === "blank") {
        return "_";
    } else if (term.token === "uri") {
        return "<" + term.value + ">";
    }
    var type = term.type != null && term.type !== "http://www.w3.org/2001/XMLSchema#string" ? "^^<" + term.type + ">" : "";
    return '"' + term.value + '"' + type;
};

var rows = function (results) {
    return results.map(function (solution) {
        return Object.keys(solution).filter(function (name) {
            return solution[name] != null;
        }).sort().map(function (name) {
            return name + "=" + termKey(solution[name]);
        }).join(" ");
    }).sort();
};

describe("W3C SPARQL 1.1 property path evaluation tests", function () {
    cases.forEach(function (testCase) {
        it(testCase.name, async function () {
            var store = await rdfstore.promises.create();
            if (testCase.data != null) {
                await store.promises.load("text/turtle", testCase.data, {baseURI: base});
            }
            var graphs = Object.keys(testCase.graphs || {});
            for (var i = 0; i < graphs.length; i++) {
                await store.promises.load("text/turtle", testCase.graphs[graphs[i]], {graph: base + graphs[i], baseURI: base});
            }
            var query = "BASE <" + base + "> " + testCase.query;
            // the graphs of the test's dataset are its named graphs (GRAPH ?g needs FROM NAMED)
            var results = graphs.length > 0 ?
                await store.promises.execute(query, [], graphs.map(function (graph) { return base + graph; })) :
                await store.promises.execute(query);
            if (typeof testCase.expected === "boolean") {
                expect(results).toBe(testCase.expected);
            } else {
                expect(rows(results)).toEqual(testCase.expected);
            }
        });
    });
});
