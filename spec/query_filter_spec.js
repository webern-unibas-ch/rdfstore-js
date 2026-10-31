var QueryFilters = require('../src/query_filters').QueryFilters;

describe('QueryFilters', function() {
    it('should run the equality function', function(done) {
        var op1 = createLiteral('123');
        var op2 = createLiteral('1234');
        var result = QueryFilters.runEqualityFunction(op1, op2, { }, null, null, null);
        expect(result.value).toEqual(false);
        done();
    });

    it('should run the lt function', function(done) {
        var op1 = createLiteral('1');
        var op2 = createLiteral('2');
        var result = QueryFilters.runLtFunction(op1, op2, {});
        expect(result.value).toEqual(true);
        done();
    });

    it('should run a relational filter (runRelationalFilter)', function(done) {
        var op1 = createLiteral('1');
        var op2 = createLiteral('2');
        var result = QueryFilters.runRelationalFilter({ operator: '>'}, op1, op2, {}, null, null, null);
        expect(result.value).toEqual(false);
        done();
    });

    it('should run a relational filter (runFilter)', function(done) {
        var op1 = createLiteralExpression('1');
        var op2 = createLiteralExpression('2');
        var expr = { expressionType: 'relationalexpression', op1: op1, operator: '>', op2: op2 };
        var result = QueryFilters.runFilter(expr, {}, null, null, null);
        expect(result.value).toEqual(false);
        done();
    });

    it('should run the or function', function(done) {
        var expr = {
            expressionType: 'conditionalor',
            operands: [
                createLiteralExpression(false),
                createLiteralExpression(true),
            ]
        };
        var result = QueryFilters.runFilter(expr, {}, null, null, null);
        expect(result.value).toEqual(true);
        done();
    });

    it('should run the and function', function(done) {
        var expr = {
            expressionType: 'conditionaland',
            operands: [
                createLiteralExpression(true),
                createLiteralExpression(false),
            ]
        };
        var result = QueryFilters.runFilter(expr, {}, null, null, null);
        expect(result.value).toEqual(false);
        done();
    });

    it('should run addition', function(done) {
        var expr = {
            expressionType: 'additiveexpression',
            summand: createIntegerExpression(1),
            summands: [ { operator: '+', expression: createIntegerExpression(4) } ]
        };
        var result = QueryFilters.runFilter(expr, {}, null, null, null);
        expect(result.value).toEqual(5);
        done();;
    });

    it('should run multiplication', function(done) {
        var expr = {
            expressionType: 'multiplicativeexpression',
            factor: createIntegerExpression(2),
            factors: [ { operator: '*', expression: createIntegerExpression(3) } ]
        };
        var result = QueryFilters.runFilter(expr, {}, null, null, null);
        expect(result.value).toEqual(6);
        done();

    });

    it('should report a type error in arithmetic as an error', function() {
        var string = createLiteralExpression('a', null);
        var arithmetic = function(type, first, operator, second) {
            var expr = {expressionType: type};
            if(type === 'additiveexpression') {
                expr.summand = first;
                expr.summands = [ { operator: operator, expression: second } ];
            } else {
                expr.factor = first;
                expr.factors = [ { operator: operator, expression: second } ];
            }
            return QueryFilters.runFilter(expr, {}, null, null, null);
        };

        expect(QueryFilters.isEbvError(arithmetic('additiveexpression', string, '+', createIntegerExpression(1)))).toBe(true);
        expect(QueryFilters.isEbvError(arithmetic('additiveexpression', createIntegerExpression(1), '-', string))).toBe(true);
        expect(QueryFilters.isEbvError(arithmetic('multiplicativeexpression', string, '*', createIntegerExpression(2)))).toBe(true);
        expect(QueryFilters.isEbvError(arithmetic('multiplicativeexpression', createIntegerExpression(2), '/', string))).toBe(true);
        // an error in a later operand
        expect(QueryFilters.isEbvError(arithmetic('multiplicativeexpression', createIntegerExpression(3), '*',
            {expressionType: 'multiplicativeexpression', factor: createIntegerExpression(2), factors: [ { operator: '/', expression: string } ]}))).toBe(true);
    });

    it('should report the negation of an error as an error', function() {
        var expr = {
            expressionType: 'unaryexpression',
            unaryexpression: '!',
            expression: {
                expressionType: 'additiveexpression',
                summand: createLiteralExpression('a', null),
                summands: [ { operator: '+', expression: createIntegerExpression(1) } ]
            }
        };
        expect(QueryFilters.isEbvError(QueryFilters.runFilter(expr, {}, null, null, null))).toBe(true);
    });

    it('should divide as op:numeric-divide', function() {
        var divide = function(a, b) {
            return QueryFilters.runFilter({
                expressionType: 'multiplicativeexpression',
                factor: a,
                factors: [ { operator: '/', expression: b } ]
            }, {}, null, null, null);
        };
        var xsd = 'http://www.w3.org/2001/XMLSchema#';

        // integer / integer is a decimal
        var half = divide(createIntegerExpression('1'), createIntegerExpression('2'));
        expect(half.type).toBe(xsd + 'decimal');
        expect(half.value).toBe(0.5);
        expect(divide(createIntegerExpression('4'), createIntegerExpression('2')).type).toBe(xsd + 'decimal');
        // division by zero: an error for integers and decimals, infinity for doubles
        expect(QueryFilters.isEbvError(divide(createIntegerExpression('1'), createIntegerExpression('0')))).toBe(true);
        expect(QueryFilters.isEbvError(divide(createLiteralExpression('1.0', xsd + 'decimal'), createIntegerExpression('0')))).toBe(true);
        expect(divide(createLiteralExpression('1', xsd + 'double'), createIntegerExpression('0')).value).toBe(Infinity);
    });

    it('should compare only comparable values', function() {
        var xsd = 'http://www.w3.org/2001/XMLSchema#';
        var one = createLiteral('1', xsd + 'integer');
        var english = {token: 'literal', value: 'x', lang: 'en'};
        var iri = {token: 'uri', value: 'http://example/iri'};
        var custom = createLiteral('z', 'http://example/c');
        var date = createLiteral('2020-01-01', xsd + 'date');
        var dateTime = createLiteral('2020-01-01T00:00:00Z', xsd + 'dateTime');
        var relational = function(operator, a, b) {
            return QueryFilters.runRelationalFilter({operator: operator}, a, b, {}, null, null, null);
        };

        // <, >, <= and >= on values that can't be compared are an error
        expect(QueryFilters.isEbvError(relational('>', english, one))).toBe(true);
        expect(QueryFilters.isEbvError(relational('<', iri, one))).toBe(true);
        expect(QueryFilters.isEbvError(relational('>=', custom, one))).toBe(true);
        expect(QueryFilters.isEbvError(relational('<=', date, dateTime))).toBe(true);
        // simple literals and xsd:string compare as strings
        expect(relational('<', createLiteral('a'), createLiteral('b', xsd + 'string')).value).toBe(true);
        // different known types are unequal, an unknown type can't be compared
        expect(relational('=', one, createLiteral('y')).value).toBe(false);
        expect(relational('!=', one, createLiteral('y')).value).toBe(true);
        expect(relational('=', createLiteral('true', xsd + 'boolean'), one).value).toBe(false);
        expect(QueryFilters.isEbvError(relational('=', custom, one))).toBe(true);
        expect(QueryFilters.isEbvError(relational('=', custom, createLiteral('z', 'http://example/d')))).toBe(true);
        expect(relational('=', custom, createLiteral('z', 'http://example/c')).value).toBe(true);
        // NaN equals nothing; an invalid lexical form is no known value and can't be compared; neither can an unbound value
        var nan = createLiteral('NaN', xsd + 'double');
        expect(relational('=', nan, nan).value).toBe(false);
        expect(relational('<', nan, one).value).toBe(false);
        expect(QueryFilters.isEbvError(relational('<', createLiteral('yes', xsd + 'boolean'), createLiteral('no', xsd + 'boolean')))).toBe(true);
        expect(QueryFilters.isEbvError(relational('<', createLiteral('abc', xsd + 'integer'), one))).toBe(true);
        expect(QueryFilters.isEbvError(relational('!=', undefined, one))).toBe(true);
        expect(QueryFilters.isEbvError(relational('=', createLiteral('yes', xsd + 'boolean'), createLiteral('no', xsd + 'boolean')))).toBe(true);
    });

    it('should run regex filters', function(done) {
        var text = {
            expressionType: 'atomic',
            primaryexpression: 'var',
            value: {
                token: 'var',
                value: 'variable'
            }
        };
        var pattern = {
            expressionType: 'atomic',
            value: {
                token: 'literal',
                value: '^12'
            }
        };
        var result = QueryFilters.runRegex(text, pattern, null, { 'variable': { token: 'literal', value: '123' } }, null, null, null);
        expect(result.value).toEqual(true);
        done();

    });

    it('should run another relational expression', function(done) {
        var expr = {
            token: 'expression',
            expressionType: 'relationalexpression',
            operator: '<',
            op1: {
                token: 'expression',
                expressionType: 'atomic',
                primaryexpression: 'var',
                value: { token: 'var', value: 'price' }
            },
            op2: {
                token: 'expression',
                expressionType: 'atomic',
                primaryexpression: 'numericliteral',
                value: { token: 'literal', lang: null, type: 'http://www.w3.org/2001/XMLSchema#integer', value: '20' }
            }
        };
        var result = QueryFilters.runFilter(expr, { price: { token: 'literal', type: 'http://www.w3.org/2001/XMLSchema#integer', value: '21' } }, null, null, null);
        expect(result.value).toEqual(false);
        done();


    });

    it("should run an IRI or ref function", function(done) {
        /** @todo */
        //expect("not implemented").toBe("implemented");
        done();
    });
});

function createIntegerExpression(value) {
    return createLiteralExpression(value, 'http://www.w3.org/2001/XMLSchema#' + 'integer');
}

function createLiteralExpression(value, type) {
    return {
        expressionType: 'atomic',
        value: createLiteral(value, type)
    };
}

function createLiteral(value, type) {
    return {
        token: 'literal',
        type: type,
        value: value
    };
}
