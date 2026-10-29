"use strict";

var N3Parser = require('n3').Parser;
var Utils = require('./utils');
//var N3Parser = require('../node_modules/n3/lib/N3Parser');

// Add a wrapper around the N3.js parser
var RVN3Parser = {};
RVN3Parser.parser = {
    async: true,
    parse: function (data, graph, options, callback) {
        // Shift arguments if necessary
        if (!callback) {
            callback = options;
            options = graph;
            graph = null;
        }

        // Make sure graph is an object
        if (graph && typeof(graph) === 'string')
            graph = { token: 'uri', value: graph, prefix: null, suffix: null };
        if (options && options.baseURI) {
            options.baseIRI = options.baseURI;
        }

        // Parse triples into array; after an error the parser must not report anything else
        var triples = [];
        var done = Utils.once(callback);
        new N3Parser(options).parse(data, function (error, triple) {
            if (error)
                done(error);
            else if (!triple)
                done(null, triples);
            else
                triples.push({
                    subject:   convertEntity(triple.subject),
                    predicate: convertEntity(triple.predicate),
                    object:    convertEntity(triple.object),
                    graph:     graph
                });
        });
    },

    resetBlankNodeIds: function() {
        // Reset blank node mapping for backward compatibility with tests
        blankNodeMap = {};
        blankNodeCounter = 0;
    }

};

// Add a blank node ID mapping system for backward compatibility
var blankNodeMap = {};
var blankNodeCounter = 0;

// Converts an entity in N3.js representation to this library's representation
function convertEntity(entity) {
    // Handle modern N3.js object format
    if (entity && typeof entity === 'object' && entity.termType) {
        switch (entity.termType) {
            case 'BlankNode':
                var blankId = entity.id;
                if (!blankNodeMap[blankId]) {
                    // Check if this is a user-defined named blank node (not N3.js internal)
                    if (blankId.startsWith('_:') && blankId.length > 2) {
                        var name = blankId.substring(2); // Remove '_:' prefix
                        
                        // Check if this looks like an N3.js internal ID (e.g., "n3-0", "b1", etc.)
                        var isInternalId = /^(n3-\d+|b\d+|\d+)$/.test(name);
                        
                        if (!isInternalId) {
                            // This appears to be a user-defined name
                            // Remove any N3.js internal prefixes (pattern: prefix_userDefined)
                            var lastUnderscore = name.lastIndexOf('_');
                            if (lastUnderscore > 0 && lastUnderscore < name.length - 1) {
                                name = name.substring(lastUnderscore + 1);
                            }
                            blankNodeMap[blankId] = '_:' + blankNodeCounter++ + '_' + name;
                        } else {
                            // N3.js internal ID - treat as anonymous
                            blankNodeMap[blankId] = '_:' + blankNodeCounter++;
                        }
                    } else {
                        // Anonymous blank node
                        blankNodeMap[blankId] = '_:' + blankNodeCounter++;
                    }
                }
                return { blank: blankNodeMap[blankId] };
                
            case 'NamedNode':
                return { token: 'uri', value: entity.id, prefix: null, suffix: null };
                
            case 'Literal':
                if (entity.language) {
                    return { literal: '"' + entity.value + '"@' + entity.language };
                } else if (entity.datatype && entity.datatype.id !== 'http://www.w3.org/2001/XMLSchema#string') {
                    return { literal: '"' + entity.value + '"^^<' + entity.datatype.id + '>' };
                } else {
                    return { literal: '"' + entity.value + '"' };
                }
                
            default:
                return { token: 'uri', value: entity.id || entity.value || entity, prefix: null, suffix: null };
        }
    }
    
    // Fallback for unexpected formats
    return { token: 'uri', value: String(entity), prefix: null, suffix: null };
}

module.exports = {
    RVN3Parser: RVN3Parser
};
