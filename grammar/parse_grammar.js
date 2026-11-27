var fs = require("fs");
var peggy = require("peggy");

console.log("Starting parsing grammar");

var grammar = fs.readFileSync("grammar/sparql_query.grammar", "utf8");
var parser = peggy.generate(grammar, { output: "source" });
fs.writeFileSync("src/parser.js", "module.exports = " + parser);

console.log("✅ Finished parsing grammar");
