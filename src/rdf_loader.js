"use strict";

/* global RDFXMLParser */ // optional, defined by a separately loaded RDF/XML parser
const NetworkTransport = require("./network_transport").NetworkTransport;
const RVN3Parser = require("./rvn3_parser").RVN3Parser;
const JSONLDParser = require("./jsonld_parser").JSONLDParser;
const Utils = require("./utils");

 const RDFLoader = function (params) {

    // per store, replaced by Store#setNetworkTransport; undefined in a worker
    this.networkTransport = NetworkTransport;
    this.precedences = ["text/turtle", "text/n3", "application/ld+json", "application/json"];
    this.parsers = {"text/turtle":RVN3Parser.parser, "text/n3":RVN3Parser.parser, "application/ld+json":JSONLDParser.parser, "application/json":JSONLDParser.parser};

    // Conditionally adding RDFXML parser
    if(typeof(RDFXMLParser) !== 'undefined') {
        this.precedences.push("application/rdf+xml");
        this.parsers["application/rdf+xml"] = RDFXMLParser.parser;
    }

    if (params != null) {
        for (const mime in params["parsers"]) {
            this.parsers[mime] = params["parsers"][mime];
        }
    }

    if (params && params["precedences"] != null) {
        this.precedences = params["precedences"];
        for (const mime in params["parsers"]) {
            if (!Utils.include(this.precedences, mime)) {
                this.precedences.push(mime);
            }
        }
    }

    this.acceptHeaderValue = "";
    for (let i = 0; i < this.precedences.length; i++) {
        if (i != 0) {
            this.acceptHeaderValue = this.acceptHeaderValue + "," + this.precedences[i];
        } else {
            this.acceptHeaderValue = this.acceptHeaderValue + this.precedences[i];
        }
    }
};

RDFLoader.prototype.registerParser = function(mediaType, parser) {
    this.parsers[mediaType] = parser;
    this.precedences.push(mediaType);
};

RDFLoader.prototype.unregisterParser = function(mediaType) {
    delete this.parsers[mediaType];
    const mediaTypes = [];
    for(let i=0; i<this.precedences.length; i++) {
        if(this.precedences[i] != mediaType) {
            mediaTypes.push(this.precedences[i]);
        }
    }

    this.precedences = mediaTypes;
};

RDFLoader.prototype.setAcceptHeaderPrecedence = function(mediaTypes) {
    this.precedences = mediaTypes;
};

RDFLoader.prototype.load = function(uri, graph, callback) {
    const that = this;
    if(this.networkTransport == null) {
        return callback(new Error("No network transport to load " + uri + ": set one with store.setNetworkTransport"));
    }
    this.networkTransport.load(uri, this.acceptHeaderValue, function(err, results){
        if(err) {
            callback(err);
        } else {
            const headers = (results && results["headers"]) || {};
            let mime = headers["Content-Type"] || headers["content-type"];
            const data = results && results['data'];
            if(mime != null) {
                mime = mime.split(";")[0];
                for(const m in that.parsers) {
                    if(m.indexOf("/")!=-1) {
                        const mimeParts = m.split("/");
                        if(mimeParts[1] === '*') {
                            if(mime.indexOf(mimeParts[0])!=-1) {
                                return that.tryToParse(that.parsers[m], graph, data, {documentURI: uri}, callback);
                            }
                        } else {
                            if(mime.indexOf(m)!=-1) {
                                return that.tryToParse(that.parsers[m], graph, data, {documentURI: uri}, callback);
                            } else if(mime.indexOf(mimeParts[1])!=-1) {
                                return that.tryToParse(that.parsers[m], graph, data, {documentURI: uri}, callback);
                            }
                        }
                    } else {
                        if(mime.indexOf(m)!=-1) {
                            return that.tryToParse(that.parsers[m], graph, data, {documentURI: uri}, callback);
                        }
                    }
                }
                callback(new Error("Unknown media type : "+mime));
            } else {
                callback(new Error("Unknown media type: no Content-Type header for " + uri));
            }
        }});
};

RDFLoader.prototype.loadFromFile = function(parser, graph, uri, options, callback) {
    try {
        const that = this;
        const fs = require('fs');
        const url = require('url');
        const parseOptions = {documentURI: uri};
        for(const option in options) {
            parseOptions[option] = options[option];
        }
        // throws on an invalid file URL, which the catch reports
        fs.readFile(url.fileURLToPath(uri), function(err, data) {
            if(err) {
                callback(err);
            } else {
                data = data.toString('utf8');
                that.tryToParse(parser, graph, data, parseOptions, callback);
            }
        });
    } catch(e) {
        callback(e);
    }
};

RDFLoader.prototype.tryToParse = function(parser, graph, input, options, callback) {
    const done = Utils.once(callback);
    try {
        // no \uXXXX pre-pass as for queries: the parsers decode escapes inside their tokens,
        // decoding them first turns e.g. an escaped quote into syntax
        parser.parse(input, graph, options, done);
    } catch(e) {
        // an exception from the caller's own callback is not a parse error: let it propagate
        if(done.called)
            throw e;
        done(Utils.toError(e));
    }
};

module.exports = {
    RDFLoader: RDFLoader
};
