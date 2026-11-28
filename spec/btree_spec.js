var btree = require("../src/btree");
var async = require("async");

var shuffle = function (o) {
    //v1.0
    for (var j, x, i = o.length; i; j = parseInt(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
    return o;
};

describe("BTree", function () {
    it("should find inserted data and walk through it", function (done) {
        async.seq(
            function (_, c) {
                new btree.Tree(2, function (tree) {
                    c(null, tree);
                });
            },
            function (tree, c) {
                async.eachSeries(
                    [11, 2, 14, 15, 1, 7, 5, 8, 4, 6, 3],
                    function (i, cc) {
                        tree.insert(i, i, function () {
                            cc();
                        });
                    },
                    function (e) {
                        c(null, tree);
                    },
                );
            },
            function (tree, c) {
                tree.search(6, function (result) {
                    expect(result).toBe(6);
                    c(null, tree);
                });
            },
            function (tree, c) {
                var found = [];
                var mustFind = [1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15];
                tree.walk(
                    function (n) {
                        found.push(n);
                    },
                    function () {
                        for (var i = 0; i < found.length; i++) {
                            expect("" + found[i].key).toBe("" + mustFind[i]);
                            expect(found[i].data).toBe(mustFind[i]);
                        }
                        expect(found.length).toBe(mustFind.length);
                        c();
                    },
                );
            },
        )(null, function (c) {
            done();
        });
    });

    it("should delete inserted data", function (done) {
        async.seq(
            function (_, c) {
                new btree.Tree(2, function (tree) {
                    c(null, tree);
                });
            },
            function (tree, c) {
                async.eachSeries(
                    [9, 2, 10, 11, 1, 7, 5, 8, 14, 15, 4, 6, 3],
                    function (i, cc) {
                        tree.insert(i, i, function () {
                            cc();
                        });
                    },
                    function (e) {
                        c(null, tree);
                    },
                );
            },
            function (tree, c) {
                tree.search(9, function (result) {
                    expect(result).toBe(9);
                    c(null, tree);
                });
            },
            function (tree, c) {
                var mustFind = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15];
                var found = [];

                tree.walk(
                    function (n) {
                        found.push(n);
                    },
                    function () {
                        for (var i = 0; i < mustFind.length; i++) {
                            expect("" + found[i].key).toBe("" + mustFind[i]);
                            expect(found[i].data).toBe(mustFind[i]);
                        }
                        expect(found.length).toBe(mustFind.length);
                        c(null, tree);
                    },
                );
            },
            function (tree, c) {
                tree.delete(9, function () {
                    c(null, tree);
                });
            },
            function (tree, c) {
                var mustFind = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 14, 15];
                var found = [];

                tree.walk(
                    function (n) {
                        found.push(n);
                    },
                    function () {
                        for (var i = 0; i < mustFind.length; i++) {
                            expect(mustFind[i]).toBe(found[i].data);
                        }
                        c(null, tree);
                    },
                );
            },
            function (tree, c) {
                tree.delete(3, function () {
                    c(null, tree);
                });
            },
            function (tree, c) {
                var mustFind = [1, 2, 4, 5, 6, 7, 8, 10, 11, 14, 15];
                var found = [];

                tree.walk(
                    function (n) {
                        found.push(n);
                    },
                    function () {
                        for (var i = 0; i < mustFind.length; i++) {
                            expect(mustFind[i]).toBe(found[i].data);
                        }

                        c(null, tree);
                    },
                );
            },
            function (tree, c) {
                var mustFind = [1, 2, 4, 5, 6, 7, 8, 10, 11, 14, 15];
                async.eachSeries(
                    mustFind,
                    function (e, cc) {
                        tree.delete(e, function () {
                            cc();
                        });
                    },
                    function () {
                        c(null, tree);
                    },
                );
            },
            function (tree, c) {
                var found = [];
                tree.walk(
                    function (n) {
                        found.push(n);
                    },
                    function () {
                        expect(found.length).toBe(0);
                        c();
                    },
                );
            },
        )(null, function () {
            done();
        });
    });

    it("should insert and delete large collections", function (done) {
        var max = 1;
        var max_data = 10000;
        var i = 0;
        var j = 0;
        var data = [];

        async.whilst(
            function (cb) {
                cb(null, i < max);
            },
            function (c) {
                async.seq(
                    function (_, c) {
                        new btree.Tree(2, function (tree) {
                            c(null, tree);
                        });
                    },
                    function (tree, c) {
                        for (j = 0; j < max_data; j++) {
                            data.push(j);
                        }
                        shuffle(data);
                        j = 0;

                        async.whilst(
                            function (cb) {
                                cb(null, j < max_data);
                            },
                            function (cc) {
                                tree.insert(data[j], data[j], function () {
                                    j++;
                                    cc();
                                });
                            },
                            function () {
                                c(null, tree);
                            },
                        );
                    },
                    function (tree, c) {
                        j = 0;
                        async.whilst(
                            function (cb) {
                                cb(null, j < max_data);
                            },
                            function (cc) {
                                tree.delete(data[j], function () {
                                    j++;
                                    cc();
                                });
                            },
                            function () {
                                var found = [];
                                tree.walk(
                                    function (n) {
                                        found.push(n);
                                    },
                                    function () {
                                        expect(found.length).toBe(0);
                                        c();
                                    },
                                );
                            },
                        );
                    },
                )(null, function () {
                    i++;
                    c();
                });
            },
            function () {
                done();
            },
        );
    });

    it("should update a key", function (done) {
        var tree;
        async.seq(
            function (c) {
                new btree.Tree(2, function (t) {
                    tree = t;
                    c();
                });
            },
            function (c) {
                tree.insert(1, 5, function () {
                    c();
                });
            },
            function (c) {
                tree.search(1, function (val) {
                    expect(val).toBe(5);
                    tree.insert(1, 55, function () {
                        c();
                    });
                });
            },
            function (c) {
                tree.search(1, function (val) {
                    expect(val).toBe(55);
                    c();
                });
            },
        )(function () {
            done();
        });
    });

    [2, 3, 5].forEach(function (order) {
        it(
            "should replace the data of an existing key instead of adding a duplicate (order " + order + ")",
            function (done) {
                var keys = [];
                for (var i = 1; i <= 20; i++) keys.push(i);
                new btree.Tree(order, function (tree) {
                    async.eachSeries(
                        keys,
                        function (key, k) {
                            tree.insert(key, key, function () {
                                k();
                            });
                        },
                        function () {
                            // the keys sit in leaves and in inner nodes
                            async.eachSeries(
                                keys,
                                function (key, k) {
                                    tree.insert(key, key * 10, function () {
                                        k();
                                    });
                                },
                                function () {
                                    var found = [];
                                    tree.walk(
                                        function (node) {
                                            found.push(node);
                                        },
                                        function () {
                                            expect(
                                                found.map(function (node) {
                                                    return node.key;
                                                }),
                                            ).toEqual(keys);
                                            found.forEach(function (node) {
                                                expect(node.data).toBe(node.key * 10);
                                            });
                                            async.eachSeries(
                                                keys,
                                                function (key, k) {
                                                    tree.delete(key, function () {
                                                        k();
                                                    });
                                                },
                                                function () {
                                                    var left = 0;
                                                    tree.walk(
                                                        function () {
                                                            left++;
                                                        },
                                                        function () {
                                                            expect(left).toBe(0);
                                                            done();
                                                        },
                                                    );
                                                },
                                            );
                                        },
                                    );
                                },
                            );
                        },
                    );
                });
            },
        );
    });
});
