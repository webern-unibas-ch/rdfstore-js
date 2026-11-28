"use strict";

const QueryEngine = require("../../src/query_engine").QueryEngine;
const QuadBackend = require("../../src/quad_backend").QuadBackend;
const Lexicon = require("../../src/lexicon").Lexicon;
const Utils = require("../../src/utils");

/**
 * Resolves with a new in-memory query engine (Lexicon + QuadBackend).
 *
 * createEngine([options]): options.treeOrder is the B-tree order (default 2).
 */
function createEngine(options) {
    const treeOrder = (options && options.treeOrder) || 2;
    return new Promise(function (resolve) {
        new Lexicon(function (lexicon) {
            new QuadBackend({ treeOrder: treeOrder }, function (backend) {
                resolve(new QueryEngine({ backend: backend, lexicon: lexicon }));
            });
        });
    });
}

/**
 * Runs engine.execute and resolves with its result, or rejects with its error.
 */
function execute(engine, query, defaultDataset, namedDataset) {
    return Utils.toPromise(function (cb) {
        engine.execute(query, cb, defaultDataset, namedDataset);
    });
}

/**
 * Resolves with the number of entries in the in-memory lexicon's term maps (URI and literal,
 * both directions). A fully released term set counts 0.
 */
function lexiconTermCount(lexicon) {
    const trees = [lexicon.uris, lexicon.oidUris, lexicon.literals, lexicon.oidLiterals];
    let count = 0;
    return new Promise(function (resolve) {
        (function next(i) {
            if (i === trees.length) return resolve(count);
            trees[i].walk(
                function () {
                    count++;
                },
                function () {
                    next(i + 1);
                },
            );
        })(0);
    });
}

/**
 * Resolves with the error the promise rejects with, or with null if it resolves.
 */
function rejection(promise) {
    return promise.then(
        function () {
            return null;
        },
        function (err) {
            return err;
        },
    );
}

module.exports = { createEngine, execute, lexiconTermCount, rejection };
