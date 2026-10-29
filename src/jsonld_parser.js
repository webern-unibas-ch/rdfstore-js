"use strict";

var jsonld = require('jsonld');

var toTriples = async function (input, graph) {
    var rval = null;

    // convert input to normalized RDF
    const normalized = await jsonld.toRDF(input, {})

    var parseTerm = function (term) {
        if (term.termType === 'BlankNode') {
            // Ensure blank node values always start with "_:" prefix
            var blankValue = term.value.startsWith('_:') ? term.value : '_:' + term.value;
            return {'blank': blankValue};
        } else if (term.termType === 'NamedNode') {
            return {'token': 'uri', 'value': term.value};
        } else if (term.termType === 'Literal') {
            if (term.language != null) {
                return {'literal': '"' + term.value + '"@' + term.language};
            } else if (term.datatype !== null) {
                return {'literal': '"' + term.value + '"^^<' + term.datatype.value + ">"};
            } else {
                return {'literal': '"' + term.value + '"'};

            }
        }
    };

    rval = [];
    var callback = function (s, p, o) {
        rval.push({
            'subject': parseTerm(s),
            'predicate': parseTerm(p),
            'object': parseTerm(o),
            'graph': graph
        });
    };


    // generate triples
    var quit = false;
    var triples = normalized;
    for (var i = 0; i < triples.length; i++) {
        var triple = triples[i];
        callback(triple.subject, triple.predicate, triple.object);
    }

    return rval;

}


// exports
exports.JSONLDParser = {};
var JSONLDParser = exports.JSONLDParser;

JSONLDParser.parser = {

    async: true,

    parse: function (data, graph, options, callback) {
        try {
            if (typeof(data) === 'string') {
                data = JSON.parse(data);
            }
        } catch (error) {
            return callback(error);
        }
        // call back outside the promise chain, so an exception in the callback is not turned into a rejection
        toTriples(data, graph).then(function (triples) {
            queueMicrotask(function () { callback(null, triples); });
        }, function (error) {
            queueMicrotask(function () { callback(error); });
        });
    }

};

module.exports = {
    JSONLDParser: JSONLDParser
};
