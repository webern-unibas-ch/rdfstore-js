"use strict";

// imports
var SparqlParser = require("./parser");
var Utils = require("./utils");
var _ = Utils;

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
var AbstractQueryTree = function() {
};

AbstractQueryTree.prototype.parseQueryString = function(query_string) {
        return SparqlParser.parse(query_string);
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
        console.log("error parsing query");
        return null;
    } else {
        var env = { freshCounter: 0 };
        syntaxTree.pattern = this.build(syntaxTree.pattern, env, graph);
        return syntaxTree;
    }
};

AbstractQueryTree.prototype.parseInsertData = function(syntaxTree){
    if(syntaxTree == null) {
        console.log("error parsing query");
        return null;
    } else {
        return syntaxTree;
    }
};

// names the internal graph variables of GRAPH ?g; module-wide, because EXISTS builds its pattern per solution
// with an env of its own, and the outer solution it is bound with carries the outer internal variables
var graphVariableCounter = 0;

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
            for(var i=0; i<node.triplesContext.length; i++) {
                node.triplesContext[i].graph = _.clone(graph, true);
            }
        }
        var bgp = {
            kind: 'BGP',
            value: node.triplesContext
        };
        bgp = AbstractQueryTree.translatePathExpressionsInBGP(bgp, env);
        return bgp;
    } else if (node.token === 'graphunionpattern') {
        var a = this.build(node.value[0], env, graph);
        var b = this.build(node.value[1], env, graph);

        return {
            kind: 'UNION',
            value: [a,b]
        };
    } else if(node.token === 'graphgraphpattern') {
        var internal = null;
        if(node.graph.token === 'var') {
            internal = {token: 'var', value: 'graph:' + graphVariableCounter++};
        }
        // an inner GRAPH sets its own active graph
        var c = this.build(node.value, env, internal || node.graph);
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

AbstractQueryTree.translatePathExpressionsInBGP = function(bgp, env) {
    var pathExpression;
    var before = [], rest, bottomJoin;
    for(var i=0; i<bgp.value.length; i++) {
        if(bgp.value[i].predicate && bgp.value[i].predicate.token === 'path') {
            //console.log("FOUND A PATH");
            pathExpression = bgp.value[i];
            rest = bgp.value.slice(i+1);
            var bgpTransformed = AbstractQueryTree.translatePathExpression(pathExpression, env);
            var optionalPattern = null;
            //console.log("BACK FROM TRANSFORMED");
            if(bgpTransformed.kind === 'BGP') {
                before = before.concat(bgpTransformed.value);
            } else if(bgpTransformed.kind === 'ZERO_OR_MORE_PATH' || bgpTransformed.kind === 'ONE_OR_MORE_PATH'){
                //console.log("BEFORE");
                //console.log(bgpTransformed);


                if(before.length > 0) {
                    bottomJoin =  {kind: 'JOIN',
                        lvalue: {kind: 'BGP', value:before},
                        rvalue: bgpTransformed};
                } else {
                    bottomJoin = bgpTransformed;
                }


                if(bgpTransformed.kind === 'ZERO_OR_MORE_PATH') {
                    if(bgpTransformed.y.token === 'var' && bgpTransformed.y.value.indexOf("fresh:")===0 &&
                        bgpTransformed.x.token === 'var' && bgpTransformed.x.value.indexOf("fresh:")===0) {
                        //console.log("ADDING EXTRA PATTERN 1)");
                        for(var j=0; j<bgp.value.length; j++) {
                            //console.log(bgp.value[j]);
                            if(bgp.value[j].object && bgp.value[j].object.token === 'var' && bgp.value[j].object.value === bgpTransformed.x.value) {
                                //console.log(" YES 1)");
                                optionalPattern = _.clone(bgp.value[j], true);
                                optionalPattern.object = bgpTransformed.y;
                            }
                        }
                    } else if(bgpTransformed.y.token === 'var' && bgpTransformed.y.value.indexOf("fresh:")===0) {
                        //console.log("ADDING EXTRA PATTERN 2)");
                        for(var j=0; j<bgp.value.length; j++) {
                            //console.log(bgp.value[j]);
                            if(bgp.value[j].subject && bgp.value[j].subject.token === 'var' && bgp.value[j].subject.value === bgpTransformed.y.value) {
                                //console.log(" YES 2)");
                                optionalPattern = _.clone(bgp.value[j],true);
                                optionalPattern.subject = bgpTransformed.x;
                            }
                        }
                    }
                }

                if(rest.length >0) {
                    //console.log("(2a)")
                    var rvalueJoin = AbstractQueryTree.translatePathExpressionsInBGP({kind: 'BGP', value: rest}, env);
                    //console.log("got rvalue");
                    if(optionalPattern != null) {
                        var optionals = before.concat([optionalPattern]).concat(rest);
                        return { kind: 'UNION',
                            value: [{ kind: 'JOIN',
                                lvalue: bottomJoin,
                                rvalue: rvalueJoin },
                                {kind: 'BGP',
                                    value: optionals}] };
                    } else {
                        return { kind: 'JOIN',
                            lvalue: bottomJoin,
                            rvalue: rvalueJoin };
                    }
                } else {
                    //console.log("(2b)")
                    return bottomJoin;
                }

            } else {
                // @todo ????
                return bgpTransformed;
            }
        } else {
            before.push(bgp.value[i]);
        }
    }

    //console.log("returning");
    bgp.value = before;
    return bgp;
};


AbstractQueryTree.translatePathExpression  = function(pathExpression, env) {
    // * and + on a single predicate become ZERO_OR_MORE_PATH / ONE_OR_MORE_PATH (rejected when executed)
    var modifier = pathExpression.predicate.modifier;
    if(modifier != null && (pathExpression.predicate.kind !== 'element' || (modifier !== '*' && modifier !== '+'))) {
        throw new NonSupportedSparqlFeatureError("property path modifier", "Property path modifiers (*, +, ?, {n,m}) are not supported");
    }
    // add support for different path patterns
    if(pathExpression.predicate.kind === 'element') {
        // simple paths, maybe modified
        if(pathExpression.predicate.modifier === '+') {
            pathExpression.predicate.modifier = null;
            var expandedPath = AbstractQueryTree.translatePathExpression(pathExpression, env);
            return {kind: 'ONE_OR_MORE_PATH',
                path: expandedPath,
                x: pathExpression.subject,
                y: pathExpression.object};
        } else if(pathExpression.predicate.modifier === '*') {
            pathExpression.predicate.modifier = null;
            var expandedPath = AbstractQueryTree.translatePathExpression(pathExpression, env);
            return {kind: 'ZERO_OR_MORE_PATH',
                path: expandedPath,
                x: pathExpression.subject,
                y: pathExpression.object};
        } else {
            pathExpression.predicate = pathExpression.predicate.value;
            return {kind: 'BGP', value: [pathExpression]};
        }
    } else if(pathExpression.predicate.kind === 'sequence') {
        var currentSubject = pathExpression.subject;
        var lastObject = pathExpression.object;
        var currentGraph = pathExpression.graph;
        var nextObject, chain;
        var restTriples = [];
        for(var i=0; i< pathExpression.predicate.value.length; i++) {
            if(i!=pathExpression.predicate.value.length-1) {
                nextObject = {
                    token: "var",
                    value: "fresh:"+env.freshCounter
                };
                env.freshCounter++;
            } else {
                nextObject = lastObject;
            }

            // @todo
            // what if the predicate is a path with
            // '*'? same fresh va in subject and object??
            chain = {
                subject: currentSubject,
                predicate: pathExpression.predicate.value[i],
                object: nextObject
            };

            if(currentGraph != null)
                chain.graph =_.clone(currentGraph,true);

            restTriples.push(chain);

            if(i!=pathExpression.predicate.value.length-1)
                currentSubject = _.clone(nextObject,true);
        }
        var bgp = {kind: 'BGP', value: restTriples};
        //console.log("BEFORE (1):");
        //console.log(bgp);
        //console.log("--------------");
        return AbstractQueryTree.translatePathExpressionsInBGP(bgp, env);
    } else {
        throw new NonSupportedSparqlFeatureError("Non supported path expression "+pathExpression.predicate.kind);
    }
};

AbstractQueryTree.prototype._buildGroupGraphPattern = function(node, env, graph) {
    var f = (node.filters || []);
    var g = {kind: "EMPTY_PATTERN"};
    if(graph != null) {
        // inside GRAPH the group starts from the active graph(s), see the EMPTY_PATTERN case of
        // QueryEngine.executeSelectUnit, so every solution binds the graph
        g.graph = _.clone(graph, true);
        for(var i=0; i<f.length; i++) {
            AbstractQueryTree.setExistsGraph(f[i].value, graph);
        }
    }
    // variables in scope of the patterns so far
    var scope = {};

    for(var i=0; i<node.patterns.length; i++) {
        var pattern = node.patterns[i];
        if(pattern.token === 'bind') {
            // Extend the patterns so far; the variable must not be in scope yet (SPARQL 1.1 18.2.1)
            var variable = pattern.as.value;
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
            var parsedPattern = this.build(pattern.value, env, graph);
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
            var parsedPattern = this.build(pattern, env, graph);
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
        for(var p in expression) {
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
        for(var i=0; i<aqt.value.length; i++) {
            var triple = aqt.value[i];
            ['subject', 'predicate', 'object'].forEach(function(component) {
                if(triple[component] != null && triple[component].token === 'var') {
                    acum[triple[component].value] = true;
                }
            });
        }
    } else if(aqt.kind === 'ZERO_OR_MORE_PATH' || aqt.kind === 'ONE_OR_MORE_PATH') {
        [aqt.x, aqt.y].forEach(function(term) {
            if(term != null && term.token === 'var') {
                acum[term.value] = true;
            }
        });
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
        for(var j=0; j<aqt.binds.length; j++) {
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
    } else if(aqt.kind === 'ZERO_OR_MORE_PATH' || aqt.kind === 'ONE_OR_MORE_PATH') {
        acum = this.collectBasicTriples(aqt.path);
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
    if(aqt.graph != null && aqt.graph.token && aqt.graph.token === 'var' &&
        bindings[aqt.graph.value] != null) {
        aqt.graph = bindings[aqt.graph.value];
    }
    if(aqt.filter != null) {
        var acum = [];
        for(var i=0; i< aqt.filter.length; i++) {
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
    } else if(aqt.kind === 'ZERO_OR_MORE_PATH' || aqt.kind === 'ONE_OR_MORE_PATH') {
        aqt.path = this._bindTripleContext(aqt.path, bindings);
        if(aqt.x && aqt.x.token === 'var' && bindings[aqt.x.value] != null) {
            aqt.x = bindings[aqt.x.value];
        }
        if(aqt.y && aqt.y.token === 'var' && bindings[aqt.y.value] != null) {
            aqt.y = bindings[aqt.y.value];
        }
    } else if(aqt.kind === 'UNION') {
        aqt.value[0] = this.bind(aqt.value[0],bindings);
        aqt.value[1] = this.bind(aqt.value[1],bindings);
    } else if(aqt.kind === 'GRAPH') {
        if(aqt.internal != null && aqt.graph.token !== 'var') {
            // ?g was bound above: the patterns inside match that graph
            var graphBindings = {};
            for(var v in bindings) {
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
        var that = this;
        aqt.value = this.bind(aqt.value, bindings);
        aqt.filter = aqt.filter.map(function(f) { return { token: 'filter', value: that._bindFilter(f.value, bindings) }; });
    } else if(aqt.kind === 'EXTEND') {
        var that = this;
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
    for(var i=0; i<triples.length; i++) {
        // the graph stays: a bound graph variable is replaced like the other components
        delete triples[i]['variables'];
        for(var p in triples[i]) {
            var comp = triples[i][p];
            if(comp != null && comp.token === 'var' && bindings[comp.value] != null) {
                triples[i][p] = bindings[comp.value];
            }
        }
    }

    return triples;
};


AbstractQueryTree.prototype._bindFilter = function(filterExpr, bindings) {
    if(filterExpr.expressionType != null) {
        var expressionType = filterExpr.expressionType;
        if(expressionType == 'relationalexpression') {
            filterExpr.op1 = this._bindFilter(filterExpr.op1, bindings);
            filterExpr.op2 = this._bindFilter(filterExpr.op2, bindings);
        } else if(expressionType == 'conditionalor' || expressionType == 'conditionaland') {
            for(var i=0; i< filterExpr.operands.length; i++) {
                filterExpr.operands[i] = this._bindFilter(filterExpr.operands[i], bindings);
            }
        } else if(expressionType == 'additiveexpression') {
            filterExpr.summand = this._bindFilter(filterExpr.summand, bindings);
            for(var i=0; i<filterExpr.summands.length; i++) {
                filterExpr.summands[i].expression = this._bindFilter(filterExpr.summands[i].expression, bindings);
            }
        } else if(expressionType == 'builtincall') {
            for(var i=0; i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._bindFilter(filterExpr.args[i], bindings);
            }
        } else if(expressionType == 'multiplicativeexpression') {
            filterExpr.factor = this._bindFilter(filterExpr.factor, bindings);
            for(var i=0; i<filterExpr.factors.length; i++) {
                filterExpr.factors[i].expression = this._bindFilter(filterExpr.factors[i].expression, bindings);
            }
        } else if(expressionType == 'unaryexpression') {
            filterExpr.expression = this._bindFilter(filterExpr.expression, bindings);
        } else if(expressionType == 'irireforfunction') {
            for(var i=0; filterExpr.args != null && i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._bindFilter(filterExpr.args[i], bindings);
            }
        } else if(expressionType == 'atomic') {
            if(filterExpr.primaryexpression == 'var') {
                // lookup the var in the bindings
                if(bindings[filterExpr.value.value] != null) {
                    var val = bindings[filterExpr.value.value];
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
        var acum = [];
        for(var i=0; i< aqt.filter.length; i++) {
            aqt.filter[i].value = this._replaceFilter(aqt.filter[i].value, from, to, ns);
            acum.push(aqt.filter[i]);
        }
        aqt.filter = acum;
    }
    if(aqt.kind === 'select') {
        aqt.pattern = this.replace(aqt.pattern, from, to, ns);
    } else if(aqt.kind === 'BGP') {
        aqt.value = this._replaceTripleContext(aqt.value, from, to, ns);
    } else if(aqt.kind === 'ZERO_OR_MORE_PATH' || aqt.kind === 'ONE_OR_MORE_PATH') {
        aqt.path = this._replaceTripleContext(aqt.path, from,to, ns);
        if(aqt.x && aqt.x.token === from.token && aqt.value === from.value) {
            aqt.x = _.clone(to,true);
        }
        if(aqt.y && aqt.y.token === from.token && aqt.value === from.value) {
            aqt.y = _.clone(to,true);
        }
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
    for(var i=0; i<triples.length; i++) {
        for(var p in triples[i]) {
            var comp = triples[i][p];
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
        var expressionType = filterExpr.expressionType;
        if(expressionType == 'relationalexpression') {
            filterExpr.op1 = this._replaceFilter(filterExpr.op1, from, to, ns);
            filterExpr.op2 = this._replaceFilter(filterExpr.op2, from, to, ns);
        } else if(expressionType == 'conditionalor' || expressionType == 'conditionaland') {
            for(var i=0; i< filterExpr.operands.length; i++) {
                filterExpr.operands[i] = this._replaceFilter(filterExpr.operands[i], from, to, ns);
            }
        } else if(expressionType == 'additiveexpression') {
            filterExpr.summand = this._replaceFilter(filterExpr.summand, from, to, ns);
            for(var i=0; i<filterExpr.summands.length; i++) {
                filterExpr.summands[i].expression = this._replaceFilter(filterExpr.summands[i].expression, from, to, ns);
            }
        } else if(expressionType == 'builtincall') {
            for(var i=0; i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._replaceFilter(filterExpr.args[i], from, to, ns);
            }
        } else if(expressionType == 'multiplicativeexpression') {
            filterExpr.factor = this._replaceFilter(filterExpr.factor, from, to, ns);
            for(var i=0; i<filterExpr.factors.length; i++) {
                filterExpr.factors[i].expression = this._replaceFilter(filterExpr.factors[i].expression, from, to, ns);
            }
        } else if(expressionType == 'unaryexpression') {
            filterExpr.expression = this._replaceFilter(filterExpr.expression, from, to, ns);
        } else if(expressionType == 'irireforfunction') {
            for(var i=0; filterExpr.args != null && i<filterExpr.args.length; i++) {
                filterExpr.args[i] = this._replaceFilter(filterExpr.args[i], from, to, ns);
            }
        } else if(expressionType == 'atomic') {
            var val = null;
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
