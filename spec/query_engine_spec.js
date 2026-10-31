var QueryEngine = require("../src/query_engine").QueryEngine;
var QuadBackend = require("../src/quad_backend").QuadBackend;
var Lexicon = require("../src/lexicon").Lexicon;
var NonSupportedSparqlFeatureError = require("../src/abstract_query_tree").NonSupportedSparqlFeatureError;
var fs = require('fs');
var _ = require("lodash");
var async = require("async");

// basic

describe("QueryEngine", function(){

    it("Should be able to parse a query.", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX ns: <http://example.org/ns#>  PREFIX x:  <http://example.org/x/> PREFIX z:  <http://example.org/x/#> INSERT DATA { x:x ns:p  "d:x ns:p" . x:x x:p   "x:x x:p" . z:x z:p   "z:x z:p" . }', function(err, result){
                    if(err !== null)
                        throw err;
                    engine.execute('BASE <http://example.org/x/> PREFIX : <> SELECT * WHERE { :x ?p ?v }', function(err, results){

                        if(err !== null)
                            throw err;
                        expect(results.length).toBe(2);

                        for(var i=0; i< results.length; i++) {
                            var result = results[i];
                            if(result.p.value === "http://example.org/ns#p") {
                                expect(result.v.value).toBe("d:x ns:p");
                            } else if(result.p.value === "http://example.org/x/p") {
                                expect(result.v.value).toBe("x:x x:p");
                            } else {
                                result.ok(false);
                            }
                        }
                        done();
                    });
                });
            });
        });
    });

    it("Test InsertDataTrivialRecovery", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }', function(result){
                    engine.execute('SELECT * { ?s ?p ?o }', function(err, result){
                        expect(err).toBe(null);
                        expect(result.length).toBe(1);
                        expect(result[0]['s'].value).toBe('http://example/book3');
                        expect(result[0]['p'].value).toBe('http://example.com/vocab#title');
                        expect(result[0]['o'].value ).toBe('http://test.com/example');
                        done();
                    });
                });

            })
        });
    });


    it("Test InsertDataTrivialRecovery2", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example>; <http://example.com/vocab#pages> 95 }', function(err,result){
                    expect( err ).toBe(null);

                    engine.execute('SELECT * { ?s ?p ?o }', function(err, result){
                        expect(result.length).toBe(2);
                        expect(result[0]['s'].value).toBe('http://example/book3');
                        expect(result[1]['s'].value).toBe('http://example/book3');

                        if(result[0]['p'].value === 'http://example.com/vocab#title') {
                            expect(result[0]['o'].value).toBe('http://test.com/example');
                        } else if(result[0]['p'].value === 'http://example.com/vocab#pages') {
                            expect(result[1]['o'].value).toBe("95");
                            expect(result[1]['o'].type).toBe("http://www.w3.org/2001/XMLSchema#integer");
                        } else {
                            expect(false);
                        }

                        if(result[1]['p'].value === 'http://example.com/vocab#title') {
                            expect(result[1]['o'].value).toBe('http://test.com/example');
                        } else if(result[1]['p'].value === 'http://example.com/vocab#pages') {
                            expect(result[1]['o'].value).toBe("95");
                            expect(result[1]['o'].type).toBe("http://www.w3.org/2001/XMLSchema#integer");
                        } else {
                            expect(false);
                        }

                        done();
                    });
                });

            })
        });
    });

    it("Test InsertDataTrivialRecovery3", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example>; <http://example.com/vocab#pages> 95 }',function(err,result){
                    engine.execute('INSERT DATA { <http://example/book4> <http://example.com/vocab#title> <http://test.com/example>; <http://example.com/vocab#pages> 96 }', function(err,result){
                        expect( err ).toBe(null);
                        engine.execute('SELECT * { <http://example/book3> ?p ?o }', function(err, result){
                            expect(err).toBe(null);
                            expect(result.length).toBe(2);

                            if(result[0]['p'].value === 'http://example.com/vocab#title') {
                                expect(result[0]['o'].value).toBe('http://test.com/example');
                            } else if(result[0]['p'].value === 'http://example.com/vocab#pages') {
                                expect(result[0]['o'].value).toBe("95");
                                expect(result[0]['o'].type).toBe("http://www.w3.org/2001/XMLSchema#integer");
                            } else {
                                expect(false);
                            }

                            if(result[1]['p'].value === 'http://example.com/vocab#title') {
                                expect(result[1]['o'].value).toBe('http://test.com/example');
                            } else if(result[1]['p'].value === 'http://example.com/vocab#pages') {
                                expect(result[1]['o'].value).toBe("95");
                                expect(result[1]['o'].type).toBe("http://www.w3.org/2001/XMLSchema#integer");
                            } else {
                                expect(false);
                            }

                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test SimpleJoin1", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example>; <http://example.com/vocab#pages> 95 . <http://example/book4> <http://example.com/vocab#title> <http://test.com/example>; <http://example.com/vocab#pages> 96 . }', function(err,result){
                    expect( err ).toBe(null);

                    engine.execute('SELECT * { ?s <http://example.com/vocab#title> ?o . ?s <http://example.com/vocab#pages> 95 }', function(err, result){
                        expect(err).toBe(null);
                        expect(result.length).toBe(1);

                        expect(result[0]['s'].value).toBe("http://example/book3");
                        done();
                    });
                });
            });
        });
    });

    it("Test PrefixInsertion", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX ns: <http://example.org/ns#>  PREFIX x:  <http://example.org/x/> PREFIX z:  <http://example.org/x/#> INSERT DATA { x:x ns:p  "d:x ns:p" . x:x x:p   "x:x x:p" . z:x z:p   "z:x z:p" . }', function(err, result){

                    engine.execute('SELECT * { ?s ?p ?o }', function(err, results){
                        expect(results.length).toBe(3);

                        for(var i=0; i<results.length; i++) {
                            if(results[i].s.value === "http://example.org/x/x") {
                                if(results[i].p.value === "http://example.org/ns#p") {
                                    expect(results[i].o.value).toBe("d:x ns:p");
                                } else if(results[i].p.value === "http://example.org/x/p") {
                                    expect(results[i].o.value).toBe("x:x x:p");
                                } else {
                                    expect(false);
                                }
                            } else if(results[i].s.value === "http://example.org/x/#x") {
                                expect(results[i].p.value).toBe("http://example.org/x/#p");
                                expect(results[i].o.value).toBe("z:x z:p");
                            } else {
                                expect(false);
                            }
                        }

                        done();
                    });
                });
            });
        });
    });

    it("Test UnionBasic1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute(" PREFIX dc10:  <http://purl.org/dc/elements/1.0/> PREFIX dc11:  <http://purl.org/dc/elements/1.1/> INSERT DATA { _:a  dc10:title     'SPARQL Query Language Tutorial' .\
                                _:a  dc10:creator   'Alice' .\
                                _:b  dc11:title     'SPARQL Protocol Tutorial' .\
                                _:b  dc11:creator   'Bob' .\
                                _:c  dc10:title     'SPARQL' .\
                                _:c  dc11:title     'SPARQL (updated)' .\
                                }", function(err, result) {

                    engine.execute("PREFIX dc10:  <http://purl.org/dc/elements/1.0/>\
                                    PREFIX dc11:  <http://purl.org/dc/elements/1.1/>\
                                    SELECT ?title WHERE  { { ?book dc10:title  ?title } UNION { ?book dc11:title  ?title } }",
                        function(err, results) {
                            expect(results.length).toBe(4);

                            var titles = [];
                            for(var i=0; i<results.length; i++) {
                                titles.push(results[i].title.value);
                            }
                            titles.sort();
                            expect(titles[0], 'SPARQL');
                            expect(titles[1], 'SPARQL (updated)');
                            expect(titles[2], 'SPARQL Protocol Tutorial');
                            expect(titles[3], 'SPARQL Query Language Tutorial');
                            done();
                        });
                });
            });
        });
    });


    it("Test UnionBasic2", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute(" PREFIX dc10:  <http://purl.org/dc/elements/1.0/> PREFIX dc11:  <http://purl.org/dc/elements/1.1/> INSERT DATA { \
                                _:a  dc10:title     'SPARQL Query Language Tutorial' .\
                                _:a  dc10:creator   'Alice' .\
                                _:b  dc11:title     'SPARQL Protocol Tutorial' .\
                                _:b  dc11:creator   'Bob' .\
                                _:c  dc10:title     'SPARQL' .\
                                _:c  dc11:title     'SPARQL (updated)' .\
                                }", function(err, result) {

                    engine.execute("PREFIX dc10:  <http://purl.org/dc/elements/1.0/>\
                                                    PREFIX dc11:  <http://purl.org/dc/elements/1.1/>\
                                                    SELECT ?x ?y\
                                                    WHERE  { { ?book dc10:title ?x } UNION { ?book dc11:title  ?y } }",
                        function(err, results) {
                            expect(results.length).toBe(4);

                            var xs = [];
                            var ys = [];
                            for(var i=0; i<results.length; i++) {
                                if(results[i].x == null) {
                                    ys.push(results[i].y.value);
                                } else {
                                    xs.push(results[i].x.value);
                                }
                            }

                            xs.sort();
                            ys.sort();

                            expect(xs[0]=='SPARQL');
                            expect(xs[1]=='SPARQL Query Language Tutorial');
                            expect(ys[0]=='SPARQL (updated)');
                            expect(ys[1]=='SPARQL Protocol Tutorial');
                            done();
                        });
                });
            });
        });
    });


    it("Test UnionBasic3", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute(" PREFIX dc10:  <http://purl.org/dc/elements/1.0/> PREFIX dc11:  <http://purl.org/dc/elements/1.1/> INSERT DATA { \
                                _:a  dc10:title     'SPARQL Query Language Tutorial' .\
                                _:a  dc10:creator   'Alice' .\
                                _:b  dc11:title     'SPARQL Protocol Tutorial' .\
                                _:b  dc11:creator   'Bob' .\
                                _:c  dc10:title     'SPARQL' .\
                                _:c  dc11:title     'SPARQL (updated)' .\
                                }", function(err, result) {

                    engine.execute("PREFIX dc10:  <http://purl.org/dc/elements/1.0/>\
                                                    PREFIX dc11:  <http://purl.org/dc/elements/1.1/>\
                                                    SELECT ?title ?author\
                                                    WHERE  { { ?book dc10:title ?title .  ?book dc10:creator ?author }\
                                                    UNION\
                                                    { ?book dc11:title ?title .  ?book dc11:creator ?author } }",
                        function(err, results) {
                            expect(results.length).toBe(2);

                            if(results[0].author.value == "Alice") {
                                expect(results[0].title.value == "SPARQL Query Language Tutorial");
                                expect(results[1].author.value == "Bob");
                                expect(results[1].title.value == "SPARQL Protocol Tutorial");
                            } else {
                                expect(results[1].author.value == "Alice");
                                expect(results[1].title.value == "SPARQL Query Language Tutorial");
                                expect(results[0].author.value == "Bob");
                                expect(results[0].title.value == "SPARQL Protocol Tutorial");
                            }
                            done();
                        });
                });
            });
        });
    });


    it("Test UnionBasic4", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute(" PREFIX dc10:  <http://purl.org/dc/elements/1.0/> PREFIX dc11:  <http://purl.org/dc/elements/1.1/> INSERT DATA { _:a  dc10:title     'SPARQL Query Language Tutorial' .\
                                _:a  dc10:creator   'Alice' .\
                                _:b  dc11:title     'SPARQL Protocol Tutorial' .\
                                _:b  dc11:creator   'Bob' .\
                                _:c  dc10:title     'SPARQL' .\
                                _:c  dc11:title     'SPARQL (updated)' .\
                                }", function(err, result) {

                    engine.execute("SELECT ?book WHERE { ?book ?p ?o }",
                        function(err, results) {
                            expect(results.length).toBe(6);
                            for(var i=0; i<6; i++) {
                                expect(results[i].book.token == 'blank');
                                expect(results[i].book.value != null);
                            }
                            done();
                        });
                });
            });
        });
    });

    it("Test OptionalBasic1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:a    foaf:name   'Alice' .\
                                 _:a    foaf:knows  _:b .\
                                 _:a    foaf:knows  _:c .\
                                 _:b    foaf:name   'Bob' .\
                                 _:c    foaf:name   'Clare' .\
                                 _:c    foaf:nick   'CT' .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT ?nameX ?nameY ?nickY\
                                                   WHERE\
                                                   { ?x foaf:knows ?y ;\
                                                     foaf:name ?nameX .\
                                                     ?y foaf:name ?nameY .\
                                                     OPTIONAL { ?y foaf:nick ?nickY }  }",
                        function(err, results) {
                            expect(results.length).toBe(2);
                            if(results[0].nickY === null) {
                                expect(results[0].nameX.value).toBe('Alice');
                                expect(results[0].nameY.value).toBe('Bob');
                                expect(results[1].nameX.value).toBe('Alice');
                                expect(results[1].nameY.value).toBe('Clare');
                                expect(results[1].nickY.value).toBe('CT');
                            } else {
                                expect(results[1].nameX.value).toBe('Alice');
                                expect(results[1].nameY.value).toBe('Bob');
                                expect(results[0].nameX.value).toBe('Alice');
                                expect(results[0].nameY.value).toBe('Clare');
                                expect(results[0].nickY.value).toBe('CT');
                            }
                            done();
                        });
                });
            });
        });
    });

    it("Test OptionalBasic2", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:a    foaf:name   'Alice' .\
                                 _:a    foaf:knows  _:b .\
                                 _:a    foaf:knows  _:c .\
                                 _:b    foaf:name   'Bob' .\
                                 _:c    foaf:name   'Clare' .\
                                 _:c    foaf:nick   'CT' .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT *\
                                                   { OPTIONAL { ?x foaf:knows ?y }\
                                                     OPTIONAL { ?y foaf:nick ?nickY }\
                                                   }",
                        function(err, results) {

                            var result = results.length > 0;
                            expect(results.length === 2).toBe(true);
                            done();
                        });
                });
            });
        });
    });

    // Sorted "s|var1|var2..." strings with the local names, so the expectations don't depend on the solution order.
    var optionalRows = function(results, vars) {
        return results.map(function(result) {
            return vars.map(function(v) {
                return result[v] == null ? "" : result[v].value.replace("http://example/", "");
            }).join("|");
        }).sort();
    };

    it("Test OptionalFilterUnmatchedSolution", function(done) {
        new Lexicon(function(lexicon){
            // the store's default tree order, which yields :a's solution first
            new QuadBackend({treeOrder: 15}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // :a has no :q, so the left join adds ?x to its solution; ?x must still be
                // unbound again for :b, whose only ?x fails the OPTIONAL's filter
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :a :p 1 .\
                            :b :p 2 .\
                            :b :q 5 .\
                            :c :p 3 .\
                            :c :q 20 }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x { ?s :p ?o OPTIONAL { ?s :q ?x FILTER(?x > 10) } }', function(err, results){
                        expect(err).toBeNull();
                        expect(optionalRows(results, ["s", "x"])).toEqual(["a|", "b|", "c|20"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test OptionalFilterUnionVariables", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // the UNION's solutions bind different variables: all of them must be unbound
                // again when a solution fails the OPTIONAL's filter, not only the first one's
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :a :p 1 .\
                            :b :p 2 .\
                            :b :q :x1 .\
                            :b :r :y1 }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x ?y { ?s :p ?o OPTIONAL { { ?s :q ?x } UNION { ?s :r ?y } FILTER(!BOUND(?y)) } }', function(err, results){
                        expect(err).toBeNull();
                        expect(optionalRows(results, ["s", "x", "y"])).toEqual(["a||", "b|x1|"]);
                        engine.execute('PREFIX : <http://example/> SELECT ?s ?x ?y { ?s :p ?o OPTIONAL { { ?s :r ?y } UNION { ?s :q ?x } FILTER(!BOUND(?x)) } }', function(err, results){
                            expect(err).toBeNull();
                            expect(optionalRows(results, ["s", "x", "y"])).toEqual(["a||", "b||y1"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test OptionalFilterVariableBoundOnlyInSomeLeftSolutions", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // the left UNION binds ?x for :a only: :b's ?x comes from the OPTIONAL alone
                // and must be unbound again when it fails the OPTIONAL's filter
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :a :q 1 .\
                            :b :p 2 .\
                            :b :r 5 .\
                            :c :p 3 .\
                            :c :r 20 }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x { { { ?s :q ?x } UNION { ?s :p ?o } } OPTIONAL { ?s :r ?x FILTER(?x > 10) } }', function(err, results){
                        expect(err).toBeNull();
                        expect(optionalRows(results, ["s", "x"])).toEqual(["a|1", "b|", "c|20"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test OptionalFilterKeepsOuterBind", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // the BIND after the OPTIONAL is evaluated on the joined solutions: a solution
                // whose OPTIONAL part fails the filter keeps the BIND's value
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :a :p 1 .\
                            :b :p 2 .\
                            :b :q 5 .\
                            :c :p 3 .\
                            :c :q 20 }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x ?z { ?s :p ?o OPTIONAL { ?s :q ?x FILTER(?x > 10) } BIND(STR(?o) AS ?z) }', function(err, results){
                        expect(err).toBeNull();
                        expect(optionalRows(results, ["s", "x", "z"])).toEqual(["a||1", "b||2", "c|20|3"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test OptionalFilterKeepsLeftSolutionOnceIfNoneMatches", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // :b has a passing and a failing ?x: only the passing one is kept, also with a BIND after the OPTIONAL
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :b :p 2 .\
                            :b :q 5 .\
                            :b :q 30 .\
                            :b :t :u }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x ?z { ?s :p ?o OPTIONAL { ?s :q ?x FILTER(?x > 10) } BIND(1 AS ?z) }', function(err, results){
                        expect(err).toBeNull();
                        expect(optionalRows(results, ["s", "x", "z"])).toEqual(["b|30|1"]);
                        // {?s=:b} from the second branch fails the filter (?o unbound): it is kept,
                        // although its bindings are a subset of the passing solution's
                        engine.execute('PREFIX : <http://example/> SELECT ?s ?o ?x { { { ?s :p ?o } UNION { ?s :t :u } } OPTIONAL { ?s :q ?x FILTER(?x > ?o) } }', function(err, results){
                            expect(err).toBeNull();
                            expect(optionalRows(results, ["s", "o", "x"])).toEqual(["b|2|30", "b|2|5", "b||"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test OptionalFilterKeepsDuplicateLeftSolutions", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // the UNION yields every left solution twice (a bag): the OPTIONAL keeps both copies
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :a :p 1 .\
                            :b :p 2 .\
                            :b :q 5 }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x { { { ?s :p ?o } UNION { ?s :p ?o } } OPTIONAL { ?s :q ?x FILTER(?x > 100) } }', function(err, results){
                        expect(err).toBeNull();
                        expect(optionalRows(results, ["s", "x"])).toEqual(["a|", "a|", "b|", "b|"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test OptionalDistinct1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:x    foaf:name   'Alice' .\
                                 _:x    foaf:mbox   <mailto:alice@example.com> .\
                                 _:y    foaf:name   'Alice' .\
                                 _:y    foaf:mbox   <mailto:asmith@example.com> .\
                                 _:z    foaf:name   'Alice' .\
                                 _:z    foaf:mbox   <mailto:alice.smith@example.com> .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT DISTINCT ?name WHERE { ?x foaf:name ?name }",
                        function(err, results) {
                            expect(results.length).toBe(1);
                            expect(results[0].name.value).toBe('Alice');
                            done();
                        });
                });
            });
        });
    });


    it("Test Limit1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:x    foaf:name   'Alice' .\
                                 _:x    foaf:mbox   <mailto:alice@example.com> .\
                                 _:y    foaf:name   'Alice' .\
                                 _:y    foaf:mbox   <mailto:asmith@example.com> .\
                                 _:z    foaf:name   'Alice' .\
                                 _:z    foaf:mbox   <mailto:alice.smith@example.com> .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                    SELECT ?name WHERE { ?x foaf:name ?name } LIMIT 2",
                        function(err, results) {
                            expect(results.length).toBe(2);
                            expect(results[0].name.value).toBe('Alice');
                            expect(results[1].name.value).toBe('Alice');
                            done();
                        });
                });
            });
        });
    });


    it("Test OrderBy1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:x    foaf:name   'Bob' .\
                                 _:x    foaf:mbox   <mailto:alice@example.com> .\
                                 _:y    foaf:name   'Alice' .\
                                 _:y    foaf:mbox   <mailto:asmith@example.com> .\
                                 _:z    foaf:name   'Marie' .\
                                 _:z    foaf:mbox   <mailto:alice.smith@example.com> .\
                               }", function(err, result) {
                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT ?name WHERE { ?x foaf:name ?name } ORDER BY ?name",
                        function(err, results) {
                            expect(results.length).toBe(3);
                            expect(results[0].name.value).toBe('Alice');
                            expect(results[1].name.value).toBe('Bob');
                            expect(results[2].name.value).toBe('Marie');
                            done();
                        });
                });
            });
        });
    });

    it("Test OrderBy2", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:x    foaf:name   'Bob' .\
                                 _:x    foaf:mbox   <mailto:alice@example.com> .\
                                 _:y    foaf:name   'Alice' .\
                                 _:y    foaf:mbox   <mailto:asmith@example.com> .\
                                 _:z    foaf:name   'Marie' .\
                                 _:z    foaf:mbox   <mailto:alice.smith@example.com> .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT ?name WHERE { ?x foaf:name ?name } ORDER BY DESC(?name)",
                        function(err, results) {
                            expect(results.length).toBe(3);
                            expect(results[0].name.value).toBe('Marie');
                            expect(results[1].name.value).toBe('Bob');
                            expect(results[2].name.value).toBe('Alice');
                            done();
                        });
                });
            });
        });
    });

    it("Test OrderBy3", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:x    foaf:name   'Bob' .\
                                 _:x    foaf:mbox   <mailto:bob@example.com> .\
                                 _:y    foaf:name   'Alice' .\
                                 _:y    foaf:mbox   <mailto:alice@example.com> .\
                                 _:z    foaf:name   'Marie' .\
                                 _:z    foaf:mbox   <mailto:marie@example.com> .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT ?mbox WHERE { ?x foaf:mbox ?mbox } ORDER BY ASC(?mbox)",
                        function(err, results) {
                            expect(results.length).toBe(3);
                            expect(results[0].mbox.value).toBe('mailto:alice@example.com');
                            expect(results[1].mbox.value).toBe('mailto:bob@example.com');
                            expect(results[2].mbox.value).toBe('mailto:marie@example.com');
                            done();
                        });
                });
            });
        });
    });


    it("Test OrderBy4", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute("PREFIX  foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {\
                                 _:x    foaf:name   'Bob' .\
                                 _:x    foaf:test1   'b' .\
                                 _:y    foaf:name   'Alice' .\
                                 _:y    foaf:test1   'a' .\
                                 _:z    foaf:name   'Marie' .\
                                 _:z    foaf:test1   'a' .\
                               }", function(err, result) {

                    engine.execute("PREFIX foaf:    <http://xmlns.com/foaf/0.1/>\
                                                   SELECT ?name WHERE { ?x foaf:test1 ?test . ?x foaf:name ?name } ORDER BY ASC(?test) ASC(?name)",
                        function(err, results) {
                            expect(results.length).toBe(3);
                            expect(results[0].name.value).toBe('Alice');
                            expect(results[1].name.value).toBe('Marie');
                            expect(results[2].name.value).toBe('Bob');
                            done();
                        });
                });
            });
        });
    });


    it("Test InsertionDeletionTrivial1", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('INSERT DATA {  <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }', function(result){
                    engine.execute('SELECT * { ?s ?p ?o }', function(err, result){
                        expect(result.length).toBe(1);
                        expect(result[0]['s'].value).toBe('http://example/book3');
                        expect(result[0]['p'].value).toBe('http://example.com/vocab#title');
                        expect(result[0]['o'].value ).toBe('http://test.com/example');

                        engine.execute('DELETE DATA { <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }', function(result) {
                            engine.execute('SELECT * { ?s ?p ?o }', function(err, result){
                                expect(result.length).toBe(0);
                                var acum = 0;
                                for(var p in engine.lexicon.uriToOID) {
                                    acum++;
                                }
                                for(var p in engine.lexicon.OIDToUri) {
                                    acum++;
                                }

                                for(var p in engine.lexicon.literalToOID) {
                                    acum++;
                                }

                                for(var p in engine.lexicon.OIDToLiteral) {
                                    acum++;
                                }
                                expect(acum).toBe(0);
                                done();
                            });
                        });
                    });
                });

            })
        });
    });

    it("Test InsertionDeletion2", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('INSERT DATA {  GRAPH <a> { <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> } }', function(err){
                    expect(err).toBe(null);

                    engine.execute('INSERT DATA {  GRAPH <b> { <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> } }', function(err){
                        expect(err).toBe(null);
                        engine.execute('SELECT * FROM NAMED <a> { GRAPH <a> { ?s ?p ?o } }', function(err, result){
                            expect(result.length).toBe(1);
                            expect(result[0]['s'].value).toBe('http://example/book3');
                            expect(result[0]['p'].value).toBe('http://example.com/vocab#title');
                            expect(result[0]['o'].value ).toBe('http://test.com/example');

                            engine.execute('SELECT * FROM NAMED <b> { GRAPH <b> { ?s ?p ?o } }', function(err, result){

                                expect(result.length).toBe(1);
                                expect(result[0]['s'].value).toBe('http://example/book3');
                                expect(result[0]['p'].value).toBe('http://example.com/vocab#title');
                                expect(result[0]['o'].value ).toBe('http://test.com/example');

                                engine.execute('DELETE DATA { GRAPH <a> { <http://example/book3> <http://example.com/vocab#title> <http://test.com/example> }  }', function(result) {
                                    engine.execute('SELECT * FROM NAMED <a> { GRAPH <a> { ?s ?p ?o } }', function(err, result){

                                        expect(result.length).toBe(0);

                                        engine.execute('SELECT * FROM NAMED <b> { GRAPH <b> { ?s ?p ?o } }', function(err, result){

                                            expect(result.length).toBe(1);
                                            expect(result[0]['s'].value).toBe('http://example/book3');
                                            expect(result[0]['p'].value).toBe('http://example.com/vocab#title');
                                            expect(result[0]['o'].value ).toBe('http://test.com/example');


                                            var acum = 0;
                                            for(var p in engine.lexicon.uriToOID) {
                                                acum++;
                                            }
                                            for(var p in engine.lexicon.OIDToUri) {
                                                acum++;
                                            }

                                            for(var p in engine.lexicon.literalToOID) {
                                                acum++;
                                            }

                                            for(var p in engine.lexicon.OIDToLiteral) {
                                                acum++;
                                            }

                                            expect(acum===8);
                                            done();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test Modify1", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/addresses> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                        <http://example/president42> foaf:givenName "Bill" .\
                                        <http://example/president42> foaf:familyName "Clinton" .\
                                   } \
                               }', function(result){
                    engine.execute("PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                              WITH <http://example/addresses>\
                              DELETE { ?person foaf:givenName 'Bill' }\
                              INSERT { ?person foaf:givenName 'William' }\
                              WHERE  { ?person foaf:givenName 'Bill' }",
                        function(err, result){
                            engine.execute("PREFIX foaf:<http://xmlns.com/foaf/0.1/>\
                              SELECT * FROM NAMED <http://example/addresses> { \
                              GRAPH <http://example/addresses> { ?s ?p ?o } }\
                              ORDER BY ?s ?p", function(err, results){


                                expect(results[0].s.value).toBe("http://example/president25");
                                expect(results[1].s.value).toBe("http://example/president25");
                                expect(results[0].o.value).toBe("McKinley");
                                expect(results[1].o.value).toBe("William");

                                expect(results[2].s.value).toBe("http://example/president27");
                                expect(results[3].s.value).toBe("http://example/president27");
                                expect(results[2].o.value).toBe("Taft");
                                expect(results[3].o.value).toBe("William");

                                expect(results[4].s.value).toBe("http://example/president42");
                                expect(results[5].s.value).toBe("http://example/president42");
                                expect(results[4].o.value).toBe("Clinton");
                                expect(results[5].o.value).toBe("William");

                                done();

                            })
                        });
                });
            });
        });
    });


    it("Test ModifyDefaultGraph", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                        <http://example/president42> foaf:givenName "Bill" .\
                                        <http://example/president42> foaf:familyName "Clinton" .\
                               }', function(){
                    engine.execute("PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                              DELETE { ?person foaf:givenName 'Bill' }\
                              INSERT { ?person foaf:givenName 'William' }\
                              WHERE  { ?person foaf:givenName 'Bill' }",
                        function(err){
                            engine.execute("PREFIX foaf:<http://xmlns.com/foaf/0.1/>\
                              SELECT * { ?s ?p ?o }\
                              ORDER BY ?s ?p", function(err, results){


                                expect(results[0].s.value).toBe("http://example/president25");
                                expect(results[1].s.value).toBe("http://example/president25");
                                expect(results[0].o.value).toBe("McKinley");
                                expect(results[1].o.value).toBe("William");

                                expect(results[2].s.value).toBe("http://example/president27");
                                expect(results[3].s.value).toBe("http://example/president27");
                                expect(results[2].o.value).toBe("Taft");
                                expect(results[3].o.value).toBe("William");

                                expect(results[4].s.value).toBe("http://example/president42");
                                expect(results[5].s.value).toBe("http://example/president42");
                                expect(results[4].o.value).toBe("Clinton");
                                expect(results[5].o.value).toBe("William");

                                done();

                            })
                        });
                });
            });
        });
    });

    it("Test ModifyOnlyInsert", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/addresses> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                        <http://example/president42> foaf:givenName "Bill" .\
                                        <http://example/president42> foaf:familyName "Clinton" .\
                                   } \
                               }', function(){
                    engine.execute("PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                              WITH <http://example/addresses_bis>\
                              INSERT { ?person foaf:givenName 'William' }\
                              USING <http://example/addresses>\
                              WHERE  { ?person foaf:givenName 'Bill' }",
                        function(err, result){
                            engine.execute("PREFIX foaf:<http://xmlns.com/foaf/0.1/>\
                              SELECT * FROM <http://example/addresses_bis> \
                              { ?s ?p ?o }\
                              ORDER BY ?s ?p", function(err, results){
                                expect(results[0].s.value).toBe("http://example/president25");
                                expect(results[0].o.value).toBe("William");

                                expect(results[1].s.value).toBe("http://example/president27");
                                expect(results[1].o.value).toBe("William");

                                expect(results[2].s.value).toBe("http://example/president42");
                                expect(results[2].o.value).toBe("William");

                                done();

                            })
                        });
                });
            });
        });
    });



    it("Test ModifyOnlyDelete", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/addresses> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                        <http://example/president42> foaf:givenName "Bill" .\
                                        <http://example/president42> foaf:familyName "Clinton" .\
                                   } \
                               }', function(result){
                    engine.execute("PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                              WITH <http://example/addresses>\
                              DELETE { ?person foaf:givenName 'Bill' }\
                              USING <http://example/addresses>\
                              WHERE  { ?person foaf:givenName 'Bill' }",
                        function(err, result){
                            engine.execute("PREFIX foaf:<http://xmlns.com/foaf/0.1/>\
                              SELECT * FROM <http://example/addresses> \
                              { ?s ?p ?o }\
                              ORDER BY ?s ?p", function(err, results){
                                expect(results.length).toBe(3);
                                done();

                            })
                        });
                });
            });
        });
    });

    it("Test AliasedVar", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 9 .\
                            :s2 :p 2 . }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (?s AS ?t) {  ?s :p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].t.value).toBe("http://example/s1");
                        expect(results[1].t.value).toBe("http://example/s2");
                        done();
                    });
                });
            });
        });
    });

    it("Test ClearGraph1", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                        engine.execute("CLEAR GRAPH <http://example/president27>", function(err, results){
                            engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                expect(results.length).toBe(0);

                                engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                    expect(results.length).toBe(2);
                                    done();

                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test ClearGraph2", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                                 INSERT DATA { \
                                      <http://example/president22> foaf:givenName "Grover" .\
                                      <http://example/president22> foaf:familyName "Cleveland" .\
                                 }', function(err, result){
                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                        engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                            engine.execute("CLEAR DEFAULT", function(err, results){
                                engine.execute("SELECT *  { ?s ?p ?o } ", function(err, results) {

                                    expect(results.length).toBe(0);

                                    engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                        expect(results.length).toBe(2);

                                        engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                            expect(results.length).toBe(2);
                                            done();

                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test ClearGraph3", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                                 INSERT DATA { \
                                      <http://example/president22> foaf:givenName "Grover" .\
                                      <http://example/president22> foaf:familyName "Cleveland" .\
                                 }', function(err, result){
                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                        engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                            engine.execute("CLEAR NAMED", function(err, results){
                                engine.execute("SELECT *  { ?s ?p ?o } ", function(err, results) {

                                    expect(results);
                                    expect(results.length).toBe(2);

                                    engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                        expect(results.length).toBe(0);

                                        engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                            expect(results.length).toBe(0);
                                            done();

                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test ClearGraph4", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                                 INSERT DATA { \
                                      <http://example/president22> foaf:givenName "Grover" .\
                                      <http://example/president22> foaf:familyName "Cleveland" .\
                                 }', function(err, result){
                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                        engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                            engine.execute("CLEAR ALL", function(err, results){
                                engine.execute("SELECT *  { ?s ?p ?o } ", function(err, results) {
                                    expect(results);
                                    expect(results.length).toBe(0);

                                    engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {
                                        expect(results.length).toBe(0);

                                        engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {
                                            expect(results.length).toBe(0);
                                            engine.lexicon.registeredGraphs(true,function(graphs){
                                                expect(graphs.length).toBe(0);
                                                done();
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });


    it("Test Create", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('CREATE GRAPH <a>', function(err, result){
                    expect(err).toBe(null);
                    expect(result).toBe(true);

                    done();
                });

            })
        });
    });

    it("Test Drop1", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                        engine.execute("DROP GRAPH <http://example/president27>", function(err, results){
                            engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                expect(results.length).toBe(0);

                                engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                    expect(results.length).toBe(2);
                                    done();

                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test Drop2", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                                 INSERT DATA { \
                                      <http://example/president22> foaf:givenName "Grover" .\
                                      <http://example/president22> foaf:familyName "Cleveland" .\
                                 }', function(err, result){
                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                        engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                            engine.execute("DROP DEFAULT", function(err, results){
                                engine.execute("SELECT *  { ?s ?p ?o } ", function(err, results) {

                                    expect(results.length).toBe(0);

                                    engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                        expect(results.length).toBe(2);

                                        engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                            expect(results.length).toBe(2);
                                            done();

                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test Drop3", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                                 INSERT DATA { \
                                      <http://example/president22> foaf:givenName "Grover" .\
                                      <http://example/president22> foaf:familyName "Cleveland" .\
                                 }', function(err, result){
                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                        engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                            engine.execute("DROP NAMED", function(err, results){
                                engine.execute("SELECT *  { ?s ?p ?o } ", function(err, results) {

                                    expect(results);
                                    expect(results.length).toBe(2);

                                    engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                        expect(results.length).toBe(0);

                                        engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                            expect(results.length).toBe(0);
                                            done();

                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test Drop4", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                                 INSERT DATA { \
                                      <http://example/president22> foaf:givenName "Grover" .\
                                      <http://example/president22> foaf:familyName "Cleveland" .\
                                 }', function(err, result){
                    engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president25> \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                   } \
                               }', function(result){

                        engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA {  GRAPH <http://example/president27> \
                                   { \
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                   } \
                               }', function(result){

                            engine.execute("DROP ALL", function(err, results){
                                engine.execute("SELECT *  { ?s ?p ?o } ", function(err, results) {

                                    expect(results);
                                    expect(results.length).toBe(0);

                                    engine.execute("SELECT * { GRAPH <http://example/president27> { ?s ?p ?o } }", function(err, results) {

                                        expect(results.length).toBe(0);

                                        engine.execute("SELECT * { GRAPH <http://example/president25> { ?s ?p ?o } }", function(err, results) {

                                            expect(results.length).toBe(0);
                                            engine.lexicon.registeredGraphs(true, function(graphs){
                                                expect(graphs.length).toBe(0);
                                                done();
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test DeleteWhere1", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                               INSERT DATA \
                                   { \
                                        <http://example/president25> foaf:givenName "Bill" .\
                                        <http://example/president25> foaf:familyName "McKinley" .\
                                        <http://example/president27> foaf:givenName "Bill" .\
                                        <http://example/president27> foaf:familyName "Taft" .\
                                        <http://example/president42> foaf:givenName "Bill" .\
                                        <http://example/president42> foaf:familyName "Clinton" .\
                                   }', function(result){
                    engine.execute("PREFIX foaf:  <http://xmlns.com/foaf/0.1/>\
                              DELETE WHERE  { ?person foaf:givenName 'Bill'}", function(err, result){
                        engine.execute("PREFIX foaf:<http://xmlns.com/foaf/0.1/>\
                              SELECT *  \
                              { ?s ?p ?o }\
                              ORDER BY ?s ?p", function(err, results){
                            expect(results.length).toBe(3);
                            done();

                        });
                    });
                });
            });
        });
    });

    it("Test GroupMax1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 9 .\
                            :s2 :p 2 .\
                            :s2 :p 0 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (MAX(?v) AS ?maxv) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].maxv.value).toBe('9');
                        expect(results[1].maxv.value).toBe('2');
                        done();
                    });
                });
            });
        });
    });


    it("Test GroupMin1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 9 .\
                            :s2 :p 2 .\
                            :s2 :p 0 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (MIN(?v) AS ?maxv) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].maxv.value).toBe('1');
                        expect(results[1].maxv.value).toBe('0');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupCount1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 9 .\
                            :s1 :v 9 .\
                            :s2 :p 2 .\
                            :s2 :p 0 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?v) AS ?count) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].count.value).toBe('3');
                        expect(results[1].count.value).toBe('2');

                        done();
                    });
                });
            });
        });
    });

    it("Test GroupCountDistinct1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 9 .\
                            :s1 :v 9 .\
                            :s2 :p 2 .\
                            :s2 :p 0 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT( distinct ?v) AS ?count) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].count.value).toBe('2')
                        expect(results[1].count.value).toBe('2')

                        done();
                    });
                });
            });
        });
    });

    it("Test GroupAvg1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 3 .\
                            :s1 :v 3 .\
                            :s2 :p 1 .\
                            :s2 :p 11 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (AVG( distinct ?v) AS ?avg) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].avg.value).toBe('2');
                        expect(results[1].avg.value).toBe('6');

                        done();
                    });
                });
            });
        });
    });

    it("Test GroupAvg2", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 2 .\
                            :s1 :q 3 .\
                            :s2 :p 1 .\
                            :s2 :p 11 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (AVG(?v) AS ?avg) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].avg.value).toBe('2.5');
                        expect(results[1].avg.value).toBe('6');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupSum1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s1 :q 3 .\
                            :s1 :v 3 .\
                            :s2 :p 1 .\
                            :s2 :p 11 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (SUM( distinct ?v) AS ?avg) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].avg.value).toBe('4');
                        expect(results[1].avg.value).toBe('12');

                        done();
                    });
                });
            });
        });
    });

    it("Test GroupSum2", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 2 .\
                            :s1 :q 3.5 .\
                            :s2 :p 1 .\
                            :s2 :p 11 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (SUM(?v) AS ?avg) {  ?s ?p ?v . } GROUP BY ?s', function(err, results){
                        expect(results.length).toBe(2);
                        expect(results[0].avg.value).toBe('5.5');
                        expect(results[1].avg.value).toBe('12');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupByFunctionCall", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 .\
                            :s3 :p 2 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s) AS ?count) {  ?s :p ?v . } GROUP BY STR(?v)', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(2);
                        var counts = [results[0].count.value, results[1].count.value].sort();
                        expect(counts).toEqual(['1', '2']);
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupByFunctionCallFirstSolutionError", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                // LANG() of an IRI is an error. With this data an IRI solution comes first,
                // and it must not drop the clause from the group key
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :a :p <http://example/iri1> .\
                            :e :p <http://example/iri2> .\
                            :b :p "x"@en .\
                            :c :p "y"@fr .\
                            :d :p "z"@fr }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s) AS ?count) {  ?s :p ?v . } GROUP BY LANG(?v)', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(2);
                        var counts = [results[0].count.value, results[1].count.value].sort();
                        expect(counts).toEqual(['1', '2']);
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupByKeysDoNotCollide", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :e :q "a" .\
                            :e :r "bc" .\
                            :f :q "ab" .\
                            :f :r "c" }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s) AS ?count) {  ?s :q ?a . ?s :r ?b . } GROUP BY STR(?a) STR(?b)', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(2);
                        expect(results[0].count.value).toBe('1');
                        expect(results[1].count.value).toBe('1');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupByAliasedExpression", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 .\
                            :s3 :p 2 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?key (COUNT(?s) AS ?count) {  ?s :p ?v . } GROUP BY (STR(?v) AS ?key)', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(2);
                        var counts = {};
                        for(var i=0; i<results.length; i++) {
                            counts[results[i].key.value] = results[i].count.value;
                        }
                        expect(counts).toEqual({'1': '1', '2': '2'});
                        done();
                    });
                });
            });
        });
    });

    it("Test AggregatesWithoutGroupBy", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 .\
                            :s3 :p 3 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s) AS ?count) (SUM(?v) AS ?sum) (GROUP_CONCAT(?v) AS ?all) {  ?s :p ?v . }', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(1);
                        expect(results[0].count.value).toBe('3');
                        expect(results[0].sum.value).toBe('6');
                        expect(results[0].all.value.split(' ').sort()).toEqual(['1', '2', '3']);

                        // over no solutions, as defined by SPARQL 1.1
                        engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s) AS ?count) (SUM(?v) AS ?sum) (AVG(?v) AS ?avg) (GROUP_CONCAT(?v) AS ?all) (MAX(?v) AS ?max) {  ?s :none ?v . }', function(err, results){
                            expect(err).toBeNull();
                            expect(results.length).toBe(1);
                            expect(results[0].count.value).toBe('0');
                            expect(results[0].sum.value).toBe('0');
                            expect(results[0].avg.value).toBe('0');
                            expect(results[0].all.value).toBe('');
                            expect(results[0].max).toBeNull();
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test GroupByBracketedExpressionWithoutAlias", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 .\
                            :s3 :p 2 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s) AS ?count) {  ?s :p ?v . } GROUP BY (STR(?v))', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(2);
                        var counts = [results[0].count.value, results[1].count.value].sort();
                        expect(counts).toEqual(['1', '2']);
                        done();
                    });
                });
            });
        });
    });

    it("Test AggregateWithUngroupedVariable", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 }";

                engine.execute(query, function(err, result){
                    // ?s is neither grouped nor aggregated, so the query is invalid
                    engine.execute('PREFIX : <http://example/> SELECT ?s (COUNT(?v) AS ?count) {  ?s :p ?v . }', function(err, results){
                        expect(err).not.toBeNull();
                        expect(err.message).toBe('Incompatible Group and Projection variables');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupByWithSolutionModifiers", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 .\
                            :s3 :p 3 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s (COUNT(?v) AS ?count) {  ?s :p ?v . } GROUP BY ?s LIMIT 1', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(1);
                        engine.execute('PREFIX : <http://example/> SELECT ?s (COUNT(?v) AS ?count) {  ?s :p ?v . } GROUP BY ?s OFFSET 1', function(err, results){
                            expect(err).toBeNull();
                            expect(results.length).toBe(2);
                            engine.execute('PREFIX : <http://example/> SELECT DISTINCT (COUNT(?v) AS ?count) {  ?s :p ?v . } GROUP BY ?s', function(err, results){
                                expect(err).toBeNull();
                                expect(results.length).toBe(1);
                                expect(results[0].count.value).toBe('1');
                                engine.execute('PREFIX : <http://example/> SELECT (COUNT(?v) AS ?count) {  ?s :p ?v . } LIMIT 0', function(err, results){
                                    expect(err).toBeNull();
                                    expect(results.length).toBe(0);
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    // Classes with 3, 1, 2, 10 and 9 instances: the groups don't come out in count order, and 10 vs. 9
    // checks that counts compare as numbers.
    var groupCountData = function() {
        var counts = {C2: 3, C1: 1, C3: 2, C4: 10, C5: 9};
        var triples = [];
        for(var c in counts) {
            for(var i=0; i<counts[c]; i++) {
                triples.push(':' + c + '_' + i + ' a :' + c + ' .');
            }
        }
        return 'PREFIX : <http://example/> INSERT DATA { ' + triples.join(' ') + ' }';
    };

    // "class=count" strings in result order
    var classCounts = function(results) {
        return results.map(function(result) {
            return result['class'].value.replace("http://example/", "") + "=" + result.count.value;
        });
    };

    it("Test GroupByOrderBy", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var select = 'PREFIX : <http://example/> SELECT ?class (COUNT(?s) AS ?count) { ?s a ?class } GROUP BY ?class ';

                engine.execute(groupCountData(), function(err, result){
                    engine.execute(select + 'ORDER BY ?count', function(err, results){
                        expect(err).toBeNull();
                        expect(classCounts(results)).toEqual(["C1=1", "C3=2", "C2=3", "C5=9", "C4=10"]);
                        engine.execute(select + 'ORDER BY DESC(?count)', function(err, results){
                            expect(err).toBeNull();
                            expect(classCounts(results)).toEqual(["C4=10", "C5=9", "C2=3", "C3=2", "C1=1"]);
                            engine.execute(select + 'ORDER BY DESC(?class)', function(err, results){
                                expect(err).toBeNull();
                                expect(classCounts(results)).toEqual(["C5=9", "C4=10", "C3=2", "C2=3", "C1=1"]);
                                // an aggregate that is not projected
                                engine.execute('PREFIX : <http://example/> SELECT ?class { ?s a ?class } GROUP BY ?class ORDER BY DESC(COUNT(?s))', function(err, results){
                                    expect(err).toBeNull();
                                    expect(results.map(function(r) { return r['class'].value.replace("http://example/", ""); }))
                                        .toEqual(["C4", "C5", "C2", "C3", "C1"]);
                                    engine.execute(select + 'ORDER BY ?count LIMIT 2', function(err, results){
                                        expect(err).toBeNull();
                                        expect(classCounts(results)).toEqual(["C1=1", "C3=2"]);
                                        done();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test GroupByHaving", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var select = 'PREFIX : <http://example/> SELECT ?class (COUNT(?s) AS ?count) { ?s a ?class } GROUP BY ?class ';

                engine.execute(groupCountData(), function(err, result){
                    engine.execute(select + 'HAVING (COUNT(?s) > 2) ORDER BY ?count', function(err, results){
                        expect(err).toBeNull();
                        expect(classCounts(results)).toEqual(["C2=3", "C5=9", "C4=10"]);
                        // the SELECT alias, several conditions, lower case
                        engine.execute(select + 'having (?count > 1) (?count < 10) ORDER BY DESC(?count)', function(err, results){
                            expect(err).toBeNull();
                            expect(classCounts(results)).toEqual(["C5=9", "C2=3", "C3=2"]);
                            // a group variable
                            engine.execute(select + 'HAVING (?class = :C3 || ?class = :C1) ORDER BY ?count LIMIT 1', function(err, results){
                                expect(err).toBeNull();
                                expect(classCounts(results)).toEqual(["C1=1"]);
                                // without GROUP BY: one group over all solutions
                                engine.execute('PREFIX : <http://example/> SELECT (COUNT(*) AS ?c) { ?s a ?class } HAVING (COUNT(*) > 100)', function(err, results){
                                    expect(err).toBeNull();
                                    expect(results.length).toBe(0);
                                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(*) AS ?c) { ?s a ?class } HAVING (COUNT(*) > 20)', function(err, results){
                                        expect(err).toBeNull();
                                        expect(results.length).toBe(1);
                                        expect(results[0].c.value).toBe('25');
                                        done();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test GroupByInvalidQueries", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute(groupCountData(), function(err, result){
                    // SELECT * can't be grouped
                    engine.execute('PREFIX : <http://example/> SELECT * { ?s a ?class } GROUP BY ?class', function(err, results){
                        expect(err.message).toBe("Incompatible Group and Projection variables");
                        // an aggregate in ORDER BY groups the solutions, so ?class must be grouped
                        engine.execute('PREFIX : <http://example/> SELECT ?class { ?s a ?class } ORDER BY DESC(COUNT(?s))', function(err, results){
                            expect(err.message).toBe("Incompatible Group and Projection variables");
                            // ?s is neither grouped nor aggregated
                            engine.execute('PREFIX : <http://example/> SELECT ?class { ?s a ?class } GROUP BY ?class HAVING (BOUND(?s))', function(err, results){
                                expect(err.message).toBe("Variable ?s is neither grouped nor aggregated");
                                engine.execute('PREFIX : <http://example/> SELECT ?class { ?s a ?class } GROUP BY ?class ORDER BY ?s', function(err, results){
                                    expect(err.message).toBe("Variable ?s is neither grouped nor aggregated");
                                    engine.execute('PREFIX : <http://example/> CONSTRUCT { ?class a ?class } WHERE { ?s a ?class } GROUP BY ?class HAVING (COUNT(?s) > 100)', function(err, results){
                                        expect(err.name).toBe('NonSupportedSparqlFeatureError');
                                        engine.execute('PREFIX : <http://example/> CONSTRUCT { ?class a ?class } WHERE { ?s a ?class } GROUP BY ?class', function(err, results){
                                            expect(err.name).toBe('NonSupportedSparqlFeatureError');
                                            done();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test GroupByAggregatesInsideExpressions", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute(groupCountData(), function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?class ((COUNT(?s) * 2) AS ?double) { ?s a ?class } GROUP BY ?class HAVING (COUNT(?s) * 2 > 5) ORDER BY ?double', function(err, results){
                        expect(err).toBeNull();
                        expect(results.map(function(r) { return r['class'].value.replace("http://example/", "") + "=" + r['double'].value; }))
                            .toEqual(["C2=6", "C5=18", "C4=20"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupByAggregateNamesDoNotCollide", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute(groupCountData(), function(err, result){
                    // a user variable named like an internal one keeps its own value
                    engine.execute('PREFIX : <http://example/> SELECT ?class (COUNT(?s) AS ?__aggregate0) { ?s a ?class } GROUP BY ?class HAVING (MAX(STR(?s)) != "") ORDER BY ?__aggregate0 LIMIT 2', function(err, results){
                        expect(err).toBeNull();
                        expect(results.map(function(r) { return r.__aggregate0.value; })).toEqual(['1', '2']);
                        done();
                    });
                });
            });
        });
    });

    it("Test AggregateInsideExpression", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = "PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p 1 .\
                            :s2 :p 2 }";

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (COUNT(?s)*2 AS ?double) {  ?s :p ?v . }', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(1);
                        expect(results[0]['double'].value).toBe('4');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupConcat1", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p "1" .\
                            :s1 :p "22" .\
                            :s2 :p "3" }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s (GROUP_CONCAT(?o) AS ?concat) {  ?s :p ?o . } GROUP BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(2);
                        var concats = {};
                        for(var i=0; i<results.length; i++) {
                            concats[results[i].s.value] = results[i].concat;
                        }
                        expect(concats['http://example/s1'].value.split(' ').sort()).toEqual(['1', '22']);
                        expect(concats['http://example/s1'].type).toBeNull();
                        expect(concats['http://example/s2'].value).toBe('3');
                        done();
                    });
                });
            });
        });
    });

    it("Test GroupConcat2", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p "1" .\
                            :s1 :p "22" .\
                            :s1 :p "333" }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (GROUP_CONCAT(?o ; SEPARATOR="|") AS ?concat) {  ?s :p ?o . } GROUP BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(1);
                        expect(results[0].concat.value.split('|').sort()).toEqual(['1', '22', '333']);
                        // keywords are case-insensitive
                        engine.execute('PREFIX : <http://example/> SELECT (group_concat(?o ; Separator=",") AS ?concat) {  ?s :p ?o . } GROUP BY ?s', function(err, results){
                            expect(err).toBeNull();
                            expect(results[0].concat.value.split(',').sort()).toEqual(['1', '22', '333']);
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test GroupConcatDistinct", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/>\
                            INSERT DATA {\
                            :s1 :p "a" .\
                            :s1 :q "a" .\
                            :s1 :p "b" }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT (GROUP_CONCAT(?o) AS ?all) (GROUP_CONCAT(DISTINCT ?o) AS ?distinct) {  ?s ?p ?o . } GROUP BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(results.length).toBe(1);
                        expect(results[0].all.value.split(' ').sort()).toEqual(['a', 'a', 'b']);
                        expect(results[0].distinct.value.split(' ').sort()).toEqual(['a', 'b']);
                        done();
                    });
                });
            });
        });
    });

    it("Test DisjointUnion", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 15}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                var query = 'PREFIX ex:  <http://www.w3.org/2009/sparql/docs/tests/data-sparql11/negation#> \
                            PREFIX dc:  <http://purl.org/dc/elements/1.1/>\
                            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> \
                            INSERT DATA { ex:a ex:p ex:o . ex:d ex:q ex:o2 . }';

                engine.execute(query, function(err, result){
                    var query = 'PREFIX ex:  <http://www.w3.org/2009/sparql/docs/tests/data-sparql11/negation#> \
                                PREFIX dc:  <http://purl.org/dc/elements/1.1/>\
                                SELECT ?a ?b { { ?a ex:p ?o1 } UNION { ?b ex:q ?o2 } }';

                    engine.execute(query, function(err, results){
                        expect(results.length).toBe(2);
                        if(results[0].a == null) {
                            expect(results[0].b.value).toBe('http://www.w3.org/2009/sparql/docs/tests/data-sparql11/negation#d')
                            expect(results[1].a.value).toBe('http://www.w3.org/2009/sparql/docs/tests/data-sparql11/negation#a')
                            expect(results[1].b == null);
                        } else if(results[0].b == null) {
                            expect(results[0].a.value).toBe('http://www.w3.org/2009/sparql/docs/tests/data-sparql11/negation#a')
                            expect(results[1].b.value).toBe('http://www.w3.org/2009/sparql/docs/tests/data-sparql11/negation#d')
                            expect(results[1].a == null);
                        } else {
                            expect(false);
                        }
                        done();
                    });
                });
            });
        });
    });


    // "local name=value^^type" (type only for typed literals, "-" for unbound) for the given variables, in result order
    var termRows = function(results, vars) {
        return results.map(function(result) {
            return vars.map(function(v) {
                var term = result[v];
                if(term == null) {
                    return v + "=-";
                }
                return v + "=" + String(term.value).replace("http://example/", "") + (term.type ? "^^" + term.type.replace(/.*#/, "") : "");
            }).join(" ");
        });
    };

    it("Test ProjectedExpressions", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/> INSERT DATA { :a :p "x"@en . :b :p 2 . :c :p :u }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s (STR(?v) AS ?x) (?v AS ?y) { ?s :p ?v } ORDER BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["s", "x", "y"])).toEqual(["s=a x=x y=x", "s=b x=2 y=2^^integer", "s=c x=u y=u"]);
                        // an error leaves the variable unbound and keeps the solution
                        engine.execute('PREFIX : <http://example/> SELECT ?s (LANG(?v) AS ?x) (-?v AS ?z) { ?s :p ?v } ORDER BY ?s', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results, ["s", "x", "z"])).toEqual([
                                "s=a x=en z=-",
                                "s=b x= z=-2^^integer",
                                "s=c x=- z=-"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test ArithmeticResults", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/> INSERT DATA { :b :p 2 . :c :p :u }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?x ?y ?z { ?s :p ?v BIND(?v + 1 AS ?x) BIND(1/"a" AS ?y) BIND(!(1/"a") AS ?z) } ORDER BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["s", "x", "y", "z"])).toEqual(["s=b x=3^^integer y=- z=-", "s=c x=- y=- z=-"]);
                        expect(typeof results[0].x.value).toBe("string");
                        engine.execute('PREFIX : <http://example/> SELECT ?s (?v / 4 AS ?x) (?v / 0 AS ?y) { ?s :p ?v } ORDER BY ?s', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results, ["s", "x", "y"])).toEqual(["s=b x=0.5^^decimal y=-", "s=c x=- y=-"]);
                            // error || true is true
                            engine.execute('PREFIX : <http://example/> SELECT ?s { ?s :p ?v FILTER(?v + 1 > 2 || true) } ORDER BY ?s', function(err, results){
                                expect(err).toBeNull();
                                expect(termRows(results, ["s"])).toEqual(["s=b", "s=c"]);
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test ComputedLiteralForms", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/> INSERT DATA { :b :p 2 . :c :p 3 }';
                var xsd = 'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> ';

                engine.execute(query, function(err, result){
                    // a computed INF is read back as infinity
                    engine.execute(xsd + 'PREFIX : <http://example/> SELECT ?s ?x ?y { ?s :p ?v BIND(?v / "0"^^xsd:double AS ?x) BIND(?x + 1 AS ?y) FILTER(?x > 1) } ORDER BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["s", "x", "y"])).toEqual(["s=b x=INF^^double y=INF^^double", "s=c x=INF^^double y=INF^^double"]);
                        // a large integer keeps its digits
                        engine.execute('PREFIX : <http://example/> SELECT ?x ?y { :b :p ?v BIND(10000000000 * 10000000000 * 10 AS ?x) BIND(?x + ?v AS ?y) }', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results, ["x", "y"])).toEqual(["x=1000000000000000000000^^integer y=1000000000000000000000^^integer"]);
                            // the same form from an aggregate
                            engine.execute(xsd + 'PREFIX : <http://example/> SELECT (SUM(?v) / "0"^^xsd:double AS ?a) { ?s :p ?v } HAVING (?a > 1)', function(err, results){
                                expect(err).toBeNull();
                                expect(termRows(results, ["a"])).toEqual(["a=INF^^double"]);
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test OrderByProjectedExpression", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/> INSERT DATA { :b :p 2 . :c :p 3 . :d :p :u }';

                engine.execute(query, function(err, result){
                    engine.execute('PREFIX : <http://example/> SELECT ?s (?v * 2 AS ?d) { ?s :p ?v } ORDER BY DESC(?d) LIMIT 2', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["s", "d"])).toEqual(["s=c d=6^^integer", "s=b d=4^^integer"]);
                        // the effective boolean value of an IRI is an error, and so is its negation
                        engine.execute('PREFIX : <http://example/> SELECT ?s { ?s :p ?v FILTER(!?v) }', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results, ["s"])).toEqual([]);
                            // AVG of values that are no numbers is unbound, AVG of no values is 0
                            engine.execute('PREFIX : <http://example/> SELECT ?s (AVG(?v) AS ?a) { ?s :p ?v } GROUP BY ?s ORDER BY ?s', function(err, results){
                                expect(err).toBeNull();
                                expect(termRows(results, ["s", "a"])).toEqual(["s=b a=2^^decimal", "s=c a=3^^decimal", "s=d a=-"]);
                                engine.execute('PREFIX : <http://example/> SELECT (AVG(?v) AS ?a) { ?s :nothing ?v }', function(err, results){
                                    expect(err).toBeNull();
                                    expect(termRows(results, ["a"])).toEqual(["a=0^^integer"]);
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it("Test DoubleLiterals", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX : <http://example/> INSERT DATA { :a :p 2e1 . :b :p 1.0e0 }', function(err, result){
                    expect(err).toBeNull();
                    engine.execute('PREFIX : <http://example/> SELECT ?s ?v (?v + 1e0 AS ?x) { ?s :p ?v } ORDER BY ?s', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["s", "v", "x"])).toEqual(["s=a v=2e1^^double x=21^^double", "s=b v=1.0e0^^double x=2^^double"]);
                        engine.execute('PREFIX : <http://example/> SELECT ?s { ?s :p 1.0e0 }', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results, ["s"])).toEqual(["s=b"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test MixedCaseKeywords", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('prefix : <http://example/> insert data { :b :p 2 . :c :p 3 . :c :q 4 }', function(err, result){
                    expect(err).toBeNull();
                    engine.execute('Prefix : <http://example/> Select Distinct ?s (Count(?v) As ?n) Where { ?s :p ?v Optional { ?s :q ?w } Filter(?v > 1) } Group By ?s Having (Count(?v) > 0) Order By Desc(?s) Limit 5', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["s", "n"])).toEqual(["s=c n=1^^integer", "s=b n=1^^integer"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test UnsupportedPropertyPaths", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var patterns = ['?s :p* ?o', '?s :p+ ?o', '?s :p? ?o', '?s :p{2} ?o', '?s !:p ?o', '?s ^:p ?o', '?s :p|:q ?o',
                    // a modifier on a group
                    '?s (:p/:p)* ?o', '?s (:p/:p)? ?o', '?s (:p|:q)+ ?o',
                    // inside EXISTS
                    '?s :p ?o FILTER EXISTS { ?o :p+ ?x }', '?s :p ?o FILTER NOT EXISTS { ?o :p* ?x }'];

                engine.execute('PREFIX : <http://example/> INSERT DATA { :a :p :b . :b :p :c }', function(err, result){
                    expect(err).toBeNull();
                    async.eachSeries(patterns, function(pattern, k) {
                        engine.execute('PREFIX : <http://example/> SELECT ?s ?o { ' + pattern + ' }', function(err, results){
                            expect(pattern + ": " + (err == null ? "no error" : err.name)).toBe(pattern + ': NonSupportedSparqlFeatureError');
                            k();
                        });
                    }, function() {
                        // sequences, also with groups, are supported
                        engine.execute('PREFIX : <http://example/> SELECT ?s ?o { ?s :p/(:p) ?o }', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results || [], ["s", "o"])).toEqual(["s=a o=c"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    it("Test InWithIris", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});

                engine.execute('PREFIX : <http://example/> INSERT DATA { :a :p :b . :a :p :c . :a :p :d . :a :p 2 }', function(err, result){
                    expect(err).toBeNull();
                    engine.execute('PREFIX : <http://example/> SELECT ?o { ?s :p ?o FILTER(?o IN (:b, :c, 2)) } ORDER BY ?o', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["o"])).toEqual(["o=b", "o=c", "o=2^^integer"]);
                        engine.execute('PREFIX : <http://example/> SELECT ?o { ?s :p ?o FILTER(?o not in (:b, :c)) } ORDER BY ?o', function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results, ["o"])).toEqual(["o=d", "o=2^^integer"]);
                            done();
                        });
                    });
                });
            });
        });
    });

    // inserts the data into a new engine, then runs each [query, variables, expected termRows] in order
    var checkQueries = function(data, cases, done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                engine.execute('PREFIX : <http://example/> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> INSERT DATA { ' + data + ' }', function(err, result){
                    expect(err).toBeNull();
                    async.eachSeries(cases, function(testCase, k) {
                        engine.execute('PREFIX : <http://example/> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> ' + testCase[0], function(err, results){
                            expect(err).toBeNull();
                            expect(termRows(results || [], testCase[1])).withContext(testCase[0]).toEqual(testCase[2]);
                            k();
                        });
                    }, function() { done(); });
                });
            });
        });
    };

    var mixedTypes = ':a :v 1 . :b :v 2 . :c :v "x"@en . :e :v "y" . :f :v :iri . :g :v "z"^^:custom . ' +
        ':a :d "2020-01-01"^^xsd:date ; :t "2020-01-01T00:00:00Z"^^xsd:dateTime';

    it("Test RelationalTypeErrors", function(done) {
        checkQueries(mixedTypes, [
            // values that can't be compared with a number give an error, and so does its negation
            ['SELECT ?s { ?s :v ?o FILTER(!(?o > 1)) } ORDER BY ?s', ["s"], ["s=a"]],
            ['SELECT ?s (?o > 1 AS ?gt) { ?s :v ?o } ORDER BY ?s', ["s", "gt"],
                ["s=a gt=false^^boolean", "s=b gt=true^^boolean", "s=c gt=-", "s=e gt=-", "s=f gt=-", "s=g gt=-"]],
            ['SELECT (?d < ?t AS ?lt) (?d = ?t AS ?eq) { :a :d ?d ; :t ?t }', ["lt", "eq"], ["lt=- eq=false^^boolean"]],
            ['SELECT ("a" < "b"^^xsd:string AS ?lt) { :a :v 1 }', ["lt"], ["lt=true^^boolean"]]
        ], done);
    });

    it("Test MixedTypeEquality", function(done) {
        checkQueries(mixedTypes, [
            // literals of different known types are unequal; a literal of an unknown type can't be compared
            ['SELECT ?s { ?s :v ?o FILTER(?o != "y") } ORDER BY ?s', ["s"], ["s=a", "s=b", "s=c", "s=f"]],
            ['SELECT ?s { ?s :v ?o FILTER(?o NOT IN ("y", 2)) } ORDER BY ?s', ["s"], ["s=a", "s=c", "s=f"]],
            // an unbound value can't be compared either
            ['SELECT ?s { ?s :v ?o OPTIONAL { ?s :d ?d } FILTER(?d != "x") }', ["s"], ["s=a"]],
            ['SELECT (1 = "1" AS ?x) (true = 1 AS ?y) ("z"^^:c = 1 AS ?z) ("z"^^:c = "z"^^:d AS ?w) (1 = 1.0 AS ?n) { :a :v 1 }',
                ["x", "y", "z", "w", "n"], ["x=false^^boolean y=false^^boolean z=- w=- n=true^^boolean"]]
        ], done);
    });

    it("Test CountDistinctStar", function(done) {
        checkQueries(':a :p 1 . :a :p 2 . :b :p 1', [
            ['SELECT (COUNT(DISTINCT *) AS ?c) (COUNT(*) AS ?n) { { ?s :p ?o } UNION { ?s :p ?o } }', ["c", "n"], ["c=3^^integer n=6^^integer"]],
            ['SELECT ?s (COUNT(DISTINCT *) AS ?c) { { ?s :p ?o } UNION { ?s :p ?o } } GROUP BY ?s ORDER BY ?s', ["s", "c"],
                ["s=a c=2^^integer", "s=b c=1^^integer"]]
        ], done);
    });

    it("Test SumAvgTypeErrors", function(done) {
        checkQueries(':a :v 1 , 2 , "a" . :b :v 3 , 4 . :c :k 1 ; :n 3 . :d :k 1 ; :n 5 . :e :k 1', [
            // a value that is no number makes SUM and AVG unbound
            ['SELECT ?s (SUM(?o) AS ?sum) (SUM(DISTINCT ?o) AS ?sd) (AVG(?o) AS ?avg) { ?s :v ?o } GROUP BY ?s ORDER BY ?s', ["s", "sum", "sd", "avg"],
                ["s=a sum=- sd=- avg=-", "s=b sum=7^^integer sd=7^^integer avg=3.5^^decimal"]],
            // unbound values are skipped, also by COUNT
            ['SELECT (SUM(?o) AS ?sum) (AVG(?o) AS ?avg) (COUNT(?o) AS ?n) { ?s :k ?k OPTIONAL { ?s :n ?o } }', ["sum", "avg", "n"],
                ["sum=8^^integer avg=4^^decimal n=2^^integer"]],
            // AVG of no values is 0, as for an empty group
            ['SELECT (AVG(?o) AS ?avg) { ?s :k ?k OPTIONAL { ?s :zz ?o } }', ["avg"], ["avg=0^^integer"]]
        ], done);
    });

    it("Test OrderByTypedValues", function(done) {
        checkQueries(':a :s "ab"^^xsd:string , "b" , "a"^^xsd:string . :a :x "foo"^^xsd:date , "2020-01-01"^^xsd:date , "bar"^^xsd:date . :a :b "1"^^xsd:boolean , "false"^^xsd:boolean . ' +
            ':a :t "2020-01-01T10:00:00+05:00"^^xsd:dateTime , "2020-01-01T06:00:00Z"^^xsd:dateTime', [
            // by value, not by lexical form; xsd:string together with simple literals
            ['SELECT ?v { :a :s ?v } ORDER BY ?v', ["v"], ["v=a^^string", "v=ab^^string", "v=b"]],
            // invalid dates by lexical form, whatever the input order
            ['SELECT ?v { :a :x ?v } ORDER BY ?v', ["v"], ["v=2020-01-01^^date", "v=bar^^date", "v=foo^^date"]],
            ['SELECT ?v { :a :b ?v } ORDER BY ?v', ["v"], ["v=false^^boolean", "v=1^^boolean"]],
            ['SELECT ?v { :a :t ?v } ORDER BY ?v', ["v"], ["v=2020-01-01T10:00:00+05:00^^dateTime", "v=2020-01-01T06:00:00Z^^dateTime"]]
        ], done);
    });

    it("Test GroupConcatUnbound", function(done) {
        // an unbound value is skipped (it crashed the process)
        checkQueries(':c :k 1 ; :n "x" . :e :k 1', [
            ['SELECT (GROUP_CONCAT(?o) AS ?g) { ?s :k ?k OPTIONAL { ?s :n ?o } }', ["g"], ["g=x"]]
        ], done);
    });

    it("Test MinMaxMixedTypes", function(done) {
        // MIN and MAX follow the ORDER BY order (IRIs before literals without a datatype before typed literals), whatever the insertion order
        var query = 'SELECT (MIN(?o) AS ?min) (MAX(?o) AS ?max) { ?s :v ?o }';
        checkQueries(':s :v "x"@en , "y" , :iri , 2', [[query, ["min", "max"], ["min=iri max=2^^integer"]]], function() {
            checkQueries(':s :v 2 , :iri , "y" , "x"@en', [[query, ["min", "max"], ["min=iri max=2^^integer"]]], function() {
                checkQueries(':s :v "b" , "a"^^xsd:string', [[query, ["min", "max"], ["min=a^^string max=b"]]], done);
            });
        });
    });

    it("Test ChainedBinds", function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 2}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'PREFIX : <http://example/> INSERT DATA { :b :p 2 }';

                engine.execute(query, function(err, result){
                    // a BIND sees the variables of the BINDs before it
                    engine.execute('PREFIX : <http://example/> SELECT ?x ?y ?z { ?s :p ?v BIND(?v + 1 AS ?x) BIND(?x * 10 AS ?y) BIND(STR(?y) AS ?z) }', function(err, results){
                        expect(err).toBeNull();
                        expect(termRows(results, ["x", "y", "z"])).toEqual(["x=3^^integer y=30^^integer z=30"]);
                        done();
                    });
                });
            });
        });
    });

    it("Test BIND", function(done){
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 15}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                  var query = 'BASE <http://example.org/book/>\
                               PREFIX dc:  <http://purl.org/dc/elements/1.1/> \
                               PREFIX ns:  <http://example.org/ns#>\
                               INSERT DATA {\
                                 <book1>  dc:title     "SPARQL Tutorial" .\
                                 <book1>  ns:price     42 .\
                                 <book1>  ns:discount  0.2 .\
                                 <book2>  dc:title     "The Semantic Web" .\
                                 <book2>  ns:price     23 .\
                                 <book2>  ns:discount  0.25 .\
                               }';

                engine.execute(query, function(err, result){
                    var query = 'PREFIX  dc:  <http://purl.org/dc/elements/1.1/>\
                                 PREFIX  ns:  <http://example.org/ns#>\
                                 SELECT  ?title ?price\
                                 {  ?x ns:price ?p .\
                                    ?x ns:discount ?discount .\
                                    FILTER(?price < 20)\
                                    BIND (?p*(1-?discount) AS ?price)\
                                    ?x dc:title ?title .\
                                 }';

                    engine.execute(query, function(err, results){
                        expect(results.length == 1);
                        expect(results[0].price.value).toBe('17.25');
                        expect(results[0].title.value).toBe("The Semantic Web");
                        done();
                    });
                });
            });
        });
    });
    it('Test FILTER EXISTS', function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 15}, function(backend){
                var engine = new QueryEngine({backend: backend,
                    lexicon: lexicon});
                var query = 'BASE <http://example.org/book/>\
                             PREFIX dc:  <http://purl.org/dc/elements/1.1/> \
                             PREFIX ns:  <http://example.org/ns#>\
                             INSERT DATA {\
                               <book1>  dc:title     "SPARQL Tutorial" .\
                               <book1>  ns:price     42 .\
                               <book1>  ns:discount  0.2 .\
                               <book1>  ns:relatedTo <book2> .\
                               <book2>  dc:title     "The Semantic Web" .\
                               <book2>  ns:price     23 .\
                               <book2>  ns:discount  0.25 .\
                             }';
                engine.execute(query, function(success, result) {
                    var query = 'PREFIX  dc:  <http://purl.org/dc/elements/1.1/>\
                                 PREFIX  ns:  <http://example.org/ns#>\
                                 SELECT  * \
                                 { ?x ns:discount ?discount .\
                                   ?x dc:title ?title .\
                                    FILTER EXISTS { ?x ns:price ?p FILTER (?p = 23) } .\
                                 }';
                    engine.execute(query, function(success, result) {
                        expect(success);
                        expect(result.length).toEqual(1);
                        expect(result[0].title.value).toEqual('The Semantic Web');
                        done();
                    });
                });
            });
        });
    });

    it('Test FILTER EXISTS composition', function(done) {
        new Lexicon(function(lexicon){
            new QuadBackend({treeOrder: 15}, function(backend){
                var engine = new QueryEngine({backend: backend,
                                              lexicon: lexicon});
                var query = 'BASE <http://example.org/book/>\
                          PREFIX dc:  <http://purl.org/dc/elements/1.1/> \
                          PREFIX ns:  <http://example.org/ns#>\
                          INSERT DATA {\
                            <book1>  dc:title     "SPARQL Tutorial" .\
                            <book1>  ns:price     42 .\
                            <book1>  ns:discount  0.2 .\
                            <book1>  ns:relatedTo <book2> .\
                            <book2>  dc:title     "The Semantic Web" .\
                            <book2>  ns:price     23 .\
                            <book2>  ns:discount  0.25 .\
                          }';
                engine.execute(query, function(success, result) {
                    var query = 'PREFIX  dc:  <http://purl.org/dc/elements/1.1/>\
                              PREFIX  ns:  <http://example.org/ns#>\
                              SELECT  * \
                              {  ?x ns:price ?p .\
                                 FILTER (?p = 23 || EXISTS { ?x ns:price 42 })  .\
                              }';
                    engine.execute(query, function(success, result) {
                        expect(success);
                        expect(result.length).toEqual(2);
                        done();
                    });
                });
            });
        });
    });

});
