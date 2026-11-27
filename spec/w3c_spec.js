var defineW3CSyntaxSpecs = require("./w3c_suite_helper").defineW3CSyntaxSpecs;

describe("W3C > syntax-query test cases", function () {
    defineW3CSyntaxSpecs("./spec/w3c/syntax-query/manifest.ttl");
});

describe("W3C > syntax-update-1 test cases", function () {
    defineW3CSyntaxSpecs("./spec/w3c/syntax-update-1/manifest.ttl");
});

describe("W3C > syntax-update-2 test cases", function () {
    defineW3CSyntaxSpecs("./spec/w3c/syntax-update-2/manifest.ttl");
});
