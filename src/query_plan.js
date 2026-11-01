"use strict";

var _ = require('./utils');
var async = require('./utils');

/**
 * A new query plan object
 * @param left
 * @param right
 * @param cost
 * @param identifier
 * @param allVars
 * @param joinVars
 * @constructor
 */
var QueryPlan = function(left, right, cost, identifier, allVars, joinVars) {

    this.left =  left;
    this.right = right;
    this.cost = cost;
    this.i = identifier;
    this.vars = allVars;
    this.join = joinVars;

};

/**
 * Functions to build and execute query plans for a particular query
 * using a dynamic programming join algorithm.
 */
var QueryPlanDPSize = {};

/**
 * Finds variable in a BGP. Variables can be actual variables or blank nodes.
 * The variables are returned as an array and assigned as a property of the BGP object.
 * @param bgp
 * @returns Array with the found variables.
 */
QueryPlanDPSize.variablesInBGP = function(bgp) {
    // may be cached in the pattern
    var variables = bgp.variables;
    if(variables) {
        return variables;
    }

    var components =  bgp.value || bgp;
    variables  = [];
    for(var comp in components) {
        if(components[comp] && components[comp].token === "var") {
            variables.push(components[comp].value);
        } else if(components[comp] && components[comp].token === "blank" && components[comp].oid == null) {
            // a blank node with an OID is a bound blank node of the store (EXISTS), so a constant
            variables.push("blank:"+components[comp].value);
        }
    }
    bgp.variables = variables;

    return variables;
};

/**
 * Checks if two plans are connected due to at least on common variable.
 * @param leftPlan
 * @param rightPlan
 * @returns {boolean}
 */
QueryPlanDPSize.connected = function(leftPlan, rightPlan) {
    var varsLeft ="/"+leftPlan.vars.join("/")+"/";
    for(var i=0; i<rightPlan.vars.length; i++) {
        if(varsLeft.indexOf("/"+rightPlan.vars[i]+"/") != -1) {
            return true;
        }
    }

    return false;
};

var intersection = function(arr1,arr2) {
    var acc = {};
    for(var i=0; i<arr1.lenght; i++) {
        acc[arr1[i]] = 1;
    }
    for(i=0; i<arr2.length; i++) {
        var val = acc[arr2[i]] || 0;
        val++;
        acc[arr2[i]] = val;
    }
    var intersect = [];
    for(var p in acc) {
        if(acc[p] == 2)
        intersect.push(acc[p]);
    }

    return intersect;
};

/**
 * Computes the intersection for the bariables of two BGPs
 * @param bgpa
 * @param bgpb
 * @returns {*}
 */
QueryPlanDPSize.variablesIntersectionBGP = function(bgpa, bgpb) {
    return intersection(
        QueryPlanDPSize.variablesInBGP(bgpa),
        QueryPlanDPSize.variablesInBGP(bgpb)
    );
};

/**
 * All BGPs sharing variables are grouped together.
 */
QueryPlanDPSize.executeAndBGPsGroups = function(bgps) {
    var groups = {};
    var groupVars = {};
    var groupId = 0;


    // Returns true if the any of the passed vars are in the vars
    // associated to the group.
    var detectVarsInGroup = function(vars, groupVars) {

        for(var j=0; j<vars.length; j++) {
            var thisVar = "/"+vars[j]+"/";
            if(groupVars.indexOf(thisVar) != -1) {
                return true;
            }
        }

        return false;
    };

    // Creates a new group merging the vars and the groups
    var mergeGroups = function(bgp, toJoin, newGroups, newGroupVars) {
        var acumGroups = [];
        var acumId = "";
        var acumVars = "";
        for(var gid in toJoin) {
            acumId = acumId+gid; // new group id
            acumGroups = acumGroups.concat(groups[gid]);
            acumVars = acumVars + groupVars[gid]; // @todo bug here? we were not adding...
        }

        acumVars = acumVars + vars.join("/") + "/";
        acumGroups.push(bgp);

        newGroups[acumId] = acumGroups;
        newGroupVars[acumId] = acumVars;
    };

    for(var i=0; i<bgps.length; i++) {
        var bgp = bgps[i];
        var newGroups = {};
        var newGroupVars = {};

        var vars = QueryPlanDPSize.variablesInBGP(bgp);
        var toJoin = {};

        for(var nextGroupId in groupVars) {
            if(detectVarsInGroup(vars, groupVars[nextGroupId])) {
                // we need to merge this group fo the next iteration
                toJoin[nextGroupId] = true;
            } else {
                // this group does not need merge for the next iteration
                newGroups[nextGroupId] = groups[nextGroupId];
                newGroupVars[nextGroupId] = groupVars[nextGroupId];
            }
        }

        if(_.size(toJoin) === 0) {
            // we haven't found a single existing group sharing vars
            // with the BGP. We need to create a new group only for this BGP.
            newGroups['g'+groupId] = [bgp];
            newGroupVars['g'+groupId] = "/"+(vars.join("/"))+"/";
            groupId++;
        } else {
            // We merge all the groups sharing vars with the BGP.
            mergeGroups(bgp,toJoin, newGroups, newGroupVars);
        }

        groups = newGroups;
        groupVars = newGroupVars;
    }

    return _.values(groups);
};

/**
 * Checks if there is an intersection between search plans.
 * @param leftPlan
 * @param rightPlan
 * @returns 0 or 1 if there's an intersection
 */
QueryPlanDPSize.intersectionSize = function(leftPlan, rightPlan) {
    var idsRight = rightPlan.i.split("_");
    for(var i=0; i<idsRight.length; i++) {
        if(idsRight[i]=="")
            continue;
        if(leftPlan.i.indexOf('_'+idsRight[i]+'_') != -1) {
            return 1; // we just need to know if this value is >0
        }
    }
    return 0;
};

/**
 * Creates  a new join tree merging two query plans with shared variables.
 * @param left plan object
 * @param right plan object
 * @returns a new query plan object
 */
QueryPlanDPSize.createJoinTree = function(leftPlan, rightPlan) {
    var varsLeft ="/"+leftPlan.vars.join("/")+"/";
    var accumVars = leftPlan.vars.concat([]);

    var join = [];

    // Search for the join vars trying to find shared vars between
    // the left plan and the right plan.
    for(var i=0; i<rightPlan.vars.length; i++) {
        if(varsLeft.indexOf("/"+rightPlan.vars[i]+"/") != -1) {
            join.push(rightPlan.vars[i]);
        } else {
            accumVars.push(rightPlan.vars[i]);
        }
    }

    // Creates a new identifier for the join tree using the union
    // of both plans identifiers.
    var rightIds = rightPlan.i.split("_");
    var leftIds = leftPlan.i.split("_");
    var distinct = {};
    for(var i=0; i<rightIds.length; i++) {
        if(rightIds[i] != "") {
            distinct[rightIds[i]] = true;
        }
    }
    for(var i=0; i<leftIds.length; i++) {
        if(leftIds[i] != "") {
            distinct[leftIds[i]] = true;
        }
    }
    var ids = _.keys(distinct);

    // Returns the new join tree
    return {
        left: leftPlan,
        right: rightPlan,
        cost: leftPlan.cost+rightPlan.cost,
        i: "_"+(ids.sort().join("_"))+"_",
        vars: accumVars,
        join: join
    };
};

/**
 * Algorithm that chooses the best way to execute an execution plan in the query engine.
 * @param treeNode
 * @param dataset
 * @param queryEngine
 * @param env
 * @returns {*}
 */
QueryPlanDPSize.executeBushyTree = function(queryPlan, dataset, queryEngine, env, callback) {
    if(queryPlan.left == null ) {
        QueryPlanDPSize.executeEmptyJoinBGP(queryPlan.right, dataset, queryEngine, env, callback);
    } else if(queryPlan.right == null) {
        QueryPlanDPSize.executeEmptyJoinBGP(queryPlan.left, dataset, queryEngine, env, callback);
    } else {
        QueryPlanDPSize.executeBushyTree(queryPlan.left, dataset, queryEngine, env, function(resultsLeft){

            if(resultsLeft!=null) {
                QueryPlanDPSize.executeBushyTree(queryPlan.right, dataset, queryEngine, env, function(resultsRight){
                    if(resultsRight!=null) {
                        callback(QueryPlanDPSize.joinBindings2(queryPlan.join, resultsLeft, resultsRight));
                    } else {
                        callback(null);
                    }
                });
            } else {
                callback(null);
            }
        });
    }
};

QueryPlanDPSize.executeAndBGPsDPSize = function(allBgps, dataset, queryEngine, env, callback) {

    var groups = QueryPlanDPSize.executeAndBGPsGroups(allBgps);
    var groupResults = [];

    async.eachSeries(groups,function(bgps,k) {
        // @todo
        // this lambda function should be moved to its named function

        // Build bushy tree for this group
        var costFactor = 1;
        queryEngine.computeCosts(bgps,env,function(bgps) {
            var bestPlans = {};
            var plans = {};
            var sizes = {};

            var maxSize = 1;
            var maxPlan = null;

            var cache = {};

            sizes['1'] = [];

            // Building plans of size 1
            for(var i=0; i<bgps.length; i++) {
                var vars = [];

                delete bgps[i]['variables'];
                for(var comp in bgps[i]) {
                    if(comp != '_cost') {
                        if(bgps[i][comp].token === 'var') {
                            vars.push(bgps[i][comp].value);
                        } else if(bgps[i][comp].token === 'blank' && bgps[i][comp].oid == null) {
                            // named like the bindings (buildBindingsFromRange), so blank nodes join
                            vars.push("blank:"+bgps[i][comp].value);
                        }
                    }
                }

                plans["_"+i+"_"] = {left: bgps[i], right:null, cost:bgps[i]._cost, i:('_'+i+'_'), vars:vars};
                var plan = {left: bgps[i], right:null, cost:bgps[i]._cost, i:('_'+i+'_'), vars:vars};
                bestPlans["_"+i+"_"] = plan;
                delete bgps[i]['_cost'];
                cache["_"+i+"_"] = true;
                sizes['1'].push("_"+i+"_");
                if(maxPlan == null || maxPlan.cost>plan.cost) {
                    maxPlan = plan;
                }
            }

            // dynamic programming -> build plans of increasing size
            for(var s=2; s<=bgps.length; s++) { // size
                for(var sl=1; sl<s; sl++) { // size left plan
                    var sr = s - sl; // size right plan
                    var leftPlans = sizes[''+sl] || [];
                    var rightPlans = sizes[''+sr] || [];
                    for(var i=0; i<leftPlans.length; i++) {
                        for(var j=0; j<rightPlans.length; j++) {
                            if(leftPlans[i]===rightPlans[j])
                                continue;
                            var leftPlan = plans[leftPlans[i]];
                            var rightPlan = plans[rightPlans[j]];

                            // condition (1)
                            if(QueryPlanDPSize.intersectionSize(leftPlan, rightPlan) == 0) {
                                // condition (2)

                                if(QueryPlanDPSize.connected(leftPlan,rightPlan)) {
                                    maxSize = s;
                                    var p1 = bestPlans[leftPlan.i];  //QueryPlanAsync.bestPlan(leftPlan, bestPlans);
                                    var p2 = bestPlans[rightPlan.i]; //QueryPlanAsync.bestPlan(rightPlan, bestPlans);

                                    var currPlan = QueryPlanDPSize.createJoinTree(p1,p2);
                                    if(!cache[currPlan.i]) {
                                        cache[currPlan.i] = true;

                                        var costUnion = currPlan.cost+1;
                                        if(bestPlans[currPlan.i] != null) {
                                            costUnion = bestPlans[currPlan.i].cost;
                                        }

                                        var acum = sizes[s] || [];
                                        acum.push(currPlan.i);
                                        plans[currPlan.i] = currPlan;
                                        sizes[s] = acum;

                                        if(costUnion > currPlan.cost) {
                                            if(maxSize === s) {
                                                maxPlan = currPlan;
                                            }
                                            bestPlans[currPlan.i] = currPlan;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            groupResults.push(maxPlan);
            k();
        });
    },function() {
        // now execute the Bushy trees and perform
        // cross products between groups
        var acum = null;
        async.eachSeries(groupResults, function(tree,k) {


            QueryPlanDPSize.executeBushyTree(tree, dataset, queryEngine, env, function(result) {
                if(result) {
                    if(acum == null) {
                        acum = result;
                        k();
                    } else {
                        acum = QueryPlanDPSize.crossProductBindings(acum, result);
                        k();
                    }
                } else {
                    k(new Error("Error executing bushy tree"));
                }

            });
        },function(err){
            if(err) {
                callback(err);
            } else {
                callback(null, acum);
            }
        });
    });
};

QueryPlanDPSize.executeEmptyJoinBGP = function(bgp, dataset, queryEngine, queryEnv, callback) {
    return QueryPlanDPSize.executeBGPDatasets(bgp, dataset, queryEngine, queryEnv, callback);
};


QueryPlanDPSize.executeBGPDatasets = function(bgp, dataset, queryEngine, queryEnv, callback) {
    // avoid duplicate queries in the same graph
    // merge of graphs is not guaranteed here.
    var duplicates = {};

    if(bgp.graph == null) {
        //union through all default graph(s)
        var acum = [];
        async.eachSeries(dataset.implicit,
            function(implicitGraph, k){
                if(duplicates[implicitGraph.oid] == null) {
                    duplicates[implicitGraph.oid] = true;
                    bgp.graph = implicitGraph;//.oid
                    queryEngine.rangeQuery(bgp, queryEnv, function(results){
                        results = QueryPlanDPSize.buildBindingsFromRange(results, bgp);
                        acum.push(results);
                        k();
                    });
                } else {
                    k();
                }
            }, function(){
                var acumBindings = QueryPlanDPSize.unionManyBindings(acum);
                callback(acumBindings);
            });
    } else if(bgp.graph.token === 'var') {
        // union through all named datasets
        var graphVar = bgp.graph.value;
        var acum = [];

        async.eachSeries(dataset.named,
            function(graph, k){
                if(duplicates[graph.oid] == null) {
                    duplicates[graph.oid] = true;
                    bgp.graph = graph;//.oid
                    if(acum != null) {
                        queryEngine.rangeQuery(bgp, queryEnv, function (results) {
                            if (results != null) {
                                results = QueryPlanDPSize.buildBindingsFromRange(results, bgp);
                                // add the graph bound variable to the result
                                for (var j = 0; j < results.length; j++) {
                                    results[j][graphVar] = graph.oid;
                                }
                                acum.push(results);
                            } else {
                                acum = null;
                            }
                            k();
                        });
                    } else {
                        k();
                    }
                } else {
		    k();
		}
            }, function(){
                if(acum == null) {
                    callback(null);
                } else {
                    var acumBindings = QueryPlanDPSize.unionManyBindings(acum);
                    callback(acumBindings);
                }
            });
    } else {
        // a graph IRI: match it, if the query names named graphs only one of them
        var match = function() {
            queryEngine.rangeQuery(bgp, queryEnv, function(results){
                if(results!=null) {
                    results = QueryPlanDPSize.buildBindingsFromRange(results, bgp);
                    callback(results);
                } else {
                    callback(null);
                }
            });
        };
        if(dataset.named == null || dataset.named.length === 0) {
            match();
        } else {
            queryEngine.isDatasetGraph(bgp.graph, dataset, queryEnv, function(inDataset){
                if(inDataset) {
                    match();
                } else {
                    callback([]);
                }
            });
        }
    }
};

QueryPlanDPSize.buildBindingsFromRange = function(results, bgp) {
    QueryPlanDPSize.variablesInBGP(bgp);

    var components =  bgp.value||bgp;
    var bindings = {};
    for(comp in components) {
        if(components[comp] && components[comp].token === "var") {
            bindings[comp] = components[comp].value;
        } else if(components[comp] && components[comp].token === "blank" && components[comp].oid == null) {
            bindings[comp] = "blank:"+components[comp].value;
        }
    }

    var resultsBindings =[];

    if(results!=null) {
        for(var i=0; i<results.length; i++) {
            var binding = {};
            var result  = results[i];
            var duplicated = false;
            for(var comp in bindings) {
                var value = result[comp];
                if(binding[bindings[comp]] == null || binding[bindings[comp]] === value) {
                    binding[bindings[comp]] = value;
                } else {
                    duplicated = true;
                    break;
                }
            }
            if(!duplicated)
                resultsBindings.push(binding);
        }
    }

    return resultsBindings;
};


// Two term objects (no OIDs) for the same RDF term
var sameTerm = function(a, b) {
    return typeof(a) === "object" && typeof(b) === "object" && a.token === b.token && a.value == b.value &&
        (a.type || null) === (b.type || null) && (a.lang || null) === (b.lang || null);
};

// Two solutions are compatible if every variable bound in both has the same value: the same OID, or the
// same RDF term for values that are no OIDs (e.g. BIND results). An unbound (null) variable matches anything.
QueryPlanDPSize.areCompatibleBindings = function(bindingsA, bindingsB) {
    for(var variable in bindingsA) {
        var a = bindingsA[variable];
        var b = bindingsB[variable];
        if(a != null && b != null && a !== b && !sameTerm(a, b)) {
            return false;
        }
    }

    return true;
};

//QueryPlanDPSize.areCompatibleBindingsStrict = function(bindingsA, bindingsB) {
//    var foundSome = false;
//    for(var variable in bindingsA) {
// 	if(bindingsB[variable]!=null && (bindingsB[variable] != bindingsA[variable])) {
// 	    return false;
// 	} else if(bindingsB[variable] == bindingsA[variable]){
// 	    foundSome = true;
// 	}
//    }
//
//    return foundSome;
//};



QueryPlanDPSize.mergeBindings = function(bindingsA, bindingsB) {
    var merged = {};
    for(var variable in bindingsA) {
        merged[variable] = bindingsA[variable];
    }

    // an unbound value on the right doesn't replace a bound one on the left
    for(var variable in bindingsB) {
        if(bindingsB[variable] != null || !(variable in merged)) {
            merged[variable] = bindingsB[variable];
        }
    }

    return merged;
};

QueryPlanDPSize.joinBindings2 = function(bindingVars, bindingsA, bindingsB) {
    var acum = {};
    var bindings, variable, variableValue, values, tmp;
    var joined = [];

    for(var i=0; i<bindingsA.length; i++) {
        bindings = bindingsA[i];
        tmp = acum;
        for(var j=0; j<bindingVars.length; j++) {
            variable = bindingVars[j];
            variableValue = bindings[variable];
            if(j == bindingVars.length-1) {
                values = tmp[variableValue] || [];
                values.push(bindings);
                tmp[variableValue] = values;
            } else {
                values = tmp[variableValue] || {};
                tmp[variableValue] = values;
                tmp = values;
            }
        }
    }

    for(var i=0; i<bindingsB.length; i++) {
        bindings = bindingsB[i];
        tmp = acum;
        for(var j=0; j<bindingVars.length; j++) {
            variable = bindingVars[j];
            variableValue = bindings[variable];

            if(tmp[variableValue] != null) {
                if(j == bindingVars.length-1) {
                    for(var k=0; k<tmp[variableValue].length; k++) {
                        joined.push(QueryPlanDPSize.mergeBindings(tmp[variableValue][k],bindings));
                    }
                } else {
                    tmp = tmp[variableValue];
                }
            }
        }
    }

    return joined;
};

// Key of a solution over the given variables, or null unless all of them are bound to OIDs.
var oidKey = function(vars, bindings) {
    var key = "";
    for(var i=0; i<vars.length; i++) {
        var value = bindings[vars[i]];
        if(typeof(value) !== "number") {
            return null;
        }
        key += value + "_";
    }
    return key;
};

// Same rows in the same order as a nested loop over areCompatibleBindings, but each left
// solution is only compared with the right solutions that can match it: those with the same
// OIDs on the shared variables, plus those with a shared variable unbound or bound to a
// non-OID value (e.g. a BIND result). A left solution without an OID key is compared with all.
// An optional leftSolutions Map receives each merged solution -> the left solution it came from.
QueryPlanDPSize.hashJoinBindings = function(bindingsA, bindingsB, leftOuter, leftSolutions) {
    var varsA = {};
    var varsB = {};
    var sharedVars = [];
    var i, p, key;
    for(i=0; i<bindingsA.length; i++) {
        for(p in bindingsA[i]) {
            varsA[p] = true;
        }
    }
    for(i=0; i<bindingsB.length; i++) {
        for(p in bindingsB[i]) {
            varsB[p] = true;
        }
    }
    for(p in varsB) {
        if(varsA[p] === true) {
            sharedVars.push(p);
        }
    }

    var buckets = {};
    var wildcards = [];
    for(i=0; i<bindingsB.length; i++) {
        key = oidKey(sharedVars, bindingsB[i]);
        if(key === null) {
            wildcards.push(i);
        } else {
            (buckets[key] = buckets[key] || []).push(i);
        }
    }

    var result = [];
    var bindingA, matched;
    var tryJoin = function(j) {
        if(QueryPlanDPSize.areCompatibleBindings(bindingA, bindingsB[j])) {
            matched = true;
            var merged = QueryPlanDPSize.mergeBindings(bindingA, bindingsB[j]);
            if(leftSolutions != null) {
                leftSolutions.set(merged, bindingA);
            }
            result.push(merged);
        }
    };
    for(i=0; i<bindingsA.length; i++) {
        bindingA = bindingsA[i];
        matched = false;
        key = oidKey(sharedVars, bindingA);
        if(key === null) {
            for(var j=0; j<bindingsB.length; j++) {
                tryJoin(j);
            }
        } else {
            // both index lists are ascending: merge them to keep the nested loop's order
            var bucket = buckets[key] || [];
            var b = 0, w = 0;
            while(b < bucket.length || w < wildcards.length) {
                if(w === wildcards.length || (b < bucket.length && bucket[b] < wildcards[w])) {
                    tryJoin(bucket[b++]);
                } else {
                    tryJoin(wildcards[w++]);
                }
            }
        }
        if(leftOuter && matched === false) {
            // the right side's variables must be present (as null) for further
            // processing, e.g. filtering by not present value (DAWG test bev-6)
            QueryPlanDPSize.augmentMissingBindings(bindingA, varsB);
            result.push(bindingA);
        }
    }
    return result;
};

QueryPlanDPSize.joinBindings = function(bindingsA, bindingsB) {
    return QueryPlanDPSize.hashJoinBindings(bindingsA, bindingsB, false);
};

QueryPlanDPSize.augmentMissingBindings = function(bindingA, bindingB) {
    for(var pb in bindingB) {
        if(bindingA[pb] == null) {
            bindingA[pb] = null;
        }
    }
    return bindingA;
};

/*
 QueryPlanDPSize.diff = function(bindingsA, biundingsb) {
 var result = [];

 for(var i=0; i< bindingsA.length; i++) {
 var bindingA = bindingsA[i];
 var matched = false;
 for(var j=0; j<bindingsB.length; j++) {
 var bindingB = bindingsB[j];
 if(QueryPlanDPSize.areCompatibleBindings(bindingA, bindingB)){
 matched = true;
 result.push(QueryPlanDPSize.mergeBindings(bindingA, bindingB));
 }
 }
 if(matched === false) {
 // missing bindings must be present for further processing
 // e.g. filtering by not present value (see DAWG tests
 // bev-6)
 QueryPlanDPSize.augmentMissingBindings(bindingA, bindingB);
 result.push(bindingA);
 }
 }

 return result;
 };
 */

QueryPlanDPSize.leftOuterJoinBindings = function(bindingsA, bindingsB, leftSolutions) {
    return QueryPlanDPSize.hashJoinBindings(bindingsA, bindingsB, true, leftSolutions);
};

QueryPlanDPSize.crossProductBindings = function(bindingsA, bindingsB) {
    var result = [];

    for(var i=0; i< bindingsA.length; i++) {
        var bindingA = bindingsA[i];
        for(var j=0; j<bindingsB.length; j++) {
            var bindingB = bindingsB[j];
            result.push(QueryPlanDPSize.mergeBindings(bindingA, bindingB));
        }
    }

    return result;
};

QueryPlanDPSize.unionBindings = function(bindingsA, bindingsB) {
    return bindingsA.concat(bindingsB);
};

QueryPlanDPSize.unionManyBindings = function(bindingLists) {
    var acum = [];
    for(var i=0; i<bindingLists.length; i++) {
        var bindings = bindingLists[i];
        acum = QueryPlanDPSize.unionBindings(acum, bindings);
    }

    return acum;
};


module.exports = {
    QueryPlan: QueryPlanDPSize
};
