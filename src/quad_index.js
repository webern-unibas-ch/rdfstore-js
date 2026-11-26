"use strict";

const BaseTree = require("./btree").Tree;
const _ = require('./utils');
const async = require('./utils');

/**
 * NodeKey
 *
 * Implements the interface of BinarySearchTree.Node
 *
 * A Tree node augmented with BPlusTree
 * node structures
 */
const NodeKey = function(components, order) {
    this.subject = components.subject;
    this.predicate = components.predicate;
    this.object = components.object;
    this.graph = components.graph;
    this.order = order;
};

/**
 * Makes it possible to compare two keys, returning -1,0,1
 * depending on the relative position of the keys.
 * @param keyPattern
 * @returns {number}
 */
NodeKey.prototype.comparator = function(keyPattern) {
    for(let i=0; i<this.order.length; i++) {
        const component = this.order[i];
        if(keyPattern[component] == null) {
            return 0;
        } else {
            if(this[component] < keyPattern[component] ) {
                return -1
            } else if(this[component] > keyPattern[component]) {
                return 1
            }
        }
    }

    return 0;
};

/**
 * Pattern
 *
 * A pattern with some variable components
 */
const Pattern = function (components) {
    this.subject = components.subject;
    this.predicate = components.predicate;
    this.object = components.object;
    this.graph = components.graph;
    this.indexKey = [];

    this.keyComponents = {};

    const order = [];
    const indiferent = [];
    const that = this;

    // components must have been already normalized and
    // inserted in the lexicon.
    // OIDs retrieved from the lexicon *are* numbers so
    // they can be told apart from variables (strings)
    _.forEach(['subject', 'predicate', 'object', 'graph'], function(component){
        if (typeof(that[component]) === 'string') {
            indiferent.push(component);
            that.keyComponents[component] = null;
        } else {
            order.push(component);
            that.keyComponents[component] = that[component];
            that.indexKey.push(component);
        }

    });

    this.order = order.concat(indiferent);
    this.key = new NodeKey(this.keyComponents, this.order);
};


/**
 * An index for quads built on top of a BTree implementation.
 *
 * @param params
 * @param callback
 * @constructor
 */
const QuadIndex = function (params, callback) {
    if (arguments != 0) {
        this.componentOrder = params.componentOrder;

        BaseTree.call(this, params.order, function (tree) {

            // For exact matches. Used by search.
            tree.comparator = function (a, b) {
                for (let i = 0; i < tree.componentOrder.length; i++) {
                    const component = tree.componentOrder[i];

                    const vala = a[component];
                    const valb = b[component];

                    if (vala < valb) {
                        return -1;
                    } else if (vala > valb) {
                        return 1;
                    }
                }

                return 0;
            };

            // For range matches.
            tree.rangeComparator = function (a, b) {
                for (let i = 0; i < tree.componentOrder.length; i++) {
                    const component = tree.componentOrder[i];
                    if (b[component] == null || a[component] == null) {
                        return 0;
                    } else {
                        if (a[component] < b[component]) {
                            return -1
                        } else if (a[component] > b[component]) {
                            return 1
                        }
                    }
                }

                return 0;
            };

            callback(tree);
        });
    }
};

QuadIndex.prototype = _.create(BaseTree.prototype, {'constructor':BaseTree});


/**
 * Insert a quad with subject,predicate,object,graph values into the index.
 * @param quad
 * @param callback
 */
QuadIndex.prototype.insert = function(quad, callback) {
    BaseTree.prototype.insert.call(this, quad, null, function(result){
        callback(result);
    });
};

/**
 * Searches for a quad value in the index returning true if it matches a key.
 * @param quad
 * @param callback
 */
QuadIndex.prototype.search = function(quad, callback) {
    BaseTree.prototype.search.call(this, quad, function(result){
        callback(result);
    }, true); // true -> check exists : hack only present in the inMemoryAsyncBTree implementation
};

/**
 * Traverse the inde accumulating the keys matching a provided pattern.
 *
 * @param pattern A subject,predicate,object,graph pattern, containing values and variables.
 * @param callback
 */
QuadIndex.prototype.range = function (pattern, callback) {
    this._rangeTraverse(this, this.root, pattern, callback);
};

QuadIndex.prototype._rangeTraverse = function(tree,node, pattern, callback) {
    const patternKey  = pattern.key;
    const acum = [];
    const pendingNodes = [node];

    async.whilst(function(){
        return pendingNodes.length > 0;
    }, function(k){
        // next node to process
        const node = pendingNodes.shift();
        let idxMin = 0;

        // move forward in the lower keys not matching the pattern.
        while(idxMin < node.numberActives && tree.rangeComparator(node.keys[idxMin].key,patternKey) === -1) {
            idxMin++;
        }

        // we found a matching or bigger key

        if(node.isLeaf === true) { // the node is a leaf node -> has no nodes to push, only keys to accumulate

            let idxMax = idxMin;

            // we keep on accumulating matching keys in this leaf
            while(idxMax < node.numberActives && tree.rangeComparator(node.keys[idxMax].key,patternKey) === 0) {
                acum.push(node.keys[idxMax].key);
                idxMax++;
            }

            // next iteration
            k();

        } else { // the node is not a leaf, push potentially matching nodes requiring processing.
            tree._diskRead(node.children[idxMin], function(childNode){

                // pushing the found node
                pendingNodes.push(childNode);
                let idxMax = idxMin;

                async.whilst(function(){
                    // keep pushing nodes while the key for that nod ematches the pattern
                    return (idxMax < node.numberActives && tree.rangeComparator(node.keys[idxMax].key,patternKey) === 0);

                },function(kk){

                    acum.push(node.keys[idxMax].key);
                    idxMax++;
                    tree._diskRead(node.children[idxMax], function(childNode){
                        pendingNodes.push(childNode);
                        kk();
                    })

                },function(){
                    k();
                });
            });
        }
    }, function(){
        callback(acum);
    });
};

module.exports = {
    QuadIndex: QuadIndex,
    Pattern: Pattern,
    NodeKey: NodeKey
};

