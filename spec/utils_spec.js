var Utils = require("../src/utils");

describe("Utils", function () {

    it("Should compute the size of objects", function (done) {
        expect(Utils.size([1,2,3,4])).toBe(4);
        expect(Utils.size({a:1,b:2})).toBe(2);
        done()
    });

    it("Should return the values of an object", function(done){
        var values = Utils.values({a:1,b:'c'});
        expect(values[0]).toBe(1);
        expect(values[1]).toBe('c');
        done();
    })

    it("Should compute parallel computations", function(done) {
        var totals = {};
        Utils.eachParallel([1,2,3,4], function(i,k){
            totals[i] = i;
            k();
        }, function() {
            expect(totals[1]).toBe(1);
            expect(totals[2]).toBe(2);
            expect(totals[3]).toBe(3);
            expect(totals[4]).toBe(4);
            done();
        })
    })

    describe("toPromise", function() {

        it("resolves with the callback's result", async function() {
            var result = await Utils.toPromise(function(cb) { setTimeout(function() { cb(null, 42); }, 0); });
            expect(result).toBe(42);
        });

        it("rejects with the callback's error", async function() {
            var error = new Error("boom");
            await expectAsync(Utils.toPromise(function(cb) { cb(error); })).toBeRejectedWith(error);
        });

        it("rejects a synchronous throw as an Error", async function() {
            var promise = Utils.toPromise(function() { throw "not an Error"; });
            await expectAsync(promise).toBeRejectedWithError(Error, "not an Error");
        });

        it("rethrows a throw after the callback ran instead of swallowing it", async function() {
            var promise;
            expect(function() {
                promise = Utils.toPromise(function(cb) { cb(null, 1); throw new Error("after callback"); });
            }).toThrowError("after callback");
            expect(promise).toBeUndefined();
        });

        it("ignores later calls of the callback", async function() {
            var result = await Utils.toPromise(function(cb) { cb(null, 1); cb(new Error("late")); });
            expect(result).toBe(1);
        });
    });
});