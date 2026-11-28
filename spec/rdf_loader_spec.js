var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var url = require("url");
var Store = require("../src/store");
var NetworkTransport = require("../src/network_transport").NetworkTransport;

// Loading remote graphs (SPARQL LOAD) through the network transport, and local files through file:// URLs.

var TURTLE = "<http://s> <http://p> <http://o> .";

var withStore = function () {
    return Store.promises.create();
};

// LOAD <uri> and store.load add to the default graph, LOAD <uri> INTO GRAPH <g> to the graph <g>
var countTriples = async function (store, graph) {
    var pattern = graph == null ? "?s ?p ?o" : "GRAPH <" + graph + "> { ?s ?p ?o }";
    var results = await store.promises.execute("SELECT * { " + pattern + " }");
    return results.length;
};

describe("RDFLoader", function () {
    describe("setNetworkTransport", function () {
        it("should make LOAD fetch through the given transport", async function () {
            var store = await withStore();

            var requests = [];
            var transport = {
                load: function (uri, accept, callback) {
                    requests.push(uri);
                    expect(accept).toContain("text/turtle");
                    callback(null, { headers: { "content-type": "text/turtle; charset=utf-8" }, data: TURTLE });
                },
            };
            store.setNetworkTransport(transport);
            expect(store.getNetworkTransport()).toBe(transport);

            await store.promises.execute("LOAD <http://example.org/data>");
            expect(requests).toEqual(["http://example.org/data"]);

            var count = await countTriples(store, null);
            expect(count).toBe(1);
        });

        it("should resolve a prefixed or relative source IRI of LOAD", async function () {
            var store = await withStore();

            var requests = [];
            store.setNetworkTransport({
                load: function (uri, accept, callback) {
                    requests.push(uri);
                    callback(null, { headers: { "content-type": "text/turtle" }, data: TURTLE });
                },
            });
            await store.promises.execute("PREFIX ex: <http://example.org/> LOAD ex:data");

            await store.promises.execute("BASE <http://example.org/> LOAD <rel>");
            expect(requests).toEqual(["http://example.org/data", "http://example.org/rel"]);
        });

        it("should make LOAD add to the default graph, or to the graph INTO GRAPH names", async function () {
            var store = await withStore();

            store.setNetworkTransport({
                load: function (uri, accept, callback) {
                    callback(null, { headers: { "content-type": "text/turtle" }, data: TURTLE });
                },
            });
            await store.promises.execute("LOAD <http://example.org/data>");

            await store.promises.execute("LOAD <http://example.org/data> INTO GRAPH <http://example.org/g>");

            var count = await countTriples(store, null);
            expect(count).toBe(1);

            count = await countTriples(store, "http://example.org/g");
            expect(count).toBe(1);

            count = await countTriples(store, "http://example.org/data");
            expect(count).toBe(0);
        });

        it("should make store.load('remote', …) fetch into the default graph, or into the given graph", async function () {
            var store = await withStore();

            var requests = [];
            store.setNetworkTransport({
                load: function (uri, accept, callback) {
                    requests.push(uri);
                    callback(null, { headers: { "content-type": "text/turtle" }, data: TURTLE });
                },
            });
            await store.promises.load("remote", "http://example.org/data");

            await store.promises.load("remote", "http://example.org/data", "http://example.org/g");
            expect(requests).toEqual(["http://example.org/data", "http://example.org/data"]);

            var count = await countTriples(store, null);
            expect(count).toBe(1);

            count = await countTriples(store, "http://example.org/g");
            expect(count).toBe(1);
        });

        it("should apply to that store only", async function () {
            var store = await withStore();

            store.setNetworkTransport({ load: function () {} });
            var other = await withStore();
            expect(other.getNetworkTransport()).toBe(NetworkTransport);
        });

        it("should report a result without Content-Type via the callback", async function () {
            var store = await withStore();

            store.setNetworkTransport({
                load: function (uri, accept, callback) {
                    callback(null, { data: TURTLE });
                },
            });
            await new Promise(function (done) {
                store.execute("LOAD <http://example.org/data>", function (err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/no Content-Type/);
                    done();
                });
            });
        });

        it("should report a missing transport via the callback", async function () {
            var store = await withStore();

            store.setNetworkTransport(null);
            await new Promise(function (done) {
                store.execute("LOAD <http://example.org/data>", function (err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/No network transport/);
                    done();
                });
            });
        });
    });

    describe("the default transport", function () {
        var server, base, requested;

        beforeEach(async function () {
            requested = [];
            server = http.createServer(function (req, res) {
                requested.push(req.url);
                if (req.url === "/dir/data.ttl?x=1") {
                    res.writeHead(200, { "Content-Type": "text/turtle" });
                    res.end(TURTLE);
                } else if (req.url === "/dir/moved") {
                    res.writeHead(302, { Location: "data.ttl?x=1" });
                    res.end();
                } else if (req.url === "/split") {
                    // the bytes of "ü" arrive in two chunks
                    var body = Buffer.from('<http://s> <http://p> "Mü" .', "utf8");
                    var cut = body.indexOf(0xc3) + 1;
                    res.writeHead(200, { "Content-Type": "text/turtle" });
                    res.write(body.subarray(0, cut));
                    setTimeout(function () {
                        res.end(body.subarray(cut));
                    }, 20);
                } else if (req.url === "/aborted") {
                    res.writeHead(200, { "Content-Type": "text/turtle", "Content-Length": "1000" });
                    res.write("<http://s> <http://p> ");
                    setTimeout(function () {
                        req.socket.destroy();
                    }, 20);
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
            await new Promise(function (done) {
                server.listen(0, "127.0.0.1", function () {
                    base = "http://127.0.0.1:" + server.address().port;
                    done();
                });
            });
        });

        afterEach(async function () {
            server.closeAllConnections();
            await new Promise(function (done) {
                server.close(done);
            });
        });

        it("should request the path with its query string", async function () {
            var store = await withStore();

            await store.promises.execute("LOAD <" + base + "/dir/data.ttl?x=1>");
            expect(requested).toEqual(["/dir/data.ttl?x=1"]);

            var count = await countTriples(store, null);
            expect(count).toBe(1);
        });

        it("should follow a relative redirect", async function () {
            var store = await withStore();

            await store.promises.execute("LOAD <" + base + "/dir/moved>");
            expect(requested).toEqual(["/dir/moved", "/dir/data.ttl?x=1"]);

            var count = await countTriples(store, null);
            expect(count).toBe(1);
        });

        it("should decode a character split across chunks", async function () {
            var store = await withStore();

            await store.promises.execute("LOAD <" + base + "/split>");

            var results = await store.promises.execute("SELECT ?o { ?s ?p ?o }");
            expect(results[0].o.value).toBe("Mü");
        });

        it("should report a connection closed during the response via the callback", async function () {
            var store = await withStore();

            await new Promise(function (done) {
                store.execute("LOAD <" + base + "/aborted>", function (err) {
                    expect(err instanceof Error).toBe(true);
                    done();
                });
            });
        });

        it("should report an HTTP error via the callback", async function () {
            var store = await withStore();

            await new Promise(function (done) {
                store.execute("LOAD <" + base + "/missing>", function (err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/404/);
                    done();
                });
            });
        });

        it("should report an unsupported protocol via the callback", async function () {
            var store = await withStore();

            await new Promise(function (done) {
                store.execute("LOAD <ftp://example.org/data.ttl>", function (err) {
                    expect(err instanceof Error).toBe(true);
                    expect(err.message).toMatch(/Unsupported protocol ftp:/);
                    done();
                });
            });
        });
    });

    describe("\\u escapes in the data", function () {
        // the parsers decode them inside their tokens; decoded beforehand, " would end the string

        var loadsQuotedLiteral = async function (mediaType, data) {
            var store = await withStore();
            await store.promises.load(mediaType, data);
            var results = await store.promises.execute("SELECT ?o { ?s ?p ?o }");
            expect(results[0].o.value).toBe('say "hi"');
        };

        it("should keep an escaped quote in Turtle a quote", async function () {
            await loadsQuotedLiteral("text/turtle", '<http://s> <http://p> "say \\u0022hi\\u0022" .');
        });

        it("should keep an escaped quote in JSON-LD a quote", async function () {
            await loadsQuotedLiteral("application/ld+json", '{"@id": "http://s", "http://p": "say \\u0022hi\\u0022"}');
        });
    });

    describe("file URLs", function () {
        var dir;

        beforeEach(function () {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "rdfstore-"));
        });

        afterEach(function () {
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it("should load a local file given as a file:// URL", async function () {
            var file = path.join(dir, "data.ttl");
            fs.writeFileSync(file, TURTLE);
            var store = await withStore();

            await store.promises.load("text/turtle", url.pathToFileURL(file).href);

            var count = await countTriples(store, null);
            expect(count).toBe(1);
        });
    });
});
