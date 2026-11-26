"use strict";

let slowNextTick = (function () {

    if(typeof(process) !== 'undefined' && process.nextTick) {
        return process.nextTick;
    }

    if(typeof(window) !== 'undefined' && window.setImmediate) {
        return window.setImmediate;
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };

})();

let spin = 0;
let yieldFrequency = 100;
let nextTick = function(f) {
    spin++;
    if(spin < yieldFrequency) {
        f();
    } else {
        spin = 0;
        slowNextTick(f);
    }
};

/**
 * Function that generates a hash key for a bound term.
 * @param term
 * @returns {*}
 */
let hashTerm = function(term) {
    try {
        if(term == null) {
            return "";
        } if(term.token==='uri') {
            return "u"+term.value;
        } else if(term.token === 'blank') {
            return "b"+term.value;
        } else if(term.token === 'literal') {
            let l = "l"+term.value;
            l = l + (term.type || "");
            l = l + (term.lang || "");

            return l;
        }
    } catch(e) {
        if(typeof(term) === 'object') {
            let key = "";
            for(let p in term) {
                key = key + p + term[p];
            }

            return key;
        }
        return term;
    }
};

/**
 * Returns a String with the lexical representation of a URI term.
 * @param term the URI term to be transformed into a String representation.
 * @param env Repository of the prefixes where th prefix of the URI will be resolved.
 * @returns the lexical representation of the URI term.
 */
let lexicalFormBaseUri = function(term, env) {
    let uri = null;
    env = env || {};
    if(term.value == null) {
        // URI has prefix and suffix, we'll try to resolve it.
        let prefix = term.prefix;
        let suffix = term.suffix;
        let resolvedPrefix = env.namespaces[prefix];
        if(resolvedPrefix != null) {
            uri = resolvedPrefix+suffix;
        } else {
            // an undeclared prefix stays as written
            return prefix+":"+suffix;
        }
    } else {
        // URI is not prefixed
        uri = term.value;
    }

    return uri === null ? null : resolveIri(env.base, uri);
};

let SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// RFC 3986 appendix B
let parseReference = function(iri) {
    let m = /^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?$/.exec(iri);
    return {scheme: m[2], authority: m[4], path: m[5], query: m[7], fragment: m[9]};
};

// RFC 3986 5.2.4
let removeDotSegments = function(input) {
    let output = "";
    while(input.length > 0) {
        if(input.indexOf("../") === 0) {
            input = input.slice(3);
        } else if(input.indexOf("./") === 0 || input.indexOf("/./") === 0) {
            input = input.slice(2);
        } else if(input === "/.") {
            input = "/";
        } else if(input.indexOf("/../") === 0 || input === "/..") {
            input = "/" + input.slice(4);
            output = output.slice(0, Math.max(output.lastIndexOf("/"), 0));
        } else if(input === "." || input === "..") {
            input = "";
        } else {
            let next = input.indexOf("/", 1);
            if(next === -1) {
                next = input.length;
            }
            output += input.slice(0, next);
            input = input.slice(next);
        }
    }
    return output;
};

/**
 * Resolves an IRI reference against a base IRI (RFC 3986 section 5.2). Works on the strings, without the
 * normalization of WHATWG URL (case, percent-encoding), so IRIs stay as written. An IRI with a scheme is
 * returned unchanged, like N3.js does when loading data, and so is any IRI without a base, or with a colon in
 * its first segment but no valid scheme (a_b:c, no relative reference). A base that has no scheme itself is
 * prepended.
 */
let resolveIri = function(base, iri) {
    // a colon in the first segment: a scheme, or no relative reference
    if(/^[^/?#]*:/.test(iri) || base == null || base === "") {
        return iri;
    } else if(!SCHEME.test(base)) {
        return base + iri;
    }
    let b = parseReference(base);
    let r = parseReference(iri);
    let authority = b.authority;
    let path, query = r.query;
    if(r.authority !== undefined) {
        authority = r.authority;
        path = removeDotSegments(r.path);
    } else if(r.path === "") {
        path = b.path;
        query = r.query !== undefined ? r.query : b.query;
    } else if(r.path[0] === "/") {
        path = removeDotSegments(r.path);
    } else if(b.authority !== undefined && b.path === "") {
        path = removeDotSegments("/" + r.path);
    } else {
        path = removeDotSegments(b.path.slice(0, b.path.lastIndexOf("/") + 1) + r.path);
    }
    return b.scheme + ":" + (authority !== undefined ? "//" + authority : "") + path +
        (query !== undefined ? "?" + query : "") + (r.fragment !== undefined ? "#" + r.fragment : "");
};


let parseISO8601 = function (str) {
    return Date.parse(str);
};

if (!Date.prototype.toISOString) {
    (function() {

        function pad(number) {
            if (number < 10) {
                return '0' + number;
            }
            return number;
        }

        Date.prototype.toISOString = function() {
            return this.getUTCFullYear() +
                '-' + pad(this.getUTCMonth() + 1) +
                '-' + pad(this.getUTCDate()) +
                'T' + pad(this.getUTCHours()) +
                ':' + pad(this.getUTCMinutes()) +
                ':' + pad(this.getUTCSeconds()) +
                '.' + (this.getUTCMilliseconds() / 1000).toFixed(3).slice(2, 5) +
                'Z';
        };

    }());
}

let iso8601 = function(date) {
    return date.toISOString();
};

let lexicalFormLiteral = function(term, env) {
    let value = term.value;
    let lang = term.lang;
    let type = term.type;

    let indexedValue = null;
    if(value != null && type != null && typeof(type) != 'string') {
        let typeValue = type.value;

        if(typeValue == null) {
            let typePrefix = type.prefix;
            let typeSuffix = type.suffix;

            let resolvedPrefix = env.namespaces[typePrefix];
            term.type = resolvedPrefix+typeSuffix;
            typeValue = resolvedPrefix+typeSuffix;
        }
        // normalization
        if(typeValue.indexOf('hexBinary') != -1) {
            indexedValue = '"' + term.value.toLowerCase() + '"^^<' + typeValue + '>';
        } else {
            indexedValue = '"' + term.value + '"^^<' + typeValue + '>';
        }
    } else {
        if(lang == null && type == null) {
            indexedValue = '"' + value + '"';
        } else if(type == null) {
            // language tags are case-insensitive: one term per tag, in lower case like the query grammar
            indexedValue = '"' + value + '"' + "@" + lang.toLowerCase();
        } else {
            // normalization
            if(type.indexOf('hexBinary') != -1) {
                indexedValue = '"' + term.value.toLowerCase() + '"^^<'+type+'>';
            } else {
                indexedValue = '"' + term.value + '"^^<'+type+'>';
            }
        }
    }
    return indexedValue;
};

// Replaces \uXXXX escapes with their characters, without eval (which a CSP without 'unsafe-eval' blocks).
let normalizeUnicodeLiterals = function (string) {
    return string.replace(/\\u([0-9a-fA-F]{4})/g, function (escape, hex) {
        return String.fromCharCode(parseInt(hex, 16));
    });
};

// Persistence relies on the native IndexedDB of the runtime (browser window or worker).
let registerIndexedDB = function(that) {
    // In the following line, you should include the prefixes of implementations you want to test.
    let context = globalThis;

    context.indexedDB = context.indexedDB || context.mozIndexedDB || context.webkitIndexedDB || context.msIndexedDB;
    context.IDBKeyRange = context.IDBKeyRange || context.webkitIDBKeyRange || context.msIDBKeyRange;
    // DON'T use "var indexedDB = ..." if you're not in a function.
    // Moreover, you may need references to some window.IDB* objects:
    if (!context.indexedDB) {
        console.log("The runtime does not support IndexedDB.");
    } else {
        that.indexedDB = context.indexedDB;
        that.IDBKeyRange = context.IDBKeyRange;
    }
};

let guid = function() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
};

// Returns a new array without the elements matching p.
let reject = function(xs,p) {
    let acc = [];
    for(let i=0; i<xs.length; i++) {
        if(!p(xs[i])) {
            acc.push(xs[i]);
        }
    }

    return acc;
};

// Removes the elements matching p from xs itself and returns them.
let remove = function(xs,p) {
    let removed = [];
    let kept = 0;
    for(let i=0; i<xs.length; i++) {
        if(p(xs[i])) {
            removed.push(xs[i]);
        } else {
            xs[kept++] = xs[i];
        }
    }
    xs.length = kept;

    return removed;
};

let include = function(xs,p) {
    for(let i=0; i<xs.length; i++){
        if(xs[i] === p)
            return true;
    }

    return false;
};

let each = function(xs,f) {
    if(xs.forEach) {
        xs.forEach(f);
    } else {
        for (let i = 0; i < xs.length; i++)
            f(xs[i]);
    }
};

let map = function(xs,f) {
    if(xs.map) {
        return xs.map(f);
    } else {
        let acc = [];
        for (let i = 0; i < xs.length; i++)
            acc[i] = f(xs[i]);

        return acc;
    }
};

let keys = function(xs) {
    let acc = [];
    for(let p in xs)
        acc.push(p);
    return acc;
};

let values = function(xs) {
    let acc = [];
    for(let p in xs)
        acc.push(xs[p]);
    return acc;
};

let size = function(xs) {
    if(xs.length) {
        return xs.length;
    } else {
        return Object.keys(xs).length;
    }
};

let clone = function(value) {
    return JSON.parse(JSON.stringify(value));
};

let isObject = function(value) {
    // Avoid a V8 JIT bug in Chrome 19-20.
    // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
    let type = typeof value;
    return type == 'function' || (value && type == 'object') || false;
};


let create = (function() {
    function Object() {}
    return function(prototype) {
        let result;
        if (isObject(prototype)) {
            Object.prototype = prototype;
            result = new Object;
            Object.prototype = null;
        }
        return result || Object();
    };
}());

let whilst = function (test, iterator, callback) {
    if (test()) {
        iterator(function (err) {
            if (err) {
                return callback(err);
            }
            // go through nextTick to periodically release the stack on large iterations
            nextTick(function () {
                whilst(test, iterator, callback);
            });
        });
    }
    else {
        callback();
    }
};


let eachSeries = function (arr, iterator, callback) {
    callback = callback || function () {};
    if (!arr.length) {
        return callback();
    }
    let completed = 0;
    let iterate = function () {
        iterator(arr[completed], function (err) {
            if (err) {
                callback(err);
                callback = function () {};
            }
            else {
                completed += 1;
                if (completed >= arr.length) {
                    callback();
                }
                else {
                    nextTick(iterate);
                }
            }
        });
    };
    iterate();
};

let eachParallel = function (arr, iterator, callback) {
    callback = callback || function () {};
    if (!arr.length) {
        return callback();
    }
    let failed = false;
    let completed = 0;

    let innerCallback = function(err) {
        if(err) {
            failed = true;
            throw(new Error(err));
        }

        if(!failed) {
            completed++;
            if(completed === arr.length)
                callback();
        }
    };


    for(let i=0; i<arr.length; i++) {
        (function(arr,i,callback,iterator) {
            nextTick(function(){
                try {
                    iterator(arr[i], function () {
                        callback();
                    })
                } catch (e) {
                    callback(e);
                }
            });
        })(arr,i,innerCallback,iterator)
    }
};


let reduce = function (arr, memo, iterator, callback) {
    eachSeries(arr, function (x, callback) {
        iterator(memo, x, function (err, v) {
            memo = v;
            callback(err);
        });
    }, function (err) {
        callback(err, memo);
    });
};

let seq = function (/* functions... */) {
    let fns = arguments;
    return function () {
        let that = this;
        let args = Array.prototype.slice.call(arguments);
        let callback = args.pop();
        reduce(fns, args, function (newargs, fn, cb) {
                fn.apply(that, newargs.concat([function () {
                    let err = arguments[0];
                    let nextargs = Array.prototype.slice.call(arguments, 1);
                    cb(err, nextargs);
                }]));
            },
            function (err, results) {
                callback.apply(that, [err].concat(results));
            });
    };
};


// Thrown values that are not Errors (some builtins throw strings) are wrapped, so callers always get an Error.
let toError = function (e) {
    return (e instanceof Error) ? e : new Error(String(e));
};

// Wraps a callback so that only its first invocation runs; `called` tells whether it already ran.
let once = function (callback) {
    let wrapped = function () {
        if (wrapped.called) {
            return;
        }
        wrapped.called = true;
        return callback.apply(this, arguments);
    };
    wrapped.called = false;
    return wrapped;
};

// Runs fn(callback) and settles a promise with its node-style result; a synchronous throw rejects too.
// A throw after the callback already ran is rethrown, as at the callback entry points: the promise
// is settled by then and would swallow it.
let toPromise = function (fn) {
    let settle;
    let promise = new Promise(function (resolve, reject) {
        settle = function (err, result) {
            if (err) {
                reject(toError(err));
            } else {
                resolve(result);
            }
        };
    });
    let done = once(settle);
    try {
        fn(done);
    } catch (e) {
        if (done.called) {
            throw e;
        }
        done(e);
    }
    return promise;
};


let isWorker = function() {
    if(typeof(process) === "undefined" || process.browser === true) {
        if (typeof(window) === "undefined") {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};


module.exports = {
    isWorker: isWorker,
    nextTick: nextTick,
    lexicalFormBaseUri: lexicalFormBaseUri,
    resolveIri: resolveIri,
    parseISO8601: parseISO8601,
    iso8601: iso8601,
    normalizeUnicodeLiterals: normalizeUnicodeLiterals,
    lexicalFormLiteral: lexicalFormLiteral,
    registerIndexedDB: registerIndexedDB,
    guid: guid,
    hashTerm: hashTerm,
    keys: keys,
    values: values,
    size: size,
    map: map,
    each: each,
    forEach: each,
    include: include,
    reject: reject,
    remove: remove,
    clone: clone,
    create: create,
    whilst: whilst,
    eachSeries: eachSeries,
    eachParallel: eachParallel,
    seq: seq,
    once: once,
    toError: toError,
    toPromise: toPromise,
    yieldFrequency: function(value){
        yieldFrequency = value;
    }
};
