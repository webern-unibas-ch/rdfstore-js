var QueryPlan = require("../src/query_plan").QueryPlan;

// Reference implementations: the nested loops that joinBindings and leftOuterJoinBindings used
// before the hash lookup. The hash join must return the same rows in the same order.
var nestedLoopJoin = function(bindingsA, bindingsB) {
    var result = [];
    for(var i=0; i<bindingsA.length; i++) {
        for(var j=0; j<bindingsB.length; j++) {
            if(QueryPlan.areCompatibleBindings(bindingsA[i], bindingsB[j])) {
                result.push(QueryPlan.mergeBindings(bindingsA[i], bindingsB[j]));
            }
        }
    }
    return result;
};

var nestedLoopLeftOuterJoin = function(bindingsA, bindingsB) {
    var result = [];
    for(var i=0; i<bindingsA.length; i++) {
        var bindingA = bindingsA[i];
        var matched = false;
        for(var j=0; j<bindingsB.length; j++) {
            var bindingB = bindingsB[j];
            if(QueryPlan.areCompatibleBindings(bindingA, bindingB)) {
                matched = true;
                result.push(QueryPlan.mergeBindings(bindingA, bindingB));
            }
        }
        if(matched === false) {
            QueryPlan.augmentMissingBindings(bindingA, bindingB);
            result.push(bindingA);
        }
    }
    return result;
};

// Deterministic PRNG (mulberry32), so a failing case can be reproduced.
var makeRandom = function(seed) {
    return function() {
        seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// Two shared objects stand in for BIND results: equal only by reference.
var objA = {token: "literal", value: "a"};
var objB = {token: "literal", value: "a"};
var oddValues = [null, objA, objB, false, "1"];

var randomRows = function(random, vars, count) {
    var rows = [];
    for(var i=0; i<count; i++) {
        var row = {};
        for(var j=0; j<vars.length; j++) {
            var r = random();
            if(r < 0.1) {
                continue; // variable absent
            } else if(r < 0.25) {
                row[vars[j]] = oddValues[Math.floor(random() * oddValues.length)];
            } else {
                row[vars[j]] = Math.floor(random() * 4); // small OID range, includes 0
            }
        }
        rows.push(row);
    }
    return rows;
};

// augmentMissingBindings mutates the left rows, so each implementation gets its own copies.
var copyRows = function(rows) {
    var copies = [];
    for(var i=0; i<rows.length; i++) {
        var copy = {};
        for(var p in rows[i]) {
            copy[p] = rows[i][p];
        }
        copies.push(copy);
    }
    return copies;
};

describe("QueryPlan joins", function() {

    it("Should return the same rows in the same order as the nested loop", function() {
        var random = makeRandom(4711);
        var varSets = [["s", "x"], ["x", "y"], ["x", "y", "z"], ["s"], []];
        for(var n=0; n<3000; n++) {
            var varsA = varSets[Math.floor(random() * varSets.length)];
            var varsB = varSets[Math.floor(random() * varSets.length)];
            var rowsA = randomRows(random, varsA, Math.floor(random() * 8));
            var rowsB = randomRows(random, varsB, Math.floor(random() * 8));

            expect(QueryPlan.joinBindings(copyRows(rowsA), copyRows(rowsB)))
                .toEqual(nestedLoopJoin(copyRows(rowsA), copyRows(rowsB)));
            expect(QueryPlan.leftOuterJoinBindings(copyRows(rowsA), copyRows(rowsB)))
                .toEqual(nestedLoopLeftOuterJoin(copyRows(rowsA), copyRows(rowsB)));
        }
    });

    it("Should left-join 32000 x 16000 bound rows without comparing every pair", function() {
        var left = [];
        var right = [];
        for(var i=0; i<32000; i++) {
            left.push({s: i, o: 100000 + i});
        }
        for(i=0; i<16000; i++) {
            right.push({s: i * 2, x: 200000 + i});
        }

        var start = Date.now();
        var result = QueryPlan.leftOuterJoinBindings(left, right);
        var elapsed = Date.now() - start;

        expect(result.length).toBe(32000);
        expect(result[0]).toEqual({s: 0, o: 100000, x: 200000});
        expect(result[1]).toEqual({s: 1, o: 100001, x: null});
        // the nested loop took about 13 s here
        expect(elapsed).toBeLessThan(2000);
    }, 60000);

});
