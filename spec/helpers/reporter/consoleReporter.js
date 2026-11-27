var reporters = require("jasmine-reporters");

var terminalReporter = new reporters.TerminalReporter({
    color: true,
    showStack: true,
    verbosity: 3,
});
jasmine.getEnv().addReporter(terminalReporter);
