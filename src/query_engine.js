"use strict";

//imports
const AbstractQueryTree = require("./abstract_query_tree").AbstractQueryTree;
const NonSupportedSparqlFeatureError = require("./abstract_query_tree").NonSupportedSparqlFeatureError;
const Utils = require("./utils");
const QuadIndex = require("./quad_index");
const QueryPlan = require("./query_plan").QueryPlan;
const QueryFilters = require("./query_filters").QueryFilters;
const PropertyPaths = require("./property_paths").PropertyPaths;
const RDFModel = require("./rdf_model");
const RDFLoader = require("./rdf_loader").RDFLoader;
const Callbacks = require("./graph_callbacks").CallbacksBackend;

const QueryEngine = function (params) {
    if (arguments.length != 0) {
        this.backend = params.backend;
        this.lexicon = params.lexicon;
        // batch loads should generate events?
        this.eventsOnBatchLoad = params.eventsOnBatchLoad || false;
        // list of namespaces that will be automatically added to every query
        this.defaultPrefixes = {};
        this.abstractQueryTree = new AbstractQueryTree();
        this.rdfLoader = new RDFLoader(params["communication"]);
        this.callbacksBackend = new Callbacks(this);
        this.customFns = params.customFns || {};
        // queries without a dataset read all graphs (store option unionDefaultGraph)
        this.unionDefaultGraph = params.unionDefaultGraph === true;
        // labels of the blank nodes BNODE() creates, unique for the engine; per solution, BNODE(str) -> label
        this.bnodeCounter = 0;
        this.bnodeLabels = new WeakMap();
    }
};

QueryEngine.prototype.setCustomFunctions = function (customFns) {
    this.customFns = customFns;
};

// Utils
// Adds the PREFIX and BASE declarations of a prologue to env, after those it has (the default prefixes for a new env)
QueryEngine.prototype.registerNsInEnvironment = function (prologue, env) {
    const namespaces = {};
    let p;
    const previous = env.namespaces || this.defaultPrefixes;
    for (p in previous) {
        namespaces[p] = previous[p];
    }

    // in order: a BASE resolves against the BASE before it, a PREFIX IRI against the BASE in effect there
    let base = env.base || null;
    const declarations = prologue != null && prologue.declarations != null ? prologue.declarations : [];
    for (let i = 0; i < declarations.length; i++) {
        const declaration = declarations[i];
        if (declaration.token === "base") {
            base = Utils.resolveIri(base, declaration.value);
        } else if (declaration.token === "prefix") {
            namespaces[declaration.prefix] = Utils.resolveIri(base, declaration.local);
        }
    }

    env.namespaces = namespaces;
    env.base = base;
};

QueryEngine.prototype.applyModifier = function (modifier, projectedBindings) {
    if (modifier == "DISTINCT") {
        const map = {};
        const result = [];
        for (let i = 0; i < projectedBindings.length; i++) {
            const bindings = projectedBindings[i];
            let key = "";

            // if no projection variables hash is passed, all the bound
            // variable in the current bindings will be used.
            for (const p in bindings) {
                // hashing the object
                const obj = bindings[p];
                if (obj == null) {
                    key = key + p + "null";
                } else if (obj.token == "literal") {
                    if (obj.value != null) {
                        key = key + obj.value;
                    }
                    if (obj.lang != null) {
                        key = key + obj.lang;
                    }
                    if (obj.type != null) {
                        key = key + obj.type;
                    }
                } else if (obj.value) {
                    key = key + p + obj.value;
                } else {
                    key = key + p + obj;
                }
            }

            if (map[key] == null) {
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

QueryEngine.prototype.applyLimitOffset = function (offset, limit, bindings) {
    if (limit == null && offset == null) {
        return bindings;
    }

    if (offset == null) {
        offset = 0;
    }

    if (limit == null) {
        limit = bindings.length;
    } else {
        limit = offset + limit;
    }

    return bindings.slice(offset, limit);
};

QueryEngine.prototype.applySingleOrderBy = function (orderFilters, modifiedBindings, dataset, outEnv, callback) {
    const acum = [];
    const that = this;
    Utils.eachSeries(
        orderFilters,
        function (orderFilter, k) {
            QueryFilters.collect(orderFilter.expression, [modifiedBindings], dataset, outEnv, that, function (results) {
                acum.push(results[0].value);
                k();
            });
        },
        function () {
            callback({ binding: modifiedBindings, value: acum });
        },
    );
};

QueryEngine.prototype.applyOrderBy = function (order, modifiedBindings, dataset, outEnv, callback) {
    const that = this;
    const acum = [];
    if (order != null && order.length > 0) {
        Utils.eachSeries(
            modifiedBindings,
            function (bindings, k) {
                that.applySingleOrderBy(order, bindings, dataset, outEnv, function (results) {
                    acum.push(results);
                    k();
                });
            },
            function () {
                acum.sort(function (a, b) {
                    return that.compareFilteredBindings(a, b, order, outEnv);
                });

                const toReturn = [];
                for (let i = 0; i < acum.length; i++) {
                    toReturn.push(acum[i].binding);
                }

                callback(toReturn);
            },
        );
    } else {
        callback(modifiedBindings);
    }
};

const untypedOrString = function (term) {
    return term.token === "literal" && (term.type == null || QueryFilters.isXsdType("string", term));
};

QueryEngine.prototype.compareFilteredBindings = function (a, b, order, env) {
    const found = false;
    let i = 0;
    while (!found) {
        if (i == a.value.length) {
            return 0;
        }
        const direction = order[i].direction;
        let filterResult;

        // unbound first
        if (a.value[i] == null && b.value[i] == null) {
            i++;
            continue;
        } else if (a.value[i] == null) {
            filterResult = { value: false };
        } else if (b.value[i] == null) {
            filterResult = { value: true };
        } else
            // blanks
            if (a.value[i].token === "blank" && b.value[i].token === "blank") {
                i++;
                continue;
            } else if (a.value[i].token === "blank") {
                filterResult = { value: false };
            } else if (b.value[i].token === "blank") {
                filterResult = { value: true };
            } else
                // uris
                if (a.value[i].token === "uri" && b.value[i].token === "uri") {
                    if (QueryFilters.runEqualityFunction(a.value[i], b.value[i], [], this, null, env).value == true) {
                        i++;
                        continue;
                    } else {
                        filterResult = QueryFilters.runTotalGtFunction(a.value[i], b.value[i], []);
                    }
                } else if (a.value[i].token === "uri") {
                    filterResult = { value: false };
                } else if (b.value[i].token === "uri") {
                    filterResult = { value: true };
                } else
                    // literals without a datatype, and xsd:string (the same as a simple literal in RDF 1.1)
                    if (untypedOrString(a.value[i]) && untypedOrString(b.value[i])) {
                        if (
                            QueryFilters.runEqualityFunction(a.value[i], b.value[i], [], this, null, env).value == true
                        ) {
                            i++;
                            continue;
                        } else {
                            filterResult = QueryFilters.runTotalGtFunction(a.value[i], b.value[i], []);
                        }
                    } else if (untypedOrString(a.value[i])) {
                        filterResult = { value: false };
                    } else if (untypedOrString(b.value[i])) {
                        filterResult = { value: true };
                    } else
                        // literals
                        if (
                            QueryFilters.runEqualityFunction(a.value[i], b.value[i], [], this, null, env).value == true
                        ) {
                            i++;
                            continue;
                        } else {
                            filterResult = QueryFilters.runTotalGtFunction(a.value[i], b.value[i], []);
                        }

        // choose value for comparison based on the direction
        if (filterResult.value == true) {
            if (direction === "ASC") {
                return 1;
            } else {
                return -1;
            }
        } else {
            if (direction === "ASC") {
                return -1;
            } else {
                return 1;
            }
        }
    }
};

// true if an aggregate (COUNT, SUM, ...) occurs anywhere in the expression tree
QueryEngine.containsAggregate = function (expression) {
    if (expression == null || typeof expression !== "object") {
        return false;
    }
    if (expression.expressionType === "aggregate") {
        return true;
    }
    for (const key in expression) {
        if (QueryEngine.containsAggregate(expression[key])) {
            return true;
        }
    }
    return false;
};

// Copy of the expression with each aggregate replaced by a variable '#aggregate<n>' ('#' can't occur in a
// SPARQL variable), so that aggregates can be used inside expressions. The distinct aggregates are added
// to `aggregates` as {name, key, expression}.
QueryEngine.extractAggregates = function (expression, aggregates) {
    if (expression == null || typeof expression !== "object") {
        return expression;
    }
    if (expression.expressionType === "aggregate") {
        const key = JSON.stringify(expression);
        let name = null;
        for (let i = 0; i < aggregates.length && name == null; i++) {
            if (aggregates[i].key === key) {
                name = aggregates[i].name;
            }
        }
        if (name == null) {
            name = "#aggregate" + aggregates.length;
            aggregates.push({ name: name, key: key, expression: expression });
        }
        return {
            token: "expression",
            expressionType: "atomic",
            primaryexpression: "var",
            value: { token: "var", value: name },
        };
    }
    const copy = Array.isArray(expression) ? [] : {};
    for (const prop in expression) {
        copy[prop] = QueryEngine.extractAggregates(expression[prop], aggregates);
    }
    return copy;
};

// The variables used in an expression, without the patterns of EXISTS / NOT EXISTS.
QueryEngine.expressionVariables = function (expression, vars) {
    if (expression == null || typeof expression !== "object") {
        return vars;
    }
    if (expression.token === "var") {
        vars.push(expression.value);
    } else if (expression.builtincall !== "exists" && expression.builtincall !== "notexists") {
        for (const key in expression) {
            QueryEngine.expressionVariables(expression[key], vars);
        }
    }
    return vars;
};

// The variables a GROUP BY binds: grouped variables and the aliases of grouped expressions.
QueryEngine.groupVariables = function (group) {
    const vars = [];
    for (let i = 0; group !== "singleGroup" && i < group.length; i++) {
        if (group[i].token === "var") {
            vars.push(group[i].value);
        } else if (group[i].token === "aliased_expression") {
            vars.push(group[i].alias.value);
        }
    }
    return vars;
};

// How a grouped query evaluates its expressions. Aggregates inside SELECT expressions, HAVING and ORDER BY
// become variables of each group's scope (see groupScope). Outside aggregates, these expressions may use
// the group variables and, more leniently than SPARQL, the SELECT aliases; `ungroupedVariable` names the
// first other variable.
QueryEngine.planGroups = function (group, projection, having, order) {
    const plan = {
        groupVars: QueryEngine.groupVariables(group),
        aggregates: [],
        projection: [],
        having: [],
        order: [],
    };
    const expressions = [];
    for (let i = 0; i < projection.length; i++) {
        const expression = projection[i].expression;
        // a single aggregate is computed over the group, any other expression evaluated on the group's scope
        const evaluated = expression != null && expression.expressionType !== "aggregate";
        plan.projection.push({
            name: projection[i].alias ? projection[i].alias.value : projection[i].value.value,
            item: projection[i],
            expression: evaluated ? QueryEngine.extractAggregates(expression, plan.aggregates) : null,
        });
        if (evaluated) {
            expressions.push(plan.projection[i].expression);
        }
    }
    for (let i = 0; having != null && i < having.length; i++) {
        plan.having.push(QueryEngine.extractAggregates(having[i], plan.aggregates));
        expressions.push(plan.having[i]);
    }
    for (let i = 0; order != null && i < order.length; i++) {
        plan.order.push({
            direction: order[i].direction,
            expression: QueryEngine.extractAggregates(order[i].expression, plan.aggregates),
        });
        expressions.push(plan.order[i].expression);
    }

    const inScope = {};
    const names = plan.groupVars.concat(
        plan.projection.map(function (projected) {
            return projected.name;
        }),
        plan.aggregates.map(function (aggregate) {
            return aggregate.name;
        }),
    );
    for (let i = 0; i < names.length; i++) {
        inScope[names[i]] = true;
    }
    const used = QueryEngine.expressionVariables(expressions, []);
    for (let i = 0; i < used.length && plan.ungroupedVariable == null; i++) {
        if (inScope[used[i]] !== true) {
            plan.ungroupedVariable = used[i];
        }
    }
    return plan;
};

// One group's solution as SELECT expressions, HAVING and ORDER BY see it: the group variables, the
// aggregates of the plan and the projected values.
QueryEngine.prototype.groupScope = function (plan, denormGroup, dataset, env) {
    const scope = {};
    for (let i = 0; i < plan.groupVars.length; i++) {
        scope[plan.groupVars[i]] = denormGroup.length > 0 ? denormGroup[0][plan.groupVars[i]] : null;
    }
    for (let i = 0; i < plan.aggregates.length; i++) {
        const value = QueryFilters.runAggregator(
            { token: "variable", kind: "aliased", expression: plan.aggregates[i].expression },
            denormGroup,
            this,
            dataset,
            env,
        );
        if (!QueryFilters.isEbvError(value)) {
            scope[plan.aggregates[i].name] = value;
        }
    }
    for (let i = 0; i < plan.projection.length; i++) {
        const projected = plan.projection[i];
        const value =
            projected.expression == null
                ? QueryFilters.runAggregator(projected.item, denormGroup, this, dataset, env)
                : QueryFilters.runFilter(projected.expression, scope, this, dataset, env);
        // an error leaves the variable unbound
        if (!QueryFilters.isEbvError(value)) {
            scope[projected.name] = QueryFilters.resultTerm(value);
        }
    }
    return scope;
};

// Adds the SELECT aliases to copies of the solutions (SPARQL 1.1 Extend, before ORDER BY). Expressions are
// evaluated on the terms of the variables they use, not on OIDs; an error leaves the alias unbound.
QueryEngine.prototype.extendBindings = function (projection, results, dataset, env, callback) {
    const aliased = [];
    const used = [];
    for (let j = 0; projection[0].kind !== "*" && j < projection.length; j++) {
        if (projection[j].kind === "aliased") {
            aliased.push(projection[j]);
            QueryEngine.expressionVariables(projection[j].expression, used);
        }
    }
    if (aliased.length === 0) {
        return callback(results);
    }
    const usedBindings = results.map(function (result) {
        const usedResult = {};
        for (let u = 0; u < used.length; u++) {
            usedResult[used[u]] = result[used[u]];
        }
        return usedResult;
    });
    const that = this;
    this.copyDenormalizedBindings(usedBindings, env.outCache, function (denormResults) {
        const expressionEnv = { blanks: {}, outCache: {}, namespaces: env.namespaces, base: env.base };
        const extended = [];
        for (let i = 0; i < results.length; i++) {
            const extendedResult = {};
            for (const p in results[i]) {
                extendedResult[p] = results[i][p];
            }
            for (let j = 0; j < aliased.length; j++) {
                const ebv = QueryFilters.runFilter(
                    aliased[j].expression,
                    denormResults[i],
                    that,
                    dataset,
                    expressionEnv,
                );
                extendedResult[aliased[j].alias.value] = QueryFilters.isEbvError(ebv)
                    ? null
                    : QueryFilters.resultTerm(ebv);
            }
            extended.push(extendedResult);
        }

        if (env.unsupportedFeature == null) env.unsupportedFeature = expressionEnv.unsupportedFeature;
        callback(extended);
    });
};

QueryEngine.prototype.projectBindings = function (projection, results) {
    if (projection[0].kind === "*") {
        return results;
    }
    return results.map(function (result) {
        const projected = {};
        for (let j = 0; j < projection.length; j++) {
            const name = projection[j].kind === "aliased" ? projection[j].alias.value : projection[j].value.value;
            projected[name] = result[name];
        }
        return projected;
    });
};

QueryEngine.prototype.resolveNsInEnvironment = function (prefix, env) {
    const namespaces = env.namespaces;
    return namespaces[prefix];
};

QueryEngine.prototype.normalizeTerm = function (term, env, shouldIndex, callback) {
    if (term.token === "uri") {
        const uri = Utils.lexicalFormBaseUri(term, env);
        if (uri == null) {
            callback(null);
        } else {
            if (shouldIndex) {
                this.lexicon.registerUri(uri, callback);
            } else {
                this.lexicon.resolveUri(uri, callback);
            }
        }
    } else if (term.token === "literal") {
        const lexicalFormLiteral = Utils.lexicalFormLiteral(term, env);
        if (shouldIndex) {
            this.lexicon.registerLiteral(lexicalFormLiteral, callback);
        } else {
            this.lexicon.resolveLiteral(lexicalFormLiteral, callback);
        }
    } else if (term.token === "blank") {
        const label = term.value;
        if (term.oid != null) {
            // a blank node of the store bound into an EXISTS pattern
            callback(term.oid);
        } else if (!shouldIndex) {
            // in a query pattern a blank node matches like a variable (see QueryPlanDPSize.variablesInBGP, withoutInternalVariables),
            // never a data blank node with the same label in env.blanks
            callback("blank:" + label);
        } else if (env.blanks[label] != null) {
            callback(env.blanks[label]);
        } else {
            this.lexicon.registerBlank(function (oid) {
                env.blanks[label] = oid;
                callback(oid);
            });
        }
    } else if (term.token === "var") {
        callback(term.value);
    } else {
        callback(null);
    }
};

QueryEngine.prototype.normalizeDatasets = function (datasets, outerEnv, callback) {
    const that = this;
    Utils.eachSeries(
        datasets,
        function (dataset, k) {
            if (dataset.value === that.lexicon.defaultGraphUri) {
                dataset.oid = that.lexicon.defaultGraphOid;
                k();
            } else {
                that.normalizeTerm(dataset, outerEnv, false, function (oid) {
                    if (oid != null) {
                        dataset.oid = oid;
                    }
                    k();
                });
            }
        },
        function () {
            callback(true);
        },
    );
};

/**
 * Calls back with whether a graph IRI is a graph of the dataset: one of its named graphs if the query names
 * some (FROM NAMED, USING NAMED, the named graphs passed to execute), else any graph of the store. The store's
 * graphs are cached on the dataset, which belongs to one query or update operation.
 */
QueryEngine.prototype.isDatasetGraph = function (graph, dataset, env, callback) {
    const that = this;
    this.normalizeTerm(graph, env, false, function (oid) {
        if (oid == null || oid === -1) {
            callback(false);
        } else if (dataset.named != null && dataset.named.length > 0 && dataset.union !== true) {
            callback(
                dataset.named.some(function (named) {
                    return named.oid === oid;
                }),
            );
        } else if (dataset.registeredGraphs != null) {
            callback(dataset.registeredGraphs.indexOf(oid) !== -1);
        } else {
            that.lexicon.registeredGraphs(false, function (graphs) {
                dataset.registeredGraphs = graphs;
                callback(graphs.indexOf(oid) !== -1);
            });
        }
    });
};

QueryEngine.prototype.normalizeQuad = function (quad, queryEnv, shouldIndex, callback) {
    let subject = null;
    let predicate = null;
    let object = null;
    let graph = null;
    const that = this;
    let error = false;

    Utils.seq(
        function (k) {
            if (quad.graph == null || quad.graph.value === that.lexicon.defaultGraphUri) {
                graph = 0; // default graph
                k();
            } else {
                const graphUriValue = Utils.lexicalFormBaseUri(quad.graph, queryEnv);
                that.normalizeTerm(quad.graph, queryEnv, shouldIndex, function (oid) {
                    if (oid != null) {
                        graph = oid;
                        if (shouldIndex === true && quad.graph.token != "var") {
                            that.lexicon.registerGraph(oid, graphUriValue, function () {
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
        },
        function (k) {
            if (error === false) {
                that.normalizeTerm(quad.subject, queryEnv, shouldIndex, function (oid) {
                    if (oid != null) {
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
        },
        function (k) {
            if (error === false) {
                that.normalizeTerm(quad.predicate, queryEnv, shouldIndex, function (oid) {
                    if (oid != null) {
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
        },
        function (k) {
            if (error === false) {
                that.normalizeTerm(quad.object, queryEnv, shouldIndex, function (oid) {
                    if (oid != null) {
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
        },
    )(function () {
        if (error === true) {
            callback(null);
        } else {
            callback({
                subject: subject,
                predicate: predicate,
                object: object,
                graph: graph,
            });
        }
    });
};

QueryEngine.prototype.denormalizeBindingsList = function (bindingsList, env, callback) {
    const that = this;
    const denormList = [];

    Utils.eachSeries(
        bindingsList,
        function (bindings, k) {
            that.denormalizeBindings(bindings, env, function (denorm) {
                denormList.push(denorm);
                k();
            });
        },
        function () {
            callback(denormList);
        },
    );
};

/**
 * Receives a bindings map (var -> oid) and an out cache (oid -> value)
 * returns a bindings map (var -> value) storing in cache all the missing values for oids
 *
 * This is required just to save lookups when final results are generated.
 */
QueryEngine.prototype.copyDenormalizedBindings = function (bindingsList, out, callback) {
    const that = this;
    const denormList = [];
    Utils.eachSeries(
        bindingsList,
        function (bindings, k) {
            const denorm = {};
            const variables = Utils.keys(bindings);
            Utils.eachSeries(
                variables,
                function (variable, kk) {
                    const oid = bindings[variable];
                    if (oid == null) {
                        // this can be null, e.g. union different variables (check SPARQL recommendation examples UNION)
                        denorm[variable] = null;
                        kk();
                    } else if (typeof oid === "object") {
                        // the binding is already denormalized, this can happen for example because the value of the
                        // binding is the result of the aggregation of other bindings in a GROUP clause
                        denorm[variable] = oid;
                        kk();
                    } else {
                        const inOut = out[oid];
                        if (inOut != null) {
                            denorm[variable] = inOut;
                            kk();
                        } else {
                            that.lexicon.retrieve(oid, function (val) {
                                out[oid] = val;
                                denorm[variable] = val;
                                kk();
                            });
                        }
                    }
                },
                function () {
                    denormList.push(denorm);
                    k();
                },
            );
        },
        function () {
            callback(denormList);
        },
    );
};

QueryEngine.prototype.denormalizeBindings = function (bindings, env, callback) {
    const variables = Utils.keys(bindings);
    const envOut = env.outCache;
    const that = this;
    Utils.eachSeries(
        variables,
        function (variable, k) {
            const oid = bindings[variable];
            if (oid == null) {
                // this can be null, e.g. union different variables (check SPARQL recommendation examples UNION)
                bindings[variable] = null;
                k();
            } else if (typeof oid === "object") {
                // the binding is already denormalized, this can happen for example because the value of the
                // binding is the result a BIND(expression AS ?new_var) binding.
                k();
            } else {
                if (envOut[oid] != null) {
                    bindings[variable] = envOut[oid];
                    k();
                } else {
                    that.lexicon.retrieve(oid, function (val) {
                        bindings[variable] = val;
                        k();
                    });
                }
            }
        },
        function () {
            callback(bindings);
        },
    );
};

// Queries execution

QueryEngine.prototype.execute = function (queryString, callback, defaultDataset, namedDataset) {
    const that = this;
    const done = Utils.once(callback);
    let modificationStarted = false;
    try {
        queryString = Utils.normalizeUnicodeLiterals(queryString);
        const syntaxTree = this.abstractQueryTree.parseQueryString(queryString);
        if (syntaxTree == null) {
            done(new Error("Error parsing query string"));
        } else if (syntaxTree.token === "query" && syntaxTree.kind == "update") {
            this.callbacksBackend.startGraphModification();
            modificationStarted = true;
            this.executeUpdate(syntaxTree, function (err, result) {
                if (that.lexicon.updateAfterWrite) that.lexicon.updateAfterWrite();

                if (err) {
                    that.callbacksBackend.cancelGraphModification();
                    done(err, result);
                } else {
                    that.callbacksBackend.endGraphModification(function () {
                        done(null, result);
                    });
                }
            });
        } else if (syntaxTree.token === "query" && syntaxTree.kind == "query") {
            this.executeQuery(syntaxTree, done, defaultDataset, namedDataset);
        } else {
            done(new Error("Cannot execute query of kind " + syntaxTree.kind));
        }
    } catch (e) {
        // an exception from the caller's own callback is not a query error: let it propagate
        if (done.called) throw e;
        if (modificationStarted) this.callbacksBackend.cancelGraphModification();
        done(Utils.toError(e));
    }
};

// Retrieval queries

QueryEngine.prototype.executeQuery = function (syntaxTree, callback, defaultDataset, namedDataset) {
    const prologue = syntaxTree.prologue;
    const units = syntaxTree.units;
    let that = this;

    // environment for the operation -> base ns, declared ns, etc.
    const queryEnv = { blanks: {}, outCache: {} };
    this.registerNsInEnvironment(prologue, queryEnv);

    // retrieval queries can only have 1 executable unit
    const aqt = that.abstractQueryTree.parseExecutableUnit(units[0]);

    // can be anything else but a select???
    if (aqt.kind === "select") {
        this.executeSelect(aqt, queryEnv, defaultDataset, namedDataset, function (err, result) {
            if (err == null) {
                if (typeof result === "object" && result.denorm === true) {
                    callback(null, result["bindings"]);
                } else {
                    that.denormalizeBindingsList(result, queryEnv, function (result) {
                        callback(null, result);
                    });
                }
            } else {
                callback(err);
            }
        });
    } else if (aqt.kind === "ask") {
        aqt.projection = [{ token: "variable", kind: "*" }];
        this.executeSelect(aqt, queryEnv, defaultDataset, namedDataset, function (err, result) {
            if (err == null) {
                if (result.length > 0) {
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            } else {
                callback(err);
            }
        });
    } else if (aqt.kind === "construct") {
        if (aqt.group != null || aqt.having != null) {
            return callback(
                new NonSupportedSparqlFeatureError(
                    "GROUP BY in CONSTRUCT",
                    "GROUP BY and HAVING are not supported in CONSTRUCT queries",
                ),
            );
        }
        aqt.projection = [{ token: "variable", kind: "*" }];
        that = this;
        this.executeSelect(aqt, queryEnv, defaultDataset, namedDataset, function (err, result) {
            if (err == null) {
                that.denormalizeBindingsList(result, queryEnv, function (result) {
                    if (result != null) {
                        const graph = new RDFModel.Graph();

                        // CONSTRUCT WHERE {} case
                        if (aqt.template == null) {
                            aqt.template = { triplesContext: aqt.pattern };
                        }
                        let blankIdCounter = 1;
                        const toClear = [];
                        for (let i = 0; i < result.length; i++) {
                            const bindings = result[i];
                            for (let j = 0; j < toClear.length; j++) delete toClear[j].valuetmp;

                            for (let j = 0; j < aqt.template.triplesContext.length; j++) {
                                // fresh IDs for blank nodes in the construct template
                                const components = ["subject", "predicate", "object"];
                                const tripleTemplate = aqt.template.triplesContext[j];
                                for (let p = 0; p < components.length; p++) {
                                    const component = components[p];
                                    if (tripleTemplate[component].token === "blank") {
                                        if (!tripleTemplate[component].valuetmp) {
                                            const blankId = "_:b" + blankIdCounter;
                                            blankIdCounter++;
                                            tripleTemplate[component].valuetmp = blankId;
                                            toClear.push(tripleTemplate[component]);
                                        }
                                    }
                                }
                                const s = RDFModel.buildRDFResource(tripleTemplate.subject, bindings, that, queryEnv);
                                const pred = RDFModel.buildRDFResource(
                                    tripleTemplate.predicate,
                                    bindings,
                                    that,
                                    queryEnv,
                                );
                                const o = RDFModel.buildRDFResource(tripleTemplate.object, bindings, that, queryEnv);
                                if (s != null && pred != null && o != null) {
                                    const triple = new RDFModel.Triple(s, pred, o);
                                    graph.add(triple);
                                }
                            }
                        }
                        callback(null, graph);
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

QueryEngine.prototype.executeSelect = function (unit, env, defaultDataset, namedDataset, callback) {
    if (unit.kind === "select" || unit.kind === "ask" || unit.kind === "construct" || unit.kind === "modify") {
        const projection = unit.projection;
        const dataset = unit.dataset;
        const modifier = unit.modifier;
        const limit = unit.limit;
        const offset = unit.offset;
        const order = unit.order;
        const that = this;

        // an unsupported feature met while evaluating an expression (see QueryFilters.runFilter) fails the query
        const reply = callback;
        callback = function (err, result) {
            if (err == null && env.unsupportedFeature != null) reply(env.unsupportedFeature);
            else reply(err, result);
        };

        if (defaultDataset != null || namedDataset != null) {
            dataset.implicit = defaultDataset || [];
            dataset.named = namedDataset || [];
        }

        const completeDataset = function (next) {
            if (dataset.implicit.length > 0 || dataset.named.length > 0) {
                next();
            } else if (that.unionDefaultGraph && unit.kind !== "modify") {
                // a query (not an update) without a dataset: the default graph is the merge of all graphs, and the
                // named graphs are all graphs of the store. As without FROM NAMED, GRAPH <iri> stays unrestricted
                // (store.graph() reads the default graph by its IRI).
                that.lexicon.registeredGraphs(true, function (uris) {
                    const graphs = uris.map(function (uri) {
                        return { token: "uri", prefix: null, suffix: null, value: uri };
                    });
                    dataset.implicit = [that.lexicon.defaultGraphUriTerm].concat(graphs);
                    dataset.named = graphs;
                    dataset.union = true;
                    next();
                });
            } else {
                dataset.implicit.push(that.lexicon.defaultGraphUriTerm);
                next();
            }
        };

        completeDataset(function () {
            that.normalizeDatasets(dataset.implicit.concat(dataset.named), env, function () {
                that.executeSelectUnit(projection, dataset, unit.pattern, env, function (err, result) {
                    if (err != null) {
                        callback(err);
                    } else if (result != null) {
                        // detect single group: aggregates (in SELECT or ORDER BY) or HAVING without GROUP BY
                        // (no group clause leaves `group` unset)
                        if (unit.group == null || unit.group === "") {
                            let foundUniqueGroup = unit.having != null;
                            for (let i = 0; i < unit.projection.length; i++) {
                                if (QueryEngine.containsAggregate(unit.projection[i].expression)) {
                                    foundUniqueGroup = true;
                                }
                            }
                            for (let i = 0; order != null && i < order.length; i++) {
                                if (QueryEngine.containsAggregate(order[i].expression)) {
                                    foundUniqueGroup = true;
                                }
                            }
                            if (foundUniqueGroup === true) {
                                unit.group = "singleGroup";
                            }
                        }
                        if (unit.group && unit.group != "") {
                            if (that.checkGroupSemantics(unit.group, projection)) {
                                const plan = QueryEngine.planGroups(unit.group, projection, unit.having, order);
                                if (plan.ungroupedVariable != null) {
                                    return callback(
                                        new Error(
                                            "Variable ?" +
                                                plan.ungroupedVariable +
                                                " is neither grouped nor aggregated",
                                        ),
                                    );
                                }
                                that.groupSolution(result, unit.group, dataset, env, function (groupedBindings) {
                                    const scopes = [];
                                    Utils.eachSeries(
                                        groupedBindings,
                                        function (groupedBindingsGroup, k) {
                                            that.copyDenormalizedBindings(
                                                groupedBindingsGroup,
                                                env.outCache,
                                                function (denormGroup) {
                                                    const scope = that.groupScope(plan, denormGroup, dataset, env);
                                                    for (let h = 0; h < plan.having.length; h++) {
                                                        if (
                                                            QueryFilters.ebv(
                                                                QueryFilters.runFilter(
                                                                    plan.having[h],
                                                                    scope,
                                                                    that,
                                                                    dataset,
                                                                    env,
                                                                ),
                                                            ) !== true
                                                        ) {
                                                            return k();
                                                        }
                                                    }
                                                    scopes.push(scope);
                                                    k();
                                                },
                                            );
                                        },
                                        function () {
                                            that.applyOrderBy(
                                                plan.order,
                                                scopes,
                                                dataset,
                                                env,
                                                function (orderedScopes) {
                                                    const aggregatedBindings = [];
                                                    for (let s = 0; s < orderedScopes.length; s++) {
                                                        const projected = {};
                                                        for (let p = 0; p < plan.projection.length; p++) {
                                                            projected[plan.projection[p].name] =
                                                                orderedScopes[s][plan.projection[p].name];
                                                        }
                                                        aggregatedBindings.push(projected);
                                                    }
                                                    const modifiedBindings = that.applyModifier(
                                                        modifier,
                                                        aggregatedBindings,
                                                    );
                                                    const limitedBindings = that.applyLimitOffset(
                                                        offset,
                                                        limit,
                                                        modifiedBindings,
                                                    );
                                                    callback(null, { bindings: limitedBindings, denorm: true });
                                                },
                                            );
                                        },
                                    );
                                });
                            } else {
                                callback(new Error("Incompatible Group and Projection variables"));
                            }
                        } else {
                            that.extendBindings(projection, result, dataset, env, function (extendedBindings) {
                                that.applyOrderBy(order, extendedBindings, dataset, env, function (orderedBindings) {
                                    const projectedBindings = that.projectBindings(projection, orderedBindings);
                                    const modifiedBindings = that.applyModifier(modifier, projectedBindings);
                                    const limitedBindings = that.applyLimitOffset(offset, limit, modifiedBindings);
                                    callback(null, limitedBindings);
                                });
                            });
                        }
                    } else {
                        // fail selectUnit
                        callback(new Error("Error executing SELECT query."));
                    }
                });
            });
        });
    } else {
        callback(new Error("Cannot execute " + unit.kind + " query as a select query"));
    }
};

QueryEngine.prototype.groupSolution = function (bindings, group, dataset, queryEnv, callback) {
    const order = [];
    const filteredBindings = [];
    let initialized = false;
    const that = this;
    if (group === "singleGroup") {
        callback([bindings]);
    } else {
        Utils.eachSeries(
            bindings,
            function (currentBindings, k) {
                let mustAddBindings = true;

                /**
                 * In this loop, we iterate through all the group clauses and transform the current bindings
                 * according to the group by clauses.
                 * If it is the first iteration we also save in a different array the order for the
                 * grouped variables that will be used later to build the final groups
                 */
                Utils.eachSeries(
                    group,
                    function (currentOrderClause, kk) {
                        let orderVariable = null;

                        if (currentOrderClause.token === "var") {
                            orderVariable = currentOrderClause.value;

                            if (initialized == false) {
                                order.push(orderVariable);
                            }
                            kk();
                        } else if (currentOrderClause.token === "aliased_expression") {
                            orderVariable = currentOrderClause.alias.value;
                            if (initialized == false) {
                                order.push(orderVariable);
                            }

                            if (currentOrderClause.expression.primaryexpression === "var") {
                                currentBindings[currentOrderClause.alias.value] =
                                    currentBindings[currentOrderClause.expression.value.value];
                                kk();
                            } else {
                                that.copyDenormalizedBindings(
                                    [currentBindings],
                                    queryEnv.outCache,
                                    function (denormBindings) {
                                        const filterResultEbv = QueryFilters.runFilter(
                                            currentOrderClause.expression,
                                            denormBindings[0],
                                            that,
                                            dataset,
                                            queryEnv,
                                        );
                                        if (!QueryFilters.isEbvError(filterResultEbv)) {
                                            currentBindings[currentOrderClause.alias.value] =
                                                QueryFilters.resultTerm(filterResultEbv);
                                        } else {
                                            mustAddBindings = false;
                                        }
                                        kk();
                                    },
                                );
                            }
                        } else {
                            // In this case, we create an additional variable in the binding to hold the group variable value:
                            // one per group clause, registered even if the first solution fails to evaluate
                            orderVariable = "groupCondition" + group.indexOf(currentOrderClause);
                            if (initialized == false) {
                                order.push(orderVariable);
                            }
                            that.copyDenormalizedBindings(
                                [currentBindings],
                                queryEnv.outCache,
                                function (denormBindings) {
                                    const filterResultEbv = QueryFilters.runFilter(
                                        currentOrderClause,
                                        denormBindings[0],
                                        that,
                                        dataset,
                                        queryEnv,
                                    );
                                    if (!QueryFilters.isEbvError(filterResultEbv)) {
                                        currentBindings[orderVariable] = filterResultEbv;
                                    } else {
                                        mustAddBindings = false;
                                    }
                                    kk();
                                },
                            );
                        }
                    },
                    function () {
                        if (initialized == false) {
                            initialized = true;
                        }
                        if (mustAddBindings === true) {
                            filteredBindings.push(currentBindings);
                        }
                        k();
                    },
                );
            },
            function () {
                /**
                 * After processing all the bindings, we build the group using the
                 * information stored about the order of the group variables.
                 */
                const dups = {};
                const groupMap = {};
                const groupCounter = 0;
                for (let i = 0; i < filteredBindings.length; i++) {
                    const currentTransformedBinding = filteredBindings[i];
                    // one entry per group clause, so ("a","bc") and ("ab","c") or 1 and "1" stay apart;
                    // a single OID keeps its plain key and with it the previous (numeric) group order
                    const keyParts = [];
                    for (let j = 0; j < order.length; j++) {
                        const maybeObject = currentTransformedBinding[order[j]];
                        if (maybeObject == null) {
                            keyParts.push(null);
                        } else if (typeof maybeObject === "object") {
                            keyParts.push([
                                maybeObject.token,
                                maybeObject.value,
                                maybeObject.type || null,
                                maybeObject.lang || null,
                            ]);
                        } else {
                            keyParts.push(maybeObject);
                        }
                    }
                    const key =
                        keyParts.length === 1 && typeof keyParts[0] !== "object"
                            ? String(keyParts[0])
                            : JSON.stringify(keyParts);

                    if (dups[key] == null) {
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
                const groups = [];

                for (const k in dups) {
                    groups.push(dups[k]);
                }

                callback(groups);
            },
        );
    }
};

/**
 * Here, all the constructions of the SPARQL algebra are handled
 */
QueryEngine.prototype.executeSelectUnit = function (projection, dataset, pattern, env, callback) {
    const that = this;
    if (pattern.kind === "BGP") {
        this.executeAndBGP(projection, dataset, pattern, env, callback);
    } else if (pattern.kind === "UNION") {
        this.executeUNION(projection, dataset, pattern.value, env, callback);
    } else if (pattern.kind === "JOIN") {
        this.executeJOIN(projection, dataset, pattern, env, callback);
    } else if (pattern.kind === "LEFT_JOIN") {
        this.executeLEFT_JOIN(projection, dataset, pattern, env, callback);
    } else if (pattern.kind === "FILTER") {
        // Some components may have the filter inside the unit
        this.executeSelectUnit(projection, dataset, pattern.value, env, function (err, results) {
            if (err != null) {
                callback(err);
            } else if (results != null) {
                QueryFilters.checkFilters(pattern, results, false, dataset, env, that, callback);
            } else {
                callback(null, []);
            }
        });
    } else if (pattern.kind === "EXTEND") {
        this.executeSelectUnit(projection, dataset, pattern.value, env, function (err, results) {
            if (err != null) {
                callback(err);
            } else if (results != null) {
                that.runBinds(pattern.binds, results, dataset, env, callback);
            } else {
                callback(null, []);
            }
        });
    } else if (pattern.kind === "GRAPH") {
        // GRAPH ?g: the patterns inside matched an internal variable, which becomes ?g here, as the join with
        // ?g -> graph of SPARQL 1.1 18.6 (a ?g bound inside to another value drops the solution)
        this.executeSelectUnit(projection, dataset, pattern.value, env, function (err, results) {
            if (err != null || results == null || pattern.internal == null) {
                callback(err, results);
            } else {
                const name = pattern.graph.value;
                const internal = pattern.internal.value;
                const solutions = [];
                for (let i = 0; i < results.length; i++) {
                    const solution = results[i];
                    const graph = solution[internal];
                    delete solution[internal];
                    if (graph == null) {
                        // not reached: every pattern inside GRAPH binds its graph
                        solutions.push(solution);
                    } else if (solution[name] == null) {
                        solution[name] = graph;
                        solutions.push(solution);
                    } else if (solution[name] === graph) {
                        solutions.push(solution);
                    }
                }
                callback(null, solutions);
            }
        });
    } else if (pattern.kind === "EMPTY_PATTERN") {
        // the empty group has one solution without variables (its filters are a FILTER node around it, see
        // DAWG algebra/filter-nested-2). Under GRAPH, like for triple patterns (QueryPlanDPSize.executeBGPDatasets),
        // a graph variable takes each named graph of the dataset, and an IRI must be a graph of the dataset.
        if (pattern.graph == null) {
            callback(null, [{}]);
        } else if (pattern.graph.token === "var") {
            const solutions = [];
            const seen = {};
            for (let i = 0; i < dataset.named.length; i++) {
                if (seen[dataset.named[i].oid] == null) {
                    seen[dataset.named[i].oid] = true;
                    const solution = {};
                    solution[pattern.graph.value] = dataset.named[i].oid;
                    solutions.push(solution);
                }
            }
            callback(null, solutions);
        } else {
            this.isDatasetGraph(pattern.graph, dataset, env, function (inDataset) {
                callback(null, inDataset ? [{}] : []);
            });
        }
    } else if (pattern.kind === "PATH") {
        PropertyPaths.execute(this, dataset, pattern, env, {}, callback);
    } else if (pattern.kind === "BGP_SCOPE") {
        this.executeBGPScope(projection, dataset, pattern.value, env, callback);
    } else {
        callback(new NonSupportedSparqlFeatureError(pattern.kind));
    }
};

// Evaluates two sub-patterns one after the other; stops at the first error. With skipIfFirstEmpty
// (joins), the second one is not evaluated when the first has no solutions.
QueryEngine.prototype.executeSelectUnits = function (
    projection,
    dataset,
    setQuery1,
    setQuery2,
    env,
    skipIfFirstEmpty,
    callback,
) {
    const that = this;
    let set1, set2;
    Utils.seq(
        function (k) {
            that.executeSelectUnit(projection, dataset, setQuery1, env, function (err, result) {
                set1 = result;
                k(err);
            });
        },
        function (k) {
            if (skipIfFirstEmpty && set1 != null && set1.length === 0) {
                set2 = [];
                return k();
            }
            that.executeSelectUnit(projection, dataset, setQuery2, env, function (err, result) {
                set2 = result;
                k(err);
            });
        },
    )(function (err) {
        if (err != null) callback(err);
        else callback(null, set1, set2);
    });
};

QueryEngine.prototype.executeUNION = function (projection, dataset, patterns, env, callback) {
    if (patterns.length != 2) {
        return callback(new Error("SPARQL algebra UNION with more than two components"));
    }

    const that = this;
    this.executeSelectUnits(projection, dataset, patterns[0], patterns[1], env, false, function (err, set1, set2) {
        if (err != null) {
            callback(err);
        } else {
            QueryFilters.checkFilters(
                patterns,
                QueryPlan.unionBindings(set1, set2),
                false,
                dataset,
                env,
                that,
                callback,
            );
        }
    });
};

// The blank nodes of a basic graph pattern match like variables (see normalizeTerm), but are scoped to it:
// they are dropped from its solutions, like the internal variables of property path sequences (fresh:).
const withoutInternalVariables = function (results) {
    return results.map(function (result) {
        const solution = {};
        for (const name in result) {
            if (name.indexOf("blank:") !== 0 && name.indexOf("fresh:") !== 0) {
                solution[name] = result[name];
            }
        }
        return solution;
    });
};

// the distinct values of a variable in the solutions, or undefined if it is not a variable or unbound in some
const boundValues = function (term, solutions) {
    const name =
        term.token === "var" ? term.value : term.token === "blank" && term.oid == null ? "blank:" + term.value : null;
    if (name == null) {
        return undefined;
    }
    const values = new Map();
    for (let i = 0; i < solutions.length; i++) {
        const value = solutions[i][name];
        if (value == null) {
            return undefined;
        }
        values.set(typeof value === "number" ? value : JSON.stringify(value), value);
    }
    return Array.from(values.values());
};

/**
 * A basic graph pattern split around property paths (see AbstractQueryTree.translatePathExpressionsInBGP): the
 * parts are joined in order, and a path starts (or ends) only at the values the solutions so far bind its
 * variable to, instead of at every node. Its blank nodes and internal variables join the parts, and are dropped
 * at the end.
 */
QueryEngine.prototype.executeBGPScope = function (projection, dataset, parts, env, callback) {
    const that = this;
    let solutions = null;
    Utils.eachSeries(
        parts,
        function (part, k) {
            if (solutions != null && solutions.length === 0) {
                return k();
            }
            const join = function (err, results) {
                if (err == null) {
                    solutions = solutions == null ? results : QueryPlan.joinBindings(solutions, results);
                }
                k(err);
            };
            if (part.kind === "PATH") {
                const candidates =
                    solutions == null
                        ? {}
                        : { starts: boundValues(part.subject, solutions), ends: boundValues(part.object, solutions) };
                PropertyPaths.execute(that, dataset, part, env, candidates, join);
            } else {
                that.executeSelectUnit(projection, dataset, part, env, join);
            }
        },
        function (err) {
            if (err != null) {
                callback(err);
            } else {
                callback(null, withoutInternalVariables(solutions));
            }
        },
    );
};

QueryEngine.prototype.executeAndBGP = function (projection, dataset, pattern, env, callback) {
    const that = this;
    QueryPlan.executeAndBGPsDPSize(pattern.value, dataset, this, env, function (err, result) {
        if (err != null) {
            callback(err);
        } else if (result != null) {
            // a part of a BGP_SCOPE keeps them for the join with the other parts
            QueryFilters.checkFilters(
                pattern,
                pattern.scoped === true ? result : withoutInternalVariables(result),
                false,
                dataset,
                env,
                that,
                callback,
            );
        } else {
            callback(null, null);
        }
    });
};

// LeftJoin keeps a left solution if none of its merged solutions passes the OPTIONAL's filter
// (SPARQL 1.1 §18.5). checkFilters returns the failed merged solutions wrapped (__nullify__): each
// such left solution comes back once, with the right side's variables unbound.
const restoreFailedLeftSolutions = function (bindings, leftSolutions, set2) {
    const acum = [];
    const failed = [];
    // left solutions already represented in acum
    const kept = new Set();
    for (let i = 0; i < bindings.length; i++) {
        if (bindings[i]["__nullify__"] === true) {
            failed.push(bindings[i]["bindings"]);
        } else {
            acum.push(bindings[i]);
            kept.add(leftSolutions.get(bindings[i]) || bindings[i]);
        }
    }

    const rightVars = {};
    for (let i = 0; i < set2.length; i++) {
        for (const p in set2[i]) {
            rightVars[p] = true;
        }
    }
    for (let i = 0; i < failed.length; i++) {
        const merged = failed[i];
        // an unmatched left solution was not merged
        const left = leftSolutions.get(merged) || merged;
        if (kept.has(left)) {
            continue;
        }
        kept.add(left);
        const solution = {};
        for (const p in left) {
            solution[p] = left[p];
        }
        QueryPlan.augmentMissingBindings(solution, rightVars);
        acum.push(solution);
    }
    return acum;
};

QueryEngine.prototype.executeLEFT_JOIN = function (projection, dataset, patterns, env, callback) {
    const setQuery1 = patterns.lvalue;
    const setQuery2 = patterns.rvalue;
    const that = this;
    this.executeSelectUnits(projection, dataset, setQuery1, setQuery2, env, true, function (err, set1, set2) {
        if (err != null) {
            callback(err);
        } else {
            // merged solution -> the left solution it came from, only needed to undo a failed filter
            const leftSolutions = patterns.filter != null && patterns.filter.length > 0 ? new Map() : null;
            const result = QueryPlan.leftOuterJoinBindings(set1, set2, leftSolutions);
            if (leftSolutions == null) {
                callback(null, result);
            } else {
                QueryFilters.checkFilters(patterns, result, true, dataset, env, that, function (err, bindings) {
                    if (err != null) {
                        callback(err);
                    } else {
                        callback(null, restoreFailedLeftSolutions(bindings, leftSolutions, set2));
                    }
                });
            }
        }
    });
};

QueryEngine.prototype.executeJOIN = function (projection, dataset, patterns, env, callback) {
    const setQuery1 = patterns.lvalue;
    const setQuery2 = patterns.rvalue;
    const that = this;

    this.executeSelectUnits(projection, dataset, setQuery1, setQuery2, env, true, function (err, set1, set2) {
        if (err != null) {
            callback(err);
        } else if (set1.length === 0 || set2.length === 0) {
            callback(null, []);
        } else {
            QueryFilters.checkFilters(
                patterns,
                QueryPlan.joinBindings(set1, set2),
                false,
                dataset,
                env,
                that,
                callback,
            );
        }
    });
};

QueryEngine.prototype.rangeQuery = function (quad, queryEnv, callback) {
    const that = this;
    that.normalizeQuad(quad, queryEnv, false, function (key) {
        if (key != null) {
            that.backend.range(new QuadIndex.Pattern(key), function (quads) {
                if (quads == null || quads.length == 0) {
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

QueryEngine.prototype.executeUpdate = function (syntaxTree, callback) {
    const prologue = syntaxTree.prologue;
    const units = syntaxTree.units;
    const that = this;

    // environment for the operation -> base ns, declared ns, etc.
    const queryEnv = { blanks: {}, outCache: {} };
    const prologues = syntaxTree.prologues || [prologue];
    this.registerNsInEnvironment(prologues[0], queryEnv);

    // operations separated by ';' run one after the other; the first error stops the request
    let lastResult;
    let index = 0;
    Utils.eachSeries(
        units,
        function (unit, k) {
            let aqt;
            if (index > 0) {
                // the declarations before this operation
                that.registerNsInEnvironment(prologues[index], queryEnv);
            }
            index++;
            try {
                aqt = that.abstractQueryTree.parseExecutableUnit(unit);
            } catch (e) {
                return k(e);
            }
            that._executeUpdateUnit(aqt, queryEnv, function (err, result) {
                lastResult = result;
                k(err);
            });
        },
        function (err) {
            if (err != null) callback(err);
            else callback(null, lastResult);
        },
    );
};

QueryEngine.prototype._executeUpdateUnit = function (aqt, queryEnv, callback) {
    const that = this;
    if (aqt.kind === "insertdata") {
        Utils.eachSeries(
            aqt.quads,
            function (quad, k) {
                that._executeQuadInsert(quad, queryEnv, k);
            },
            function (err) {
                if (err != null) callback(err);
                else callback(null, true);
            },
        );
    } else if (aqt.kind === "deletedata") {
        Utils.eachSeries(
            aqt.quads,
            function (quad, k) {
                that._executeQuadDelete(quad, queryEnv, null, k);
            },
            function (err) {
                if (err != null) callback(err);
                else callback(null, true);
            },
        );
    } else if (aqt.kind === "modify") {
        this._executeModifyQuery(aqt, queryEnv, callback);
    } else if (aqt.kind === "create") {
        callback(null, true);
    } else if (aqt.kind === "load") {
        // without INTO GRAPH, LOAD adds to the default graph (SPARQL 1.1 Update 3.1.4)
        let graph = { uri: this.lexicon.defaultGraphUri };
        if (aqt.destinyGraph != null) {
            graph = { uri: Utils.lexicalFormBaseUri(aqt.destinyGraph, queryEnv) };
        }
        this.rdfLoader.load(Utils.lexicalFormBaseUri(aqt.sourceGraph, queryEnv), graph, function (err, result) {
            if (err) {
                callback(err);
            } else {
                that.batchLoad(result, callback);
            }
        });
    } else if (aqt.kind === "drop") {
        this._executeClearGraph(aqt.destinyGraph, queryEnv, callback);
    } else if (aqt.kind === "clear") {
        this._executeClearGraph(aqt.destinyGraph, queryEnv, callback);
    } else {
        callback(new Error("not supported execution unit: " + aqt.kind));
    }
};

// Stores parsed quads; calls back (err) or (null, number of new quads).
QueryEngine.prototype.batchLoad = function (quads, callback) {
    let counter = 0;
    const blanks = {};
    const that = this;

    // check every quad first, so that a broken one does not leave the batch half stored
    const components = ["subject", "predicate", "object", "graph"];
    for (let q = 0; q < quads.length; q++) {
        for (let c = 0; c < components.length; c++) {
            if (quads[q][components[c]] == null || typeof quads[q][components[c]] !== "object") {
                return callback(new Error("Cannot load a quad without a " + components[c]));
            }
        }
    }

    if (this.eventsOnBatchLoad) this.callbacksBackend.startGraphModification();

    // subject
    const registerComponent = function (quad, component, newQuad, k) {
        let maybeBlankOid;

        if (quad[component]["uri"] || quad[component].token === "uri") {
            const uriValue = quad[component].uri || quad[component].value;
            that.lexicon.registerUri(uriValue, function (oid) {
                const returnUriComponent = function () {
                    if (quad[component].uri != null) {
                        quad[component] = { token: "uri", value: quad[component].uri };
                        delete quad[component]["uri"];
                    }
                    newQuad[component] = oid;
                    k();
                };

                if (component === "graph") {
                    that.lexicon.registerGraph(oid, uriValue, function () {
                        returnUriComponent();
                    });
                } else {
                    returnUriComponent();
                }
            });
        } else if (quad[component]["literal"] || quad[component].token === "literal") {
            if (quad[component].literal != null) {
                quad[component] = that.lexicon.parseLiteral(quad[component].literal);
            }
            // the same key as for a literal in a query (lower-case language tag, hexBinary normalization)
            that.lexicon.registerLiteral(Utils.lexicalFormLiteral(quad[component], {}), function (oid) {
                newQuad[component] = oid;
                k();
            });
        } else {
            maybeBlankOid = blanks[quad[component].blank || quad[component].value];
            if (maybeBlankOid == null) {
                that.lexicon.registerBlank(function (maybeBlankOid) {
                    blanks[quad[component].blank || quad[component].value] = maybeBlankOid;

                    if (quad[component].token == null) {
                        quad[component].token = "blank";
                        quad[component].value = quad[component].blank;
                        delete quad[component]["blank"];
                    }
                    newQuad[component] = maybeBlankOid;
                    k();
                });
            } else {
                if (quad[component].token == null) {
                    quad[component].token = "blank";
                    quad[component].value = quad[component].blank;
                    delete quad[component]["blank"];
                }
                newQuad[component] = maybeBlankOid;
                k();
            }
        }
    };

    Utils.eachSeries(
        quads,
        function (quad, k) {
            const newQuad = {};
            Utils.eachSeries(
                components,
                function (component, kk) {
                    registerComponent(quad, component, newQuad, kk);
                },
                function () {
                    const originalQuad = quad;
                    quad = newQuad;
                    const key = new QuadIndex.NodeKey(quad);

                    that.backend.search(key, function (result) {
                        if (!result) {
                            that.backend.index(key, function (result) {
                                if (result) {
                                    if (that.eventsOnBatchLoad)
                                        that.callbacksBackend.nextGraphModification(Callbacks.added, [
                                            originalQuad,
                                            quad,
                                        ]);
                                    counter = counter + 1;
                                }
                                k();
                            });
                        } else {
                            k();
                        }
                    });
                },
            );
        },
        function () {
            if (that.lexicon.updateAfterWrite != null) that.lexicon.updateAfterWrite();

            const exitFn = function () {
                callback(null, counter);
            };

            if (that.eventsOnBatchLoad) {
                that.callbacksBackend.endGraphModification(exitFn);
            } else {
                exitFn();
            }
        },
    );
};

// Low level operations for update queries

QueryEngine.prototype._executeModifyQuery = function (aqt, queryEnv, callback) {
    const that = this;
    let querySuccess = true;
    let error = new Error("Error executing modify query");
    let solutions = null;
    let bindings = null;
    // blank nodes of deleted quads and of the insert template: released at the end unless a quad uses them
    const blanks = [];

    aqt.insert = aqt.insert == null ? [] : aqt.insert;
    aqt.delete = aqt.delete == null ? [] : aqt.delete;

    Utils.seq(
        function (k) {
            // select query

            const defaultGraph = [];
            let namedGraph = [];

            if (aqt.with != null) {
                defaultGraph.push(aqt.with);
            }

            if (aqt.using != null) {
                namedGraph = [];
                for (let i = 0; i < aqt.using.length; i++) {
                    const usingGraph = aqt.using[i];
                    if (usingGraph.kind === "named") {
                        namedGraph.push(usingGraph.uri);
                    } else {
                        defaultGraph.push(usingGraph.uri);
                    }
                }
            }

            aqt.dataset = {};
            aqt.projection = [{ token: "variable", kind: "*" }];

            that.executeSelect(aqt, queryEnv, defaultGraph, namedGraph, function (err, result) {
                if (err) {
                    error = err;
                    querySuccess = false;
                    return k();
                } else {
                    // keeps the OIDs in result: the data blank nodes of a solution are found by them
                    solutions = result;
                    that.copyDenormalizedBindings(result, queryEnv.outCache, function (result) {
                        bindings = result;
                        k();
                    });
                }
            });
        },
        function (k) {
            // delete query
            if (querySuccess) {
                that.instantiateTemplate(
                    aqt.delete,
                    solutions,
                    bindings,
                    aqt.with,
                    null,
                    queryEnv,
                    function (instances) {
                        Utils.eachSeries(
                            instances,
                            function (instance, kk) {
                                that._executeQuadDelete(instance.quad, instance.env, blanks, function () {
                                    kk();
                                });
                            },
                            function () {
                                k();
                            },
                        );
                    },
                );
            } else {
                k();
            }
        },
        function (k) {
            // insert query
            if (querySuccess) {
                that.instantiateTemplate(
                    aqt.insert,
                    solutions,
                    bindings,
                    aqt.with,
                    blanks,
                    queryEnv,
                    function (instances) {
                        Utils.eachSeries(
                            instances,
                            function (instance, kk) {
                                that._executeQuadInsert(instance.quad, instance.env, function () {
                                    kk();
                                });
                            },
                            function () {
                                k();
                            },
                        );
                    },
                );
            } else {
                k();
            }
        },
        function (k) {
            that._releaseBlanks(blanks, function () {
                k();
            });
        },
    )(function () {
        if (querySuccess) callback(null, true);
        else callback(error);
    });
};

/**
 * Builds the quads of an INSERT or DELETE template for every solution (SPARQL 1.1 Update 3.1.3) and calls back
 * with [{quad, env}]. A quad with an unbound variable is skipped. Each solution gets its own blank node map in
 * env: a data blank node it binds keeps its OID, and a blank node of the template or one from BNODE() becomes a
 * new blank node per solution, its OID added to newBlanks. Without newBlanks (DELETE) such a quad is skipped: a
 * DELETE template must not contain blank nodes, and a new blank node is in no quad.
 */
QueryEngine.prototype.instantiateTemplate = function (
    template,
    solutions,
    bindings,
    defaultGraph,
    newBlanks,
    queryEnv,
    callback,
) {
    const that = this;
    const components = ["subject", "predicate", "object", "graph"];
    const instances = [];
    let index = 0;
    Utils.eachSeries(
        bindings,
        function (binding, k) {
            const solution = solutions[index++];
            const env = {
                blanks: {},
                outCache: queryEnv.outCache,
                namespaces: queryEnv.namespaces,
                base: queryEnv.base,
            };
            for (const variable in solution) {
                if (
                    typeof solution[variable] === "number" &&
                    binding[variable] != null &&
                    binding[variable].token === "blank"
                ) {
                    env.blanks[binding[variable].value] = solution[variable];
                }
            }
            // template label or BNODE() label -> blank node of this solution, with the label the lexicon gives its OID
            const fresh = {};
            Utils.eachSeries(
                template,
                function (src, kk) {
                    const quad = {};
                    // [component, key in fresh]
                    const newTerms = [];
                    for (let c = 0; c < components.length; c++) {
                        const component = components[c];
                        const term = src[component];
                        if (component === "graph" && term == null) {
                            quad.graph = defaultGraph;
                        } else if (term.token === "var") {
                            const value = binding[term.value];
                            if (value == null) return kk();
                            if (value.token === "blank" && env.blanks[value.value] == null) {
                                if (newBlanks == null) return kk();
                                newTerms.push([component, "v" + value.value]);
                            }
                            quad[component] = value;
                        } else if (term.token === "blank") {
                            if (newBlanks == null) return kk();
                            newTerms.push([component, "t" + term.value]);
                            quad[component] = term;
                        } else {
                            quad[component] = term;
                        }
                    }
                    Utils.eachSeries(
                        newTerms,
                        function (newTerm, kkk) {
                            const component = newTerm[0],
                                key = newTerm[1];
                            if (fresh[key] != null) {
                                quad[component] = fresh[key];
                                return kkk();
                            }
                            that.lexicon.registerBlank(function (oid) {
                                fresh[key] = { token: "blank", value: "_:" + oid };
                                env.blanks[fresh[key].value] = oid;
                                newBlanks.push(oid);
                                quad[component] = fresh[key];
                                kkk();
                            });
                        },
                        function () {
                            instances.push({ quad: quad, env: env });
                            kk();
                        },
                    );
                },
                function () {
                    k();
                },
            );
        },
        function () {
            callback(instances);
        },
    );
};

QueryEngine.prototype._executeQuadInsert = function (quad, queryEnv, callback) {
    const that = this;
    let normalized;
    let error = false;
    let errorMessage = null;
    Utils.seq(
        function (k) {
            that.normalizeQuad(quad, queryEnv, true, function (result) {
                if (result != null) {
                    normalized = result;
                } else {
                    error = true;
                    errorMessage = "Error normalizing quad.";
                }
                k();
            });
        },
        function (k) {
            if (error === false) {
                const key = new QuadIndex.NodeKey(normalized);
                that.backend.search(key, function (found) {
                    if (found === true) {
                        k();
                    } else {
                        that.backend.index(key, function () {
                            that.callbacksBackend.nextGraphModification(Callbacks.added, [quad, normalized]);
                            k();
                        });
                    }
                });
            } else {
                k();
            }
        },
    )(function () {
        if (error) {
            callback(new Error(errorMessage));
        } else {
            callback(null, true);
        }
    });
};

// Deletes a quad if the store has it. The OIDs of its blank nodes are added to deletedBlanks, to be released
// later with _releaseBlanks (null: released right away).
QueryEngine.prototype._executeQuadDelete = function (quad, queryEnv, deletedBlanks, callback) {
    const that = this;
    let normalized;
    let error = false;
    let found = false;
    let errorMessage, key;
    Utils.seq(
        function (k) {
            that.normalizeQuad(quad, queryEnv, true, function (result) {
                if (result != null) {
                    normalized = result;
                } else {
                    error = true;
                    errorMessage = "Error normalizing quad.";
                }
                k();
            });
        },
        function (k) {
            if (error === false) {
                key = new QuadIndex.NodeKey(normalized);
                that.backend.search(key, function (result) {
                    found = result === true;
                    if (found) {
                        that.backend.delete(key, function () {
                            k();
                        });
                    } else {
                        k();
                    }
                });
            } else {
                k();
            }
        },
        function (k) {
            if (error === false) {
                // also for a missing quad: normalizeQuad registered its terms. Blank nodes are left to _releaseBlanks,
                // other quads may still use them
                that.lexicon.unregister(quad, key, function () {
                    if (found) that.callbacksBackend.nextGraphModification(Callbacks["deleted"], [quad, normalized]);
                    k();
                });
            } else {
                k();
            }
        },
        function (k) {
            const blanks = error === false ? that._blankOids(quad, normalized) : [];
            if (deletedBlanks != null) {
                Array.prototype.push.apply(deletedBlanks, blanks);
                k();
            } else {
                that._releaseBlanks(blanks, function () {
                    k();
                });
            }
        },
    )(function () {
        if (error) {
            callback(new Error(errorMessage));
        } else {
            callback(null, true);
        }
    });
};

// The OIDs of the blank nodes of a quad (subject or object; a predicate or graph name is never a blank node)
QueryEngine.prototype._blankOids = function (quad, normalized) {
    const oids = [];
    if (quad.subject.token === "blank") oids.push(normalized.subject);
    if (quad.object.token === "blank") oids.push(normalized.object);
    return oids;
};

// Removes the blank nodes with these OIDs from the lexicon if no quad uses them anymore.
QueryEngine.prototype._releaseBlanks = function (oids, callback) {
    const that = this;
    Utils.eachSeries(
        Array.from(new Set(oids)),
        function (oid, k) {
            that.backend.range(
                new QuadIndex.Pattern({ subject: oid, predicate: "p", object: "o", graph: "g" }),
                function (asSubject) {
                    if (asSubject != null && asSubject.length > 0) return k();
                    that.backend.range(
                        new QuadIndex.Pattern({ subject: "s", predicate: "p", object: oid, graph: "g" }),
                        function (asObject) {
                            if (asObject != null && asObject.length > 0) return k();
                            that.lexicon.unregisterBlank(oid, function () {
                                k();
                            });
                        },
                    );
                },
            );
        },
        function () {
            callback();
        },
    );
};

// Runs an update inside the update that is already in progress: unlike execute(), it neither starts
// nor ends a graph modification, so its changes are announced together with the surrounding update.
QueryEngine.prototype._executeNestedUpdate = function (queryString, callback) {
    let syntaxTree;
    try {
        syntaxTree = this.abstractQueryTree.parseQueryString(queryString);
    } catch (e) {
        return callback(Utils.toError(e));
    }
    this.executeUpdate(syntaxTree, callback);
};

QueryEngine.prototype._executeClearGraph = function (destinyGraph, queryEnv, callback) {
    const that = this;
    const finish = function (err) {
        if (err) callback(err);
        else callback(null, true);
    };
    if (destinyGraph === "default") {
        this._executeNestedUpdate("DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }", finish);
    } else if (destinyGraph === "named") {
        that.lexicon.registeredGraphs(true, function (graphs) {
            if (graphs != null) {
                let foundErrorDeleting = null;
                Utils.eachSeries(
                    graphs,
                    function (graph, k) {
                        if (foundErrorDeleting == null) {
                            that._executeNestedUpdate(
                                "DELETE { GRAPH <" +
                                    graph +
                                    "> { ?s ?p ?o } } WHERE { GRAPH <" +
                                    graph +
                                    "> { ?s ?p ?o } }",
                                function (err) {
                                    if (!err) {
                                        that.lexicon.resolveUri(graph, function (oid) {
                                            if (oid != -1) {
                                                that.lexicon.knownGraphs.delete(oid, function () {
                                                    k();
                                                });
                                            } else {
                                                foundErrorDeleting = new Error(
                                                    "Cannot find graph " + graph + " to clear it",
                                                );
                                                k();
                                            }
                                        });
                                    } else {
                                        foundErrorDeleting = err;
                                        k();
                                    }
                                },
                            );
                        } else {
                            k();
                        }
                    },
                    function () {
                        finish(foundErrorDeleting);
                    },
                );
            } else {
                finish(new Error("Error deleting named graphs"));
            }
        });
    } else if (destinyGraph === "all") {
        this._executeClearGraph("default", queryEnv, function (err) {
            if (!err) {
                that._executeClearGraph("named", queryEnv, finish);
            } else {
                finish(err);
            }
        });
    } else {
        // destinyGraph is an URI
        if (destinyGraph.token == "uri") {
            const graphUri = Utils.lexicalFormBaseUri(destinyGraph, queryEnv);
            if (graphUri != null) {
                this._executeNestedUpdate(
                    "DELETE { GRAPH <" + graphUri + "> { ?s ?p ?o } } WHERE { GRAPH <" + graphUri + "> { ?s ?p ?o } }",
                    finish,
                );
            } else {
                finish(new Error("wrong graph URI"));
            }
        } else {
            finish(new Error("wrong graph URI"));
        }
    }
};

QueryEngine.prototype.checkGroupSemantics = function (groupVars, projectionVars) {
    if (projectionVars[0].kind === "*") {
        return false;
    }
    // aggregates without GROUP BY ('singleGroup') have no group variables: nothing may be projected without being aggregated
    const projection = {};
    const names = QueryEngine.groupVariables(groupVars);
    for (let i = 0; i < names.length; i++) {
        projection[names[i]] = true;
    }

    for (let i = 0; i < projectionVars.length; i++) {
        const projectionVar = projectionVars[i];
        if (projectionVar.kind === "var") {
            if (projection[projectionVar.value.value] == null) {
                return false;
            }
        } else if (
            projectionVar.kind === "aliased" &&
            projectionVar.expression &&
            projectionVar.expression.primaryexpression === "var"
        ) {
            if (projection[projectionVar.expression.value.value] == null) {
                return false;
            }
        }
    }

    return true;
};

QueryEngine.prototype.runBinds = function (binds, bindings, dataset, env, callback) {
    const that = this;
    const originalBindings = bindings;
    if (binds != null && binds.length > 0) {
        that.copyDenormalizedBindings(bindings, env.outCache, function (denormBindings) {
            // IRIs and literals to replace by their OID
            const terms = [];
            for (let i = 0; i < bindings.length; i++) {
                for (let j = 0; j < binds.length; j++) {
                    const bind = binds[j];
                    const thisDenormBindings = denormBindings[i];
                    const ebv = QueryFilters.runFilter(bind.expression, thisDenormBindings, that, dataset, env);
                    // SPARQL 1.1 Extend: if the expression raises an error, the variable stays unbound;
                    // otherwise the following BINDs see it
                    if (!QueryFilters.isEbvError(ebv)) {
                        // null for an unbound variable (BIND(?unbound AS ?y))
                        const term = QueryFilters.resultTerm(ebv);
                        originalBindings[i][bind.as.value] = term;
                        thisDenormBindings[bind.as.value] = term;
                        if (term != null && term.token === "blank") {
                            // a blank node of the store can only come from a variable of the solution: it takes
                            // that OID (a new one from BNODE() has none)
                            for (const v in originalBindings[i]) {
                                const bound = thisDenormBindings[v];
                                if (
                                    typeof originalBindings[i][v] === "number" &&
                                    bound != null &&
                                    bound.token === "blank" &&
                                    bound.value === term.value
                                ) {
                                    originalBindings[i][bind.as.value] = originalBindings[i][v];
                                    break;
                                }
                            }
                        } else if (term != null && (term.token === "uri" || term.token === "literal")) {
                            terms.push({ solution: originalBindings[i], variable: bind.as.value, term: term });
                        }
                    }
                }
            }
            // An IRI, literal or blank node of the store gets its OID, like a term matched by a triple pattern, so such a
            // term object in a solution is never in the lexicon: joins (areCompatibleBindings), GROUP BY and
            // DISTINCT can then compare OIDs and term objects as they are.
            // lexical form -> OID or -1, for values that repeat (e.g. a constant)
            const oids = new Map();
            Utils.eachSeries(
                terms,
                function (entry, k) {
                    const key =
                        entry.term.token === "uri"
                            ? "u" + entry.term.value
                            : "l" + Utils.lexicalFormLiteral(entry.term, env);
                    const replace = function (oid) {
                        if (oid != null && oid !== -1) {
                            entry.solution[entry.variable] = oid;
                        }
                        k();
                    };
                    if (oids.has(key)) {
                        replace(oids.get(key));
                    } else {
                        that.normalizeTerm(entry.term, env, false, function (oid) {
                            oids.set(key, oid);
                            replace(oid);
                        });
                    }
                },
                function () {
                    callback(null, bindings);
                },
            );
        });
    } else {
        callback(null, bindings);
    }
};

QueryEngine.prototype.computeCosts = function (quads, env, callback) {
    for (let i = 0; i < quads.length; i++) {
        quads[i]["_cost"] = this.quadCost(quads[i], env);
    }

    callback(quads);
};

QueryEngine.prototype.quadCost = function (quad, env) {
    return 1;
};

QueryEngine.prototype.registerDefaultNamespace = function (ns, prefix) {
    this.defaultPrefixes[ns] = prefix;
};

module.exports = {
    QueryEngine: QueryEngine,
};
