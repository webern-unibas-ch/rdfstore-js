"use strict";

// imports
const SparqlParser = require("./parser");
const Utils = require("./utils");
const _ = Utils;

function NonSupportedSparqlFeatureError(feature, message) {
    this.name = "NonSupportedSparqlFeatureError";
    this.feature = feature;
    this.message = message || "SPARQL feature "+feature+" non supported";
}
NonSupportedSparqlFeatureError.prototype = new Error();
NonSupportedSparqlFeatureError.constructor = NonSupportedSparqlFeatureError;

function SparqlParserError(message) {
    this.name = "SparqlParserError";
    this.message = message || "Error parsing SPARQL query";
}
SparqlParserError.prototype = new Error();
SparqlParserError.constructor = SparqlParserError;


/**
 * @doc
 *
 * Based on <http://www.w3.org/2001/sw/DataAccess/rq23/rq24-algebra.html>
 * W3C's note
 */
const AbstractQueryTree = function() {
};

AbstractQueryTree.prototype.parseQueryString = function(query_string) {
    const syntaxTree = SparqlParser.parse(query_string);
    // the VALUES block after a query is parsed, but its bindings are not evaluated
    if(syntaxTree.inlineData != null)
        throw new NonSupportedSparqlFeatureError("VALUES", "VALUES is not supported");
    return syntaxTree;
};

AbstractQueryTree.prototype.parseExecutableUnit = function(executableUnit) {
    if(executableUnit.kind === 'select') {
        return this.parseSelect(executableUnit);
    } else if(executableUnit.kind === 'ask') {
        return this.parseSelect(executableUnit);
    } else if(executableUnit.kind === 'modify') {
        return this.parseSelect(executableUnit);
    } else if(executableUnit.kind === 'construct') {
        return this.parseSelect(executableUnit);
    } else if(executableUnit.kind === 'insertdata') {
        return this.parseInsertData(executableUnit);
    } else if(executableUnit.kind === 'deletedata') {
        return this.parseInsertData(executableUnit);
    } else if(executableUnit.kind === 'load') {
        return executableUnit;
    } else if(executableUnit.kind === 'clear') {
        return executableUnit;
    } else if(executableUnit.kind === 'drop') {
        return executableUnit;
    } else if(executableUnit.kind === 'create') {
        return executableUnit;
    } else {
        throw new Error('unknown executable unit: ' + executableUnit.kind);
    }
};

AbstractQueryTree.prototype.parseSelect = function(syntaxTree, graph){

    if(syntaxTree == null) {
        return null;
    } else {
        const env = {};
        syntaxTree.pattern = this.build(syntaxTree.pattern, env, graph);
        // the variable of a GROUP BY or SELECT expression must not be in scope of the pattern or of the
        // expressions before it (SPARQL 1.1 18.2.1)
        const scope = AbstractQueryTree.inScopeVariables(syntaxTree.pattern, {});
        const introduce = function(clause, variable) {
            if(scope[variable.value] === true) {
                throw new SparqlParserError(clause + ": variable ?" + variable.value + " is already in scope");
            }
            scope[variable.value] = true;
        };
        if(Array.isArray(syntaxTree.group)) {
            for(let i=0; i<syntaxTree.group.length; i++) {
                if(syntaxTree.group[i].token === 'aliased_expression') {
                    introduce("GROUP BY", syntaxTree.group[i].alias);
                }
            }
        }
        if(syntaxTree.projection != null) {
            for(let j=0; j<syntaxTree.projection.length; j++) {
                if(syntaxTree.projection[j].kind === 'aliased') {
                    introduce("SELECT", syntaxTree.projection[j].alias);
                }
            }
        }
        return syntaxTree;
    }
};

AbstractQueryTree.prototype.parseInsertData = function(syntaxTree){
    if(syntaxTree == null) {
        return null;
    } else {
        return syntaxTree;
    }
};

// numbers the internal variables (fresh: of property path sequences, graph: of GRAPH ?g); module-wide, because
// EXISTS builds its pattern per solution, and the outer solution it is bound with carries the outer ones
let internalVariableCounter = 0;

/**
 * Builds the algebra expression of a pattern. graph is the active graph (SPARQL 1.1 18.6) the patterns inside
 * GRAPH are matched against: an IRI, or for GRAPH ?g an internal variable that the GRAPH node maps to ?g
 * after its patterns are evaluated, so that ?g itself is not bound inside (W3C graph-variable-scope).
 */
AbstractQueryTree.prototype.build = function(node, env, graph) {
    if(node.token === 'groupgraphpattern') {
        return this._buildGroupGraphPattern(node, env, graph);
    } else if (node.token === 'basicgraphpattern') {
        if(graph != null) {
            for(let i=0; i<node.triplesContext.length; i++) {
                node.triplesContext[i].graph = _.clone(graph, true);
            }
        }
        let bgp = {
            kind: 'BGP',
            value: node.triplesContext
        };
        bgp = AbstractQueryTree.translatePathExpressionsInBGP(bgp, env);
        return bgp;
    } else if (node.token === 'graphunionpattern') {
        const a = this.build(node.value[0], env, graph);
        const b = this.build(node.value[1], env, graph);

        return {
            kind: 'UNION',
            value: [a,b]
        };
    } else if(node.token === 'graphgraphpattern') {
        let internal = null;
        if(node.graph.token === 'var') {
            internal = {token: 'var', value: 'graph:' + internalVariableCounter++};
        }
        // an inner GRAPH sets its own active graph
        const c = this.build(node.value, env, internal || node.graph);
        return {
            kind: 'GRAPH',
            value: c,
            graph: node.graph,
            internal: internal
        };
    } else {
        if(node.token != null) {
            throw new NonSupportedSparqlFeatureError(node.token, "Non implemented SPARQL graph pattern: '" + node.token+"'");
        } else {
            throw new SparqlParserError("Error parsing graph pattern: '"+JSON.stringify(node)+"'");
        }
    }
};

/**
 * Translates the property paths of a basic graph pattern. A path of IRIs, sequences and inverses (`:p/^:q`)
 * becomes triple patterns joined by internal variables (fresh:), which the planner joins like the others. Any
 * other path (with *, +, ?, |) becomes a PATH node, evaluated by PropertyPaths. A basic graph pattern with
 * PATH nodes becomes a BGP_SCOPE with its parts, the triple patterns first: they are joined in order (see
 * QueryEngine.executeBGPScope), and its blank nodes and internal variables are dropped only after the join.
 */
AbstractQueryTree.translatePathExpressionsInBGP = function(bgp, env) {
    const triples = [];
    const paths = [];
    for(let i=0; i<bgp.value.length; i++) {
        const triple = bgp.value[i];
        if(triple.predicate != null && triple.predicate.token === 'path') {
            const path = AbstractQueryTree.normalizePath(triple.predicate);
            if(isPlainPath(path)) {
                expandPlainPath(triple.subject, path, triple.object, triple.graph, triples);
            } else {
                const pathPattern = {kind: 'PATH', subject: triple.subject, path: path, object: triple.object};
                if(triple.graph != null) {
                    pathPattern.graph = triple.graph;
                }
                paths.push(pathPattern);
            }
        } else {
            triples.push(triple);
        }
    }

    if(paths.length === 0) {
        bgp.value = triples;
        return bgp;
    }
    const parts = triples.length > 0 ? [{kind: 'BGP', value: triples, scoped: true}].concat(paths) : paths;
    return {kind: 'BGP_SCOPE', value: parts};
};

/**
 * The path of the parser as a tree of {type: 'link', iri}, {type: 'inverse', path}, {type: 'seq', paths},
 * {type: 'alt', paths} and {type: 'zeroOrMore' | 'oneOrMore' | 'zeroOrOne', path}.
 */
AbstractQueryTree.normalizePath = function(node) {
    if(node.token !== 'path') {
        return {type: 'link', iri: node};
    }
    let path;
    if(node.kind === 'element') {
        path = AbstractQueryTree.normalizePath(node.value);
    } else if(node.kind === 'sequence' || node.kind === 'alternative') {
        path = {type: node.kind === 'sequence' ? 'seq' : 'alt', paths: node.value.map(AbstractQueryTree.normalizePath)};
    } else if(node.kind === 'inversePath') {
        path = {type: 'inverse', path: AbstractQueryTree.normalizePath(node.value)};
    } else if(node.kind === 'negatedPropertySet') {
        throw new NonSupportedSparqlFeatureError("negated property set", "Negated property sets (!) in property paths are not supported");
    } else {
        throw new NonSupportedSparqlFeatureError("path expression " + node.kind);
    }

    const modifier = node.modifier;
    if(modifier == null) {
        return path;
    } else if(modifier === '*') {
        return {type: 'zeroOrMore', path: path};
    } else if(modifier === '+') {
        return {type: 'oneOrMore', path: path};
    } else if(modifier === '?') {
        return {type: 'zeroOrOne', path: path};
    } else {
        throw new NonSupportedSparqlFeatureError("property path modifier", "Property path modifiers {n,m} are not supported");
    }
};

const isPlainPath = function(path) {
    if(path.type === 'link') {
        return true;
    } else if(path.type === 'inverse') {
        return isPlainPath(path.path);
    } else if(path.type === 'seq') {
        return path.paths.every(isPlainPath);
    } else {
        return false;
    }
};

const expandPlainPath = function(subject, path, object, graph, acum) {
    if(path.type === 'link') {
        const triple = {subject: _.clone(subject, true), predicate: path.iri, object: _.clone(object, true)};
        if(graph != null) {
            triple.graph = _.clone(graph, true);
        }
        acum.push(triple);
    } else if(path.type === 'inverse') {
        expandPlainPath(object, path.path, subject, graph, acum);
    } else {
        let current = subject;
        for(let i=0; i<path.paths.length; i++) {
            const next = i === path.paths.length - 1 ? object : {token: "var", value: "fresh:" + internalVariableCounter++};
            expandPlainPath(current, path.paths[i], next, graph, acum);
            current = next;
        }
    }
};

/**
 * The IRIs of the links in a path
 */
AbstractQueryTree.pathLinks = function(path, acum) {
    if(path.type === 'link') {
        acum.push(path.iri);
    } else if(path.type === 'seq' || path.type === 'alt') {
        for(let i=0; i<path.paths.length; i++) {
            AbstractQueryTree.pathLinks(path.paths[i], acum);
        }
    } else {
        AbstractQueryTree.pathLinks(path.path, acum);
    }
    return acum;
};

AbstractQueryTree.prototype._buildGroupGraphPattern = function(node, env, graph) {
    const f = (node.filters || []);
    let g = {kind: "EMPTY_PATTERN"};
    if(graph != null) {
        // inside GRAPH the group starts from the active graph(s), see the EMPTY_PATTERN case of
        // QueryEngine.executeSelectUnit, so every solution binds the graph
        g.graph = _.clone(graph, true);
        for(let i=0; i<f.length; i++) {
            AbstractQueryTree.setExistsGraph(f[i].value, graph);
        }
    }
    // variables in scope of the patterns so far
    const scope = {};

    for(let i=0; i<node.patterns.length; i++) {
        const pattern = node.patterns[i];
        if(pattern.token === 'bind') {
            // Extend the patterns so far; the variable must not be in scope yet (SPARQL 1.1 18.2.1)
            const variable = pattern.as.value;
            if(scope[variable] === true) {
                throw new SparqlParserError("BIND: variable ?" + variable + " is already in scope");
            }
            scope[variable] = true;
            if(g.kind === 'EXTEND') {
                g.binds.push(pattern);
            } else {
                g = { kind: 'EXTEND',
                    value: g,
                    binds: [pattern] };
            }
        } else if(pattern.token === 'optionalgraphpattern') {
            const parsedPattern = this.build(pattern.value, env, graph);
            AbstractQueryTree.inScopeVariables(parsedPattern, scope);
            if(parsedPattern.kind === 'FILTER') {
                g =  { kind:'LEFT_JOIN',
                    lvalue: g,
                    rvalue: parsedPattern.value,
                    filter: parsedPattern.filter };
            } else {
                g = { kind:'LEFT_JOIN',
                    lvalue: g,
                    rvalue: parsedPattern,
                    filter: true };
            }
        } else {
            const parsedPattern = this.build(pattern, env, graph);
            AbstractQueryTree.inScopeVariables(parsedPattern, scope);
            // the patterns inside GRAPH bind the active graph, except an inner GRAPH: it joins the start of the
            // group (W3C graph-nested-2/3)
            if(g.kind == "EMPTY_PATTERN" && (graph == null || parsedPattern.kind !== 'GRAPH')) {
                g = parsedPattern;
            } else {
                g = { kind: 'JOIN',
                    lvalue: g,
                    rvalue: parsedPattern };
            }
        }
    }

    if(f.length != 0) {
        return { kind: 'FILTER',
            filter: f,
            value: g};
    } else {
        return g;
    }
};

/**
 * Records the active graph on every EXISTS / NOT EXISTS in a filter expression of a group inside GRAPH.
 * QueryFilters.preprocessExistentialFilters builds the EXISTS pattern per solution with that graph, an
 * internal graph variable replaced by its value in the solution.
 */
AbstractQueryTree.setExistsGraph = function(expression, graph) {
    if(expression == null || typeof(expression) !== 'object') {
        return;
    }
    if(expression.expressionType === 'builtincall' &&
        (expression.builtincall === 'exists' || expression.builtincall === 'notexists')) {
        expression.graph = _.clone(graph, true);
    } else {
        for(const p in expression) {
            AbstractQueryTree.setExistsGraph(expression[p], graph);
        }
    }
};

/**
 * Adds the variables in scope of an algebra expression to acum (SPARQL 1.1 18.2.1). Inside GRAPH ?g the
 * patterns match an internal graph variable, and ?g is in scope only after the GRAPH.
 */
AbstractQueryTree.inScopeVariables = function(aqt, acum) {
    if(aqt.kind === 'BGP') {
        for(let i=0; i<aqt.value.length; i++) {
            const triple = aqt.value[i];
            ['subject', 'predicate', 'object'].forEach(function(component) {
                if(triple[component] != null && triple[component].token === 'var') {
                    acum[triple[component].value] = true;
                }
            });
        }
    } else if(aqt.kind === 'PATH') {
        [aqt.subject, aqt.object].forEach(function(term) {
            if(term != null && term.token === 'var') {
                acum[term.value] = true;
            }
        });
    } else if(aqt.kind === 'BGP_SCOPE') {
        aqt.value.forEach(function(part) { AbstractQueryTree.inScopeVariables(part, acum); });
    } else if(aqt.kind === 'UNION') {
        AbstractQueryTree.inScopeVariables(aqt.value[0], acum);
        AbstractQueryTree.inScopeVariables(aqt.value[1], acum);
    } else if(aqt.kind === 'LEFT_JOIN' || aqt.kind === 'JOIN') {
        AbstractQueryTree.inScopeVariables(aqt.lvalue, acum);
        AbstractQueryTree.inScopeVariables(aqt.rvalue, acum);
    } else if(aqt.kind === 'GRAPH') {
        AbstractQueryTree.inScopeVariables(aqt.value, acum);
        if(aqt.graph.token === 'var') {
            acum[aqt.graph.value] = true;
        }
    } else if(aqt.kind === 'FILTER') {
        AbstractQueryTree.inScopeVariables(aqt.value, acum);
    } else if(aqt.kind === 'EXTEND') {
        AbstractQueryTree.inScopeVariables(aqt.value, acum);
        for(let j=0; j<aqt.binds.length; j++) {
            acum[aqt.binds[j].as.value] = true;
        }
    }
    return acum;
};

/**
 * Collects basic triple pattern in a complex SPARQL AQT
 */
AbstractQueryTree.prototype.collectBasicTriples = function(aqt, acum) {
    if(acum == null) {
        acum = [];
    }

    if(aqt.kind === 'select') {
        acum = this.collectBasicTriples(aqt.pattern,acum);
    } else if(aqt.kind === 'BGP') {
        acum = acum.concat(aqt.value);
    } else if(aqt.kind === 'PATH') {
        // a triple pattern for each IRI of the path, so that observers see changes to them
        const links = AbstractQueryTree.pathLinks(aqt.path, []);
        for(let i=0; i<links.length; i++) {
            const triple = {subject: {token: 'var', value: 'path:s'}, predicate: links[i], object: {token: 'var', value: 'path:o'}};
            if(aqt.graph != null) {
                triple.graph = aqt.graph;
            }
            acum.push(triple);
        }
    } else if(aqt.kind === 'BGP_SCOPE') {
        for(let j=0; j<aqt.value.length; j++) {
            acum = this.collectBasicTriples(aqt.value[j], acum);
        }
    } else if(aqt.kind === 'UNION') {
        acum = this.collectBasicTriples(aqt.value[0],acum);
        acum = this.collectBasicTriples(aqt.value[1],acum);
    } else if(aqt.kind === 'GRAPH') {
        acum = this.collectBasicTriples(aqt.value,acum);
    } else if(aqt.kind === 'LEFT_JOIN' || aqt.kind === 'JOIN') {
        acum = this.collectBasicTriples(aqt.lvalue, acum);
        acum = this.collectBasicTriples(aqt.rvalue, acum);
    } else if(aqt.kind === 'FILTER' || aqt.kind === 'EXTEND') {
        acum = this.collectBasicTriples(aqt.value, acum);
    } else if(aqt.kind === 'construct') {
        acum = this.collectBasicTriples(aqt.pattern,acum);
    } else if(aqt.kind === 'EMPTY_PATTERN') {
        // nothing
    } else {
        throw "Unknown pattern: "+aqt.kind;
    }

    return acum;
};

/**
 * Replaces bindings in an AQT
 */
AbstractQueryTree.prototype.bind = function(aqt, bindings) {
    const that = this;
    if(aqt.graph != null && aqt.graph.token && aqt.graph.token === 'var' &&
        bindings[aqt.graph.value] != null) {
        aqt.graph = bindings[aqt.graph.value];
    }
    if(aqt.filter != null) {
        const acum = [];
        for(let i=0; i< aqt.filter.length; i++) {
            aqt.filter[i].value = this._bindFilter(aqt.filter[i].value, bindings);
            acum.push(aqt.filter[i]);
        }
        aqt.filter = acum;
    }
    if(aqt.kind === 'select') {
        aqt.pattern = this.bind(aqt.pattern, bindings);
        //acum = this.collectBasicTriples(aqt.pattern,acum);
    } else if(aqt.kind === 'BGP') {
        aqt.value = this._bindTripleContext(aqt.value, bindings);
        //acum = acum.concat(aqt.value);
    } else if(aqt.kind === 'PATH') {
        if(aqt.subject.token === 'var' && bindings[aqt.subject.value] != null) {
            aqt.subject = bindings[aqt.subject.value];
        }
        if(aqt.object.token === 'var' && bindings[aqt.object.value] != null) {
            aqt.object = bindings[aqt.object.value];
        }
    } else if(aqt.kind === 'BGP_SCOPE') {
        aqt.value = aqt.value.map(function(part) { return that.bind(part, bindings); });
    } else if(aqt.kind === 'UNION') {
        aqt.value[0] = this.bind(aqt.value[0],bindings);
        aqt.value[1] = this.bind(aqt.value[1],bindings);
    } else if(aqt.kind === 'GRAPH') {
        if(aqt.internal != null && aqt.graph.token !== 'var') {
            // ?g was bound above: the patterns inside match that graph
            const graphBindings = {};
            for(const v in bindings) {
                graphBindings[v] = bindings[v];
            }
            graphBindings[aqt.internal.value] = aqt.graph;
            aqt.internal = null;
            aqt.value = this.bind(aqt.value, graphBindings);
        } else {
            aqt.value = this.bind(aqt.value, bindings);
        }
    } else if(aqt.kind === 'LEFT_JOIN' || aqt.kind === 'JOIN') {
        aqt.lvalue = this.bind(aqt.lvalue, bindings);
        aqt.rvalue = this.bind(aqt.rvalue, bindings);
    } else if(aqt.kind === 'FILTER') {
        aqt.value = this.bind(aqt.value, bindings);
        aqt.filter = aqt.filter.map(function(f) { return { token: 'filter', value: that._bindFilter(f.value, bindings) }; });
    } else if(aqt.kind === 'EXTEND') {
        aqt.value = this.bind(aqt.value, bindings);
        aqt.binds = aqt.binds.map(function(b) { return { token: 'bind', expression: that._bindFilter(b.expression, bindings), as: b.as }; });
    } else if(aqt.kind === 'EMPTY_PATTERN') {
        // nothing
    } else {
        throw "Unknown pattern: "+aqt.kind;
    }

    return aqt;
};

AbstractQueryTree.prototype._bindTripleContext = function(triples, bindings) {
    for(let i=0; i<triples.length; i++) {
        // the graph stays: a bound graph variable is replaced like the other components
        delete triples[i]['variables'];
        for(const p in triples[i]) {
            const comp = triples[i][p];
            if(comp != null && comp.token === 'var' && bindings[comp.value] != null) {
                triples[i][p] = bindings[comp.value];
            }
        }
    }

    return triples;
};


AbstractQueryTree.prototype._bindFilter = function(filterExpr, bindings) {
    if(filterExpr.expressionType != null) {
        const expressionType = filterExpr.expressionType;
        if(expressionType == 'relationalexpression') {
            filterExpr.op1 = this._bindFilter(filterExpr.op1, bindings);
            filterExpr.op2 = this._bindFilter(filterExpr.op2, bindings);
        } else if(expressionType == 'conditionalor' || expressionType == 'conditionaland') {
            for(let i=0; i< filterExpr.operands.length; i++) {
                filterExpr.operands[i] = this._bindFilter(filterExpr.operands[i], bindings);
            }
        } else if(expressionType == 'additiveexpression') {
            filterExpr.summand = this._bindFilter(filterExpr.summand, bindings);
            for(let i=0; i<filterExpr.summands.length; i++) {
                filterExpr.summands[i].expression = this._bindFilter(filterExpr.summands[i].expression, bindings);
            }
        } else if(expressionType == 'builtincall') {
            for(let i=0; i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._bindFilter(filterExpr.args[i], bindings);
            }
        } else if(expressionType == 'multiplicativeexpression') {
            filterExpr.factor = this._bindFilter(filterExpr.factor, bindings);
            for(let i=0; i<filterExpr.factors.length; i++) {
                filterExpr.factors[i].expression = this._bindFilter(filterExpr.factors[i].expression, bindings);
            }
        } else if(expressionType == 'unaryexpression') {
            filterExpr.expression = this._bindFilter(filterExpr.expression, bindings);
        } else if(expressionType == 'irireforfunction') {
            for(let i=0; filterExpr.args != null && i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._bindFilter(filterExpr.args[i], bindings);
            }
        } else if(expressionType == 'atomic') {
            if(filterExpr.primaryexpression == 'var') {
                // lookup the var in the bindings
                if(bindings[filterExpr.value.value] != null) {
                    const val = bindings[filterExpr.value.value];
                    if(val.token === 'uri') {
                        filterExpr.primaryexpression = 'iri';
                    } else {
                        filterExpr.primaryexpression = 'literal';
                    }
                    filterExpr.value = val;
                }
            }
        }
    }

    return filterExpr;
};

/**
 * Replaces terms in an AQT
 */
AbstractQueryTree.prototype.replace = function(aqt, from, to, ns) {
    if(aqt.graph != null && aqt.graph.token && aqt.graph.token === from.token &&
        aqt.graph.value == from.value) {
        aqt.graph = _.clone(to,true);
    }
    if(aqt.filter != null) {
        const acum = [];
        for(let i=0; i< aqt.filter.length; i++) {
            aqt.filter[i].value = this._replaceFilter(aqt.filter[i].value, from, to, ns);
            acum.push(aqt.filter[i]);
        }
        aqt.filter = acum;
    }
    if(aqt.kind === 'select') {
        aqt.pattern = this.replace(aqt.pattern, from, to, ns);
    } else if(aqt.kind === 'BGP') {
        aqt.value = this._replaceTripleContext(aqt.value, from, to, ns);
    } else if(aqt.kind === 'PATH') {
        const endpoints = this._replaceTripleContext([{subject: aqt.subject, object: aqt.object}], from, to, ns)[0];
        aqt.subject = endpoints.subject;
        aqt.object = endpoints.object;
    } else if(aqt.kind === 'BGP_SCOPE') {
        const that = this;
        aqt.value = aqt.value.map(function(part) { return that.replace(part, from, to, ns); });
    } else if(aqt.kind === 'UNION') {
        aqt.value[0] = this.replace(aqt.value[0],from,to, ns);
        aqt.value[1] = this.replace(aqt.value[1],from,to, ns);
    } else if(aqt.kind === 'GRAPH') {
        aqt.value = this.replace(aqt.value, from, to, ns);
    } else if(aqt.kind === 'LEFT_JOIN' || aqt.kind === 'JOIN') {
        aqt.lvalue = this.replace(aqt.lvalue, from, to, ns);
        aqt.rvalue = this.replace(aqt.rvalue, from, to, ns);
    } else if(aqt.kind === 'FILTER') {
        aqt.value = this._replaceFilter(aqt.value, from,to, ns);
    } else if(aqt.kind === 'EXTEND') {
        aqt.value = this.replace(aqt.value, from, to, ns);
    } else if(aqt.kind === 'EMPTY_PATTERN') {
        // nothing
    } else {
        throw "Unknown pattern: "+aqt.kind;
    }

    return aqt;
};

AbstractQueryTree.prototype._replaceTripleContext = function(triples, from, to, ns) {
    for(let i=0; i<triples.length; i++) {
        for(const p in triples[i]) {
            const comp = triples[i][p];
            if(comp.token === 'var' && from.token === 'var' && comp.value === from.value) {
                triples[i][p] = to;
            } else if(comp.token === 'blank' && from.token === 'blank' && comp.value === from.value) {
                triples[i][p] = to;
            } else {
                if((comp.token === 'literal' || comp.token ==='uri') &&
                    (from.token === 'literal' || from.token ==='uri') &&
                    comp.token === from.token && Utils.lexicalFormTerm(comp,ns)[comp.token] === Utils.lexicalFormTerm(from,ns)[comp.token]) {
                    triples[i][p] = to;
                }
            }
        }
    }

    return triples;
};


AbstractQueryTree.prototype._replaceFilter = function(filterExpr, from, to, ns) {
    if(filterExpr.expressionType != null) {
        const expressionType = filterExpr.expressionType;
        if(expressionType == 'relationalexpression') {
            filterExpr.op1 = this._replaceFilter(filterExpr.op1, from, to, ns);
            filterExpr.op2 = this._replaceFilter(filterExpr.op2, from, to, ns);
        } else if(expressionType == 'conditionalor' || expressionType == 'conditionaland') {
            for(let i=0; i< filterExpr.operands.length; i++) {
                filterExpr.operands[i] = this._replaceFilter(filterExpr.operands[i], from, to, ns);
            }
        } else if(expressionType == 'additiveexpression') {
            filterExpr.summand = this._replaceFilter(filterExpr.summand, from, to, ns);
            for(let i=0; i<filterExpr.summands.length; i++) {
                filterExpr.summands[i].expression = this._replaceFilter(filterExpr.summands[i].expression, from, to, ns);
            }
        } else if(expressionType == 'builtincall') {
            for(let i=0; i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._replaceFilter(filterExpr.args[i], from, to, ns);
            }
        } else if(expressionType == 'multiplicativeexpression') {
            filterExpr.factor = this._replaceFilter(filterExpr.factor, from, to, ns);
            for(let i=0; i<filterExpr.factors.length; i++) {
                filterExpr.factors[i].expression = this._replaceFilter(filterExpr.factors[i].expression, from, to, ns);
            }
        } else if(expressionType == 'unaryexpression') {
            filterExpr.expression = this._replaceFilter(filterExpr.expression, from, to, ns);
        } else if(expressionType == 'irireforfunction') {
            for(let i=0; filterExpr.args != null && i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._replaceFilter(filterExpr.args[i], from, to, ns);
            }
        } else if(expressionType == 'atomic') {
            let val = null;
            if(filterExpr.primaryexpression == from.token && filterExpr.value == from.value) {
                val = to.value;
            } else if(filterExpr.primaryexpression == 'iri' && from.token == 'uri' && filterExpr.value == from.value) {
                val = to.value;
            }


            if(val != null) {
                if(to.token === 'uri') {
                    filterExpr.primaryexpression = 'iri';
                } else {
                    filterExpr.primaryexpression = to.token;
                }
                filterExpr.value = val;
            }
        }
    }

    return filterExpr;
};

module.exports = {
    AbstractQueryTree: AbstractQueryTree,
    NonSupportedSparqlFeatureError: NonSupportedSparqlFeatureError,
    SparqlParserError: SparqlParserError
};
