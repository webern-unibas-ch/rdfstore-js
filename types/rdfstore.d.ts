// TypeScript declarations for rdfstore-js.
// Hand-written: keep them in sync with src/store.js, src/store_promises.js and src/rdf_model.js.
// `yarn types` checks them against types/test.mts and types/test.cts.

/** Node-style callback: called once, with an Error or with `null` and the result. */
export type Callback<T> = (err: Error | null, result: T) => void;

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface UriValue {
    token: 'uri';
    value: string;
}

export interface LiteralValue {
    token: 'literal';
    value: string;
    /** Datatype IRI, only set for typed literals. */
    type?: string;
    /** Language tag, only set for language-tagged literals. */
    lang?: string;
}

export interface BlankValue {
    token: 'blank';
    value: string;
}

export type BindingValue = UriValue | LiteralValue | BlankValue;

/** One SELECT solution: variable name (without `?`) to value, `null` when unbound. */
export type Bindings = Record<string, BindingValue | null>;

/** Result of a SELECT query. */
export type SelectResult = Bindings[];

/**
 * Result of `execute`: SELECT gives `SelectResult`, CONSTRUCT a `Graph`,
 * ASK a `boolean`, `LOAD` the number of loaded triples, any other update `true`.
 * Pass the expected type as type argument, e.g. `execute<SelectResult>(query)`,
 * to skip narrowing.
 */
export type QueryResult = SelectResult | Graph | boolean | number;

// ---------------------------------------------------------------------------
// RDF Interfaces model (store.rdf)
// ---------------------------------------------------------------------------

export interface RDFNode {
    readonly interfaceName: 'NamedNode' | 'Literal' | 'BlankNode';
    readonly nominalValue: string;
    /** Compares interfaceName and nominalValue; a plain value is compared with `valueOf()`. */
    equals(other: RDFNode | string): boolean;
    toString(): string;
    toNT(): string;
}

export interface NamedNode extends RDFNode {
    readonly interfaceName: 'NamedNode';
    valueOf(): string;
}

export interface BlankNode extends RDFNode {
    readonly interfaceName: 'BlankNode';
    readonly bnodeId: string | number;
    valueOf(): string;
}

export interface Literal extends RDFNode {
    readonly interfaceName: 'Literal';
    readonly language?: string;
    readonly datatype?: string;
    /** The literal as a native value: number, boolean, Date or string, by datatype. */
    valueOf(): any;
}

export type Term = NamedNode | BlankNode | Literal;

export interface Triple {
    subject: NamedNode | BlankNode;
    predicate: NamedNode;
    object: Term;
    equals(other: Triple): boolean;
    /** The triple in N-Triples syntax. */
    toString(): string;
}

export type TripleAction = (triple: Triple) => Triple;

export interface Graph {
    /** Number of triples. */
    readonly length: number;
    readonly triples: Triple[];
    add(triple: Triple): this;
    addAll(graph: Graph): this;
    addAction(action: TripleAction, run?: boolean): this;
    remove(triple: Triple): this;
    removeMatches(subject?: RDFNode | string | null, predicate?: RDFNode | string | null, object?: RDFNode | string | null): this;
    toArray(): Triple[];
    some(test: (triple: Triple, graph: Graph) => boolean): boolean;
    every(test: (triple: Triple, graph: Graph) => boolean): boolean;
    filter(test: (triple: Triple, graph: Graph) => boolean): Graph;
    forEach(fn: (triple: Triple, graph: Graph) => void): void;
    match(subject?: RDFNode | string | null, predicate?: RDFNode | string | null, object?: RDFNode | string | null, limit?: number): Graph;
    merge(graph: Graph): Graph;
    /** The graph in N-Triples syntax. */
    toNT(): string;
}

export interface RDFEnvironment {
    createNamedNode(value: string): NamedNode;
    createBlankNode(): BlankNode;
    createLiteral(value: string, language?: string | null, datatype?: string | NamedNode | null): Literal;
    createTriple(subject: NamedNode | BlankNode, predicate: NamedNode, object: Term): Triple;
    createGraph(triples?: Triple[]): Graph;
    createAction(test: (triple: Triple) => boolean, action: TripleAction): TripleAction;
    /** Expands a CURIE (`foaf:name`) or term with the registered prefixes; `null` if it cannot. */
    resolve(curie: string): string | null;
    setPrefix(prefix: string, uri: string): void;
    setDefaultPrefix(uri: string): void;
    /** Predicates for `Graph.filter`, e.g. `rdf.filters.p(node)`. */
    filters: { [name: string]: (...nodes: RDFNode[]) => (triple: Triple) => boolean };
    prefixes: any;
    terms: any;
    /** The model constructors (NamedNode, Literal, Graph, ...). */
    api: any;
    [key: string]: any;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface StoreOptions {
    /** Order of the B-tree indices. Default 15. */
    treeOrder?: number;
    /** Use the IndexedDB backend (browser only). */
    persistent?: boolean;
    /** Name of the persistent store. */
    name?: string;
    /** Clear the persistent storage when the store is created. */
    overwrite?: boolean;
    [key: string]: any;
}

export interface LoadOptions {
    /** Graph to load into; the default graph if missing. */
    graph?: string;
    /** Base IRI for relative IRIs in the data. */
    baseURI?: string;
    [key: string]: any;
}

/** A parser for `registerParser`. */
export interface Parser {
    parse(data: any, graph: any, options: any, callback: Callback<any[]>): void;
}

/** Graph modification event passed to `subscribe` listeners. */
export type GraphEvent = 'added' | 'deleted';

/** A custom function for `registerCustomFunction`; receives the query filters engine and the arguments. */
export type CustomFunction = (engine: any, args: any[]) => any;

export declare class Store {
    constructor(callback: Callback<Store>);
    constructor(options: StoreOptions, callback: Callback<Store>);

    static readonly VERSION: string;
    /** Sets how often long-running loops yield to the event loop (default 100). */
    static yieldFrequency(value: number): void;

    /** RDF Interfaces environment, shared by all stores. */
    rdf: RDFEnvironment;
    /** Promise versions of the asynchronous methods. */
    readonly promises: StorePromises;

    execute<R = QueryResult>(query: string, callback?: Callback<R>): void;
    execute<R = QueryResult>(query: string, defaultGraphs: string[], namedGraphs: string[], callback?: Callback<R>): void;
    executeWithEnvironment<R = QueryResult>(query: string, defaultGraphs: string[], namedGraphs: string[], callback?: Callback<R>): void;

    graph(callback: Callback<Graph>): void;
    graph(graphUri: string, callback: Callback<Graph>): void;
    node(nodeUri: string, callback: Callback<Graph>): void;
    node(nodeUri: string, graphUri: string, callback: Callback<Graph>): void;

    insert(triples: Graph, callback?: Callback<true>): void;
    insert(triples: Graph, graphUri: string, callback?: Callback<true>): void;
    delete(triples: Graph, callback?: Callback<true>): void;
    delete(triples: Graph, graphUri: string, callback?: Callback<true>): void;
    clear(callback?: Callback<true>): void;
    clear(graphUri: string, callback?: Callback<true>): void;

    /** Loads RDF data, or with mediaType `'remote'` the document at the URI in `data`; calls back with the number of triples. */
    load(mediaType: string, data: any, callback: Callback<number>): void;
    load(mediaType: string, data: any, graphOrOptions: string | LoadOptions, callback: Callback<number>): void;
    registerParser(mediaType: string, parser: Parser): void;
    registeredGraphs(callback: Callback<NamedNode[]>): void;

    startObservingNode(nodeUri: string, listener: (node: Graph) => void): void;
    startObservingNode(nodeUri: string, graphUri: string, listener: (node: Graph) => void): void;
    stopObservingNode(listener: (node: Graph) => void): void;
    startObservingQuery(query: string, listener: (bindings: SelectResult) => void, ready?: () => void): void;
    stopObservingQuery(query: string): void;
    subscribe(subject: string | null, predicate: string | null, object: string | null, graph: string | null,
              listener: (event: GraphEvent, triples: Triple[]) => void, ready?: (...args: any[]) => void): void;
    unsubscribe(listener: (event: GraphEvent, triples: Triple[]) => void): void;
    setBatchLoadEvents(fireEvents: boolean): void;

    setPrefix(prefix: string, uri: string): void;
    setDefaultPrefix(uri: string): void;
    registerDefaultNamespace(prefix: string, uri: string): void;
    registerDefaultProfileNamespaces(): void;
    registerCustomFunction(name: string, fn: CustomFunction): void;

    getNetworkTransport(): any;
    setNetworkTransport(transport: any): void;
    close(callback?: () => void): void;
}

/** Promise versions of the asynchronous Store methods (`store.promises`). */
export interface StorePromises {
    execute<R = QueryResult>(query: string, defaultGraphs?: string[], namedGraphs?: string[]): Promise<R>;
    executeWithEnvironment<R = QueryResult>(query: string, defaultGraphs: string[], namedGraphs: string[]): Promise<R>;
    load(mediaType: string, data: any, graphOrOptions?: string | LoadOptions): Promise<number>;
    insert(triples: Graph, graphUri?: string): Promise<true>;
    delete(triples: Graph, graphUri?: string): Promise<true>;
    clear(graphUri?: string): Promise<true>;
    graph(graphUri?: string): Promise<Graph>;
    node(nodeUri: string, graphUri?: string): Promise<Graph>;
    registeredGraphs(): Promise<NamedNode[]>;
    close(): Promise<void>;
}

export declare function create(callback: Callback<Store>): Store;
export declare function create(options: StoreOptions, callback: Callback<Store>): Store;

/** Not supported in the 0.9.x series: always calls back with an error. */
export declare function connect(...args: any[]): void;

export declare const promises: {
    /** Creates a store; resolves when it is ready. */
    create(options?: StoreOptions): Promise<Store>;
};
