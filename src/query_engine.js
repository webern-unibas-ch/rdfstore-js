"use strict";

//imports
var AbstractQueryTree = require("./abstract_query_tree").AbstractQueryTree;
var NonSupportedSparqlFeatureError = require("./abstract_query_tree").NonSupportedSparqlFeatureError;
var Utils = require("./utils");
var QuadIndex = require("./quad_index");
var QueryPlan = require("./query_plan").QueryPlan;
var QueryFilters = require("./query_filters").QueryFilters;
var RDFModel = require("./rdf_model");
var RDFLoader = require("./rdf_loader").RDFLoader;
var Callbacks = require("./graph_callbacks").CallbacksBackend;
var async = require('./utils');
var _ = require('./utils');

var QueryEngine = function(params) {
    if(arguments.length != 0) {
        this.backend = params.backend;
        this.lexicon = params.lexicon;
        // batch loads should generate events?
        this.eventsOnBatchLoad = (params.eventsOnBatchLoad || false);
        // list of namespaces that will be automatically added to every query
        this.defaultPrefixes = {};
        this.abstractQueryTree = new AbstractQueryTree();
        this.rdfLoader = new RDFLoader(params['communication']);
        this.callbacksBackend = new Callbacks(this);
        this.customFns = params.customFns || {};
    }
};

QueryEngine.prototype.setCustomFunctions = function(customFns) {
    this.customFns = customFns;
};

// Utils
QueryEngine.prototype.registerNsInEnvironment = function(prologue, env) {
    var prefixes = [];
    if(prologue != null && prologue.prefixes != null) {
        prefixes =prologue.prefixes;
    }
    var toSave = {};

    // adding default prefixes;
    for(var p in this.defaultPrefixes) {
        toSave[p] = this.defaultPrefixes[p];
    }

    for(var i=0; i<prefixes.length; i++) {
        var prefix = prefixes[i];
        if(prefix.token === "prefix") {
            toSave[prefix.prefix] = prefix.local;
        }
    }

    env.namespaces = toSave;
    if(prologue!=null && prologue.base && typeof(prologue.base) === 'object') {
        env.base = prologue.base.value;
    } else {
        env.base = null;
    }
};

QueryEngine.prototype.applyModifier = function(modifier, projectedBindings) {
    if(modifier == "DISTINCT") {
        var map = {};
        var result = [];
        for(var i=0; i<projectedBindings.length; i++) {
            var bindings = projectedBindings[i];
            var key = "";

            // if no projection variables hash is passed, all the bound
            // variable in the current bindings will be used.
            for(var p in (bindings)) {
                // hashing the object
                var obj = bindings[p];
                if(obj == null) {
                    key = key+p+'null';
                } else if(obj.token == 'literal') {
                    if(obj.value != null) {
                        key = key + obj.value;
                    }
                    if(obj.lang != null) {
                        key = key + obj.lang;
                    }
                    if(obj.type != null) {
                        key = key + obj.type;
                    }
                } else if(obj.value) {
                    key  = key + p + obj.value;
                } else {
                    key = key + p + obj;
                }
            }

            if(map[key] == null) {
                // this will preserve the order in projectedBindings
                result.push(bindings);
                map[key] = true;
            }
        }
        return result;
    } else {
        return projectedBindings;
    }
};

QueryEngine.prototype.applyLimitOffset = function(offset, limit, bindings) {
    if(limit == null && offset == null) {
        return bindings;
    }

    if (offset == null) {
        offset = 0;
    }

    if(limit == null) {
        limit = bindings.length;
    } else {
        limit = offset + limit;
    }

    return bindings.slice(offset, limit);
};


QueryEngine.prototype.applySingleOrderBy = function(orderFilters, modifiedBindings, dataset, outEnv, callback) {
    var acum = [];
    var that = this;
    async.eachSeries(orderFilters, function(orderFilter,k){
        QueryFilters.collect(orderFilter.expression, [modifiedBindings], dataset, outEnv, that, function(results) {
            acum.push(results[0].value);
            k()
        });
    }, function(){
        callback({binding:modifiedBindings, value:acum})
    });
};

QueryEngine.prototype.applyOrderBy = function(order, modifiedBindings, dataset, outEnv, callback) {
    var that = this;
    var acum = [];
    if(order != null && order.length > 0) {
        async.eachSeries(modifiedBindings, function(bindings,k){
            that.applySingleOrderBy(order, bindings, dataset, outEnv, function(results){
                acum.push(results);
                k();
            });
        }, function(){
            acum.sort(function(a,b){
                return that.compareFilteredBindings(a, b, order, outEnv);
            });

            var toReturn = [];
            for(var i=0; i<acum.length; i++) {
                toReturn.push(acum[i].binding);
            }

            callback(toReturn);
        });

    } else {
        callback(modifiedBindings);
    }
};

var untypedOrString = function(term) {
    return term.token === 'literal' && (term.type == null || QueryFilters.isXsdType("string", term));
};

QueryEngine.prototype.compareFilteredBindings = function(a, b, order, env) {
    var found = false;
    var i = 0;
    while(!found) {
        if(i==a.value.length) {
            return 0;
        }
        var direction = order[i].direction;
        var filterResult;

        // unbound first
        if(a.value[i] == null && b.value[i] == null) {
            i++;
            continue;
        }else if(a.value[i] == null) {
            filterResult = {value: false};
        } else if(b.value[i] == null) {
            filterResult = {value: true};
        } else

        // blanks
        if(a.value[i].token === 'blank' && b.value[i].token === 'blank') {
            i++;
            continue;
        } else if(a.value[i].token === 'blank') {
            filterResult = {value: false};
        } else if(b.value[i].token === 'blank') {
            filterResult = {value: true};
        } else

        // uris
        if(a.value[i].token === 'uri' && b.value[i].token === 'uri') {
            if(QueryFilters.runEqualityFunction(a.value[i], b.value[i], [], this, env).value == true) {
                i++;
                continue;
            } else {
                filterResult = QueryFilters.runTotalGtFunction(a.value[i], b.value[i], []);
            }
        } else if(a.value[i].token === 'uri') {
            filterResult = {value: false};
        } else if(b.value[i].token === 'uri') {
            filterResult = {value: true};
        } else

        // literals without a datatype, and xsd:string (the same as a simple literal in RDF 1.1)
        if(untypedOrString(a.value[i]) && untypedOrString(b.value[i])) {
            if(QueryFilters.runEqualityFunction(a.value[i], b.value[i], [], this, env).value == true) {
                i++;
                continue;
            } else {
                filterResult = QueryFilters.runTotalGtFunction(a.value[i], b.value[i], []);
            }
        } else if(untypedOrString(a.value[i])) {
            filterResult = {value: false};
        } else if(untypedOrString(b.value[i])) {
            filterResult = {value: true};
        } else

        // literals
        if(QueryFilters.runEqualityFunction(a.value[i], b.value[i], [], this, env).value == true) {
            i++;
            continue;
        } else {
            filterResult = QueryFilters.runTotalGtFunction(a.value[i], b.value[i], []);
        }


        // choose value for comparison based on the direction
        if(filterResult.value == true) {
            if(direction === "ASC") {
                return 1;
            } else {
                return -1;
            }
        } else {
            if(direction === "ASC") {
                return -1;
            } else {
                return 1;
            }
        }
    }
};

QueryEngine.prototype.removeDefaultGraphBindings = function(bindingsList, dataset) {
    var onlyDefaultDatasets = [];
    var namedDatasetsMap = {};
    for(var i=0; i<dataset.named.length; i++) {
        namedDatasetsMap[dataset.named[i].oid] = true;
    }
    for(i=0; i<dataset.implicit.length; i++) {
        if(namedDatasetsMap[dataset.implicit[i].oid] == null) {
            onlyDefaultDatasets.push(dataset.implicit[i].oid);
        }
    }
    var acum = [];
    for(i=0; i<bindingsList.length; i++) {
        var bindings = bindingsList[i];
        var foundDefaultGraph = false;
        for(var p in bindings) {
            for(var j=0; j<namedDatasetsMap.length; j++) {
                if(bindings[p] === namedDatasetsMap[j]) {
                    foundDefaultGraph = true;
                    break;
                }
            }
            if(foundDefaultGraph) {
                break;
            }
        }
        if(!foundDefaultGraph) {
            acum.push(bindings);
        }
    }

    return acum;
};


// true if an aggregate (COUNT, SUM, ...) occurs anywhere in the expression tree
QueryEngine.containsAggregate = function(expression) {
    if(expression == null || typeof(expression) !== 'object') {
        return false;
    }
    if(expression.expressionType === 'aggregate') {
        return true;
    }
    for(var key in expression) {
        if(QueryEngine.containsAggregate(expression[key])) {
            return true;
        }
    }
    return false;
};

// Copy of the expression with each aggregate replaced by a variable '#aggregate<n>' ('#' can't occur in a
// SPARQL variable), so that aggregates can be used inside expressions. The distinct aggregates are added
// to `aggregates` as {name, key, expression}.
QueryEngine.extractAggregates = function(expression, aggregates) {
    if(expression == null || typeof(expression) !== 'object') {
        return expression;
    }
    if(expression.expressionType === 'aggregate') {
        var key = JSON.stringify(expression);
        var name = null;
        for(var i=0; i<aggregates.length && name == null; i++) {
            if(aggregates[i].key === key) {
                name = aggregates[i].name;
            }
        }
        if(name == null) {
            name = '#aggregate' + aggregates.length;
            aggregates.push({name: name, key: key, expression: expression});
        }
        return {token: 'expression', expressionType: 'atomic', primaryexpression: 'var', value: {token: 'var', value: name}};
    }
    var copy = Array.isArray(expression) ? [] : {};
    for(var key in expression) {
        copy[key] = QueryEngine.extractAggregates(expression[key], aggregates);
    }
    return copy;
};

// The variables used in an expression, without the patterns of EXISTS / NOT EXISTS.
QueryEngine.expressionVariables = function(expression, vars) {
    if(expression == null || typeof(expression) !== 'object') {
        return vars;
    }
    if(expression.token === 'var') {
        vars.push(expression.value);
    } else if(expression.builtincall !== 'exists' && expression.builtincall !== 'notexists') {
        for(var key in expression) {
            QueryEngine.expressionVariables(expression[key], vars);
        }
    }
    return vars;
};

// The variables a GROUP BY binds: grouped variables and the aliases of grouped expressions.
QueryEngine.groupVariables = function(group) {
    var vars = [];
    for(var i=0; group !== 'singleGroup' && i<group.length; i++) {
        if(group[i].token === 'var') {
            vars.push(group[i].value);
        } else if(group[i].token === 'aliased_expression') {
            vars.push(group[i].alias.value);
        }
    }
    return vars;
};

// How a grouped query evaluates its expressions. Aggregates inside SELECT expressions, HAVING and ORDER BY
// become variables of each group's scope (see groupScope). Outside aggregates, these expressions may use
// the group variables and, more leniently than SPARQL, the SELECT aliases; `ungroupedVariable` names the
// first other variable.
QueryEngine.planGroups = function(group, projection, having, order) {
    var plan = {groupVars: QueryEngine.groupVariables(group), aggregates: [], projection: [], having: [], order: []};
    var expressions = [];
    for(var i=0; i<projection.length; i++) {
        var expression = projection[i].expression;
        var nested = expression != null && expression.expressionType !== 'aggregate' && QueryEngine.containsAggregate(expression);
        plan.projection.push({
            name: projection[i].alias ? projection[i].alias.value : projection[i].value.value,
            item: projection[i],
            expression: nested ? QueryEngine.extractAggregates(expression, plan.aggregates) : null
        });
        if(nested) {
            expressions.push(plan.projection[i].expression);
        }
    }
    for(i=0; having != null && i<having.length; i++) {
        plan.having.push(QueryEngine.extractAggregates(having[i], plan.aggregates));
        expressions.push(plan.having[i]);
    }
    for(i=0; order != null && i<order.length; i++) {
        plan.order.push({direction: order[i].direction, expression: QueryEngine.extractAggregates(order[i].expression, plan.aggregates)});
        expressions.push(plan.order[i].expression);
    }

    var inScope = {};
    var names = plan.groupVars.concat(plan.projection.map(function(projected) { return projected.name; }),
        plan.aggregates.map(function(aggregate) { return aggregate.name; }));
    for(i=0; i<names.length; i++) {
        inScope[names[i]] = true;
    }
    var used = QueryEngine.expressionVariables(expressions, []);
    for(i=0; i<used.length && plan.ungroupedVariable == null; i++) {
        if(inScope[used[i]] !== true) {
            plan.ungroupedVariable = used[i];
        }
    }
    return plan;
};

// One group's solution as SELECT expressions, HAVING and ORDER BY see it: the group variables, the
// aggregates of the plan and the projected values.
QueryEngine.prototype.groupScope = function(plan, denormGroup, dataset, env) {
    var scope = {};
    for(var i=0; i<plan.groupVars.length; i++) {
        scope[plan.groupVars[i]] = denormGroup.length > 0 ? denormGroup[0][plan.groupVars[i]] : null;
    }
    for(i=0; i<plan.aggregates.length; i++) {
        var value = QueryFilters.runAggregator({token: 'variable', kind: 'aliased', expression: plan.aggregates[i].expression}, denormGroup, this, dataset, env);
        if(!QueryFilters.isEbvError(value)) {
            scope[plan.aggregates[i].name] = value;
        }
    }
    for(i=0; i<plan.projection.length; i++) {
        var projected = plan.projection[i];
        value = projected.expression == null ?
            QueryFilters.runAggregator(projected.item, denormGroup, this, dataset, env) :
            QueryFilters.runFilter(projected.expression, scope, this, dataset, env);
        // an error leaves the variable unbound
        if(!QueryFilters.isEbvError(value)) {
            scope[projected.name] = QueryFilters.resultTerm(value);
        }
    }
    return scope;
};


// Adds the SELECT aliases to copies of the solutions (SPARQL 1.1 Extend, before ORDER BY). Expressions are
// evaluated on the terms of the variables they use, not on OIDs; an error leaves the alias unbound.
QueryEngine.prototype.extendBindings = function(projection, results, dataset, env, callback) {
    var aliased = [];
    var used = [];
    for(var j=0; projection[0].kind !== '*' && j<projection.length; j++) {
        if(projection[j].kind === 'aliased') {
            aliased.push(projection[j]);
            QueryEngine.expressionVariables(projection[j].expression, used);
        }
    }
    if(aliased.length === 0) {
        return callback(results);
    }
    var usedBindings = results.map(function(result) {
        var usedResult = {};
        for(var u=0; u<used.length; u++) {
            usedResult[used[u]] = result[used[u]];
        }
        return usedResult;
    });
    var that = this;
    this.copyDenormalizedBindings(usedBindings, env.outCache, function(denormResults) {
        var expressionEnv = {blanks:{}, outCache:{}, namespaces: env.namespaces, base: env.base};
        var extended = [];
        for(var i=0; i<results.length; i++) {
            var extendedResult = {};
            for(var p in results[i]) {
                extendedResult[p] = results[i][p];
            }
            for(var j=0; j<aliased.length; j++) {
                var ebv = QueryFilters.runFilter(aliased[j].expression, denormResults[i], that, dataset, expressionEnv);
                extendedResult[aliased[j].alias.value] = QueryFilters.isEbvError(ebv) ? null : QueryFilters.resultTerm(ebv);
            }
            extended.push(extendedResult);
        }

        if(env.unsupportedFeature == null)
            env.unsupportedFeature = expressionEnv.unsupportedFeature;
        callback(extended);
    });
};

QueryEngine.prototype.projectBindings = function(projection, results) {
    if(projection[0].kind === '*') {
        return results;
    }
    return results.map(function(result) {
        var projected = {};
        for(var j=0; j<projection.length; j++) {
            var name = projection[j].kind === 'aliased' ? projection[j].alias.value : projection[j].value.value;
            projected[name] = result[name];
        }
        return projected;
    });
};

QueryEngine.prototype.resolveNsInEnvironment = function(prefix, env) {
    var namespaces = env.namespaces;
    return namespaces[prefix];
};

QueryEngine.prototype.normalizeTerm = function(term, env, shouldIndex, callback) {
    if(term.token === 'uri') {
        var uri = Utils.lexicalFormBaseUri(term, env);
        if(uri == null) {
            callback(null);
        } else {
            if(shouldIndex) {
                this.lexicon.registerUri(uri,callback);
            } else {
                this.lexicon.resolveUri(uri,callback);
            }
        }

    } else if(term.token === 'literal') {
        var lexicalFormLiteral = Utils.lexicalFormLiteral(term, env);
        if(shouldIndex) {
            this.lexicon.registerLiteral(lexicalFormLiteral,callback);
        } else {
            this.lexicon.resolveLiteral(lexicalFormLiteral,callback);
        }
    } else if(term.token === 'blank') {
        var label = term.value;
        if(!shouldIndex) {
            // in a query pattern a blank node matches like a variable (see QueryPlanDPSize.variablesInBGP, withoutBlankNodes),
            // never a data blank node with the same label in env.blanks
            callback("blank:" + label);
        } else if(env.blanks[label] != null) {
            callback(env.blanks[label]);
        } else {
            this.lexicon.registerBlank(function(oid){
                env.blanks[label] = oid;
                callback(oid);
            });
        }
    } else if(term.token === 'var') {
        callback(term.value);
    } else {
        callback(null);
    }
};

QueryEngine.prototype.normalizeDatasets = function(datasets, outerEnv, callback) {
    var that = this;
    async.eachSeries(datasets, function(dataset, k){
        if(dataset.value === that.lexicon.defaultGraphUri) {
            dataset.oid = that.lexicon.defaultGraphOid;
            k();
        } else {
            that.normalizeTerm(dataset, outerEnv, false, function(oid){
                if(oid != null) {
                    dataset.oid = oid;
                }
                k();
            });
        }
    }, function(){
        callback(true);
    });
};

QueryEngine.prototype.normalizeQuad = function(quad, queryEnv, shouldIndex, callback) {
    var subject    = null;
    var predicate  = null;
    var object     = null;
    var graph      = null;
    var that = this;
    var error = false;

    async.seq(function(k){
        if(quad.graph == null || quad.graph.value === that.lexicon.defaultGraphUri) {
            graph = 0; // default graph
            k();
        } else {
            var graphUriValue = Utils.lexicalFormBaseUri(quad.graph, queryEnv);
            that.normalizeTerm(quad.graph, queryEnv, shouldIndex, function(oid){
                if(oid != null) {
                    graph = oid;
                    if(shouldIndex === true && quad.graph.token!='var') {
                        that.lexicon.registerGraph(oid, graphUriValue, function(){
                            k();
                        });
                    } else {
                        k();
                    }
                } else {
                    error = true;
                    k();
                }
            });
        }

    }, function(k){
        if(error === false) {
            that.normalizeTerm(quad.subject, queryEnv, shouldIndex, function(oid){
                if(oid!=null) {
                    subject = oid;
                    k();
                } else {
                    error = true;
                    k();
                }
            });
        } else {
            k();
        }
    },function(k){
        if(error === false) {
            that.normalizeTerm(quad.predicate, queryEnv, shouldIndex, function(oid){
                if(oid!=null) {
                    predicate = oid;
                    k();
                } else {
                    error = true;
                    k();
                }
            });
        } else {
            k();
        }
    },function(k){
        if(error === false) {
            that.normalizeTerm(quad.object, queryEnv, shouldIndex, function(oid){
                if(oid!=null) {
                    object = oid;
                    k();
                } else {
                    error = true;
                    k();
                }
            });
        } else {
            k();
        }
    })(function(){
        if(error === true){
            callback(null);
        } else {
            callback({
                subject:subject,
                predicate:predicate,
                object:object,
                graph:graph
            });
        }
    });
};

QueryEngine.prototype.denormalizeBindingsList = function(bindingsList, env, callback) {
    var that = this;
    var denormList = [];

    async.eachSeries(bindingsList, function(bindings, k){
        that.denormalizeBindings(bindings, env, function(denorm){
            denormList.push(denorm);
            k();
        });
    },function(){
        callback(denormList);
    });
};

/**
 * Receives a bindings map (var -> oid) and an out cache (oid -> value)
 * returns a bindings map (var -> value) storing in cache all the missing values for oids
 *
 * This is required just to save lookups when final results are generated.
 */
QueryEngine.prototype.copyDenormalizedBindings = function(bindingsList, out, callback) {
    var that = this;
    var denormList = [];
    async.eachSeries(bindingsList, function(bindings, k){
        var denorm = {};
        var variables = _.keys(bindings);
        async.eachSeries(variables, function(variable, kk){
            var oid = bindings[variable];
            if(oid == null) {
                // this can be null, e.g. union different variables (check SPARQL recommendation examples UNION)
                denorm[variable] = null;
                kk();
            } else if(typeof(oid) === 'object') {
                // the binding is already denormalized, this can happen for example because the value of the
                // binding is the result of the aggregation of other bindings in a GROUP clause
                denorm[variable] = oid;
                kk();
            } else {
                var inOut = out[oid];
                if(inOut!= null) {
                    denorm[variable] = inOut;
                    kk();
                } else {
                    that.lexicon.retrieve(oid, function(val){
                        out[oid] = val;
                        denorm[variable] = val;
                        kk();
                    });
                }
            }
        },function(){
            denormList.push(denorm);
            k();
        });
    }, function(){
        callback(denormList);
    });
};

QueryEngine.prototype.denormalizeBindings = function(bindings, env, callback) {
    var variables = _.keys(bindings);
    var envOut = env.outCache;
    var that = this;
    async.eachSeries(variables, function(variable, k){
        var oid = bindings[variable];
        if(oid == null) {
            // this can be null, e.g. union different variables (check SPARQL recommendation examples UNION)
            bindings[variable] = null;
            k();
        } else if(typeof(oid) === 'object') {
            // the binding is already denormalized, this can happen for example because the value of the
            // binding is the result a BIND(expression AS ?new_var) binding.
            k();
        } else {
            if(envOut[oid] != null) {
                bindings[variable] = envOut[oid];
                k();
            } else {
                that.lexicon.retrieve(oid, function(val){
                    bindings[variable] = val;
                    if(val.token === 'blank')
                        env.blanks[val.value] = oid;
                    k();
                });
            }
        }
    }, function(){
        callback(bindings);
    });
};

// Queries execution

QueryEngine.prototype.execute = function(queryString, callback, defaultDataset, namedDataset){
    var that = this;
    var done = Utils.once(callback);
    var modificationStarted = false;
    try {
        queryString = Utils.normalizeUnicodeLiterals(queryString);
        var syntaxTree = this.abstractQueryTree.parseQueryString(queryString);
        if(syntaxTree == null) {
            done(new Error("Error parsing query string"));
        } else if(syntaxTree.token === 'query' && syntaxTree.kind == 'update')  {
            this.callbacksBackend.startGraphModification();
            modificationStarted = true;
            this.executeUpdate(syntaxTree, function(err, result){
                if(that.lexicon.updateAfterWrite)
                    that.lexicon.updateAfterWrite();

                if(err) {
                    that.callbacksBackend.cancelGraphModification();
                    done(err, result);
                } else {
                    that.callbacksBackend.endGraphModification(function(){
                        done(null, result);
                    });
                }
            });
        } else if(syntaxTree.token === 'query' && syntaxTree.kind == 'query') {
            this.executeQuery(syntaxTree, done, defaultDataset, namedDataset);
        } else {
            done(new Error("Cannot execute query of kind " + syntaxTree.kind));
        }
    } catch(e) {
        // an exception from the caller's own callback is not a query error: let it propagate
        if(done.called)
            throw e;
        if(modificationStarted)
            this.callbacksBackend.cancelGraphModification();
        done(Utils.toError(e));
    }
};

// Retrieval queries

QueryEngine.prototype.executeQuery = function(syntaxTree, callback, defaultDataset, namedDataset) {
    var prologue = syntaxTree.prologue;
    var units = syntaxTree.units;
    var that = this;

    // environment for the operation -> base ns, declared ns, etc.
    var queryEnv = {blanks:{}, outCache:{}};
    this.registerNsInEnvironment(prologue, queryEnv);

    // retrieval queries can only have 1 executable unit
    var aqt = that.abstractQueryTree.parseExecutableUnit(units[0]);

    // can be anything else but a select???
    if(aqt.kind === 'select') {
        this.executeSelect(aqt, queryEnv, defaultDataset, namedDataset, function(err, result){
            if(err == null) {
                if(typeof(result) === 'object' && result.denorm === true) {
                    callback(null, result['bindings']);
                } else {
                    that.denormalizeBindingsList(result, queryEnv, function(result){
                        callback(null, result);
                    });
                }
            } else {
                callback(err);
            }
        });
    } else if(aqt.kind === 'ask') {
        aqt.projection = [{"token": "variable", "kind": "*"}];
        this.executeSelect(aqt, queryEnv, defaultDataset, namedDataset, function(err, result){
            if(err == null) {
                if(result.length>0) {
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            } else {
                callback(err);
            }
        });
    } else if(aqt.kind === 'construct') {
        if(aqt.group != null || aqt.having != null) {
            return callback(new NonSupportedSparqlFeatureError("GROUP BY in CONSTRUCT", "GROUP BY and HAVING are not supported in CONSTRUCT queries"));
        }
        aqt.projection = [{"token": "variable", "kind": "*"}];
        that = this;
        this.executeSelect(aqt, queryEnv, defaultDataset, namedDataset, function(err, result){
            if(err == null) {

                that.denormalizeBindingsList(result, queryEnv, function(result){
                    if(result != null) {
                        var graph = new RDFModel.Graph();

                        // CONSTRUCT WHERE {} case
                        if(aqt.template == null) {
                            aqt.template = {triplesContext: aqt.pattern};
                        }
                        var blankIdCounter = 1;
                        var toClear = [];
                        for(var i=0; i<result.length; i++) {
                            var bindings = result[i];
                            for(var j=0; j<toClear.length; j++)
                                delete toClear[j].valuetmp;

                            for(var j=0; j<aqt.template.triplesContext.length; j++) {
                                // fresh IDs for blank nodes in the construct template
                                var components = ['subject', 'predicate', 'object'];
                                var tripleTemplate = aqt.template.triplesContext[j];
                                for(var p=0; p<components.length; p++) {
                                    var component = components[p];
                                    if(tripleTemplate[component].token === 'blank') {
                                        if(tripleTemplate[component].valuetmp && tripleTemplate[component].valuetmp != null) {
                                        } else {
                                            var blankId = "_:b"+blankIdCounter;
                                            blankIdCounter++;
                                            tripleTemplate[component].valuetmp = blankId;
                                            toClear.push(tripleTemplate[component]);
                                        }
                                    }
                                }
                                var s = RDFModel.buildRDFResource(tripleTemplate.subject,bindings,that,queryEnv);
                                var p = RDFModel.buildRDFResource(tripleTemplate.predicate,bindings,that,queryEnv);
                                var o = RDFModel.buildRDFResource(tripleTemplate.object,bindings,that,queryEnv);
                                if(s!=null && p!=null && o!=null) {
                                    var triple = new RDFModel.Triple(s,p,o);
                                    graph.add(triple);
                                    //} else {
                                    //    return callback(false, "Error creating output graph")
                                }
                            }
                            }
                        callback(null,graph);
                    } else {
                        callback(new Error("Error denormalizing bindings."));
                    }
                });
            } else {
                callback(err);
            }
        });
    }
};


// Select queries

QueryEngine.prototype.executeSelect = function(unit, env, defaultDataset, namedDataset, callback) {
    if(unit.kind === "select" || unit.kind === "ask" || unit.kind === "construct" || unit.kind === "modify") {
        var projection = unit.projection;
        var dataset    = unit.dataset;
        var modifier   = unit.modifier;
        var limit      = unit.limit;
        var offset     = unit.offset;
        var order      = unit.order;
        var that = this;

        // an unsupported feature met while evaluating an expression (see QueryFilters.runFilter) fails the query
        var reply = callback;
        callback = function(err, result) {
            if(err == null && env.unsupportedFeature != null)
                reply(env.unsupportedFeature);
            else
                reply(err, result);
        };

        if(defaultDataset != null || namedDataset != null) {
            dataset.implicit = defaultDataset || [];
            dataset.named   = namedDataset || [];
        }

        if(dataset.implicit != null && dataset.implicit.length === 0 && dataset.named !=null && dataset.named.length === 0) {
            // We add the default graph to the default merged graph
            dataset.implicit.push(this.lexicon.defaultGraphUriTerm);
        }


        that.normalizeDatasets(dataset.implicit.concat(dataset.named), env, function(){
            that.executeSelectUnit(projection, dataset, unit.pattern, env, function (err, result) {
                if (err != null) {
                    callback(err);
                } else if (result != null) {
                    // detect single group: aggregates (in SELECT or ORDER BY) or HAVING without GROUP BY
                    // (no group clause leaves `group` unset)
                    if (unit.group == null || unit.group === "") {
                        var foundUniqueGroup = unit.having != null;
                        for (var i = 0; i < unit.projection.length; i++) {
                            if (QueryEngine.containsAggregate(unit.projection[i].expression)) {
                                foundUniqueGroup = true;
                            }
                        }
                        for (i = 0; order != null && i < order.length; i++) {
                            if (QueryEngine.containsAggregate(order[i].expression)) {
                                foundUniqueGroup = true;
                            }
                        }
                        if (foundUniqueGroup === true) {
                            unit.group = 'singleGroup';
                        }
                    }
                    if (unit.group && unit.group != "") {
                        if (that.checkGroupSemantics(unit.group, projection)) {
                            var plan = QueryEngine.planGroups(unit.group, projection, unit.having, order);
                            if (plan.ungroupedVariable != null) {
                                return callback(new Error("Variable ?" + plan.ungroupedVariable + " is neither grouped nor aggregated"));
                            }
                            that.groupSolution(result, unit.group, dataset, env, function(groupedBindings){
                                var scopes = [];
                                async.eachSeries(groupedBindings, function(groupedBindingsGroup, k){
                                    that.copyDenormalizedBindings(groupedBindingsGroup, env.outCache, function(denormGroup){
                                        var scope = that.groupScope(plan, denormGroup, dataset, env);
                                        for (var h = 0; h < plan.having.length; h++) {
                                            if (QueryFilters.ebv(QueryFilters.runFilter(plan.having[h], scope, that, dataset, env)) !== true) {
                                                return k();
                                            }
                                        }
                                        scopes.push(scope);
                                        k();
                                    });
                                }, function(){
                                    that.applyOrderBy(plan.order, scopes, dataset, env, function(orderedScopes){
                                        var aggregatedBindings = [];
                                        for (var s = 0; s < orderedScopes.length; s++) {
                                            var projected = {};
                                            for (var p = 0; p < plan.projection.length; p++) {
                                                projected[plan.projection[p].name] = orderedScopes[s][plan.projection[p].name];
                                            }
                                            aggregatedBindings.push(projected);
                                        }
                                        var modifiedBindings = that.applyModifier(modifier, aggregatedBindings);
                                        var limitedBindings = that.applyLimitOffset(offset, limit, modifiedBindings);
                                        callback(null, {'bindings': limitedBindings, 'denorm': true});
                                    });
                                });
                            });
                        } else {
                            callback(new Error("Incompatible Group and Projection variables"));
                        }
                    } else {
                        that.extendBindings(projection, result, dataset, env, function(extendedBindings){
                            that.applyOrderBy(order, extendedBindings, dataset, env, function(orderedBindings){
                                var projectedBindings = that.projectBindings(projection, orderedBindings);
                                var modifiedBindings = that.applyModifier(modifier, projectedBindings);
                                var limitedBindings = that.applyLimitOffset(offset, limit, modifiedBindings);
                                var filteredBindings = that.removeDefaultGraphBindings(limitedBindings, dataset);

                                callback(null, filteredBindings);
                            });
                        });
                    }

                } else { // fail selectUnit
                    callback(new Error("Error executing SELECT query."));
                }
            });
        });
    } else {
        callback(new Error("Cannot execute " + unit.kind + " query as a select query"));
    }
};


QueryEngine.prototype.groupSolution = function(bindings, group, dataset, queryEnv, callback){
    var order = [];
    var filteredBindings = [];
    var initialized = false;
    var that = this;
    if(group === 'singleGroup') {
        callback([bindings]);
    } else {
        async.eachSeries(bindings, function(currentBindings,k){
            var mustAddBindings = true;

            /**
             * In this loop, we iterate through all the group clauses and transform the current bindings
             * according to the group by clauses.
             * If it is the first iteration we also save in a different array the order for the
             * grouped variables that will be used later to build the final groups
             */
            async.eachSeries(group, function(currentOrderClause, kk){
                var orderVariable = null;

                if(currentOrderClause.token === 'var') {
                    orderVariable = currentOrderClause.value;

                    if(initialized == false) {
                        order.push(orderVariable);
                    }
                    kk();
                } else if(currentOrderClause.token === 'aliased_expression') {
                    orderVariable = currentOrderClause.alias.value;
                    if(initialized == false) {
                        order.push(orderVariable);
                    }

                    if(currentOrderClause.expression.primaryexpression === 'var') {
                        currentBindings[currentOrderClause.alias.value] = currentBindings[currentOrderClause.expression.value.value];
                        kk();
                    } else {
                        that.copyDenormalizedBindings([currentBindings], queryEnv.outCache, function(denormBindings){
                            var filterResultEbv = QueryFilters.runFilter(currentOrderClause.expression, denormBindings[0], that, dataset, queryEnv);
                            if(!QueryFilters.isEbvError(filterResultEbv)) {
                                currentBindings[currentOrderClause.alias.value] = QueryFilters.resultTerm(filterResultEbv);
                            } else {
                                mustAddBindings = false;
                            }
                            kk();
                        });
                    }
                } else {
                    // In this case, we create an additional variable in the binding to hold the group variable value:
                    // one per group clause, registered even if the first solution fails to evaluate
                    orderVariable = "groupCondition"+group.indexOf(currentOrderClause);
                    if(initialized == false) {
                        order.push(orderVariable);
                    }
                    that.copyDenormalizedBindings([currentBindings], queryEnv.outCache, function(denormBindings){
                        var filterResultEbv = QueryFilters.runFilter(currentOrderClause, denormBindings[0], that, dataset, queryEnv);
                        if(!QueryFilters.isEbvError(filterResultEbv)) {
                            currentBindings[orderVariable] = filterResultEbv;
                        } else {
                            mustAddBindings = false;
                        }
                        kk();
                    });
                }
            }, function(){
                if(initialized == false) {
                    initialized = true;
                }
                if(mustAddBindings === true) {
                    filteredBindings.push(currentBindings);
                }
                k();
            });
        }, function(){
            /**
             * After processing all the bindings, we build the group using the
             * information stored about the order of the group variables.
             */
            var dups = {};
            var groupMap = {};
            var groupCounter = 0;
            for(var i=0; i<filteredBindings.length; i++) {
                var currentTransformedBinding = filteredBindings[i];
                // one entry per group clause, so ("a","bc") and ("ab","c") or 1 and "1" stay apart;
                // a single OID keeps its plain key and with it the previous (numeric) group order
                var keyParts = [];
                for(var j=0; j<order.length; j++) {
                    var maybeObject = currentTransformedBinding[order[j]];
                    if(maybeObject == null) {
                        keyParts.push(null);
                    } else if(typeof(maybeObject) === 'object') {
                        keyParts.push([maybeObject.token, maybeObject.value, maybeObject.type || null, maybeObject.lang || null]);
                    } else {
                        keyParts.push(maybeObject);
                    }
                }
                var key = (keyParts.length === 1 && typeof(keyParts[0]) !== 'object') ? String(keyParts[0]) : JSON.stringify(keyParts);

                if(dups[key] == null) {
                    //currentTransformedBinding["__group__"] = groupCounter;
                    groupMap[key] = groupCounter;
                    dups[key] = [currentTransformedBinding];
                    //groupCounter++
                } else {
                    //currentTransformedBinding["__group__"] = dups[key][0]["__group__"];
                    dups[key].push(currentTransformedBinding);
                }
            }

            // The final result is an array of arrays with all the groups
            var groups = [];

            for(var k in dups) {
                groups.push(dups[k]);
            }

            callback(groups);
        });
    }
};


/**
 * Here, all the constructions of the SPARQL algebra are handled
 */
QueryEngine.prototype.executeSelectUnit = function(projection, dataset, pattern, env, callback) {
    if(pattern.kind === "BGP") {
        this.executeAndBGP(projection, dataset, pattern, env, callback);
    } else if(pattern.kind === "UNION") {
        this.executeUNION(projection, dataset, pattern.value, env, callback);
    } else if(pattern.kind === "JOIN") {
        this.executeJOIN(projection, dataset, pattern, env, callback);
    } else if(pattern.kind === "LEFT_JOIN") {
        this.executeLEFT_JOIN(projection, dataset, pattern, env, callback);
    } else if(pattern.kind === "FILTER") {
        // Some components may have the filter inside the unit
        var that = this;
        this.executeSelectUnit(projection, dataset, pattern.value, env, function (err, results) {
            if (err != null) {
                callback(err);
            } else if (results != null) {
                QueryFilters.checkFilters(pattern, results, false, dataset, env, that, callback);
            } else {
                callback(null, []);
            }
        });
    } else if(pattern.kind === "EMPTY_PATTERN") {
        // the empty group has one solution without variables (its filters are a FILTER node around it, see
        // DAWG algebra/filter-nested-2). Under GRAPH, like for triple patterns (QueryPlanDPSize.executeBGPDatasets),
        // a graph variable takes each named graph of the dataset, and an IRI must be a graph of the store.
        var that = this;
        var extend = function(solutions) {
            that.runBinds(pattern.binds, solutions, dataset, env, callback);
        };
        if(pattern.graph == null) {
            extend([{}]);
        } else if(pattern.graph.token === 'var') {
            var solutions = [];
            var seen = {};
            for(var i=0; i<dataset.named.length; i++) {
                if(seen[dataset.named[i].oid] == null) {
                    seen[dataset.named[i].oid] = true;
                    var solution = {};
                    solution[pattern.graph.value] = dataset.named[i].oid;
                    solutions.push(solution);
                }
            }
            extend(solutions);
        } else {
            this.normalizeTerm(pattern.graph, env, false, function(oid){
                that.lexicon.registeredGraphs(false, function(graphs){
                    extend(graphs.indexOf(oid) !== -1 ? [{}] : []);
                });
            });
        }
    } else if(pattern.kind === "ZERO_OR_MORE_PATH" || pattern.kind === 'ONE_OR_MORE_PATH') {
        // the place to evaluate them; see the commented-out executeZeroOrMorePath below
        callback(new NonSupportedSparqlFeatureError(pattern.kind, "Property path modifiers (*, +, ?, {n,m}) are not supported"));
    } else {
        callback(new NonSupportedSparqlFeatureError(pattern.kind));
    }
};

/*
QueryEngine.prototype.executeZeroOrMorePath = function(pattern, dataset, env) {
    //console.log("EXECUTING ZERO OR MORE PATH");
    //console.log("X");
    //console.log(pattern.x);
    //console.log("Y");
    //console.log(pattern.y);
    var projection = [];
    var starProjection = false;
    if(pattern.x.token === 'var') {
        projection.push({token: 'variable',
            kind: 'var',
            value: pattern.x.value});
    }
    if(pattern.y.token === 'var') {
        projection.push({token: 'variable',
            kind: 'var',
            value: pattern.y.value});
    }

    if(projection.length === 0) {
        projection.push({"token": "variable", "kind": "*"});
        starProjection = true;
    }

    //console.log("COMPUTED PROJECTION");
    //console.log(projection);


    if(pattern.x.token === 'var' && pattern.y.token === 'var') {
        var bindings = this.executeAndBGP(projection, dataset, pattern.path, env);
        //console.log("BINDINGS "+bindings.length);
        //console.log(bindings);
        var acum = {};
        var results = [];
        var vx, intermediate, nextBinding, vxDenorm;
        var origVXName = pattern.x.value;
        var last = pattern.x;
        var nextPath = pattern.path;
        //console.log("VAR - VAR PATTERN");
        //console.log(nextPath.value);
        for(var i=0; i<bindings.length; i++) {
            vx = bindings[i][origVXName];
            if(acum[vx] == null) {
                vxDenorm = this.lexicon.retrieve(vx);
                pattern.x = vxDenorm;
                //console.log("REPLACING");
                //console.log(last);
                //console.log("BY");
                //console.log(vxDenorm);
                //console.log(nextPath.value);
                pattern.path = this.abstractQueryTree.replace(nextPath, last, vxDenorm, env);
                nextPath = Utils.clone(pattern.path);
                intermediate = this.executeZeroOrMorePath(pattern, dataset, env);
                for(var j=0; j<intermediate.length; j++) {
                    nextBinding = intermediate[j];
                    nextBinding[origVXName] = vx;
                    results.push(nextBinding)
                }
                last = vxDenorm;
            }
        }

        //console.log("RETURNING VAR - VAR");
        return results;
    } else if(pattern.x.token !== 'var' && pattern.y.token === 'var') {
        var finished;
        var acum = {};
        var initial = true;
        var pending = [];
        var bindings,nextBinding;
        var collected = [];
        var origVx = pattern.x;
        var last;

        while(initial == true || pending.length !== 0) {
            //console.log("-- Iteration");
            //console.log(pattern.path.value[0]);
            if(initial === true) {
                bindings = this.executeAndBGP(projection, dataset, pattern.path, env);
                //console.log("SAVING LAST");
                //console.log(pattern.x);
                last = pattern.x;
                initial = false;
            } else {
                var nextOid = pending.pop();
                //console.log("POPPING:"+nextOid);
                var value = this.lexicon.retrieve(nextOid);
                var path = pattern.path; //Utils.clone(pattern.path);
                //console.log(path.value[0]);
                //console.log("REPLACING");
                //console.log(last);
                //console.log("BY");
                //console.log(value);
                path = this.abstractQueryTree.replace(path, last, value, env);
                //console.log(path.value[0]);
                bindings = this.executeAndBGP(projection, dataset, path, env);
                last = value;
            }


            //console.log("BINDINGS!");
            //console.log(bindings);

            for(var i=0; i<bindings.length; i++) {
                //console.log(bindings[i][pattern.y.value])
                var value = bindings[i][pattern.y.value];
                //console.log("VALUE:"+value);
                if(acum[value] !== true) {
                    nextBinding = {};
                    nextBinding[pattern.y.value] = value;
                    collected.push(nextBinding);
                    acum[value] = true;
                    pending.push(value);
                }
            }
        }
        //console.log("RETURNING TERM - VAR");
        //console.log(collected);
        return collected;
    } else {
        throw "Kind of path not supported!";
    }
};
*/

// Evaluates two sub-patterns one after the other; stops at the first error. With skipIfFirstEmpty
// (joins), the second one is not evaluated when the first has no solutions.
QueryEngine.prototype.executeSelectUnits = function(projection, dataset, setQuery1, setQuery2, env, skipIfFirstEmpty, callback) {
    var that = this;
    var set1, set2;
    async.seq(
        function(k){
            that.executeSelectUnit(projection, dataset, setQuery1, env, function (err, result) {
                set1 = result;
                k(err);
            });
        },
        function(k){
            if(skipIfFirstEmpty && set1 != null && set1.length === 0) {
                set2 = [];
                return k();
            }
            that.executeSelectUnit(projection, dataset, setQuery2, env, function (err, result) {
                set2 = result;
                k(err);
            });
        })(function(err){
        if(err != null)
            callback(err);
        else
            callback(null, set1, set2);
    });
};

QueryEngine.prototype.executeUNION = function(projection, dataset, patterns, env, callback) {
    if(patterns.length != 2) {
        return callback(new Error("SPARQL algebra UNION with more than two components"));
    }

    var that = this;
    this.executeSelectUnits(projection, dataset, patterns[0], patterns[1], env, false, function(err, set1, set2){
        if(err != null) {
            callback(err);
        } else {
            var result = QueryPlan.unionBindings(set1, set2);
            that.runBinds(patterns.binds, result, dataset, env, function(err, bindings){
                if(err != null) {
                    callback(err);
                } else {
                    QueryFilters.checkFilters(patterns, bindings, false, dataset, env, that, callback);
                }
            });
        }
    });
};

// The blank nodes of a basic graph pattern match like variables (see normalizeTerm), but are scoped to it:
// they are dropped from its solutions.
var withoutBlankNodes = function(results) {
    return results.map(function(result) {
        var solution = {};
        for(var name in result) {
            if(name.indexOf("blank:") !== 0) {
                solution[name] = result[name];
            }
        }
        return solution;
    });
};

QueryEngine.prototype.executeAndBGP = function(projection, dataset, pattern, env, callback) {
    var that = this;
    QueryPlan.executeAndBGPsDPSize(pattern.value, dataset, this, env, function(err, result){
        if(err != null) {
            callback(err);
        } else if(result!=null) {
            that.runBinds(pattern.binds, withoutBlankNodes(result), dataset, env, function(err, bindings){
                if(err != null) {
                    callback(err);
                } else {
                    QueryFilters.checkFilters(pattern, bindings, false, dataset, env, that, callback);
                }
            });
        } else {
            callback(null, null);
        }
    });
};

// LeftJoin keeps a left solution if none of its merged solutions passes the OPTIONAL's filter
// (SPARQL 1.1 §18.5). checkFilters returns the failed merged solutions wrapped (__nullify__): each
// such left solution comes back once, with the right side's variables unbound and the values of
// the BINDs, which ran on the merged solutions.
var restoreFailedLeftSolutions = function(bindings, leftSolutions, set2, binds) {
    var acum = [];
    var failed = [];
    // left solutions already represented in acum
    var kept = new Set();
    for(var i=0; i<bindings.length; i++) {
        if(bindings[i]["__nullify__"] === true) {
            failed.push(bindings[i]["bindings"]);
        } else {
            acum.push(bindings[i]);
            kept.add(leftSolutions.get(bindings[i]) || bindings[i]);
        }
    }

    var rightVars = {};
    for(i=0; i<set2.length; i++) {
        for(var p in set2[i]) {
            rightVars[p] = true;
        }
    }
    for(i=0; i<failed.length; i++) {
        var merged = failed[i];
        // an unmatched left solution was not merged
        var left = leftSolutions.get(merged) || merged;
        if(kept.has(left)) {
            continue;
        }
        kept.add(left);
        var solution = {};
        for(p in left) {
            solution[p] = left[p];
        }
        QueryPlan.augmentMissingBindings(solution, rightVars);
        for(var j=0; j<binds.length; j++) {
            var bindVar = binds[j].as.value;
            if(bindVar in merged) {
                solution[bindVar] = merged[bindVar];
            }
        }
        acum.push(solution);
    }
    return acum;
};

QueryEngine.prototype.executeLEFT_JOIN = function(projection, dataset, patterns, env, callback) {
    var setQuery1 = patterns.lvalue;
    var setQuery2 = patterns.rvalue;
    var that = this;
    this.executeSelectUnits(projection, dataset, setQuery1, setQuery2, env, true, function(err, set1, set2){
        if(err != null) {
            callback(err);
        } else {
            // merged solution -> the left solution it came from, only needed to undo a failed filter
            var leftSolutions = patterns.filter != null && patterns.filter.length > 0 ? new Map() : null;
            var result = QueryPlan.leftOuterJoinBindings(set1, set2, leftSolutions);
            that.runBinds(patterns.binds, result, dataset, env, function(err, bindings){
                if(err != null) {
                    callback(err);
                } else if(leftSolutions == null) {
                    callback(null, bindings);
                } else {
                    QueryFilters.checkFilters(patterns, bindings, true, dataset, env, that, function(err, bindings){
                        if(err != null) {
                            callback(err);
                        } else {
                            callback(null, restoreFailedLeftSolutions(bindings, leftSolutions, set2, patterns.binds || []));
                        }
                    });
                }
            });
        }
    });
};

QueryEngine.prototype.executeJOIN = function(projection, dataset, patterns, env, callback) {
    var setQuery1 = patterns.lvalue;
    var setQuery2 = patterns.rvalue;
    var that = this;

    this.executeSelectUnits(projection, dataset, setQuery1, setQuery2, env, true, function(err, set1, set2){
        if(err != null) {
            callback(err);
        } else if(set1.length ===0 || set2.length===0) {
            callback(null, []);
        } else {
            that.runBinds(patterns.binds, QueryPlan.joinBindings(set1, set2), dataset, env, function(err, bindings){
                if(err != null) {
                    callback(err);
                } else {
                    QueryFilters.checkFilters(patterns, bindings, false, dataset, env, that, callback);
                }
            });
        }
    });
};


QueryEngine.prototype.rangeQuery = function(quad, queryEnv, callback) {
    var that = this;
    that.normalizeQuad(quad, queryEnv, false, function(key){
        if(key != null) {
            that.backend.range(new QuadIndex.Pattern(key), function(quads) {
                if(quads == null || quads.length == 0) {
                    callback([]);
                } else {
                    callback(quads);
                }
            });
        } else {
            callback(null);
        }
    });
};

// Update queries

QueryEngine.prototype.executeUpdate = function(syntaxTree, callback) {
    var prologue = syntaxTree.prologue;
    var units = syntaxTree.units;
    var that = this;

    // environment for the operation -> base ns, declared ns, etc.
    var queryEnv = {blanks:{}, outCache:{}};
    this.registerNsInEnvironment(prologue, queryEnv);

    // operations separated by ';' run one after the other; the first error stops the request
    var lastResult;
    async.eachSeries(units, function(unit, k){
        var aqt;
        try {
            aqt = that.abstractQueryTree.parseExecutableUnit(unit);
        } catch(e) {
            return k(e);
        }
        that._executeUpdateUnit(aqt, queryEnv, function(err, result){
            lastResult = result;
            k(err);
        });
    }, function(err){
        if(err != null)
            callback(err);
        else
            callback(null, lastResult);
    });
};

QueryEngine.prototype._executeUpdateUnit = function(aqt, queryEnv, callback) {
    var that = this;
    if(aqt.kind === 'insertdata') {
        async.eachSeries(aqt.quads, function(quad, k){
            that._executeQuadInsert(quad, queryEnv, k);
        }, function(err){
            if(err != null)
                callback(err);
            else
                callback(null, true);
        });
    } else if(aqt.kind === 'deletedata') {
        async.eachSeries(aqt.quads, function(quad, k){
            that._executeQuadDelete(quad, queryEnv, k);
        }, function(err){
            if(err != null)
                callback(err);
            else
                callback(null, true);
        });
    } else if(aqt.kind === 'modify') {
        this._executeModifyQuery(aqt, queryEnv, callback);
    } else if(aqt.kind === 'create') {
        callback(null, true);
    } else if(aqt.kind === 'load') {
        var graph = {'uri': Utils.lexicalFormBaseUri(aqt.sourceGraph, queryEnv)};
        if(aqt.destinyGraph != null) {
            graph = {'uri': Utils.lexicalFormBaseUri(aqt.destinyGraph, queryEnv)};
        }
        this.rdfLoader.load(aqt.sourceGraph.value, graph, function(err, result){
            if(err) {
                callback(err);
            } else {
                that.batchLoad(result, callback);
            }
        });
    } else if(aqt.kind === 'drop') {
        this._executeClearGraph(aqt.destinyGraph, queryEnv, callback);
    } else if(aqt.kind === 'clear') {
        this._executeClearGraph(aqt.destinyGraph, queryEnv, callback);
    } else {
        callback(new Error("not supported execution unit: " + aqt.kind));
    }
};

// Stores parsed quads; calls back (err) or (null, number of new quads).
QueryEngine.prototype.batchLoad = function(quads, callback) {
    var counter = 0;
    var blanks = {};
    var that = this;

    // check every quad first, so that a broken one does not leave the batch half stored
    var components = ['subject','predicate','object','graph'];
    for(var q=0; q<quads.length; q++) {
        for(var c=0; c<components.length; c++) {
            if(quads[q][components[c]] == null || typeof(quads[q][components[c]]) !== 'object') {
                return callback(new Error("Cannot load a quad without a " + components[c]));
            }
        }
    }

    if(this.eventsOnBatchLoad)
        this.callbacksBackend.startGraphModification();

    // subject
    var registerComponent = function(quad, component, newQuad, k) {
        var maybeBlankOid, oid, quad;

        if (quad[component]['uri'] || quad[component].token === 'uri') {
            var uriValue = (quad[component].uri || quad[component].value);
            that.lexicon.registerUri(uriValue, function(oid){
                var returnUriComponent = function(){
                    if (quad[component].uri != null) {
                        quad[component] = {'token': 'uri', 'value': quad[component].uri};
                        delete quad[component]['uri'];
                    }
                    newQuad[component] = oid;
                    k();
                };

                if(component === 'graph') {
                    that.lexicon.registerGraph(oid, uriValue, function(){
                        returnUriComponent();
                    });
                } else {
                    returnUriComponent();
                }
            });
        } else if (quad[component]['literal'] || quad[component].token === 'literal') {
            that.lexicon.registerLiteral(quad[component].literal || quad[component].value, function(oid){
                if (quad[component].literal != null) {
                    quad[component] = that.lexicon.parseLiteral(quad[component].literal);
                    delete quad[component]['literal'];
                }
                newQuad[component] = oid;
                k();
            });
        } else {
            maybeBlankOid = blanks[quad[component].blank || quad[component].value];
            if (maybeBlankOid == null) {
                that.lexicon.registerBlank(function(maybeBlankOid){
                    blanks[(quad[component].blank || quad[component].value)] = maybeBlankOid;

                    if (quad[component].token == null) {
                        quad[component].token = 'blank';
                        quad[component].value = quad[component].blank;
                        delete quad[component]['blank'];
                    }
                    newQuad[component] = maybeBlankOid;
                    k();
                });

            } else {
                if (quad[component].token == null) {
                    quad[component].token = 'blank';
                    quad[component].value = quad[component].blank;
                    delete quad[component]['blank'];
                }
                newQuad[component] = maybeBlankOid;
                k();
            }
        }

    };


    async.eachSeries(quads, function(quad,k){
        var newQuad = {};
        async.eachSeries(components, function(component,kk){
            registerComponent(quad, component, newQuad, kk)
        }, function(){
            var originalQuad = quad;
            quad = newQuad;
            var key = new QuadIndex.NodeKey(quad);

            that.backend.search(key, function(result){
                if(!result) {
                    that.backend.index(key, function(result){
                        if(result){
                            if(that.eventsOnBatchLoad)
                                that.callbacksBackend.nextGraphModification(Callbacks.added, [originalQuad,quad]);
                            counter = counter + 1;
                        }
                        k();
                    });
                } else {
                    k();
                }
            });

        });
    }, function(){
        if(that.lexicon.updateAfterWrite != null)
            that.lexicon.updateAfterWrite();

        var exitFn = function(){
            callback(null, counter);
        };

        if(that.eventsOnBatchLoad) {
            that.callbacksBackend.endGraphModification(exitFn);
        } else {
            exitFn();
        }
    });
};

// Low level operations for update queries

QueryEngine.prototype._executeModifyQuery = function(aqt, queryEnv, callback) {
    var that = this;
    var querySuccess = true;
    var error = new Error("Error executing modify query");
    var bindings = null;
    var components = ['subject', 'predicate', 'object', 'graph'];

    aqt.insert = aqt.insert == null ? [] : aqt.insert;
    aqt.delete = aqt.delete == null ? [] : aqt.delete;

    async.seq(
        function(k) {
            // select query

            var defaultGraph = [];
            var namedGraph = [];

            if(aqt.with != null) {
                defaultGraph.push(aqt.with);
            }

            if(aqt.using != null) {
                namedGraph = [];
                for(var i=0; i<aqt.using.length; i++) {
                    var usingGraph = aqt.using[i];
                    if(usingGraph.kind === 'named') {
                        namedGraph.push(usingGraph.uri);
                    } else {
                        defaultGraph.push(usingGraph.uri);
                    }
                }
            }

            aqt.dataset = {};
            aqt.projection = [{"token": "variable", "kind": "*"}];

            that.executeSelect(aqt, queryEnv, defaultGraph, namedGraph, function(err, result) {
                if(err) {
                    error = err
                    querySuccess = false;
                    return k();
                } else {
                    that.denormalizeBindingsList(result, queryEnv, function(result){
                        if(result!=null) {
                            bindings = result;
                        } else {
                            error = new Error("Error denormalizing bindings list");
                            querySuccess = false;
                        }
                        k();
                    });
                }
            });
        },function(k) {
            // delete query

            var defaultGraph = aqt.with;
            if(querySuccess) {
                var quads = [];
                for(var i=0; i<aqt.delete.length; i++) {
                    var src = aqt.delete[i];

                    for(var j=0; j<bindings.length; j++) {
                        var quad = {};
                        var binding = bindings[j];

                        for(var c=0; c<components.length; c++) {
                            var component = components[c];
                            if(component == 'graph' && src[component] == null) {
                                quad['graph'] = defaultGraph;
                            } else if(src[component].token === 'var') {
                                quad[component] = binding[src[component].value];
                            } else {
                                quad[component] = src[component];
                            }
                        }

                        quads.push(quad);
                    }
                }

                // a template quad that cannot be built (e.g. an unbound variable) is skipped, as SPARQL 1.1 Update specifies
                async.eachSeries(quads, function(quad,kk) {
                    that._executeQuadDelete(quad, queryEnv, function(){
                        kk();
                    });
                },function(){ k(); });
            } else {
                k();
            }
        },function(k) {
            // insert query
            var defaultGraph = aqt.with;

            if(querySuccess) {
                var quads = [];
                for(var i=0; i<aqt.insert.length; i++) {
                    var src = aqt.insert[i];

                    for(var j=0; j<bindings.length; j++) {
                        var quad = {};
                        var binding = bindings[j];

                        for(var c=0; c<components.length; c++) {
                            var component = components[c];
                            if(component == 'graph' && src[component] == null) {
                                quad['graph'] = defaultGraph;
                            } else if(src[component].token === 'var') {
                                quad[component] = binding[src[component].value];
                            } else {
                                quad[component] = src[component];
                            }
                        }

                        quads.push(quad);
                    }
                }

                // as for DELETE: template quads that cannot be built are skipped
                async.eachSeries(quads, function(quad,kk) {
                    that._executeQuadInsert(quad, queryEnv, function(){
                        kk();
                    });
                },function(){ k(); });
            } else {
                k();
            }
        }
    )(function(){
        if(querySuccess)
            callback(null, true);
        else
            callback(error);
    });
};

QueryEngine.prototype._executeQuadInsert = function(quad, queryEnv, callback) {
    var that = this;
    var normalized;
    var error = false;
    var errorMessage = null;
    async.seq(
        function(k){
            that.normalizeQuad(quad, queryEnv, true, function(result){
                if(result != null){
                    normalized = result;
                } else {
                    error = true;
                    errorMessage = "Error normalizing quad.";
                }
                k();
            });
        },
        function(k){
            if(error === false) {
                var key = new QuadIndex.NodeKey(normalized);
                that.backend.search(key, function(found){
                    if(found === true){
                        k();
                    } else {
                        that.backend.index(key, function(){
                            that.callbacksBackend.nextGraphModification(Callbacks.added, [quad, normalized]);
                            k();
                        });
                    }
                });
            } else {
                k();
            }
        })(
        function(){
            if(error) {
                callback(new Error(errorMessage));
            } else {
                callback(null, true);
            }
        });
};

QueryEngine.prototype._executeQuadDelete = function(quad, queryEnv, callback) {
    var that = this;
    var normalized;
    var error = false;
    var errorMessage, key;
    async.seq(
        function(k){
            that.normalizeQuad(quad, queryEnv, true, function(result){
                if(result != null){
                    normalized = result;
                } else {
                    error = true;
                    errorMessage = "Error normalizing quad.";
                }
                k();
            });
        },
        function(k){
            if(error === false) {
                key = new QuadIndex.NodeKey(normalized);
                that.backend.delete(key, function(){
                        k();
                });
            } else {
                k();
            }
        },
        function(k){
            if(error === false) {
                that.lexicon.unregister(quad, key, function(){
                    that.callbacksBackend.nextGraphModification(Callbacks['deleted'], [quad, normalized]);
                    k();
                });
            } else {
                k();
            }
        })(
        function(){
            if(error) {
                callback(new Error(errorMessage));
            } else {
                callback(null, true);
            }
        });
};

// Runs an update inside the update that is already in progress: unlike execute(), it neither starts
// nor ends a graph modification, so its changes are announced together with the surrounding update.
QueryEngine.prototype._executeNestedUpdate = function(queryString, callback) {
    var syntaxTree;
    try {
        syntaxTree = this.abstractQueryTree.parseQueryString(queryString);
    } catch(e) {
        return callback(Utils.toError(e));
    }
    this.executeUpdate(syntaxTree, callback);
};

QueryEngine.prototype._executeClearGraph = function(destinyGraph, queryEnv, callback) {
    var that = this;
    var finish = function(err) {
        if(err)
            callback(err);
        else
            callback(null, true);
    };
    if(destinyGraph === 'default') {
        this._executeNestedUpdate("DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }", finish);
    } else if(destinyGraph === 'named') {
        that.lexicon.registeredGraphs(true, function(graphs){
            if(graphs!=null) {
                var foundErrorDeleting = null;
                async.eachSeries(graphs, function(graph,k){
                    if(foundErrorDeleting == null) {
                        that._executeNestedUpdate("DELETE { GRAPH <"+graph+"> { ?s ?p ?o } } WHERE { GRAPH <"+graph+"> { ?s ?p ?o } }", function(err){
                            if(!err) {
                                that.lexicon.resolveUri(graph, function(oid){
                                    if(oid != -1) {
                                        that.lexicon.knownGraphs.delete(oid, function(){
                                            k();
                                        });
                                    } else {
                                        foundErrorDeleting = new Error("Cannot find graph "+graph+" to clear it");
                                        k();
                                    }
                                });
                            } else {
                                foundErrorDeleting = err;
                                k();
                            }
                        });
                    } else {
                        k();
                    }
                }, function(){
                    finish(foundErrorDeleting);
                });
            } else {
                finish(new Error("Error deleting named graphs"));
            }
        });
    } else if(destinyGraph === 'all') {
        this._executeClearGraph('default', queryEnv, function(err) {
            if(!err) {
                that._executeClearGraph('named', queryEnv, finish);
            } else {
                finish(err);
            }
        });
    } else {
        // destinyGraph is an URI
        if(destinyGraph.token == 'uri') {
            var graphUri = Utils.lexicalFormBaseUri(destinyGraph,queryEnv);
            if(graphUri != null) {
                this._executeNestedUpdate("DELETE { GRAPH <"+graphUri+"> { ?s ?p ?o } } WHERE { GRAPH <"+graphUri+"> { ?s ?p ?o } }", finish);
            } else {
                finish(new Error("wrong graph URI"));
            }
        } else {
            finish(new Error("wrong graph URI"));
        }
    }
};

QueryEngine.prototype.checkGroupSemantics = function(groupVars, projectionVars) {
    if(projectionVars[0].kind === '*') {
        return false;
    }
    // aggregates without GROUP BY ('singleGroup') have no group variables: nothing may be projected without being aggregated
    var projection = {};
    var names = QueryEngine.groupVariables(groupVars);
    for(var i=0; i<names.length; i++) {
        projection[names[i]] = true;
    }

    for(i=0; i<projectionVars.length; i++) {
        var projectionVar = projectionVars[i];
        if(projectionVar.kind === 'var') {
            if(projection[projectionVar.value.value] == null) {
                return false;
            }
        } else if(projectionVar.kind === 'aliased' &&
            projectionVar.expression &&
            projectionVar.expression.primaryexpression === 'var') {
            if(projection[projectionVar.expression.value.value] == null) {
                return false;
            }
        }
    }

    return true;
};

QueryEngine.prototype.runBinds = function(binds, bindings, dataset, env, callback) {
    var that = this;
    var originalBindings = bindings;
    if(binds != null && binds.length > 0) {
        that.copyDenormalizedBindings(bindings, env.outCache, function(denormBindings){
            // IRIs and literals to replace by their OID
            var terms = [];
            for(var i=0; i<bindings.length; i++) {
                for(var j=0; j<binds.length; j++) {
                    var bind = binds[j];
                    var thisDenormBindings = denormBindings[i];
                    var ebv = QueryFilters.runFilter(bind.expression, thisDenormBindings, that, dataset, env);
                    // SPARQL 1.1 Extend: if the expression raises an error, the variable stays unbound;
                    // otherwise the following BINDs see it
                    if(!QueryFilters.isEbvError(ebv)) {
                        var term = QueryFilters.resultTerm(ebv);
                        if(term.token === 'uri') {
                            // a prefixed or relative IRI from the query
                            term = {token: 'uri', value: Utils.lexicalFormBaseUri(term, env)};
                        }
                        originalBindings[i][bind.as.value] = term;
                        thisDenormBindings[bind.as.value] = term;
                        if(term.token === 'uri' || term.token === 'literal') {
                            terms.push({solution: originalBindings[i], variable: bind.as.value, term: term});
                        }
                    }
                }
            }
            // An IRI or literal of the store gets its OID, like a term matched by a triple pattern, so such a
            // term object in a solution is never in the lexicon: joins (areCompatibleBindings), GROUP BY and
            // DISTINCT can then compare OIDs and term objects as they are.
            async.eachSeries(terms, function(entry, k){
                that.normalizeTerm(entry.term, env, false, function(oid){
                    if(oid != null && oid !== -1) {
                        entry.solution[entry.variable] = oid;
                    }
                    k();
                });
            }, function(){
                callback(null, bindings);
            });
        });
    } else {
        callback(null, bindings);
    }
};

QueryEngine.prototype.computeCosts = function (quads, env, callback) {
    for (var i = 0; i < quads.length; i++) {
        quads[i]['_cost'] = this.quadCost(quads[i], env);
    }

    callback(quads);
};

QueryEngine.prototype.quadCost = function(quad, env) {
    return 1;
};

QueryEngine.prototype.registerDefaultNamespace = function(ns, prefix) {
    this.defaultPrefixes[ns] = prefix;
};


module.exports = {
    QueryEngine: QueryEngine
};
