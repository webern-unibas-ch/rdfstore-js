"use strict";

let utils = require('./utils');
let async = utils;
let InMemoryLexicon = require('./lexicon').Lexicon;

/**
 * Temporal implementation of the lexicon
 */


let PersistentLexicon = function(callback, dbName){
    let that = this;

    utils.registerIndexedDB(that);

    this.defaultGraphOid = 0;
    this.defaultGraphUri = "https://github.com/antoniogarrote/rdfstore-js#default_graph";
    this.defaultGraphUriTerm = {"token":"uri","prefix":null,"suffix":null,"value":this.defaultGraphUri};
    this.oidCounter = 1;

    that.dbName = dbName || "rdfstorejs";
    let request = that.indexedDB.open(this.dbName+"_lexicon", 1);
    request.onerror = function(event) {
        callback(null,new Error("Error opening IndexedDB: " + event.target.errorCode));
    };
    request.onsuccess = function(event) {
        that.db = event.target.result;
        callback(that);
    };
    request.onupgradeneeded = function(event) {
        that.db = event.target.result;

        // graphs
        let graphStore = that.db.createObjectStore('knownGraphs', { keyPath: 'oid'});
        graphStore.createIndex("uriToken","uriToken",{unique: true});
        // uris,literal,blanks mapping
        let uriStore = that.db.createObjectStore('components', { keyPath: 'id', autoIncrement : true });
        uriStore.createIndex("value","value",{unique: true});

        //setTimeout(function(){ callback(that); },0);
    };

};

/**
 * Registers a new graph in the lexicon list of known graphs.
 * @param oid
 * @param uriToken
 * @param callback
 */
PersistentLexicon.prototype.registerGraph = function(oid, uriToken, callback){
    if(oid != this.defaultGraphOid) {
        let transaction = this.db.transaction(['knownGraphs'], 'readwrite');
        transaction.onerror = function (event) {
            callback(null, new Error(event.target.statusCode));
        };
        let objectStore = transaction.objectStore('knownGraphs');
        let request = objectStore.get(uriToken)
        request.onsuccess = function(event) {
            let graphData = event.target.result;
            if(graphData) {
                // found graph -> return
                callback(true)
            } else {
                let request = objectStore.add({oid: oid, uriToken: uriToken});
                request.onsuccess = function (_) {
                    callback(true);
                };
            }
        }
    } else {
        callback();
    }
};

/**
 * Returns the list of known graphs OIDs or URIs.
 * @param returnUris
 * @param callback
 */
PersistentLexicon.prototype.registeredGraphs = function(returnUris, callback) {
    let graphs = [];
    let objectStore = this.db.transaction(['knownGraphs'],'readwrite').objectStore("knownGraphs");

    let request = objectStore.openCursor();
    request.onsuccess = function(event) {
        let cursor = event.target.result;
        if(cursor) {
            if(returnUris === true) {
                graphs.push(cursor.value.uriToken);
            } else {
                graphs.push(cursor.value.oid);
            }
            cursor.continue();
        } else {
            callback(graphs);
        }
    };
    request.onerror = function(event) {
        callback(null,new Error("Error retrieving data from the cursor: " + event.target.errorCode));
    };
};

/**
 * Registers a URI in the lexicon. It returns the allocated OID for the URI.
 * As a side effect it increases the cost counter for that URI if it is already registered.
 * @param uri
 * @param callback
 * @returns URI's OID.
 */
PersistentLexicon.prototype.registerUri = function(uri, callback) {
    let that = this;
    if(uri === this.defaultGraphUri) {
        callback(this.defaultGraphOid);
    } else{
        let objectStore = that.db.transaction(["components"],"readwrite").objectStore("components");
        let request = objectStore.index("value").get("_u:"+uri);
        request.onsuccess = function(event) {
            let uriData = event.target.result;
            if(uriData) {
                // found in index -> update
                uriData.counter++;
                let oid = uriData.id;
                let requestUpdate = objectStore.put(uriData);
                requestUpdate.onsuccess =function (_) {
                    callback(oid);
                };
                requestUpdate.onerror = function (event) {
                    callback(null, new Error("Error updating the URI data" + event.target.errorCode));
                };
            } else {
                // not found -> create
                let requestAdd = objectStore.add({value: "_u:"+uri, counter:0, uri:true});
                requestAdd.onsuccess = function(event){
                    callback(event.target.result);
                };
                requestAdd.onerror = function(event){
                    callback(null, new Error("Error inserting the URI data"+event.target.errorCode));
                };
            }
        };
        request.onerror = function(event) {
            callback(null, new Error("Error retrieving the URI data"+event.target.errorCode));
        };
    }
};

/**
 * Returns the OID associated to the URI.
 * If the URI hasn't been  associated in the lexicon, -1 is returned.
 * @param uri
 * @param callback
 */
PersistentLexicon.prototype.resolveUri = function(uri,callback) {
    if(uri === this.defaultGraphUri) {
        callback(this.defaultGraphOid);
    } else {
        let objectStore = this.db.transaction(["components"]).objectStore("components");
        let request = objectStore.index("value").get("_u:"+uri);
        request.onsuccess = function(event) {
            if(event.target.result != null) {
                callback(event.target.result.id);
            } else
                callback(-1);
        };
        request.onerror = function(event) {
            callback(null, new Error("Error retrieving uri data "+event.target.errorCode));
        }
    }
};

/**
 * Register a new blank node in the lexicon.
 * @param label
 * @returns {string}
 */
PersistentLexicon.prototype.registerBlank = function(callback) {
    let oidStr = utils.guid();
    let that = this;

    let objectStore = that.db.transaction(["components"],"readwrite").objectStore("components");
    let requestAdd = objectStore.add({value: "_b:"+oidStr, counter:0, label:true});
    requestAdd.onsuccess = function(event){
        callback(event.target.result);
    };
    requestAdd.onerror = function(event){
        callback(null, new Error("Error inserting the URI data"+event.target.errorCode));
    };
};

/**
 * Registers a new literal in the index.
 * @param literal
 * @param callback
 * @returns the OID of the newly registered literal
 */
PersistentLexicon.prototype.registerLiteral = function(literal, callback) {
    let that = this;

    let objectStore = that.db.transaction(["components"],"readwrite").objectStore("components");
    let request = objectStore.index("value").get("_l:"+literal);
    request.onsuccess = function(event) {
        let literalData = event.target.result;
        if(literalData) {
            // found in index -> update
            literalData.counter++;
            let oid = literalData.id;
            let requestUpdate = objectStore.put(literalData);
            requestUpdate.onsuccess =function (event) {
                callback(oid);
            };
            requestUpdate.onerror = function (event) {
                callback(null, new Error("Error updating the literal data" + event.target.errorCode));
            };
        } else {
            // not found -> create
            let requestAdd = objectStore.add({value: "_l:"+literal, counter:0, literal:true});
            requestAdd.onsuccess = function(event){
                callback(event.target.result);
            };
            requestAdd.onerror =function(event){
                callback(null, new Error("Error inserting the literal data"+event.target.errorCode));
            };
        }
    };
    request.onerror = function(event) {
        callback(null, new Error("Error retrieving the literal data"+event.target.errorCode));
    };
};

/**
 * Returns the OID of the resolved literal or -1 if no literal is found.
 * @param literal
 * @param callback
 */
PersistentLexicon.prototype.resolveLiteral = function (literal,callback) {
    let objectStore = this.db.transaction(["components"]).objectStore("components");
    let request = objectStore.index("value").get("_l:"+literal);
    request.onsuccess = function(event) {
        if(event.target.result != null) {
            callback(event.target.result.id);
        } else
            callback(-1);
    };
    request.onerror = function(event) {
        callback(null, new Error("Error retrieving literal data "+event.target.errorCode));
    }
};


/**
 * Transforms a literal string into a token object.
 * @param literalString
 * @returns A token object with the parsed literal.
 */
PersistentLexicon.prototype.parseLiteral = function(literalString) {
    return InMemoryLexicon.prototype.parseLiteral(literalString);
};

/**
 * Parses a literal URI string into a token object
 * @param uriString
 * @returns A token object with the parsed URI.
 */
PersistentLexicon.prototype.parseUri = function(uriString) {
    return InMemoryLexicon.prototype.parseUri(uriString);
};

/**
 * Retrieves a token containing the URI, literal or blank node associated
 * to the provided OID.
 * If no value is found, null is returned.
 * @param oid
 * @param callback
 * @returns parsed token or null if not found.
 */
PersistentLexicon.prototype.retrieve = function(oid, callback) {
    let that = this, transaction, request;

    if(oid === this.defaultGraphOid) {
        callback({
            token: "uri",
            value:this.defaultGraphUri,
            prefix: null,
            suffix: null,
            defaultGraph: true
        });
    } else {
        transaction = that.db.transaction(["components"]);
        request = transaction.objectStore("components").get(oid);
        request.onsuccess = function(event) {
            if(event.target.result != null) {
                if(event.target.result.label != null) {
                    let label = "_:" + event.target.result.id;
                    callback({token: "blank", value: label});
                } else if(event.target.result.uri != null) {
                    callback(that.parseUri(event.target.result.value.slice(3,event.target.result.value.length)));
                } else if(event.target.result.literal != null) {
                    callback(that.parseLiteral(event.target.result.value.slice(3,event.target.result.value.length)));
                } else {
                    console.log(event.target.result);
                    callback(null,new Error("Unknown type of component "+event.target.result));
                }
            } else {
                callback(null,null);
            }
        };
        request.onerror = function(event) {
            callback(null, new Error("Error searching in blanks data "+event.target.errorCode));
        };
    }
};

/**
 * Empties the PersistentLexicon and restarts the counters.
 * @param callback
 */
PersistentLexicon.prototype.clear = function(callback) {
    let that = this;
    this.defaultGraphOid = 0;
    this.defaultGraphUri = "https://github.com/antoniogarrote/rdfstore-js#default_graph";
    this.defaultGraphUriTerm = {"token":"uri","prefix":null,"suffix":null,"value":this.defaultGraphUri};

    let transaction = that.db.transaction(["components"],"readwrite"), request;
    let components = transaction.objectStore("components");

    let k = function() {
        if(callback != null)
            callback();
    };

    request = components.clear();
    request.onsuccess = k;
    request.onerror = k;
};

/**
 * Removes the values associated to the subject, predicate, object and graph
 * values of the provided quad. Blank nodes are left alone: other quads may still
 * use them, so the query engine releases them with unregisterBlank.
 * @param quad
 * @param key
 * @param callback
 */
PersistentLexicon.prototype.unregister = function (quad, key, callback) {
    let that = this;
    let unregisterTerm = function(term, oid, k) {
        if (term == null || term.token === 'blank') {
            k();
        } else {
            that._unregisterTerm(term.token, oid, k);
        }
    };
    async.seq(function(k){
        unregisterTerm(quad.subject, key.subject, k);
    }, function(k){
        unregisterTerm(quad.predicate, key.predicate, k);
    }, function(k){
        unregisterTerm(quad.object, key.object, k);
    }, function(k){
        unregisterTerm(quad.graph, key.graph, k);
    })(function(){
        callback(true);
    });
};

/**
 * Removes a blank node that no quad uses anymore.
 * @param oid
 * @param callback
 */
PersistentLexicon.prototype.unregisterBlank = function (oid, callback) {
    this._unregisterTerm('blank', oid, callback);
};

/**
 * Unregisters a value, either URI, literal or blank.
 * @param kind
 * @param oid
 * @param callback
 * @private
 */
PersistentLexicon.prototype._unregisterTerm = function (kind, oid, callback) {
    let that = this, request;
    let transaction = that.db.transaction(["components", "knownGraphs"],"readwrite");
    if (kind === 'uri') {
        if (oid != this.defaultGraphOid) {
            let removeKnownGraphs = function() {
                let request = transaction.objectStore("knownGraphs").delete(oid);
                request.onsuccess = function() { callback(); };
            };
            request = transaction.objectStore("components").delete(oid);
            request.onsuccess = removeKnownGraphs();
        } else {
            callback();
        }
    } else {
        request = transaction.objectStore("components").delete(oid);
        request.onsuccess = function() { callback(); };
    }
};

module.exports = {
    PersistentLexicon: PersistentLexicon
};
