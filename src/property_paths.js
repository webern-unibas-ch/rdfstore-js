"use strict";

/**
 * Evaluates property paths (SPARQL 1.1 section 18.4): the PATH nodes of the algebra (see
 * AbstractQueryTree.translatePathExpressionsInBGP). A path is evaluated to a relation, a list of
 * [start, end] node pairs per graph. Nodes are OIDs; a constant that is not in the store is a term
 * object, which only a zero-length path reaches.
 *
 * The default graph is one graph, also if it merges several (FROM). Under GRAPH ?g each named graph of
 * the dataset is evaluated on its own, and every solution binds the graph.
 */

var Utils = require("./utils");
var async = require("./utils");

var PropertyPaths = {};

// a Map/Set key for a node
var nodeKey = function(node) {
    return typeof(node) === 'number' ? node : "t" + JSON.stringify(node);
};

var pairKey = function(pair) {
    return nodeKey(pair[0]) + " " + nodeKey(pair[1]);
};

var distinctPairs = function(pairs) {
    var seen = new Set();
    var acum = [];
    for(var i=0; i<pairs.length; i++) {
        var key = pairKey(pairs[i]);
        if(!seen.has(key)) {
            seen.add(key);
            acum.push(pairs[i]);
        }
    }
    return acum;
};

// applies fn to the pairs of every graph
var mapRelation = function(relation, fn) {
    var result = new Map();
    relation.forEach(function(pairs, graph) {
        result.set(graph, fn(pairs, graph));
    });
    return result;
};

/**
 * An end of the path: {variable: name}, or {node: OID or term}. A blank node of the query matches like a
 * variable; a bound one (EXISTS) carries its OID.
 */
var resolveEndpoint = function(ctx, term, callback) {
    if(term.token === 'var') {
        callback({variable: term.value});
    } else if(term.token === 'blank') {
        if(term.oid == null) {
            callback({variable: "blank:" + term.value});
        } else {
            callback({node: term.oid !== -1 ? term.oid : {token: 'blank', value: term.value}});
        }
    } else {
        ctx.engine.normalizeTerm(term, ctx.env, false, function(oid) {
            if(oid != null && oid !== -1) {
                callback({node: oid});
            } else if(term.token === 'uri') {
                callback({node: {token: 'uri', value: Utils.lexicalFormBaseUri(term, ctx.env)}});
            } else {
                callback({node: ctx.engine.lexicon.parseLiteral(Utils.lexicalFormLiteral(term, ctx.env))});
            }
        });
    }
};

// the graphs to evaluate the path in: the default graph, the GRAPH IRI if it is in the dataset, or the named
// graphs of the dataset (GRAPH ?g)
var graphKeys = function(ctx, callback) {
    if(ctx.graph == null) {
        callback(["default"]);
    } else if(ctx.graph.token === 'var') {
        var keys = [];
        for(var i=0; i<ctx.dataset.named.length; i++) {
            if(keys.indexOf(ctx.dataset.named[i].oid) === -1) {
                keys.push(ctx.dataset.named[i].oid);
            }
        }
        callback(keys);
    } else {
        ctx.engine.isDatasetGraph(ctx.graph, ctx.dataset, ctx.env, function(inDataset) {
            callback(inDataset ? ["graph"] : []);
        });
    }
};

// the solutions of one triple pattern over the path's graph(s), as a relation of the subject and object
var matchTriple = function(ctx, predicate, callback) {
    var triple = {
        subject: {token: 'var', value: 'path:s'},
        predicate: predicate,
        object: {token: 'var', value: 'path:o'}
    };
    if(ctx.graph != null) {
        triple.graph = Utils.clone(ctx.graph, true);
    }
    ctx.engine.executeAndBGP(null, ctx.dataset, {kind: 'BGP', value: [triple], scoped: true}, ctx.env, function(err, results) {
        if(err != null) {
            return callback(err);
        }
        var relation = new Map();
        ctx.keys.forEach(function(key) {
            relation.set(key, []);
        });
        var graphVariable = ctx.graph != null && ctx.graph.token === 'var' ? ctx.graph.value : null;
        results = results || [];
        for(var i=0; i<results.length; i++) {
            var pairs = relation.get(graphVariable == null ? ctx.keys[0] : results[i][graphVariable]);
            if(pairs != null) {
                pairs.push([results[i]['path:s'], results[i]['path:o']]);
            }
        }
        // a graph is a set of triples (several default graphs may hold the same triple)
        callback(null, mapRelation(relation, distinctPairs));
    });
};

// every node of each graph (subjects and objects), for zero-length paths between two variables
var graphNodes = function(ctx, callback) {
    if(ctx.nodes != null) {
        return callback(null, ctx.nodes);
    }
    matchTriple(ctx, {token: 'var', value: 'path:p'}, function(err, relation) {
        if(err != null) {
            return callback(err);
        }
        ctx.nodes = mapRelation(relation, function(pairs) {
            var nodes = new Set();
            for(var i=0; i<pairs.length; i++) {
                nodes.add(pairs[i][0]);
                nodes.add(pairs[i][1]);
            }
            return Array.from(nodes);
        });
        callback(null, ctx.nodes);
    });
};

// the zero-length pairs: the start (or end) nodes of the path (a constant also if it is not in the graph), else
// every node of the graph. Inside |, / or a modifier the ends are not known, so the constant ends of the whole path
// are added: they need not be in the graph either (<x> (:p?|:q) ?y gives ?y = <x>), and pair only with themselves.
var zeroLength = function(ctx, ends, callback) {
    var nodes = ends.starts || ends.ends;
    if(nodes !== undefined) {
        callback(null, new Map(ctx.keys.map(function(key) {
            return [key, nodes.map(function(n) { return [n, n]; })];
        })));
    } else {
        graphNodes(ctx, function(err, nodes) {
            if(err != null) {
                return callback(err);
            }
            callback(null, mapRelation(nodes, function(list) {
                return distinctPairs(list.concat(ctx.boundNodes).map(function(n) { return [n, n]; }));
            }));
        });
    }
};

// the nodes reachable from start in one or more steps; iterative, so that long chains and cycles end
var reachable = function(adjacency, start) {
    var visited = new Set();
    var pending = (adjacency.get(start) || []).slice();
    while(pending.length > 0) {
        var node = pending.pop();
        if(!visited.has(node)) {
            visited.add(node);
            var next = adjacency.get(node);
            if(next != null) {
                for(var i=0; i<next.length; i++) {
                    if(!visited.has(next[i])) {
                        pending.push(next[i]);
                    }
                }
            }
        }
    }
    return visited;
};

// the transitive closure of a relation (path+), distinct pairs; only from the start nodes or to the end nodes
var closure = function(pairs, ends) {
    var backwards = ends.starts === undefined && ends.ends !== undefined;
    var adjacency = new Map();
    for(var i=0; i<pairs.length; i++) {
        var from = backwards ? pairs[i][1] : pairs[i][0];
        var to = backwards ? pairs[i][0] : pairs[i][1];
        if(!adjacency.has(from)) {
            adjacency.set(from, []);
        }
        adjacency.get(from).push(to);
    }
    var starts = ends.starts || ends.ends || Array.from(adjacency.keys());
    var acum = [];
    for(var j=0; j<starts.length; j++) {
        reachable(adjacency, starts[j]).forEach(function(node) {
            acum.push(backwards ? [node, starts[j]] : [starts[j], node]);
        });
    }
    return acum;
};

// joins two relations on the end of the first and the start of the second
var compose = function(left, right) {
    var byStart = new Map();
    for(var i=0; i<right.length; i++) {
        var key = nodeKey(right[i][0]);
        if(!byStart.has(key)) {
            byStart.set(key, []);
        }
        byStart.get(key).push(right[i][1]);
    }
    var acum = [];
    for(var j=0; j<left.length; j++) {
        var ends = byStart.get(nodeKey(left[j][1]));
        if(ends != null) {
            for(var k=0; k<ends.length; k++) {
                acum.push([left[j][0], ends[k]]);
            }
        }
    }
    return acum;
};

/**
 * Evaluates a path to a relation (Map graph -> pairs). ends holds the nodes the whole path starts (starts) or ends
 * (ends) at, undefined if any; inner paths get {} and are evaluated over the whole graph.
 */
var evaluate = function(ctx, path, ends, callback) {
    if(path.type === 'link') {
        matchTriple(ctx, path.iri, callback);
    } else if(path.type === 'inverse') {
        evaluate(ctx, path.path, {starts: ends.ends, ends: ends.starts}, function(err, relation) {
            callback(err, err != null ? null : mapRelation(relation, function(pairs) {
                return pairs.map(function(pair) { return [pair[1], pair[0]]; });
            }));
        });
    } else if(path.type === 'alt') {
        var union = null;
        async.eachSeries(path.paths, function(part, k) {
            evaluate(ctx, part, ends, function(err, relation) {
                if(err == null) {
                    union = union == null ? relation : mapRelation(union, function(pairs, graph) {
                        return pairs.concat(relation.get(graph));
                    });
                }
                k(err);
            });
        }, function(err) {
            callback(err, err != null ? null : union);
        });
    } else if(path.type === 'seq') {
        // step by step from the start nodes, or backwards from the end nodes: each part starts (ends) only at the
        // nodes the parts before reached
        var backwards = ends.starts === undefined && ends.ends !== undefined;
        var parts = backwards ? path.paths.slice().reverse() : path.paths;
        var result = null;
        var reached = backwards ? ends.ends : ends.starts;
        async.eachSeries(parts, function(part, k) {
            evaluate(ctx, part, backwards ? {ends: reached} : {starts: reached}, function(err, relation) {
                if(err != null) {
                    return k(err);
                }
                result = result == null ? relation : mapRelation(result, function(pairs, graph) {
                    return backwards ? compose(relation.get(graph), pairs) : compose(pairs, relation.get(graph));
                });
                if(reached !== undefined) {
                    var nodes = new Map();
                    result.forEach(function(pairs) {
                        pairs.forEach(function(pair) {
                            var node = backwards ? pair[0] : pair[1];
                            nodes.set(nodeKey(node), node);
                        });
                    });
                    reached = Array.from(nodes.values());
                }
                k();
            });
        }, function(err) {
            callback(err, err != null ? null : result);
        });
    } else if(path.type === 'oneOrMore' || path.type === 'zeroOrMore' || path.type === 'zeroOrOne') {
        // a closure needs the whole relation of its inner path
        evaluate(ctx, path.path, path.type === 'zeroOrOne' ? ends : {}, function(err, relation) {
            if(err != null) {
                return callback(err);
            }
            var steps = mapRelation(relation, function(pairs) {
                return path.type === 'zeroOrOne' ? pairs : closure(pairs, ends);
            });
            if(path.type === 'oneOrMore') {
                return callback(null, steps);
            }
            zeroLength(ctx, ends, function(err, identity) {
                if(err != null) {
                    return callback(err);
                }
                callback(null, mapRelation(steps, function(pairs, graph) {
                    return distinctPairs(identity.get(graph).concat(pairs));
                }));
            });
        });
    } else {
        callback(new Error("Unknown property path: " + path.type));
    }
};

var sameNode = function(a, b) {
    return nodeKey(a) === nodeKey(b);
};

/**
 * The solutions of a PATH node: bindings of its variables (and of the graph variable under GRAPH ?g). candidates
 * may restrict a variable start or end to nodes, the values a join will keep: {starts: [...], ends: [...]}.
 */
PropertyPaths.execute = function(engine, dataset, pattern, env, candidates, callback) {
    var ctx = {engine: engine, dataset: dataset, env: env, graph: pattern.graph};
    resolveEndpoint(ctx, pattern.subject, function(subject) {
        resolveEndpoint(ctx, pattern.object, function(object) {
            graphKeys(ctx, function(keys) {
                ctx.keys = keys;
                if(keys.length === 0) {
                    return callback(null, []);
                }
                var ends = {
                    starts: subject.node !== undefined ? [subject.node] : candidates.starts,
                    ends: object.node !== undefined ? [object.node] : candidates.ends
                };
                ctx.boundNodes = [subject.node, object.node].filter(function(node) { return node !== undefined; });
                evaluate(ctx, pattern.path, ends, function(err, relation) {
                    if(err != null) {
                        return callback(err);
                    }
                    var graphVariable = ctx.graph != null && ctx.graph.token === 'var' ? ctx.graph.value : null;
                    var sameVariable = subject.variable != null && subject.variable === object.variable;
                    var solutions = [];
                    relation.forEach(function(pairs, graph) {
                        for(var i=0; i<pairs.length; i++) {
                            var pair = pairs[i];
                            if((subject.variable == null && !sameNode(pair[0], subject.node)) ||
                                (object.variable == null && !sameNode(pair[1], object.node)) ||
                                (sameVariable && !sameNode(pair[0], pair[1]))) {
                                continue;
                            }
                            var solution = {};
                            if(subject.variable != null) {
                                solution[subject.variable] = pair[0];
                            }
                            if(object.variable != null) {
                                solution[object.variable] = pair[1];
                            }
                            if(graphVariable != null) {
                                solution[graphVariable] = graph;
                            }
                            solutions.push(solution);
                        }
                    });
                    callback(null, solutions);
                });
            });
        });
    });
};

module.exports = {
    PropertyPaths: PropertyPaths
};
