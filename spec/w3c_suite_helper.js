var AbstractQueryTree = require("../src/abstract_query_tree").AbstractQueryTree;
var Utils = require("../src/utils");
var fs = require('fs');
var path = require('path');
var N3 = require('n3');

var RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var MF_NS = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
var DAWG_NS = "http://www.w3.org/2001/sw/DataAccess/tests/test-dawg#";

// Tests the store does not pass yet. Each one runs as pending while it still fails, and fails once it passes,
// so that it is removed from this list.
var KNOWN_EXCEPTIONS = {
    // positive tests: features the store does not support
    "syntax-subquery-01.rq": "subqueries are not supported",
    "syntax-subquery-02.rq": "subqueries are not supported",
    "syntax-subquery-03.rq": "subqueries are not supported",
    "syntax-SELECTscope1.rq": "subqueries are not supported",
    "syntax-SELECTscope3.rq": "subqueries are not supported",
    "syntax-minus-01.rq": "MINUS is not supported",
    // negative tests the store accepts
    "syn-bad-01.rq": "SELECT * with GROUP BY is accepted",
    "syn-bad-02.rq": "an ungrouped variable in SELECT is accepted",
    "syn-bad-pname-06.rq": "an escaped ':' in a local name is accepted",
    "syn-bad-pname-13.rq": "a ':' in a blank node label is accepted",
    "syntax-update-bad-03.ru": "a variable in DELETE DATA is accepted",
    "syntax-update-bad-04.ru": "a variable in INSERT DATA is accepted",
    "syntax-update-bad-10.ru": "a blank node in DELETE WHERE is accepted",
    "syntax-update-bad-11.ru": "a blank node in a DELETE template is accepted",
    "syntax-update-bad-12.ru": "a blank node in DELETE DATA is accepted"
};

// The approved syntax tests of a manifest: {file, isPositive, queryText}
var readManifest = function(manifestPath) {
    var dir = path.dirname(manifestPath);
    var quads = new N3.Parser({baseIRI: "file:///"}).parse(fs.readFileSync(manifestPath, 'utf8'));
    var subjects = {};
    quads.forEach(function(quad) {
        var properties = subjects[quad.subject.value] = subjects[quad.subject.value] || {};
        properties[quad.predicate.value] = quad.object.value;
    });

    var tests = [];
    Object.keys(subjects).forEach(function(subject) {
        var properties = subjects[subject];
        var type = properties[RDF_NS + "type"];
        if(!/SyntaxTest11$/.test(type) || properties[DAWG_NS + "approval"] !== DAWG_NS + "Approved")
            return;
        var file = properties[MF_NS + "action"].split("/").pop();
        tests.push({
            file: file,
            isPositive: type.indexOf(MF_NS + "Positive") === 0,
            queryText: fs.readFileSync(path.join(dir, file), 'utf8').trim()
        });
    });
    return tests;
};

// Parses the query and builds every executable unit, as QueryEngine.execute does; returns the error, if any
var checkQuery = function(queryText) {
    var aqt = new AbstractQueryTree();
    try {
        var syntaxTree = aqt.parseQueryString(Utils.normalizeUnicodeLiterals(queryText));
        syntaxTree.units.forEach(function(unit) {
            aqt.parseExecutableUnit(unit);
        });
        return null;
    } catch(e) {
        return e;
    }
};

// Defines one spec per approved test of the manifest; call it inside a describe
var defineW3CSyntaxSpecs = function(manifestPath) {
    var tests = readManifest(manifestPath);
    if(tests.length === 0)
        throw new Error("no approved syntax tests in " + manifestPath);

    tests.forEach(function(test) {
        it((test.isPositive ? "accepts " : "rejects ") + test.file, function() {
            var error = checkQuery(test.queryText);
            var passes = test.isPositive ? error == null : error != null;
            var knownException = KNOWN_EXCEPTIONS[test.file];
            if(knownException != null) {
                if(passes)
                    fail(test.file + " passes now: remove it from the known exceptions");
                else
                    pending(knownException);
            } else if(test.isPositive) {
                expect(error && error.toString()).toBeNull();
            } else {
                expect(error).withContext("query is accepted:\n" + test.queryText).not.toBeNull();
            }
        });
    });
};

module.exports = {
    defineW3CSyntaxSpecs: defineW3CSyntaxSpecs
};
