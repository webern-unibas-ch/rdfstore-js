"use strict";

const jsonld = require('jsonld');

const toTriples = async function (input, graph) {
    let rval = null;

    // convert input to normalized RDF
    const normalized = await jsonld.toRDF(input, {})

    const parseTerm = function (term) {
        if (term.termType === 'BlankNode') {
            // Ensure blank node values always start with "_:" prefix
            const blankValue = term.value.startsWith('_:') ? term.value : '_:' + term.value;
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
    const callback = function (s, p, o) {
        rval.push({
            'subject': parseTerm(s),
            'predicate': parseTerm(p),
            'object': parseTerm(o),
            'graph': graph
        });
    };


    // generate triples
    const triples = normalized;
    for (let i = 0; i < triples.length; i++) {
        const triple = triples[i];
        callback(triple.subject, triple.predicate, triple.object);
    }

    return rval;

}


// exports
exports.JSONLDParser = {};
const JSONLDParser = exports.JSONLDParser;

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
