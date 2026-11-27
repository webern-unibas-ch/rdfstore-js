"use strict";

const QueryEngine = require("../../src/query_engine").QueryEngine;
const QuadBackend = require("../../src/quad_backend").QuadBackend;
const Lexicon = require("../../src/lexicon").Lexicon;

/**
 * Builds an in-memory query engine (Lexicon + QuadBackend) and hands it to the callback.
 *
 * newEngine([options], callback): options.treeOrder is the B-tree order (default 2).
 */
function newEngine(options, callback) {
    if (callback == null) {
        callback = options;
        options = {};
    }
    const treeOrder = options.treeOrder || 2;
    new Lexicon(function (lexicon) {
        new QuadBackend({ treeOrder: treeOrder }, function (backend) {
            callback(new QueryEngine({ backend: backend, lexicon: lexicon }));
        });
    });
}

module.exports = { newEngine };
