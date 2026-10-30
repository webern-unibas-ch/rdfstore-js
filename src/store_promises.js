"use strict";

var Utils = require("./utils");

/**
 * Promise versions of the asynchronous Store methods, available as <code>store.promises</code>.<br/>
 * <br/>
 * Every method takes the same arguments as its callback counterpart, minus the callback.
 * It resolves with the callback's result and rejects with its error. The callback API
 * stays unchanged; the events API has no promise version, because its listeners fire
 * more than once.
 *
 * @constructor
 * @param {Store} store The store whose methods are wrapped
 */
var StorePromises = function(store) {
    this.store = store;
};

// The store methods tell their forms apart by the number of arguments, so each
// wrapper passes exactly the arguments the intended form expects, plus the callback.

StorePromises.prototype.execute = function(query, defaultGraphs, namedGraphs) {
    var store = this.store;
    if(defaultGraphs == null && namedGraphs == null) {
        return Utils.toPromise(function(cb) { store.execute(query, cb); });
    }
    return this.executeWithEnvironment(query, defaultGraphs || [], namedGraphs || []);
};

StorePromises.prototype.executeWithEnvironment = function(query, defaultGraphs, namedGraphs) {
    var store = this.store;
    return Utils.toPromise(function(cb) { store.executeWithEnvironment(query, defaultGraphs, namedGraphs, cb); });
};

StorePromises.prototype.load = function(mediaType, data, graphOrOptions) {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        if(graphOrOptions == null) {
            store.load(mediaType, data, cb);
        } else {
            store.load(mediaType, data, graphOrOptions, cb);
        }
    });
};

StorePromises.prototype.insert = function(triples, graph) {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        if(graph == null) {
            store.insert(triples, cb);
        } else {
            store.insert(triples, graph, cb);
        }
    });
};

StorePromises.prototype.delete = function(triples, graph) {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        if(graph == null) {
            store.delete(triples, cb);
        } else {
            store.delete(triples, graph, cb);
        }
    });
};

StorePromises.prototype.clear = function(graph) {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        if(graph == null) {
            store.clear(cb);
        } else {
            store.clear(graph, cb);
        }
    });
};

StorePromises.prototype.graph = function(graphUri) {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        if(graphUri == null) {
            store.graph(cb);
        } else {
            store.graph(graphUri, cb);
        }
    });
};

StorePromises.prototype.node = function(nodeUri, graphUri) {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        if(graphUri == null) {
            store.node(nodeUri, cb);
        } else {
            store.node(nodeUri, graphUri, cb);
        }
    });
};

StorePromises.prototype.registeredGraphs = function() {
    var store = this.store;
    return Utils.toPromise(function(cb) { store.registeredGraphs(cb); });
};

StorePromises.prototype.close = function() {
    var store = this.store;
    return Utils.toPromise(function(cb) {
        store.close(function() { cb(null); });
    });
};

module.exports.StorePromises = StorePromises;
