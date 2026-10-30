var fs = require("fs");
var path = require("path");
var rdfstore = require("../src/store");

// types/rdfstore.d.ts is hand-written, and `yarn types` only checks it against itself.
// These specs compare its method names with the runtime, so a method added to or removed
// from the store without updating the declarations fails here.

var declarations = fs.readFileSync(path.join(__dirname, "..", "types", "rdfstore.d.ts"), "utf8");

// Method names declared in the body of `header { ... }` (members at four spaces indentation)
var declaredMethods = function(header) {
    var start = declarations.indexOf(header + " {");
    expect(start).not.toBe(-1);
    var body = declarations.slice(start, declarations.indexOf("\n}", start));
    var names = {};
    var re = /^    (?!static |constructor\()(\w+)\s*[<(]/gm;
    var match;
    while((match = re.exec(body)) !== null) {
        names[match[1]] = true;
    }
    return Object.keys(names).sort();
};

describe("TypeScript declarations", function() {

    it("declare every public Store method", function() {
        var runtime = Object.getOwnPropertyNames(rdfstore.Store.prototype).filter(function(name) {
            var descriptor = Object.getOwnPropertyDescriptor(rdfstore.Store.prototype, name);
            return name !== "constructor" && name.charAt(0) !== "_" && typeof descriptor.value === "function";
        }).sort();
        expect(declaredMethods("export declare class Store")).toEqual(runtime);
    });

    it("declare every store.promises method", function(done) {
        rdfstore.create(function(err, store) {
            expect(err).toBe(null);
            expect(declaredMethods("export interface StorePromises")).toEqual(Object.keys(store.promises).sort());
            done();
        });
    });
});
