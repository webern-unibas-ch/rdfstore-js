"use strict";

var utils = require("./utils");
if(!utils.isWorker()) {
    var http = require("http");
    var https = require("https");

    var NetworkTransport = {

        load: function (uri, accept, callback, redirect) {
            var redirection = redirect == null ? 3 : redirect;
            var parts;
            try {
                parts = new URL(uri);
            } catch (e) {
                return callback(new Error("Invalid URI: " + uri));
            }

            var client;
            if (parts.protocol === 'http:') {
                client = http;
            } else if (parts.protocol === 'https:') {
                client = https;
            } else {
                return callback(new Error("Unsupported protocol " + parts.protocol + " in URI: " + uri));
            }
            // the browser bundles replace http/https with an empty stub
            if (typeof client.request !== 'function') {
                return callback(new Error("No HTTP client to load " + uri + ": set one with store.setNetworkTransport"));
            }

            // URL keeps the brackets of an IPv6 hostname, http.request expects it without them
            var hostname = parts.hostname.replace(/^\[(.*)\]$/, "$1");
            var params = {
                'hostname': hostname,
                'port': parts.port || (client === http ? 80 : 443),
                'method': 'GET',
                'path': parts.pathname + parts.search,
                'headers': {'host': parts.host, 'Accept': accept}
            };

            // a dropped connection can report through the request, the response or both
            var done = utils.once(callback);
            var request = client.request(params, function (response) {
                var headers = response.headers;
                var data = "";

                if (("" + response.statusCode)[0] == '2') {
                    // decodes characters split across chunks
                    response.setEncoding('utf8');
                    response.on('data', function (chunk) {
                        data = data + chunk;
                    });
                    response.on('end', function () {
                        done(null, {headers: headers, data: data});
                    });
                    response.on('error', done);
                    response.on('close', function () {
                        if (!response.complete) {
                            done(new Error("Connection closed before the response was complete: " + uri));
                        }
                    });
                } else if (("" + response.statusCode)[0] == '3') {
                    // discard the body so the socket is freed
                    response.resume();
                    if (redirection == 0) {
                        done(new Error("Too many redirections"));
                    } else {
                        var location = (headers["Location"] || headers["location"]);
                        if (location != null) {
                            // a relative Location is resolved against the requested URI;
                            // an unresolvable one is passed on as is and reported as invalid
                            try {
                                location = new URL(location, uri).href;
                            } catch (e) {}
                            NetworkTransport.load(location, accept, done, (redirection - 1));
                        } else {
                            done(new Error("Redirection without location header"));
                        }
                    }
                } else {
                    response.resume();
                    done(new Error("HTTP error: " + response.statusCode));
                }
            });

            request.on('error', done);

            request.end();
        }

    };

    module.exports = {
        NetworkTransport: NetworkTransport
    };
}