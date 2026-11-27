import globals from "globals";

// no-undef: ES module builds run in strict mode, where an implicit global
// throws instead of silently landing on `window`. no-redeclare, no-var and
// prefer-const keep each name declared once, block-scoped, and const unless
// it is reassigned.
export default [
    {
        ignores: ["src/parser.js", "src/perftest/"],
    },
    {
        files: ["src/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            "no-undef": "error",
            "no-redeclare": "error",
            "no-var": "error",
            "prefer-const": "error",
            // Unused parameters keep shared callback signatures readable; unused
            // catch bindings belong to the question of swallowed exceptions.
            "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
            // An intentionally empty block (a swallowed exception) says so in a comment.
            "no-empty": "error",
        },
    },
];
