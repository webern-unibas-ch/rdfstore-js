var QueryPlan = require("../src/query_plan").QueryPlan;

// Reference implementations: nested loops over areCompatibleBindings. The hash join must return the
// same rows in the same order. An unmatched left solution gets every variable of the right side as
// null (the nested loop before the hash join used only the last right solution's variables).
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
            for(j=0; j<bindingsB.length; j++) {
                QueryPlan.augmentMissingBindings(bindingA, bindingsB[j]);
            }
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

// Two shared objects stand in for BIND results: the same RDF term.
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

    it("Should treat an unbound variable as compatible on either side", function() {
        expect(QueryPlan.joinBindings([{x: null}], [{x: 5}])).toEqual([{x: 5}]);
        // a bound value is not overwritten by an unbound one
        expect(QueryPlan.joinBindings([{x: 5}], [{x: null, y: 1}])).toEqual([{x: 5, y: 1}]);
        expect(QueryPlan.leftOuterJoinBindings([{s: 1, x: null}], [{s: 1, x: 7}])).toEqual([{s: 1, x: 7}]);
    });

    it("Should compare values that are no OIDs as RDF terms", function() {
        expect(QueryPlan.joinBindings([{k: objA}], [{k: objB, s: 1}])).toEqual([{k: objB, s: 1}]);
        expect(QueryPlan.joinBindings([{k: objA}], [{k: {token: "literal", value: "a", lang: "en"}}])).toEqual([]);
        expect(QueryPlan.joinBindings([{k: objA}], [{k: 1}])).toEqual([]);
        expect(QueryPlan.joinBindings([{k: {token: "literal", value: "chat", lang: "fr"}}], [{k: {token: "literal", value: "chatfr"}}])).toEqual([]);
    });

    it("Should add every variable of the right side to an unmatched left solution", function() {
        var result = QueryPlan.leftOuterJoinBindings([{s: 1}], [{s: 2, x: 5}, {s: 2, y: 6}]);
        expect(result).toEqual([{s: 1, x: null, y: null}]);
    });

    it("Should compare bound rows only with the rows sharing their key", function() {
        var left = [];
        var right = [];
        for(var i=0; i<2000; i++) {
            left.push({s: i, o: 100000 + i});
        }
        for(i=0; i<1000; i++) {
            right.push({s: i * 2, x: 200000 + i});
        }
        spyOn(QueryPlan, "areCompatibleBindings").and.callThrough();

        var result = QueryPlan.leftOuterJoinBindings(left, right);

        expect(result.length).toBe(2000);
        expect(result[0]).toEqual({s: 0, o: 100000, x: 200000});
        expect(result[1]).toEqual({s: 1, o: 100001, x: null});
        // one candidate per matched left row; a nested loop makes 2000 * 1000 comparisons
        expect(QueryPlan.areCompatibleBindings.calls.count()).toBe(1000);
    });

});
