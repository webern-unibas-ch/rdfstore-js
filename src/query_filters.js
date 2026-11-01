"use strict";

var Utils = require('./utils');
var     _ = Utils;
var async = require('./utils');
var NonSupportedSparqlFeatureError = require('./abstract_query_tree').NonSupportedSparqlFeatureError;

var QueryFilters = {};

var xmlSchema = "http://www.w3.org/2001/XMLSchema#";

QueryFilters.checkFilters = function(pattern, bindings, nullifyErrors, dataset, queryEnv, queryEngine, callback) {
    var filters = [];
    if (pattern.filter && typeof(pattern.filter) !== 'function')
        filters = pattern.filter;
    var nullified = [];
    if(filters==null || filters.length === 0 || pattern.length != null) {
        return callback(null, bindings);
    }
    QueryFilters.preprocessExistentialFilters(filters, bindings, queryEngine, dataset, queryEnv, function(err, preProcessedFilters){
        if(err != null) {
            return callback(err);
        }
        async.eachSeries(preProcessedFilters, function(filter,k){
            QueryFilters.run(filter.value, bindings, nullifyErrors, dataset, queryEnv, queryEngine, function(err, filteredBindings){
                if(err != null) {
                    return k(err);
                }
                var acum = [];
                for(var i=0; i<filteredBindings.length; i++) {
                    var filteredBinding = filteredBindings[i];
                    if(filteredBinding["__nullify__"]!=null) {
                        nullified.push(filteredBinding);
                    } else {
                        acum.push(filteredBinding);
                    }
                }
                bindings = acum;
                k();
            });
        },function(err){
            if(err != null) {
                callback(err);
            } else {
                callback(null, bindings.concat(nullified));
            }
        });
    });
};

QueryFilters.preprocessExistentialFilters = function(filters, bindings, queryEngine, dataset, env ,cb) {
    var preProcessedFilters = [];
    async.eachSeries(filters, function(filter, k){
        if(filter.value.expressionType === 'builtincall' &&
           (filter.value.builtincall === 'exists' ||
            filter.value.builtincall === 'notexists')) {
            var builtincall = filter.value.builtincall;
            var args = filter.value.args;

            var bindingsResults = {};
            queryEngine.copyDenormalizedBindings(bindings, env.outCache, function(denormBindings){
                async.eachSeries(denormBindings, function(bindings, kk) {
                    var ast;
                    try {
                        // this runs after a nextTick, so an error in the pattern (e.g. a BIND to a variable in scope) must not throw
                        ast = queryEngine.abstractQueryTree.parseSelect({pattern: _.clone(args[0],true)}, bindings);
                        ast = queryEngine.abstractQueryTree.bind(ast.pattern, bindings);
                    } catch(e) {
                        return kk(Utils.toError(e));
                    }
                    queryEngine.executeSelectUnit([ {kind:'*'} ], dataset, ast, env, function(err, result){
                        if(err != null) {
                            return kk(err);
                        }
                        var success = null;
                        if(builtincall === 'exists') {
                            success = QueryFilters.ebvBoolean(result.length!==0);
                        } else {
                            success = QueryFilters.ebvBoolean(result.length===0);
                        }
                        var bindingsKey = [];
                        for(var p in bindings) { bindingsKey.push(JSON.stringify(bindings[p]));}
                        bindingsKey = bindingsKey.sort().join("");
                        bindingsResults[bindingsKey] = success;
                        kk();
                    });
                }, function(err){
                    if(err != null) {
                        return k(err);
                    }
                    filter.value.origArgs = filter.value.args;
                    filter.value.args = bindingsResults;
                    preProcessedFilters.push(filter);
                    k();
                });
            });
        } else if (filter.value.expressionType === "conditionalor" || filter.value.expressionType === "conditionaland") {
            var operands = _.map(filter.value.operands, function(operand){ return {"value": operand}; });
            QueryFilters.preprocessExistentialFilters(operands, bindings, queryEngine, dataset, env, function(err, preprocessedOperands){
                if(err != null) {
                    return k(err);
                }
                filter.value.operands = preprocessedOperands.map(function(operand){ return operand.value; });
                preProcessedFilters.push(filter);
                k();
            });
        } else if (filter.value.expressionType === "multiplicativeexpression") {
            var operands = _.map(filter.value.factors, function(operand){ return {"value": operand}; });
            QueryFilters.preprocessExistentialFilters(operands, bindings, queryEngine, dataset, env, function(err, preprocessedOperands){
                if(err != null) {
                    return k(err);
                }
                filter.value.factors = preprocessedOperands.map(function(operand){ return operand.value; });
                preProcessedFilters.push(filter);
                k();
            });
        } else if (filter.value.expressionType === "additiveexpression") {
            var operands = _.map(filter.value.summands, function(operand){ return {"value": operand}; });
            QueryFilters.preprocessExistentialFilters(operands, bindings, queryEngine, dataset, env, function(err, preprocessedOperands){
                if(err != null) {
                    return k(err);
                }
                filter.value.summands = preprocessedOperands.map(function(operand){ return operand.value; });
                preProcessedFilters.push(filter);
                k();
            });
        } else if(filter.value.expressionType === "relationalexpression") {
            var operands = [ {"value": filter.value.op1}, {"value": filter.value.op2}];
            QueryFilters.preprocessExistentialFilters(operands, bindings, queryEngine, dataset, env, function(err, preprocessedOperands){
                if(err != null) {
                    return k(err);
                }
                filter.value.op1 = preprocessedOperands[0].value;
                filter.value.op2 = preprocessedOperands[1].value;
                preProcessedFilters.push(filter);
                k();
            });
        } else if(filter.value.expressionType === "irireforfunction" || filter.value.expressionType === "custom") {
            if(filter.value.args != null) {
                var operands = _.map(filter.value.args, function (operand) {
                    return {"value": operand};
                });
                QueryFilters.preprocessExistentialFilters(operands, bindings, queryEngine, dataset, env, function(err, preprocessedOperands){
                    if(err != null) {
                        return k(err);
                    }
                    filter.value.args = preprocessedOperands.map(function (operand) {
                        return operand.value;
                    });
                    preProcessedFilters.push(filter);
                    k();
                });
            } else {
                preProcessedFilters.push(filter);
                k();
            }
        } else {
            preProcessedFilters.push(filter);
            k();
        }
    }, function(err){
        cb(err, preProcessedFilters);
    });
};

QueryFilters.boundVars = function(filterExpr) {
    if(filterExpr.expressionType != null) {
        var expressionType = filterExpr.expressionType;
        if(expressionType == 'relationalexpression') {
            var op1 = filterExpr.op1;
            var op2 = filterExpr.op2;
            return QueryFilters.boundVars(op1)+QueryFilters.boundVars(op2);
        } else if(expressionType == 'conditionalor' || expressionType == 'conditionaland') {
            var vars = [];
            for(var i=0; i< filterExpr.operands; i++) {
                vars = vars.concat(QueryFilters.boundVars(filterExpr.operands[i]));
            }
            return vars;
        } else if(expressionType == 'builtincall') {
            if(filterExpr.args == null) {
                return [];
            } else {
                var acum = [];
                for(var i=0; i< filterExpr.args.length; i++) {
                    acum = acum.concat(QueryFilters.boundVars(filterExpr.args[i]));
                }
                return acum;
            }
        } else if(expressionType == 'multiplicativeexpression') {
            var acum = QueryFilters.boundVars(filterExpr.factor);
            for(var i=0; i<filterExpr.factors.length; i++) {
                acum = acum.concat(QueryFilters.boundVars(filterExpr.factors[i].expression));
            }
            return acum;
        } else if(expressionType == 'additiveexpression') {
            var acum = QueryFilters.boundVars(filterExpr.summand);
            for(var i=0; i<filterExpr.summands.length; i++) {
                acum = acum.concat(QueryFilters.boundVars(filterExpr.summands[i].expression));
            }

            return acum;
        } else if(expressionType == 'regex') {
            var acum = QueryFilters.boundVars(filterExpr.expression1);
            return acum.concat(QueryFilters.boundVars(filterExpr.expression2));
        } else if(expressionType == 'unaryexpression') {
            return QueryFilters.boundVars(filterExpr.expression);
        } else if(expressionType == 'atomic') {
            if(filterExpr.primaryexpression == 'var') {
                return [filterExpr.value];
            } else {
                // numeric, literal, etc...
                return [];
            }
        }
    } else {
        throw("Cannot find bound expressions in a no expression token");
    }
};

QueryFilters.run = function(filterExpr, bindings, nullifyFilters, dataset, env, queryEngine, callback) {
    queryEngine.copyDenormalizedBindings(bindings, env.outCache, function(denormBindings){
        var filteredBindings = [];
        for(var i=0; i<bindings.length; i++) {
            var thisDenormBindings = denormBindings[i];
            // ebv can be directly a RDFTerm (e.g. atomic expression in filter)
            // this additional call to ebv will return -> true/false/error
            var ebv = QueryFilters.ebv(QueryFilters.runFilter(filterExpr, thisDenormBindings, queryEngine, dataset, env));
            //console.log("EBV:")
            //console.log(ebv)
            //console.log("FOR:")
            //console.log(thisDenormBindings)
            if(QueryFilters.isEbvError(ebv)) {
                // error
                if(nullifyFilters) {
                    var thisBindings = {"__nullify__": true, "bindings": bindings[i]};
                    filteredBindings.push(thisBindings);
                }
            } else if(ebv === true) {
                // true
                filteredBindings.push(bindings[i]);
            } else {
                // false
                if(nullifyFilters) {
                    var thisBindings = {"__nullify__": true, "bindings": bindings[i]};
                    filteredBindings.push(thisBindings);
                }
            }
        }
        callback(null, filteredBindings);
    });
};

QueryFilters.collect = function(filterExpr, bindings, dataset, env, queryEngine, callback) {
    queryEngine.copyDenormalizedBindings(bindings, env.outCache, function(denormBindings) {
        var filteredBindings = [];
        for(var i=0; i<denormBindings.length; i++) {
            var thisDenormBindings = denormBindings[i];
            var ebv = QueryFilters.runFilter(filterExpr, thisDenormBindings, queryEngine, dataset, env);
            filteredBindings.push({binding:bindings[i], value:ebv});
        }
        return callback(filteredBindings);
    });
};

QueryFilters.runDistinct = function(projectedBindings, projectionVariables) {
};

// A key for a whole solution, for COUNT(DISTINCT *)
var solutionKey = function(bindings) {
    var names = Object.keys(bindings).sort();
    var key = [];
    for(var i=0; i<names.length; i++) {
        if(bindings[names[i]] != null) {
            key.push(names[i], Utils.hashTerm(bindings[names[i]]));
        }
    }
    return JSON.stringify(key);
};

// The value of an aggregate's expression for one solution; null if it is unbound or an error, which aggregates skip
var aggregateValue = function(aggregator, bindings, queryEngine, dataset, env) {
    var ebv = QueryFilters.runFilter(aggregator.expression.expression, bindings, queryEngine, dataset, env);
    return QueryFilters.isEbvError(ebv) ? null : ebv;
};

// @todo add more aggregation functions here
QueryFilters.runAggregator = function(aggregator, bindingsGroup, queryEngine, dataset, env) {
    if(bindingsGroup == null || bindingsGroup.length === 0) {
        // an aggregate without GROUP BY over no solutions: SPARQL 1.1 defines 0 for COUNT, SUM, AVG and "" for GROUP_CONCAT
        var aggregateType = aggregator.expression != null ? aggregator.expression.aggregateType : null;
        if(aggregateType === 'count' || aggregateType === 'sum' || aggregateType === 'avg') {
            return {token: 'literal', type:xmlSchema+"integer", value:'0'};
        } else if(aggregateType === 'group_concat') {
            return {token: 'literal', type:null, value:''};
        }
        // MIN, MAX and anything else stay unbound, like an unmatched OPTIONAL variable
        return null;
    } else if(aggregator.token === 'variable' && aggregator.kind == 'var') {
        return bindingsGroup[0][aggregator.value.value];
    } else if(aggregator.token === 'variable' && aggregator.kind === 'aliased') {
        if(aggregator.expression.expressionType === 'aggregate') {
            var aggregateType = aggregator.expression.aggregateType;
            var isDistinct = aggregator.expression.distinct != null && aggregator.expression.distinct != '';
            if(aggregateType === 'max' || aggregateType === 'min') {
                // SPARQL defines MIN and MAX by the ORDER BY order, which also orders values that < can't compare
                var sign = aggregateType === 'max' ? 1 : -1;
                var best = null;
                for(var i=0; i< bindingsGroup.length; i++) {
                    var ebv = aggregateValue(aggregator, bindingsGroup[i], queryEngine, dataset, env);
                    if(ebv != null &&
                        (best === null || sign * queryEngine.compareFilteredBindings({value: [ebv]}, {value: [best]}, [{direction: 'ASC'}], env) > 0)) {
                        best = ebv;
                    }
                }

                return best === null ? QueryFilters.ebvError() : best;
            } else if(aggregateType === 'count') {
                var distinct = {};
                var count = 0;
                if(aggregator.expression.expression === '*') {
                    if(isDistinct) {
                        for(var i=0; i< bindingsGroup.length; i++) {
                            var key = solutionKey(bindingsGroup[i]);
                            if(distinct[key] == null) {
                                distinct[key] = true;
                                count++;
                            }
                        }
                    } else {
                        count = bindingsGroup.length;
                    }
                } else {
                    for(var i=0; i< bindingsGroup.length; i++) {
                        var ebv = aggregateValue(aggregator, bindingsGroup[i], queryEngine, dataset, env);
                        if(ebv != null) {
                            if(isDistinct) {
                                var key = Utils.hashTerm(ebv);
                                if(distinct[key] == null) {
                                    distinct[key] = true;
                                    count++;
                                }
                            } else {
                                count++;
                            }
                        }
                    }
                }

                return {token: 'literal', type:xmlSchema+"integer", value:''+count};
            } else if(aggregateType === 'sum' || aggregateType === 'avg') {
                var distinct = {};
                var aggregated = {token: 'literal', type:xmlSchema+"integer", value:'0'};
                var count = 0;
                for(var i=0; i< bindingsGroup.length; i++) {
                    var ebv = aggregateValue(aggregator, bindingsGroup[i], queryEngine, dataset, env);
                    if(ebv == null) {
                        continue;
                    } else if(!QueryFilters.isNumeric(ebv)) {
                        // a value that is no number makes the aggregate a type error
                        return QueryFilters.ebvError();
                    }
                    if(isDistinct) {
                        var key = Utils.hashTerm(ebv);
                        if(distinct[key] != null) {
                            continue;
                        }
                        distinct[key] = true;
                    }
                    aggregated = QueryFilters.runSumFunction(aggregated, ebv);
                    count++;
                }

                if(aggregateType === 'sum' || count === 0) {
                    // AVG of no values is 0, as for an empty group
                    return QueryFilters.resultTerm(aggregated);
                }
                return QueryFilters.resultTerm(QueryFilters.runDivFunction(aggregated, {token: 'literal', type:xmlSchema+"integer", value:''+count}));
            } else if(aggregateType === 'group_concat') {
                var distinct = {};
                var values = [];
                var separator = aggregator.expression.separator != null ? aggregator.expression.separator : " ";
                for(var i=0; i< bindingsGroup.length; i++) {
                    var ebv = aggregateValue(aggregator, bindingsGroup[i], queryEngine, dataset, env);
                    if(ebv != null && ebv.token === 'literal') {
                        if(isDistinct) {
                            var key = Utils.hashTerm(ebv);
                            if(distinct[key] == null) {
                                distinct[key] = true;
                                values.push(ebv.value);
                            }
                        } else {
                            values.push(ebv.value);
                        }
                    }
                }

                return {token: 'literal', type:null, value:values.join(separator)};
            }
        }
    }
};

// Evaluates an expression; every sub-expression goes through here as well. An exception while evaluating
// (e.g. a builtin applied to an unbound variable, or a failing custom function) is an expression error, as
// in SPARQL, so || and && can still decide. An unsupported feature is noted on the query environment, and
// the query reports it once it has finished (see QueryEngine.executeSelect).
QueryFilters.runFilter = function(filterExpr, bindings, queryEngine, dataset, env) {
    try {
        return QueryFilters.runExpression(filterExpr, bindings, queryEngine, dataset, env);
    } catch(e) {
        if(e instanceof NonSupportedSparqlFeatureError && env != null && env.unsupportedFeature == null)
            env.unsupportedFeature = e;
        return QueryFilters.ebvError();
    }
};

QueryFilters.runExpression = function(filterExpr, bindings, queryEngine, dataset, env) {
    //console.log("RUNNING FILTER");
    //console.log(filterExpr);
    if(filterExpr.expressionType != null) {
        var expressionType = filterExpr.expressionType;
        if(expressionType == 'relationalexpression') {
            var op1 = QueryFilters.runFilter(filterExpr.op1, bindings,queryEngine, dataset, env);
            var op2 = QueryFilters.runFilter(filterExpr.op2, bindings,queryEngine, dataset, env);
            return QueryFilters.runRelationalFilter(filterExpr, op1, op2, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'conditionalor') {
            return QueryFilters.runOrFunction(filterExpr, bindings, queryEngine, dataset, env);
        } else if (expressionType == 'conditionaland') {
            return QueryFilters.runAndFunction(filterExpr, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'additiveexpression') {
            return QueryFilters.runAddition(filterExpr.summand, filterExpr.summands, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'builtincall') {
            return QueryFilters.runBuiltInCall(filterExpr.builtincall, filterExpr.args, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'multiplicativeexpression') {
            return QueryFilters.runMultiplication(filterExpr.factor, filterExpr.factors, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'unaryexpression') {
            return QueryFilters.runUnaryExpression(filterExpr.unaryexpression, filterExpr.expression, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'irireforfunction') {
            return QueryFilters.runIriRefOrFunction(filterExpr.iriref, filterExpr.args, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'regex') {
            return QueryFilters.runRegex(filterExpr.text, filterExpr.pattern, filterExpr.flags, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'custom') {
            return QueryFilters.runBuiltInCall(filterExpr.name, filterExpr.args, bindings, queryEngine, dataset, env);
        } else if(expressionType == 'atomic') {
            if(filterExpr.primaryexpression == 'var') {
                // lookup the var in the bindings
                return bindings[filterExpr.value.value];
            } else {
                // numeric, literal, etc...
                //return queryEngine.filterExpr.value;
                if(typeof(filterExpr.value) != 'object') {
                    return filterExpr.value
                } else {
                    if(filterExpr.value.type == null || typeof(filterExpr.value.type) != 'object') {
                        return filterExpr.value
                    } else {
                        // type can be parsed as a hash using namespaces

                        filterExpr.value.type =  Utils.lexicalFormBaseUri(filterExpr.value.type, env);
                        return filterExpr.value
                    }
                }
            }
        } else {
            throw("Unknown filter expression type");
        }
    } else {
        throw("Cannot find bound expressions in a no expression token");
    }
};

QueryFilters.isRDFTerm = function(val) {
    if(val==null) {
        return false;
    } if((val.token && val.token == 'literal') ||
        (val.token && val.token == 'uri') ||
        (val.token && val.token == 'blank')) {
        return true;
    } else {
        return false;
    }
};


/*
 17.4.1.7 RDFterm-equal

 xsd:boolean   RDF term term1 = RDF term term2

 Returns TRUE if term1 and term2 are the same RDF term as defined in Resource Description Framework (RDF):
 Concepts and Abstract Syntax [CONCEPTS]; produces a type error if the arguments are both literal but are not
 the same RDF term *; returns FALSE otherwise. term1 and term2 are the same if any of the following is true:

 term1 and term2 are equivalent IRIs as defined in 6.4 RDF URI References of [CONCEPTS].
 term1 and term2 are equivalent literals as defined in 6.5.1 Literal Equality of [CONCEPTS].
 term1 and term2 are the same blank node as described in 6.6 Blank Nodes of [CONCEPTS].

 * Two different literals that both have a known value (isKnownLiteral) are different values, so FALSE.
 */
QueryFilters.RDFTermEquality = function(v1, v2, queryEngine, env) {
    if(v1.token === 'literal' && v2.token === 'literal') {
        if(v1.lang == v2.lang && v1.type == v2.type && v1.value == v2.value) {
            return true;
        }
        return QueryFilters.isKnownLiteral(v1) && QueryFilters.isKnownLiteral(v2) ? false : QueryFilters.ebvError();
    } else if(v1.token === 'uri' && v2.token === 'uri') {
        return Utils.lexicalFormBaseUri(v1, env) == Utils.lexicalFormBaseUri(v2, env);
    } else if(v1.token === 'blank' && v2.token === 'blank') {
        return v1.value == v2.value;
    } else {
        return false;
    }
};


QueryFilters.isInteger = function(val) {
    if(val == null) {
        return false;
    }
    if(val.token === 'literal') {
        if(val.type == xmlSchema+"integer" ||
            val.type == xmlSchema+"decimal" ||
            val.type == xmlSchema+"double" ||
            val.type == xmlSchema+"nonPositiveInteger" ||
            val.type == xmlSchema+"negativeInteger" ||
            val.type == xmlSchema+"long" ||
            val.type == xmlSchema+"int" ||
            val.type == xmlSchema+"short" ||
            val.type == xmlSchema+"byte" ||
            val.type == xmlSchema+"nonNegativeInteger" ||
            val.type == xmlSchema+"unsignedLong" ||
            val.type == xmlSchema+"unsignedInt" ||
            val.type == xmlSchema+"unsignedShort" ||
            val.type == xmlSchema+"unsignedByte" ||
            val.type == xmlSchema+"positiveInteger" ) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};

QueryFilters.isFloat = function(val) {
    if(val == null) {
        return false;
    }
    if(val.token === 'literal') {
        if(val.type == xmlSchema+"float") {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};

QueryFilters.isDecimal = function(val) {
    if(val == null) {
        return false;
    }
    if(val.token === 'literal') {
        if(val.type == xmlSchema+"decimal") {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};

QueryFilters.isDouble = function(val) {
    if(val == null) {
        return false;
    }
    if(val.token === 'literal') {
        if(val.type == xmlSchema+"double") {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};


QueryFilters.isNumeric = function(val) {
    if(val == null) {
        return false;
    }
    if(val.token === 'literal') {
        if(val.type == xmlSchema+"integer" ||
            val.type == xmlSchema+"decimal" ||
            val.type == xmlSchema+"float" ||
            val.type == xmlSchema+"double" ||
            val.type == xmlSchema+"nonPositiveInteger" ||
            val.type == xmlSchema+"negativeInteger" ||
            val.type == xmlSchema+"long" ||
            val.type == xmlSchema+"int" ||
            val.type == xmlSchema+"short" ||
            val.type == xmlSchema+"byte" ||
            val.type == xmlSchema+"nonNegativeInteger" ||
            val.type == xmlSchema+"unsignedLong" ||
            val.type == xmlSchema+"unsignedInt" ||
            val.type == xmlSchema+"unsignedShort" ||
            val.type == xmlSchema+"unsignedByte" ||
            val.type == xmlSchema+"positiveInteger" ) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};

QueryFilters.isSimpleLiteral = function(val) {
    if(val && val.token == 'literal') {
        if(val.type == null && val.lang == null) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};

QueryFilters.isXsdType = function(type, val) {
    if(val && val.token == 'literal') {
        return val.type == xmlSchema+""+type;
    } else {
        return false;
    }
};

QueryFilters.ebv = function (term) {
    if (term == null || QueryFilters.isEbvError(term)) {
        return QueryFilters.ebvError();
    } else {
        if (term.token && term.token === 'literal') {
            if (term.type == xmlSchema+"integer" ||
                term.type == xmlSchema+"decimal" ||
                term.type == xmlSchema+"double" ||
                term.type == xmlSchema+"nonPositiveInteger" ||
                term.type == xmlSchema+"negativeInteger" ||
                term.type == xmlSchema+"long" ||
                term.type == xmlSchema+"int" ||
                term.type == xmlSchema+"short" ||
                term.type == xmlSchema+"byte" ||
                term.type == xmlSchema+"nonNegativeInteger" ||
                term.type == xmlSchema+"unsignedLong" ||
                term.type == xmlSchema+"unsignedInt" ||
                term.type == xmlSchema+"unsignedShort" ||
                term.type == xmlSchema+"unsignedByte" ||
                term.type == xmlSchema+"positiveInteger") {
                var tmp = parseFloat(term.value);
                if (isNaN(tmp)) {
                    return false;
                } else {
                    return parseFloat(term.value) != 0;
                }
            } else if (term.type === xmlSchema+"boolean") {
                return (term.value === 'true' || term.value === true || term.value === 'True');
            } else if (term.type === xmlSchema+"string") {
                return term.value != "";
            } else if (term.type === xmlSchema+"dateTime") {
                return (new Date(term.value)) != null;
            } else if (QueryFilters.isEbvError(term)) {
                return term;
            } else if (term.type == null) {
                if (term.value != "") {
                    return true;
                } else {
                    return false;
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if (term.token === 'uri' || term.token === 'blank') {
            // an IRI or blank node has no effective boolean value
            return QueryFilters.ebvError();
        } else {
            return term.value === true;
        }
    }
};

QueryFilters.effectiveBooleanValue = QueryFilters.ebv;

QueryFilters.ebvTrue = function() {
    var val = {token: 'literal', type:xmlSchema+"boolean", value:true};
    return val;
};

QueryFilters.ebvFalse = function() {
    var val = {token: 'literal', type:xmlSchema+"boolean", value:false};
    return val;
};

QueryFilters.ebvError = function() {
    var val = {token: 'literal', type:"https://github.com/antoniogarrote/js-tools/types#error", value:null};
    return val;
};

QueryFilters.isEbvError = function(term) {
    if(typeof(term) == 'object' && term != null) {
        return term.type === "https://github.com/antoniogarrote/js-tools/types#error";
//    } else if(term == null) {
//        return true;
    } else {
        return false;
    }
};

QueryFilters.ebvBoolean = function (bool) {
    if (QueryFilters.isEbvError(bool)) {
        return bool;
    } else {
        if (bool === true) {
            return QueryFilters.ebvTrue();
        } else {
            return QueryFilters.ebvFalse();
        }
    }
};


QueryFilters.runRelationalFilter = function(filterExpr, op1, op2, bindings, queryEngine, dataset, env) {
    var operator = filterExpr.operator;
    if(operator === '=') {
        return QueryFilters.runEqualityFunction(op1, op2, bindings, queryEngine, dataset, env);
    } else if(operator === '!=') {
        var res = QueryFilters.runEqualityFunction(op1, op2, bindings, queryEngine, dataset, env);
        if(QueryFilters.isEbvError(res)) {
            return res;
        } else {
            res.value = !res.value;
            return res;
        }
    } else if(operator === '<') {
        return QueryFilters.runLtFunction(op1, op2, bindings);
    } else if(operator === '>') {
        return QueryFilters.runGtFunction(op1, op2, bindings);
    } else if(operator === '<=') {
        return QueryFilters.runLtEqFunction(op1, op2, bindings);
    } else if(operator === '>=') {
        return QueryFilters.runGtEqFunction(op1, op2, bindings);
    } else {
        throw("Error applying relational filter, unknown operator");
    }
};

/**
 * Transforms a JS object representing a [typed] literal in a javascript
 * value that can be used in javascript operations and functions
 */
// The number of a numeric literal: its lexical form, or the number of a computed literal.
QueryFilters.numericValue = function(value) {
    if(value === 'INF' || value === '+INF') {
        return Infinity;
    } else if(value === '-INF') {
        return -Infinity;
    }
    return typeof(value) === 'number' ? value : parseFloat(value);
};

// The lexical form of a computed number: INF, -INF and NaN for infinite and undefined results, and no
// exponent notation (which JavaScript uses from 1e21 and below 1e-6) except for xsd:double and xsd:float.
QueryFilters.lexicalForm = function(value, type) {
    if(value === Infinity) {
        return 'INF';
    } else if(value === -Infinity) {
        return '-INF';
    }
    var lexical = '' + value;
    if(typeof(value) === 'number' && lexical.indexOf('e') !== -1 && type !== xmlSchema+"double" && type !== xmlSchema+"float") {
        lexical = Number.isInteger(value) ? BigInt(value).toString() : value.toFixed(20).replace(/.?0+$/, '');
    }
    return lexical;
};

// A computed literal as a value of a solution: expressions compute literals with a number or boolean
// value, while stored literals carry their lexical form as a string.
QueryFilters.resultTerm = function(term) {
    if(term == null || term.value == null || typeof(term.value) === 'string') {
        return term;
    }
    var copy = Utils.clone(term);
    copy.value = QueryFilters.lexicalForm(term.value, term.type);
    return copy;
};

QueryFilters.effectiveTypeValue = function(val){
    if(val.token == 'literal') {
        if(QueryFilters.isNumeric(val)) {
            return QueryFilters.numericValue(val.value);
        } else if (val.type == xmlSchema+"date" ||
            val.type == xmlSchema+"dateTime" ) {
            try {
                var d = Utils.parseISO8601(val.value);
                return(d);
            } catch(e) {
                return null;
            }
        } else if (val.type == xmlSchema+"boolean" ) {
            return val.value === true || val.value === 'true' || val.value === '1' || val.value === 1 || val.value === true ? true :
                val.value === false || val.value === 'false' || val.value === '0' || val.value === 0 || val.value === false ? false :
                    undefined;
        } else if (val.type == xmlSchema+"string" ) {
            return val.value === null || val.value === undefined ? undefined : ''+val.value;
        } else if (val.type == null) {
            // plain literal -> just manipulate the string
            return val.value;
        } else {
            return val.value
        }
    } else {
        // @todo
        throw("value not supported in operations yet");
    }
};

/*
 A logical-or that encounters an error on only one branch will return TRUE if the other branch is TRUE and an error if the other branch is FALSE.
 A logical-or or logical-and that encounters errors on both branches will produce either of the errors.
 */
QueryFilters.runOrFunction = function(filterExpr, bindings, queryEngine, dataset, env) {

    var acum = null;

    for(var i=0; i< filterExpr.operands.length; i++) {
        var ebv = QueryFilters.runFilter(filterExpr.operands[i], bindings, queryEngine, dataset, env);
        if(QueryFilters.isEbvError(ebv) == false) {
            ebv = QueryFilters.ebv(ebv);
        }
        if(acum == null) {
            acum = ebv;
        } else if(QueryFilters.isEbvError(ebv)) {
            if(QueryFilters.isEbvError(acum)) {
                acum = QueryFilters.ebvError();
            } else if(acum === true) {
                acum = true;
            } else {
                acum = QueryFilters.ebvError();
            }
        } else if(ebv === true) {
            acum = true;
        } else {
            if(QueryFilters.isEbvError(acum)) {
                acum = QueryFilters.ebvError();
            }
        }
    }

    return QueryFilters.ebvBoolean(acum);
};

/*
 A logical-and that encounters an error on only one branch will return an error if the other branch is TRUE and FALSE if the other branch is FALSE.
 A logical-or or logical-and that encounters errors on both branches will produce either of the errors.
 */
QueryFilters.runAndFunction = function(filterExpr, bindings, queryEngine, dataset, env) {

    var acum = null;

    for(var i=0; i< filterExpr.operands.length; i++) {

        var ebv = QueryFilters.runFilter(filterExpr.operands[i], bindings, queryEngine, dataset, env);

        if(QueryFilters.isEbvError(ebv) == false) {
            ebv = QueryFilters.ebv(ebv);
        }

        if(acum == null) {
            acum = ebv;
        } else if(QueryFilters.isEbvError(ebv)) {
            if(QueryFilters.isEbvError(acum)) {
                acum = QueryFilters.ebvError();
            } else if(acum === true) {
                acum = QueryFilters.ebvError();
            } else {
                acum = false;
            }
        } else if(ebv === true) {
            if(QueryFilters.isEbvError(acum)) {
                acum = QueryFilters.ebvError();
            }
        } else {
            acum = false;
        }
    }

    return QueryFilters.ebvBoolean(acum);
};


// The kind of value by which two terms compare (SPARQL operator mapping), or null if they can't be compared.
// Simple literals and xsd:string compare as strings, as RDF 1.1 makes them the same.
QueryFilters.comparisonKind = function(op1, op2) {
    var isString = function(op) {
        return QueryFilters.isSimpleLiteral(op) || QueryFilters.isXsdType("string", op);
    };
    if(QueryFilters.isNumeric(op1) && QueryFilters.isNumeric(op2)) {
        return 'numeric';
    } else if(isString(op1) && isString(op2)) {
        return 'string';
    }
    var types = ["boolean", "dateTime", "date"];
    for(var i=0; i<types.length; i++) {
        if(QueryFilters.isXsdType(types[i], op1) && QueryFilters.isXsdType(types[i], op2)) {
            return types[i];
        }
    }
    return null;
};

// -1, 0 or 1; null if a value is NaN, which is unordered; an error if the values can't be compared or one has an
// invalid lexical form (effectiveTypeValue gives NaN for such a number or date, undefined for such a boolean)
QueryFilters.runCompare = function(op1, op2) {
    if(QueryFilters.isEbvError(op1) || QueryFilters.isEbvError(op2) || QueryFilters.comparisonKind(op1, op2) == null) {
        return QueryFilters.ebvError();
    }
    var isValid = function(op, value) {
        return value !== undefined && (value === value ||
            (QueryFilters.isNumeric(op) && (op.value === 'NaN' || typeof(op.value) === 'number')));
    };
    var v1 = QueryFilters.effectiveTypeValue(op1);
    var v2 = QueryFilters.effectiveTypeValue(op2);
    if(!isValid(op1, v1) || !isValid(op2, v2)) {
        return QueryFilters.ebvError();
    } else if(v1 < v2) {
        return -1;
    } else if(v1 > v2) {
        return 1;
    } else if(v1 === v2) {
        return 0;
    }
    return null;
};

// A literal whose value is known: a (language-tagged) string, or a valid value of a type in comparisonKind.
// Two different known literals are different values; with an unknown type they might still be equal.
QueryFilters.isKnownLiteral = function(term) {
    return term.lang != null || !QueryFilters.isEbvError(QueryFilters.runCompare(term, term));
};

QueryFilters.runEqualityFunction = function(op1, op2, bindings, queryEngine, dataset, env) {
    if(!QueryFilters.isRDFTerm(op1) || !QueryFilters.isRDFTerm(op2)) {
        // an error or an unbound variable
        return QueryFilters.ebvError();
    }
    var comp = QueryFilters.runCompare(op1, op2);
    if(comp === null) {
        return QueryFilters.ebvFalse();
    } else if(!QueryFilters.isEbvError(comp)) {
        return QueryFilters.ebvBoolean(comp === 0);
    }
    return QueryFilters.ebvBoolean(QueryFilters.RDFTermEquality(op1, op2, queryEngine, env));
};

var relationalFunction = function(test) {
    return function(op1, op2) {
        var comp = QueryFilters.runCompare(op1, op2);
        if(QueryFilters.isEbvError(comp)) {
            return comp;
        }
        return QueryFilters.ebvBoolean(comp != null && test(comp));
    };
};

QueryFilters.runGtFunction = relationalFunction(function(comp) { return comp > 0; });
QueryFilters.runLtFunction = relationalFunction(function(comp) { return comp < 0; });
QueryFilters.runGtEqFunction = relationalFunction(function(comp) { return comp >= 0; });
QueryFilters.runLtEqFunction = relationalFunction(function(comp) { return comp <= 0; });

/**
 * Total gt function used when sorting bindings in the SORT BY clause.
 *
 * @todo
 * Some criteria are not clear
 */
QueryFilters.runTotalGtFunction = function(op1,op2) {
    if(QueryFilters.isEbvError(op1) || QueryFilters.isEbvError(op2)) {
        return QueryFilters.ebvError();
    }

    var comp = QueryFilters.runCompare(op1, op2);
    if(typeof(comp) === 'number') {
        return QueryFilters.ebvBoolean(comp > 0);
    } else if(op1.token && op1.token === 'uri' && op2.token && op2.token === 'uri') {
        return QueryFilters.ebvBoolean(op1.value > op2.value);
    } else if(op1.token && op1.token === 'literal' && op2.token && op2.token === 'literal') {
        // one of the literals must have type/lang and the othe may not have them
        return QueryFilters.ebvBoolean(""+op1.value+op1.type+op1.lang > ""+op2.value+op2.type+op2.lang);
    } else if(op1.token && op1.token === 'blank' && op2.token && op2.token === 'blank') {
        return QueryFilters.ebvBoolean(op1.value > op2.value);
    } else if(op1.value && op2.value) {
        return QueryFilters.ebvBoolean(op1.value > op2.value);
    } else {
        return QueryFilters.ebvTrue();
    }
};


QueryFilters.runAddition = function(summand, summands, bindings, queryEngine, dataset, env) {
    var summandOp = QueryFilters.runFilter(summand,bindings,queryEngine, dataset, env);
    if(QueryFilters.isEbvError(summandOp)) {
        return QueryFilters.ebvError();
    }

    // a non-numeric operand is a type error
    var acum = summandOp;
    if(QueryFilters.isNumeric(summandOp)) {
        for(var i=0; i<summands.length; i++) {
            var nextSummandOp = QueryFilters.runFilter(summands[i].expression, bindings,queryEngine, dataset, env);
            if(QueryFilters.isNumeric(nextSummandOp)) {
                if(summands[i].operator === '+') {
                    acum = QueryFilters.runSumFunction(acum, nextSummandOp);
                } else if(summands[i].operator === '-') {
                    acum = QueryFilters.runSubFunction(acum, nextSummandOp);
                }
            } else {
                return QueryFilters.ebvError();
            }
        }
        return acum;
    } else {
        return QueryFilters.ebvError();
    }
};

QueryFilters.runSumFunction = function(suma, sumb) {
    if(QueryFilters.isEbvError(suma) || QueryFilters.isEbvError(sumb)) {
        return QueryFilters.ebvError();
    }
    var val = QueryFilters.effectiveTypeValue(suma) + QueryFilters.effectiveTypeValue(sumb);

    if(QueryFilters.isDouble(suma) || QueryFilters.isDouble(sumb)) {
        return {token: 'literal', type:xmlSchema+"double", value:val};
    } else if(QueryFilters.isFloat(suma) || QueryFilters.isFloat(sumb)) {
        return {token: 'literal', type:xmlSchema+"float", value:val};
    } else if(QueryFilters.isDecimal(suma) || QueryFilters.isDecimal(sumb)) {
        return {token: 'literal', type:xmlSchema+"decimal", value:val};
    } else {
        return {token: 'literal', type:xmlSchema+"integer", value:val};
    }
};

QueryFilters.runSubFunction = function(suma, sumb) {
    if(QueryFilters.isEbvError(suma) || QueryFilters.isEbvError(sumb)) {
        return QueryFilters.ebvError();
    }
    var val = QueryFilters.effectiveTypeValue(suma) - QueryFilters.effectiveTypeValue(sumb);

    if(QueryFilters.isDouble(suma) || QueryFilters.isDouble(sumb)) {
        return {token: 'literal', type:xmlSchema+"double", value:val};
    } else if(QueryFilters.isFloat(suma) || QueryFilters.isFloat(sumb)) {
        return {token: 'literal', type:xmlSchema+"float", value:val};
    } else if(QueryFilters.isDecimal(suma) || QueryFilters.isDecimal(sumb)) {
        return {token: 'literal', type:xmlSchema+"decimal", value:val};
    } else {
        return {token: 'literal', type:xmlSchema+"integer", value:val};
    }
};

QueryFilters.runMultiplication = function(factor, factors, bindings, queryEngine, dataset, env) {
    var factorOp = QueryFilters.runFilter(factor,bindings,queryEngine, dataset, env);
    if(QueryFilters.isEbvError(factorOp)) {
        return factorOp;
    }

    // a non-numeric operand (or an error) is a type error
    var acum = factorOp;
    if(QueryFilters.isNumeric(factorOp)) {
        for(var i=0; i<factors.length; i++) {
            var nextFactorOp = QueryFilters.runFilter(factors[i].expression, bindings,queryEngine, dataset, env);
            if(QueryFilters.isNumeric(nextFactorOp)) {
                if(factors[i].operator === '*') {
                    acum = QueryFilters.runMulFunction(acum, nextFactorOp);
                } else if(factors[i].operator === '/') {
                    acum = QueryFilters.runDivFunction(acum, nextFactorOp);
                }
            } else {
                return QueryFilters.ebvError();
            }
        }
        return acum;
    } else {
        return QueryFilters.ebvError();
    }
};

QueryFilters.runMulFunction = function(faca, facb) {
    if(QueryFilters.isEbvError(faca) || QueryFilters.isEbvError(facb)) {
        return QueryFilters.ebvError();
    }
    var val = QueryFilters.effectiveTypeValue(faca) * QueryFilters.effectiveTypeValue(facb);

    if(QueryFilters.isDouble(faca) || QueryFilters.isDouble(facb)) {
        return {token: 'literal', type:xmlSchema+"double", value:val};
    } else if(QueryFilters.isFloat(faca) || QueryFilters.isFloat(facb)) {
        return {token: 'literal', type:xmlSchema+"float", value:val};
    } else if(QueryFilters.isDecimal(faca) || QueryFilters.isDecimal(facb)) {
        return {token: 'literal', type:xmlSchema+"decimal", value:val};
    } else {
        return {token: 'literal', type:xmlSchema+"integer", value:val};
    }
};

// op:numeric-divide: integer / integer is a decimal, and dividing a decimal or integer by zero is an error
// (a float or double gives INF or NaN)
QueryFilters.runDivFunction = function(faca, facb) {
    if(QueryFilters.isEbvError(faca) || QueryFilters.isEbvError(facb)) {
        return QueryFilters.ebvError();
    }
    var divisor = QueryFilters.effectiveTypeValue(facb);
    var val = QueryFilters.effectiveTypeValue(faca) / divisor;

    if(QueryFilters.isDouble(faca) || QueryFilters.isDouble(facb)) {
        return {token: 'literal', type:xmlSchema+"double", value:val};
    } else if(QueryFilters.isFloat(faca) || QueryFilters.isFloat(facb)) {
        return {token: 'literal', type:xmlSchema+"float", value:val};
    } else if(divisor == 0) {
        return QueryFilters.ebvError();
    } else {
        return {token: 'literal', type:xmlSchema+"decimal", value:val};
    }
};

QueryFilters.runBuiltInCall = function(builtincall, args, bindings, queryEngine, dataset, env) {
    if(builtincall === 'notexists' || builtincall === 'exists') {
        // args hast to be the boolean value preprocessed already so we can keep this function sync
        var bindingsKey = [];
        for(var p in bindings) { bindingsKey.push(JSON.stringify(bindings[p]));}
        bindingsKey = bindingsKey.sort().join("");

        return args[bindingsKey];
    }  else {

        var ops = [];
        for(var i=0; i<args.length; i++) {
            if(args[i].token === 'var') {
                ops.push(args[i]);
            } else {
                var op = QueryFilters.runFilter(args[i], bindings, queryEngine, dataset, env);
                if(QueryFilters.isEbvError(op)) {
                    return op;
                }
                ops.push(op);
            }
        }

        if(builtincall === 'str') {
            if(ops[0].token === 'literal') {
                // lexical form literals
                return {token: 'literal', type:null, value:""+ops[0].value}; // type null? or xmlSchema+"string"
            } else if(ops[0].token === 'uri'){
                // codepoint URIs
                return {token: 'literal', type:null, value:ops[0].value}; // idem
            } else {
                return QueryFilters.ebvFalse();
            }
        } else if(builtincall === 'lang') {
            if(ops[0].token === 'literal'){
                if(ops[0].lang != null) {
                    return {token: 'literal', value:""+ops[0].lang};
                } else {
                    return {token: 'literal', value:""};
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if(builtincall === 'datatype') {
            if(ops[0].token === 'literal'){
                var lit = ops[0];
                if(lit.type != null) {
                    if(typeof(lit.type) === 'string') {
                        return {token: 'uri', value:lit.type, prefix:null, suffix:null};
                    } else {
                        return lit.type;
                    }
                } else if(lit.lang == null) {
                    return {token: 'uri', value:'http://www.w3.org/2001/XMLSchema#string', prefix:null, suffix:null};
                } else {
                    return QueryFilters.ebvError();
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if(builtincall === 'isliteral') {
            if(ops[0].token === 'literal'){
                return QueryFilters.ebvTrue();
            } else {
                return QueryFilters.ebvFalse();
            }
        } else if(builtincall === 'isblank') {
            if(ops[0].token === 'blank'){
                return QueryFilters.ebvTrue();
            } else {
                return QueryFilters.ebvFalse();
            }
        } else if(builtincall === 'isuri' || builtincall === 'isiri') {
            if(ops[0].token === 'uri'){
                return QueryFilters.ebvTrue();
            } else {
                return QueryFilters.ebvFalse();
            }
        } else if(builtincall === 'sameterm') {
            var op1 = ops[0];
            var op2 = ops[1];
            var res = QueryFilters.RDFTermEquality(op1, op2, queryEngine, env);
            if(QueryFilters.isEbvError(res)) {
                res = false;
            }
            return QueryFilters.ebvBoolean(res);
        } else if(builtincall === 'langmatches') {
            var lang = ops[0];
            var langRange = ops[1];

            if(lang.token === 'literal' && langRange.token === 'literal'){
                if(langRange.value === '*' && lang.value != '') {
                    return QueryFilters.ebvTrue();
                } else {
                    return QueryFilters.ebvBoolean(lang.value.toLowerCase().indexOf(langRange.value.toLowerCase()) === 0)
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if(builtincall === 'bound') {
            var boundVar = ops[0].value;
            var acum = [];
            if(boundVar == null) {
                return QueryFilters.ebvError();
            } else  if(bindings[boundVar] != null) {
                return QueryFilters.ebvTrue();
            } else {
                return QueryFilters.ebvFalse();
            }
        } else if(queryEngine.customFns[builtincall] != null) {
            return queryEngine.customFns[builtincall](QueryFilters, ops);
        } else {
            throw new NonSupportedSparqlFeatureError(builtincall, "Builtin call "+builtincall+" not implemented yet");
        }
    }
};

QueryFilters.runUnaryExpression = function(unaryexpression, expression, bindings, queryEngine, dataset, env) {
    var op = QueryFilters.runFilter(expression, bindings,queryEngine, dataset, env);
    if(QueryFilters.isEbvError(op)) {
        return op;
    }

    if(unaryexpression === '!') {
        var res = QueryFilters.ebv(op);
        if(QueryFilters.isEbvError(res)) {
            return res;
        } else {
            return QueryFilters.ebvBoolean(!res);
        }
    } else if(unaryexpression === '+') {
        if(QueryFilters.isNumeric(op)) {
            return op;
        } else {
            return QueryFilters.ebvError();
        }
    } else if(unaryexpression === '-') {
        if(QueryFilters.isNumeric(op)) {
            var clone = {};
            for(var p in op) {
                clone[p] = op[p];
            }
            clone.value = -clone.value;
            return clone;
        } else {
            return QueryFilters.ebvError();
        }
    }
};

QueryFilters.runRegex = function(text, pattern, flags, bindings, queryEngine, dataset, env) {

    if(text != null) {
        text = QueryFilters.runFilter(text, bindings, queryEngine, dataset, env);
    } else {
        return QueryFilters.ebvError();
    }

    if(pattern != null) {
        pattern = QueryFilters.runFilter(pattern, bindings, queryEngine, dataset, env);
    } else {
        return QueryFilters.ebvError();
    }

    if(flags != null) {
        flags = QueryFilters.runFilter(flags, bindings, queryEngine, dataset, env);
    }


    if(pattern != null && pattern.token === 'literal' && (flags == null || flags.token === 'literal')) {
        pattern = pattern.value;
        flags = (flags == null) ? null : flags.value;
    } else {
        return QueryFilters.ebvError();
    }

    if(text!= null && text.token == 'var') {
        if(bindings[text.value] != null) {
            text = bindings[text.value];
        } else {
            return QueryFilters.ebvError();
        }
    } else if(text!=null && text.token === 'literal') {
        if(text.type == null || QueryFilters.isXsdType("string",text)) {
            text = text.value
        } else {
            return QueryFilters.ebvError();
        }
    } else {
        return QueryFilters.ebvError();
    }

    var regex;
    if(flags == null) {
        regex = new RegExp(pattern);
    } else {
        regex = new RegExp(pattern,flags.toLowerCase());
    }
    if(regex.exec(text)) {
        return QueryFilters.ebvTrue();
    } else {
        return QueryFilters.ebvFalse();
    }
};

QueryFilters.normalizeLiteralDatatype = function(literal, queryEngine, env) {
    if(literal.value.type == null || typeof(literal.value.type) != 'object') {
        return literal;
    } else {
        // type can be parsed as a hash using namespaces
        literal.value.type =  Utils.lexicalFormBaseUri(literal.value.type, env);
        return literal;
    }
};

QueryFilters.runIriRefOrFunction = function(iriref, args, bindings,queryEngine, dataset, env) {
    if(args == null) {
        // an IRI of the query, possibly prefixed or relative
        return {token: 'uri', value: Utils.lexicalFormBaseUri(iriref, env)};
    } else {
        var ops = [];
        for(var i=0; i<args.length; i++) {
            ops.push(QueryFilters.runFilter(args[i], bindings, queryEngine, dataset, env));
        }

        var fun = Utils.lexicalFormBaseUri(iriref, env);

        if(fun == xmlSchema+"integer" ||
            fun == xmlSchema+"decimal" ||
            fun == xmlSchema+"double" ||
            fun == xmlSchema+"nonPositiveInteger" ||
            fun == xmlSchema+"negativeInteger" ||
            fun == xmlSchema+"long" ||
            fun == xmlSchema+"int" ||
            fun == xmlSchema+"short" ||
            fun == xmlSchema+"byte" ||
            fun == xmlSchema+"nonNegativeInteger" ||
            fun == xmlSchema+"unsignedLong" ||
            fun == xmlSchema+"unsignedInt" ||
            fun == xmlSchema+"unsignedShort" ||
            fun == xmlSchema+"unsignedByte" ||
            fun == xmlSchema+"positiveInteger") {
            var from = ops[0];
            if(from.token === 'literal') {
                from = QueryFilters.normalizeLiteralDatatype(from, queryEngine, env);
                if(from.type == xmlSchema+"integer" ||
                    from.type == xmlSchema+"decimal" ||
                    from.type == xmlSchema+"double" ||
                    from.type == xmlSchema+"nonPositiveInteger" ||
                    from.type == xmlSchema+"negativeInteger" ||
                    from.type == xmlSchema+"long" ||
                    from.type == xmlSchema+"int" ||
                    from.type == xmlSchema+"short" ||
                    from.type == xmlSchema+"byte" ||
                    from.type == xmlSchema+"nonNegativeInteger" ||
                    from.type == xmlSchema+"unsignedLong" ||
                    from.type == xmlSchema+"unsignedInt" ||
                    from.type == xmlSchema+"unsignedShort" ||
                    from.type == xmlSchema+"unsignedByte" ||
                    from.type == xmlSchema+"positiveInteger") {
                    from.type = fun;
                    return from;
                } else if(from.type == 'http://www.w3.org/2001/XMLSchema#boolean') {
                    if(QueryFilters.ebv(from) == true) {
                        from.type = fun;
                        from.value = 1;
                    } else {
                        from.type = fun;
                        from.value = 0;
                    }
                    return from;
                } else if(from.type == 'http://www.w3.org/2001/XMLSchema#float' ||
                    from.type == 'http://www.w3.org/2001/XMLSchema#double') {
                    from.type = fun;
                    from.value = parseInt(from.value);
                    return from;
                } else if(from.type == 'http://www.w3.org/2001/XMLSchema#string' || from.type == null) {
                    if(from.value.split(".").length > 2) {
                        return QueryFilters.ebvError();
                    } else if (from.value.split("-").length > 2) {
                        return QueryFilters.ebvError();
                    } else if (from.value.split("/").length > 2) {
                        return QueryFilters.ebvError();
                    } else if (from.value.split("+").length > 2) {
                        return QueryFilters.ebvError();
                    }

                    // @todo improve this with regular expressions for each lexical representation
                    if(fun == xmlSchema+"decimal") {
                        if(from.value.indexOf("e") != -1 || from.value.indexOf("E") != -1) {
                            return QueryFilters.ebvError();
                        }
                    }

                    // @todo improve this with regular expressions for each lexical representation
                    if(fun == xmlSchema+"int" || fun == xmlSchema+"integer") {
                        if(from.value.indexOf("e") != -1 || from.value.indexOf("E") != -1 || from.value.indexOf(".") != -1) {
                            return QueryFilters.ebvError();
                        }
                    }

                    try {
                        from.value = parseInt(parseFloat(from.value));
                        if(isNaN(from.value)) {
                            return QueryFilters.ebvError();
                        } else {
                            from.type = fun;
                            return from;
                        }
                    } catch(e) {
                        return QueryFilters.ebvError();
                    }
                } else {
                    return QueryFilters.ebvError();
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if(fun == xmlSchema+"boolean") {
            var from = ops[0];
            if(from.token === "literal" && from.type == null) {
                if(from.value === "true" || from.value === "1") {
                    return QueryFilters.ebvTrue();
                } else if(from.value === "false" || from.value === "0" ) {
                    return QueryFilters.ebvFalse();
                } else {
                    return QueryFilters.ebvError();
                }
            } else if(from.token === "literal") {
                if(QueryFilters.isEbvError(from)) {
                    return from;
                } else {
                    return QueryFilters.ebvBoolean(from);
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if(fun == xmlSchema+"string") {
            var from = ops[0];
            if(from.token === 'literal') {
                from = QueryFilters.normalizeLiteralDatatype(from, queryEngine, env);
                if(from.type == xmlSchema+"integer" ||
                    from.type == xmlSchema+"decimal" ||
                    from.type == xmlSchema+"double" ||
                    from.type == xmlSchema+"nonPositiveInteger" ||
                    from.type == xmlSchema+"negativeInteger" ||
                    from.type == xmlSchema+"long" ||
                    from.type == xmlSchema+"int" ||
                    from.type == xmlSchema+"short" ||
                    from.type == xmlSchema+"byte" ||
                    from.type == xmlSchema+"nonNegativeInteger" ||
                    from.type == xmlSchema+"unsignedLong" ||
                    from.type == xmlSchema+"unsignedInt" ||
                    from.type == xmlSchema+"unsignedShort" ||
                    from.type == xmlSchema+"unsignedByte" ||
                    from.type == xmlSchema+"positiveInteger" ||
                    from.type == xmlSchema+"float") {
                    from.type = fun;
                    from.value = ""+from.value;
                    return from;
                } else if(from.type == xmlSchema+"string") {
                    return from;
                } else if(from.type == xmlSchema+"boolean") {
                    if(QueryFilters.ebv(from)) {
                        from.type = fun;
                        from.value = 'true';
                    } else {
                        from.type = fun;
                        from.value = 'false';
                    }
                    return from;
                } else if(from.type == xmlSchema+"dateTime" ||
                    from.type == xmlSchema+"date") {
                    from.type = fun;
                    if(typeof(from.value) != 'string') {
                        from.value = Utils.iso8601(from.value);
                    }
                    return from;
                } else if(from.type == null) {
                    from.value = ""+from.value;
                    from.type = fun;
                    return from;
                } else {
                    return QueryFilters.ebvError();
                }
            } else if(from.token === 'uri') {
                return {token: 'literal',
                    value: Utils.lexicalFormBaseUri(from, env),
                    type: fun,
                    lang: null};
            } else {
                return QueryFilters.ebvError();
            }
        } else if(fun == xmlSchema+"dateTime" || fun == xmlSchema+"date") {
            from = ops[0];
            if(from.type == xmlSchema+"dateTime" || from.type == xmlSchema+"date") {
                return from;
            } else if(from.type == xmlSchema+"string" || from.type == null) {
                try {
                    from.value = Utils.iso8601(Utils.parseISO8601(from.value));
                    from.type = fun;
                    return from;
                } catch(e) {
                    return QueryFilters.ebvError();
                }
            } else {
                return QueryFilters.ebvError();
            }
        } else if(fun == xmlSchema+"float") {
            var from = ops[0];
            if(from.token === 'literal') {
                from = QueryFilters.normalizeLiteralDatatype(from, queryEngine, env);
                if(from.type == 'http://www.w3.org/2001/XMLSchema#decimal' ||
                    from.type == 'http://www.w3.org/2001/XMLSchema#int') {
                    from.type = fun;
                    from.value = parseFloat(from.value);
                    return from;
                } else if(from.type == 'http://www.w3.org/2001/XMLSchema#boolean') {
                    if(QueryFilters.ebv(from) == true) {
                        from.type = fun;
                        from.value = 1.0;
                    } else {
                        from.type = fun;
                        from.value = 0.0;
                    }
                    return from;
                } else if(from.type == 'http://www.w3.org/2001/XMLSchema#float' ||
                    from.type == 'http://www.w3.org/2001/XMLSchema#double') {
                    from.type = fun;
                    from.value = parseFloat(from.value);
                    return from;
                } else if(from.type == 'http://www.w3.org/2001/XMLSchema#string') {
                    try {
                        from.value = parseFloat(from.value);
                        if(isNaN(from.value)) {
                            return QueryFilters.ebvError();
                        } else {
                            from.type = fun;
                            return from;
                        }
                    } catch(e) {
                        return QueryFilters.ebvError();
                    }
                } else if(from.type == null) {
                    // checking some exceptions that are parsed as Floats by JS
                    if(from.value.split(".").length > 2) {
                        return QueryFilters.ebvError();
                    } else if (from.value.split("-").length > 2) {
                        return QueryFilters.ebvError();
                    } else if (from.value.split("/").length > 2) {
                        return QueryFilters.ebvError();
                    } else if (from.value.split("+").length > 2) {
                        return QueryFilters.ebvError();
                    }

                    try {
                        from.value = parseFloat(from.value);
                        if(isNaN(from.value)) {
                            return QueryFilters.ebvError();
                        } else {
                            from.type = fun;
                            return from;
                        }
                    } catch(e) {
                        return QueryFilters.ebvError();
                    }
                } else {
                    return QueryFilters.ebvError();
                }
            } else {
                return QueryFilters.ebvError();
            }
        }  else if(queryEngine.customFns[fun] != null) {
            return queryEngine.customFns[fun](QueryFilters, ops);
        } else {

            // unknown function
            return QueryFilters.ebvError();
        }
    }
};


module.exports = {
    QueryFilters: QueryFilters
};
