var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var url = require("url");
var Store = require("../src/store");
var NetworkTransport = require("../src/network_transport").NetworkTransport;

// Loading remote graphs (SPARQL LOAD) through the network transport, and local files through file:// URLs.

var TURTLE = "<http://s> <http://p> <http://o> .";

var withStore = function(cb) {
    new Store.Store(function(err, store) {
        expect(err).toBe(null);
        cb(store);
    });
};

// LOAD <uri> stores the triples in the graph <uri>, store.load in the default graph
var countTriples = function(store, graph, cb) {
    var pattern = graph == null ? "?s ?p ?o" : "GRAPH <" + graph + "> { ?s ?p ?o }";
    store.execute("SELECT * { " + pattern + " }", function(err, results) {
        expect(err).toBe(null);
        cb(results.length);
    });
};

describe("RDFLoader", function() {

    describe("setNetworkTransport", function() {

        it("makes LOAD fetch through the given transport", function(done) {
            withStore(function(store) {
                var requests = [];
                var transport = {
                    load: function(uri, accept, callback) {
                        requests.push(uri);
                        expect(accept).toContain("text/turtle");
                        callback(null, {headers: {"content-type": "text/turtle; charset=utf-8"}, data: TURTLE});
                    }
                };
                store.setNetworkTransport(transport);
                expect(store.getNetworkTransport()).toBe(transport);
                store.execute("LOAD <http://example.org/data>", function(err) {
                    expect(err).toBe(null);
                    expect(requests).toEqual(["http://example.org/data"]);
                    countTriples(store, "http://example.org/data", function(count) {
                        expect(count).toBe(1);
                        done();
                    });
                });
            });
        });

        it("applies to that store only", function(done) {
            withStore(function(store) {
                store.setNetworkTransport({load: function() {}});
                withStore(function(other) {
                    expect(other.getNetworkTransport()).toBe(NetworkTransport);
                    done();
                });
            });
        });

        it("reports a result without Content-Type via the callback", function(done) {
            withStore(function(store) {
                store.setNetworkTransport({load: function(uri, accept, callback) { callback(null, {data: TURTLE}); }});
                store.execute("LOAD <http://example.org/data>", function(err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/no Content-Type/);
                    done();
                });
            });
        });

        it("reports a missing transport via the callback", function(done) {
            withStore(function(store) {
                store.setNetworkTransport(null);
                store.execute("LOAD <http://example.org/data>", function(err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/No network transport/);
                    done();
                });
            });
        });
    });

    describe("the default transport", function() {
        var server, base, requested;

        beforeEach(function(done) {
            requested = [];
            server = http.createServer(function(req, res) {
                requested.push(req.url);
                if(req.url === "/dir/data.ttl?x=1") {
                    res.writeHead(200, {"Content-Type": "text/turtle"});
                    res.end(TURTLE);
                } else if(req.url === "/dir/moved") {
                    res.writeHead(302, {"Location": "data.ttl?x=1"});
                    res.end();
                } else if(req.url === "/split") {
                    // the bytes of "ü" arrive in two chunks
                    var body = Buffer.from('<http://s> <http://p> "Mü" .', "utf8");
                    var cut = body.indexOf(0xc3) + 1;
                    res.writeHead(200, {"Content-Type": "text/turtle"});
                    res.write(body.subarray(0, cut));
                    setTimeout(function() { res.end(body.subarray(cut)); }, 20);
                } else if(req.url === "/aborted") {
                    res.writeHead(200, {"Content-Type": "text/turtle", "Content-Length": "1000"});
                    res.write("<http://s> <http://p> ");
                    setTimeout(function() { req.socket.destroy(); }, 20);
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
            server.listen(0, "127.0.0.1", function() {
                base = "http://127.0.0.1:" + server.address().port;
                done();
            });
        });

        afterEach(function(done) {
            server.closeAllConnections();
            server.close(done);
        });

        it("requests the path with its query string", function(done) {
            withStore(function(store) {
                store.execute("LOAD <" + base + "/dir/data.ttl?x=1>", function(err) {
                    expect(err).toBe(null);
                    expect(requested).toEqual(["/dir/data.ttl?x=1"]);
                    countTriples(store, base + "/dir/data.ttl?x=1", function(count) {
                        expect(count).toBe(1);
                        done();
                    });
                });
            });
        });

        it("follows a relative redirect", function(done) {
            withStore(function(store) {
                store.execute("LOAD <" + base + "/dir/moved>", function(err) {
                    expect(err).toBe(null);
                    expect(requested).toEqual(["/dir/moved", "/dir/data.ttl?x=1"]);
                    countTriples(store, base + "/dir/moved", function(count) {
                        expect(count).toBe(1);
                        done();
                    });
                });
            });
        });

        it("decodes a character split across chunks", function(done) {
            withStore(function(store) {
                store.execute("LOAD <" + base + "/split>", function(err) {
                    expect(err).toBe(null);
                    store.execute("SELECT ?o { GRAPH <" + base + "/split> { ?s ?p ?o } }", function(err, results) {
                        expect(err).toBe(null);
                        expect(results[0].o.value).toBe("Mü");
                        done();
                    });
                });
            });
        });

        it("reports a connection closed during the response via the callback", function(done) {
            withStore(function(store) {
                store.execute("LOAD <" + base + "/aborted>", function(err) {
                    expect(err instanceof Error).toBe(true);
                    done();
                });
            });
        });

        it("reports an HTTP error via the callback", function(done) {
            withStore(function(store) {
                store.execute("LOAD <" + base + "/missing>", function(err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/404/);
                    done();
                });
            });
        });

        it("reports an unsupported protocol via the callback", function(done) {
            withStore(function(store) {
                store.execute("LOAD <ftp://example.org/data.ttl>", function(err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/Unsupported protocol ftp:/);
                    done();
                });
            });
        });
    });

    describe("\\u escapes in the data", function() {
        // the parsers decode them inside their tokens; decoded beforehand, " would end the string

        var loadsQuotedLiteral = function(mediaType, data, done) {
            withStore(function(store) {
                store.load(mediaType, data, function(err) {
                    expect(err).toBe(null);
                    store.execute("SELECT ?o { ?s ?p ?o }", function(err, results) {
                        expect(err).toBe(null);
                        expect(results[0].o.value).toBe('say "hi"');
                        done();
                    });
                });
            });
        };

        it("keeps an escaped quote in Turtle a quote", function(done) {
            loadsQuotedLiteral("text/turtle", '<http://s> <http://p> "say \\u0022hi\\u0022" .', done);
        });

        it("keeps an escaped quote in JSON-LD a quote", function(done) {
            loadsQuotedLiteral("application/ld+json", '{"@id": "http://s", "http://p": "say \\u0022hi\\u0022"}', done);
        });
    });

    describe("file URLs", function() {
        var dir;

        beforeEach(function() {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "rdfstore-"));
        });

        afterEach(function() {
            fs.rmSync(dir, {recursive: true, force: true});
        });

        it("loads a local file given as a file:// URL", function(done) {
            var file = path.join(dir, "data.ttl");
            fs.writeFileSync(file, TURTLE);
            withStore(function(store) {
                store.load("text/turtle", url.pathToFileURL(file).href, function(err) {
                    expect(err).toBe(null);
                    countTriples(store, null, function(count) {
                        expect(count).toBe(1);
                        done();
                    });
                });
            });
        });
    });
});
