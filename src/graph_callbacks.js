"use strict";

//imports
const Utils = require("./utils");
const Pattern = require("./quad_index").Pattern;
const RDFModel = require("./rdf_model");
const AbstractQueryTree = require("./abstract_query_tree").AbstractQueryTree;

const Callbacks = {};

Callbacks.ANYTHING = {
    token: "var",
    value: "_",
};

Callbacks.added = "added";
Callbacks.deleted = "deleted";
Callbacks.eventsFlushed = "eventsFlushed";

Callbacks.CallbacksBackend = function () {
    this.aqt = new AbstractQueryTree();
    this.engine = arguments[0];
    this.indexMap = {};
    // node listener -> its observers (one per startObservingNode call), keyed by function
    // identity: a plain object would key by the function's source text
    this.observersMap = new Map();
    this.queriesIndexMap = {};
    this.emptyNotificationsMap = {};
    this.queriesList = [];
    this.pendingQueries = [];
    this.matchedQueries = [];
    this.updateInProgress = null;
    this.indices = ["SPOG", "GP", "OGS", "POG", "GSP", "OS"];
    this.componentOrders = {
        SPOG: ["subject", "predicate", "object", "graph"],
        GP: ["graph", "predicate", "subject", "object"],
        OGS: ["object", "graph", "subject", "predicate"],
        POG: ["predicate", "object", "graph", "subject"],
        GSP: ["graph", "subject", "predicate", "object"],
        OS: ["object", "subject", "predicate", "graph"],
    };

    this.callbackCounter = 0;
    this.callbacksMap = {};
    this.callbacksInverseMap = new Map();
    // per subscription id: the pattern and its OIDs, whose lexicon references unsubscribe gives back
    this.callbackTerms = {};
    // per listener whose subscribe is still normalizing its pattern: whether it was unsubscribed meanwhile
    this.pendingSubscriptions = new Map();
    // patterns of stopped listeners and queries; the next update or load releases their lexicon references
    // (see releasePendingTerms), so that releasing never runs alongside an operation that registers terms
    this.termsToRelease = [];

    this.queryCounter = 0;
    this.queriesMap = {};
    this.queriesCallbacksMap = {};
    this.queriesInverseMap = {};
    // per observed query id: the patterns and their OIDs, whose lexicon references stopObservingQuery gives back
    this.queriesTerms = {};

    for (let i = 0; i < this.indices.length; i++) {
        const indexKey = this.indices[i];
        this.indexMap[indexKey] = {};
        this.queriesIndexMap[indexKey] = {};
    }
};

Callbacks.CallbacksBackend.prototype.startGraphModification = function () {
    if (this.ongoingModification !== true) {
        this.pendingQueries = [].concat(this.queriesList);
        this.matchedQueries = [];

        if (this.updateInProgress == null) {
            this.updateInProgress = {};
            this.updateInProgress[Callbacks["added"]] = [];
            this.updateInProgress[Callbacks["deleted"]] = [];
        }
    }
};

Callbacks.CallbacksBackend.prototype.nextGraphModification = function (event, quad) {
    this.updateInProgress[event].push(quad);
};

Callbacks.CallbacksBackend.prototype.endGraphModification = function (callback) {
    if (this.ongoingModification !== true) {
        const that = this;
        if (this.updateInProgress != null) {
            const tmp = that.updateInProgress;
            that.updateInProgress = null;
            this.sendNotification(Callbacks["deleted"], tmp[Callbacks["deleted"]], function () {
                that.sendNotification(Callbacks["added"], tmp[Callbacks["added"]], function () {
                    that.sendEmptyNotification(Callbacks["eventsFlushed"], null, function () {
                        that.dispatchQueries(function () {
                            callback(true);
                        });
                    });
                });
            });
        } else {
            callback(true);
        }
    } else {
        callback(true);
    }
};

Callbacks.CallbacksBackend.prototype.cancelGraphModification = function () {
    if (this.ongoingModification !== true) {
        this.updateInProgress = null;
    }
};

Callbacks.CallbacksBackend.prototype.sendNotification = function (event, quadsPairs, doneCallback) {
    const notificationsMap = {};
    for (let i = 0; i < quadsPairs.length; i++) {
        const quadPair = quadsPairs[i];
        for (const indexKey in this.indexMap) {
            let index = this.indexMap[indexKey];
            const order = this.componentOrders[indexKey];
            this._searchCallbacksInIndex(index, order, event, quadPair, notificationsMap);
            if (this.pendingQueries.length != 0) {
                index = this.queriesIndexMap[indexKey];
                this._searchQueriesInIndex(index, order, quadPair);
            }
        }
    }

    this.dispatchNotifications(notificationsMap);

    if (doneCallback != null) doneCallback(true);
};

Callbacks.CallbacksBackend.prototype.sendEmptyNotification = function (event, value, doneCallback) {
    const callbacks = this.emptyNotificationsMap[event] || [];
    for (let i = 0; i < callbacks.length; i++) {
        callbacks[i](event, value);
    }
    doneCallback();
};

Callbacks.CallbacksBackend.prototype.dispatchNotifications = function (notificationsMap) {
    for (const callbackId in notificationsMap) {
        const callback = this.callbacksMap[callbackId];
        const deleted = notificationsMap[callbackId][Callbacks["deleted"]];
        if (deleted != null) {
            try {
                callback(Callbacks["deleted"], deleted);
            } catch (e) {
                /* swallowed on purpose: a throwing handler must not break event dispatch */
            }
        }
        for (const event in notificationsMap[callbackId]) {
            if (event != Callbacks["deleted"]) {
                try {
                    callback(event, notificationsMap[callbackId][event]);
                } catch (e) {
                    /* swallowed on purpose: a throwing handler must not break event dispatch */
                }
            }
        }
    }
};

Callbacks.CallbacksBackend.prototype._searchCallbacksInIndex = function (
    index,
    order,
    event,
    quadPair,
    notificationsMap,
) {
    const quadPairNomalized = quadPair[1];
    quadPair = quadPair[0];

    for (let i = 0; i < order.length + 1; i++) {
        const matched = index["_"] || [];

        const filteredIds = [];
        for (let j = 0; j < matched.length; j++) {
            const callbackId = matched[j];
            if (this.callbacksMap[callbackId] != null) {
                notificationsMap[callbackId] = notificationsMap[callbackId] || {};
                notificationsMap[callbackId][event] = notificationsMap[callbackId][event] || [];
                notificationsMap[callbackId][event].push(quadPair);
                filteredIds.push(callbackId);
            }
        }
        index["_"] = filteredIds;
        const component = order[i];
        if (index["" + quadPairNomalized[component]] != null) {
            index = index["" + quadPairNomalized[component]];
        } else {
            break;
        }
    }
};

Callbacks.CallbacksBackend.prototype.subscribeEmpty = function (event, callback) {
    const callbacks = this.emptyNotificationsMap[event] || [];
    callbacks.push(callback);
    this.emptyNotificationsMap[event] = callbacks;
};

Callbacks.CallbacksBackend.prototype.unsubscribeEmpty = function (event, callback) {
    let callbacks = this.emptyNotificationsMap[event];
    if (callbacks != null) {
        callbacks = Utils.reject(callbacks, function (cb) {
            return cb === callback;
        });
    }
    this.emptyNotificationsMap[event] = callbacks;
};

Callbacks.CallbacksBackend.prototype.subscribe = function (s, p, o, g, callback, doneCallback) {
    const quad = this._tokenizeComponents(s, p, o, g);
    const queryEnv = { blanks: {}, outCache: {} };
    this.engine.registerNsInEnvironment(null, queryEnv);
    const that = this;
    const pending = { cancelled: false };
    this.pendingSubscriptions.set(callback, pending);
    this.engine.normalizeQuad(quad, queryEnv, true, function (normalized) {
        that.pendingSubscriptions.delete(callback);
        if (pending.cancelled) {
            that.termsToRelease.push({ quad: quad, key: normalized });
            if (doneCallback != null) doneCallback(true);
            return;
        }
        const pattern = new Pattern(normalized);
        const indexKey = that._indexForPattern(pattern);
        const indexOrder = that.componentOrders[indexKey];
        let index = that.indexMap[indexKey];
        for (let i = 0; i < indexOrder.length; i++) {
            const component = indexOrder[i];
            const quadValue = normalized[component];
            if (quadValue === "_") {
                if (index["_"] == null) {
                    index["_"] = [];
                }
                that.callbackCounter++;
                index["_"].push(that.callbackCounter);
                that.callbacksMap[that.callbackCounter] = callback;
                that.callbacksInverseMap.set(callback, that.callbackCounter);
                that.callbackTerms[that.callbackCounter] = { quad: quad, key: normalized };
                break;
            } else {
                if (i === indexOrder.length - 1) {
                    index[quadValue] = index[quadValue] || { _: [] };
                    that.callbackCounter++;
                    index[quadValue]["_"].push(that.callbackCounter);
                    that.callbacksMap[that.callbackCounter] = callback;
                    that.callbacksInverseMap.set(callback, that.callbackCounter);
                    that.callbackTerms[that.callbackCounter] = { quad: quad, key: normalized };
                } else {
                    index[quadValue] = index[quadValue] || {};
                    index = index[quadValue];
                }
            }
        }
        if (doneCallback != null) doneCallback(true);
    });
};

Callbacks.CallbacksBackend.prototype.unsubscribe = function (callback) {
    const id = this.callbacksInverseMap.get(callback);
    if (id != null) {
        this.callbacksInverseMap.delete(callback);
        delete this.callbacksMap[id];
        if (this.callbackTerms[id] != null) this.termsToRelease.push(this.callbackTerms[id]);
        delete this.callbackTerms[id];
    } else if (this.pendingSubscriptions.has(callback)) {
        // subscribe has not registered it yet: it drops the subscription when it does
        this.pendingSubscriptions.get(callback).cancelled = true;
    }
};

// Releases the lexicon references of stopped listeners and queries, then calls callback. Called at the start
// of every update and load, inside it: B-tree changes must not interleave with another operation's.
Callbacks.CallbacksBackend.prototype.releasePendingTerms = function (callback) {
    const terms = this.termsToRelease;
    if (terms.length === 0) return callback();
    this.termsToRelease = [];
    const lexicon = this.engine.lexicon;
    Utils.eachSeries(
        terms,
        function (entry, k) {
            lexicon.release(entry.quad, entry.key, function () {
                k();
            });
        },
        function () {
            callback();
        },
    );
};

Callbacks.CallbacksBackend.prototype._tokenizeComponents = function (s, p, o, g) {
    const pattern = {};

    if (s == null) {
        pattern["subject"] = Callbacks.ANYTHING;
    } else {
        if (s.indexOf("_:") == 0) {
            pattern["subject"] = { token: "blank", value: s };
        } else {
            pattern["subject"] = { token: "uri", value: s };
        }
    }

    if (p == null) {
        pattern["predicate"] = Callbacks.ANYTHING;
    } else {
        pattern["predicate"] = { token: "uri", value: p };
    }

    if (o == null) {
        pattern["object"] = Callbacks.ANYTHING;
    } else {
        pattern["object"] = { token: "uri", value: o };
    }

    if (g == null) {
        pattern["graph"] = Callbacks.ANYTHING;
    } else {
        pattern["graph"] = { token: "uri", value: g };
    }

    return pattern;
};

Callbacks.CallbacksBackend.prototype._indexForPattern = function (pattern) {
    const indexKey = pattern.indexKey;
    const matchingIndices = this.indices;

    for (let i = 0; i < matchingIndices.length; i++) {
        const index = matchingIndices[i];
        const indexComponents = this.componentOrders[index];
        for (let j = 0; j < indexComponents.length; j++) {
            if (Utils.include(indexKey, indexComponents[j]) === false) {
                break;
            }
            if (j == indexKey.length - 1) {
                return index;
            }
        }
    }

    return "SPOG"; // If no other match, we return the most generic index
};

Callbacks.CallbacksBackend.prototype.observeNode = function () {
    let uri, graphUri, callback, doneCallback;

    if (arguments.length === 4) {
        uri = arguments[0];
        graphUri = arguments[1];
        callback = arguments[2];
        doneCallback = arguments[3];
    } else {
        uri = arguments[0];
        graphUri = this.engine.lexicon.defaultGraphUri;
        callback = arguments[1];
        doneCallback = arguments[2];
    }
    const query = "CONSTRUCT { <" + uri + "> ?p ?o } WHERE { GRAPH <" + graphUri + "> { <" + uri + "> ?p ?o } }";
    const that = this;
    const queryEnv = { blanks: {}, outCache: {} };
    this.engine.registerNsInEnvironment(null, queryEnv);
    const bindings = [];
    this.engine.execute(query, function (err, graph) {
        if (!err) {
            const node = graph;
            let mustFlush = false;
            const observer = function (event, triples) {
                if (event === "eventsFlushed" && mustFlush) {
                    mustFlush = false;
                    try {
                        callback(node);
                    } catch (e) {
                        /* swallowed on purpose: a throwing handler must not break event dispatch */
                    }
                } else if (event !== "eventsFlushed") {
                    mustFlush = true;
                    for (let i = 0; i < triples.length; i++) {
                        let triple = triples[i];
                        const s = RDFModel.buildRDFResource(triple.subject, bindings, that.engine, queryEnv);
                        const p = RDFModel.buildRDFResource(triple.predicate, bindings, that.engine, queryEnv);
                        const o = RDFModel.buildRDFResource(triple.object, bindings, that.engine, queryEnv);
                        if (s != null && p != null && o != null) {
                            triple = new RDFModel.Triple(s, p, o);
                            if (event === Callbacks["added"]) {
                                node.add(triple);
                            } else if (event === Callbacks["deleted"]) {
                                node.remove(triple);
                            }
                        }
                    }
                }
            };
            that.observersMap.set(callback, (that.observersMap.get(callback) || []).concat(observer));
            that.subscribeEmpty(Callbacks["eventsFlushed"], observer);
            that.subscribe(uri, null, null, null, observer, function () {
                try {
                    callback(node);
                } catch (e) {
                    /* swallowed on purpose: a throwing handler must not break event dispatch */
                }

                if (doneCallback) doneCallback(true);
            });
        } else {
            if (doneCallback) doneCallback(false);
        }
    });
};

Callbacks.CallbacksBackend.prototype.stopObservingNode = function (callback) {
    const observers = this.observersMap.get(callback);
    if (observers) {
        this.observersMap.delete(callback);
        for (let i = 0; i < observers.length; i++) {
            this.unsubscribe(observers[i]);
            this.unsubscribeEmpty(Callbacks["eventsFlushed"], observers[i]);
        }
        return true;
    } else {
        return false;
    }
};

// Queries

Callbacks.CallbacksBackend.prototype.observeQuery = function (query, callback, endCallback) {
    const queryParsed = this.aqt.parseQueryString(query);
    const parsedTree = this.aqt.parseSelect(queryParsed.units[0]);
    const patterns = this.aqt.collectBasicTriples(parsedTree);
    const that = this;
    const queryEnv = { blanks: {}, outCache: {} };
    // the query's PREFIX and BASE, so that its patterns are registered under the IRIs that change
    this.engine.registerNsInEnvironment(queryParsed.prologue, queryEnv);
    const counter = this.queryCounter;
    this.queryCounter++;
    this.queriesMap[counter] = query;
    // a query observed more than once has one id per call
    this.queriesInverseMap[query] = (this.queriesInverseMap[query] || []).concat(counter);
    this.queriesList.push(counter);
    this.queriesCallbacksMap[counter] = callback;

    // a query without a dataset in a store with a union default graph: its patterns match in every graph
    const dataset = parsedTree.dataset;
    const union = this.engine.unionDefaultGraph && dataset.implicit.length === 0 && dataset.named.length === 0;

    Utils.eachSeries(
        patterns,
        function (quad, k) {
            if (quad.graph == null) {
                quad.graph = union ? { token: "var", value: "graph:union" } : that.engine.lexicon.defaultGraphUriTerm;
            }

            that.engine.normalizeQuad(quad, queryEnv, true, function (normalized) {
                if (that.queriesMap[counter] != null) {
                    (that.queriesTerms[counter] = that.queriesTerms[counter] || []).push({
                        quad: quad,
                        key: normalized,
                    });
                } else {
                    // stopped while its patterns were still being registered
                    that.termsToRelease.push({ quad: quad, key: normalized });
                }
                const pattern = new Pattern(normalized);
                const indexKey = that._indexForPattern(pattern);
                const indexOrder = that.componentOrders[indexKey];
                let index = that.queriesIndexMap[indexKey];

                for (let j = 0; j < indexOrder.length; j++) {
                    const component = indexOrder[j];
                    const quadValue = normalized[component];
                    if (typeof quadValue === "string") {
                        if (index["_"] == null) {
                            index["_"] = [];
                        }
                        index["_"].push(counter);
                        break;
                    } else {
                        if (j === indexOrder.length - 1) {
                            index[quadValue] = index[quadValue] || { _: [] };
                            index[quadValue]["_"].push(counter);
                        } else {
                            index[quadValue] = index[quadValue] || {};
                            index = index[quadValue];
                        }
                    }
                }
                k();
            });
        },
        function () {
            // ready only after the initial result, so that changes made from it notify after that result
            that.engine.execute(query, function (err, results) {
                try {
                    if (!err) {
                        callback(results);
                    }
                } finally {
                    // also when the listener throws; its exception still propagates
                    if (endCallback != null) endCallback(err || null);
                }
            });
        },
    );
};

Callbacks.CallbacksBackend.prototype.stopObservingQuery = function (query) {
    const ids = this.queriesInverseMap[query];
    if (ids != null) {
        delete this.queriesInverseMap[query];
        for (let i = 0; i < ids.length; i++) {
            delete this.queriesMap[ids[i]];
            delete this.queriesCallbacksMap[ids[i]];
            Array.prototype.push.apply(this.termsToRelease, this.queriesTerms[ids[i]] || []);
            delete this.queriesTerms[ids[i]];
        }
        this.queriesList = Utils.reject(this.queriesList, function (queryId) {
            return Utils.include(ids, queryId);
        });
    }
};

Callbacks.CallbacksBackend.prototype._searchQueriesInIndex = function (index, order, quadPair) {
    const quadPairNomalized = quadPair[1];
    quadPair = quadPair[0];

    for (let i = 0; i < order.length + 1; i++) {
        const matched = index["_"] || [];

        const filteredIds = [];
        for (let j = 0; j < matched.length; j++) {
            const queryId = matched[j];
            if (Utils.include(this.pendingQueries, queryId)) {
                Utils.remove(this.pendingQueries, function (pendingQueryId) {
                    return pendingQueryId === queryId;
                });
                this.matchedQueries.push(queryId);
            }
            // removing IDs for queries no longer being observed
            if (this.queriesMap[queryId] != null) {
                filteredIds.push(queryId);
            }
        }
        index["_"] = filteredIds;

        const component = order[i];
        if (index["" + quadPairNomalized[component]] != null) {
            index = index["" + quadPairNomalized[component]];
        } else {
            break;
        }
    }
};

Callbacks.CallbacksBackend.prototype.dispatchQueries = function (callback) {
    const that = this;
    let query, queryCallback;
    const toDispatchMap = {};

    Utils.eachSeries(
        this.matchedQueries,
        function (queryId, k) {
            // avoid duplicate notifications
            if (toDispatchMap[queryId] == null) {
                toDispatchMap[queryId] = true;
                query = that.queriesMap[queryId];
                queryCallback = that.queriesCallbacksMap[queryId];

                that.engine.execute(query, function (err, results) {
                    if (!err) {
                        try {
                            queryCallback(results);
                        } catch (e) {
                            /* swallowed on purpose: a throwing handler must not break event dispatch */
                        }
                    }
                    k();
                });
            } else {
                k();
            }
        },
        function () {
            callback();
        },
    );
};

Callbacks.CallbacksBackend.added = Callbacks.added;
Callbacks.CallbacksBackend.deleted = Callbacks.deleted;
Callbacks.CallbacksBackend.eventsFlushed = Callbacks.eventsFlushed;

module.exports = Callbacks;
