"use strict";

var Utils = require("./utils");

/**
 * Builds the promise versions of the asynchronous Store methods, available as <code>store.promises</code>.<br/>
 * <br/>
 * Every method takes the same arguments as its callback counterpart, minus the callback.
 * It resolves with the callback's result and rejects with its error. The methods are
 * closures over the store, so they also work when taken off the object
 * (<code>const { execute } = store.promises</code>). The callback API stays unchanged;
 * the events API has no promise version, because its listeners fire more than once.
 *
 * @param {Store} store the store whose methods are wrapped
 */
var createStorePromises = function(store) {

    // The store methods tell their forms apart by the number of arguments, so the optional
    // argument is passed only when it is set, followed by the callback.
    var callStore = function(method, args, optional) {
        if(optional != null) {
            args = args.concat([optional]);
        }
        return Utils.toPromise(function(cb) {
            store[method].apply(store, args.concat([cb]));
        });
    };

    var executeWithEnvironment = function(query, defaultGraphs, namedGraphs) {
        // e.g. queries.map(execute) passes an index and the array: reject instead of querying the wrong graphs
        if(!Array.isArray(defaultGraphs) || !Array.isArray(namedGraphs)) {
            return Promise.reject(new TypeError("defaultGraphs and namedGraphs must be arrays of graph URIs"));
        }
        return callStore("executeWithEnvironment", [query, defaultGraphs, namedGraphs]);
    };

    return {
        execute: function(query, defaultGraphs, namedGraphs) {
            if(defaultGraphs == null && namedGraphs == null) {
                return callStore("execute", [query]);
            }
            return executeWithEnvironment(query, defaultGraphs == null ? [] : defaultGraphs, namedGraphs == null ? [] : namedGraphs);
        },
        executeWithEnvironment: executeWithEnvironment,
        load: function(mediaType, data, graphOrOptions) {
            return callStore("load", [mediaType, data], graphOrOptions);
        },
        insert: function(triples, graph) {
            return callStore("insert", [triples], graph);
        },
        delete: function(triples, graph) {
            return callStore("delete", [triples], graph);
        },
        clear: function(graph) {
            return callStore("clear", [], graph);
        },
        graph: function(graphUri) {
            return callStore("graph", [], graphUri);
        },
        node: function(nodeUri, graphUri) {
            return callStore("node", [nodeUri], graphUri);
        },
        registeredGraphs: function() {
            return callStore("registeredGraphs", []);
        },
        close: function() {
            // close calls back without arguments
            return Utils.toPromise(function(cb) {
                store.close(function() { cb(null); });
            });
        }
    };
};

module.exports.createStorePromises = createStorePromises;
