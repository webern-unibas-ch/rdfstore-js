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

/**
 * Counts the entries of the in-memory lexicon's term maps (URI and literal, both directions)
 * and hands the sum to the callback. A fully released term set counts 0.
 */
function countLexiconTerms(lexicon, callback) {
    const trees = [lexicon.uris, lexicon.oidUris, lexicon.literals, lexicon.oidLiterals];
    let count = 0;
    (function next(i) {
        if (i === trees.length) return callback(count);
        trees[i].walk(
            function () {
                count++;
            },
            function () {
                next(i + 1);
            },
        );
    })(0);
}

module.exports = { newEngine, countLexiconTerms };
