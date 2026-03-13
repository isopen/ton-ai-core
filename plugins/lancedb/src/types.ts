export interface VectorDBConfig {
    uri: string;
    vectorDimension?: number;
    defaultTableName?: string;
    region?: string;
    apiKey?: string;
    hostOverride?: string;
    storageOptions?: Record<string, any>;
    readConsistencyInterval?: number;
}

export interface VectorRecord {
    id?: number | string;
    vector?: number[];
    [key: string]: any;
}

export interface SearchOptions {
    limit?: number;
    filter?: string;
    columns?: string[];
    distanceType?: 'l2' | 'cosine' | 'dot' | 'hamming';
    nprobes?: number;
    refineFactor?: number;
    prefilter?: boolean;
    postfilter?: boolean;
    bypassVectorIndex?: boolean;
    fastSearch?: boolean;
    queryType?: 'vector' | 'fts' | 'hybrid';
    ftsColumns?: string[];
    vectorColumn?: string;
    text?: string;
    distanceRange?: [number, number];
    column?: string;
}

export interface SearchResult {
    id: string;
    score: number;
    _distance?: number;
    _relevance_score?: number;
    query_index?: number;
    [key: string]: any;
}

export interface TableInfo {
    name: string;
    rowCount: number;
    schema: any;
    vectorDimension?: number;
    version?: number;
    indices?: IndexInfo[];
}

export interface DatabaseStats {
    tables: TableInfo[];
    totalRows: number;
    uri: string;
}

export interface VersionInfo {
    version: number;
    timestamp: Date;
}

export interface IndexInfo {
    name: string;
    columns: string[];
    indexType: string;
    metric?: string;
}

export interface AddColumnsSql {
    name: string;
    valueSql: string;
}

export interface ColumnAlteration {
    path: string;
    rename?: string;
    nullable?: boolean;
    dataType?: any;
}

export interface MergeInsertBuilder {
    whenMatchedUpdateAll(): this;
    whenNotMatchedInsertAll(): this;
    whenNotMatchedBySourceDelete(): this;
    execute(source: any[]): Promise<void>;
}

export interface EmbeddingConfig {
    provider: 'openai' | 'sentence-transformers' | 'cohere' | 'huggingface' | 'clip' | 'ollama';
    model: string;
    device?: 'cpu' | 'cuda';
    apiKey?: string;
    dimensions?: number;
}

export interface EmbeddingModel {
    name: string;
    provider: string;
    dimensions: number;
}

export interface EmbeddingFunction {
    embed: (text: string) => Promise<number[]>;
    embedBatch?: (texts: string[]) => Promise<number[][]>;
}

export interface FTSConfig {
    language?: string;
    stem?: boolean;
    removeStopWords?: boolean;
    asciiFolding?: boolean;
    withPosition?: boolean;
    maxTokenLength?: number;
    ngramMinLength?: number;
    ngramMaxLength?: number;
    prefixOnly?: boolean;
    baseTokenizer?: string;
}

export interface MatchQueryOptions {
    fuzziness?: number;
    maxExpansions?: number;
    prefixLength?: number;
}

export interface PhraseQueryOptions {
    slop?: number;
}

export interface BoostQuery {
    positive: any;
    negative: any;
    negativeBoost?: number;
}

export interface MultiMatchQueryOptions {
    boosts?: number[];
    tieBreaker?: number;
    type?: 'best_fields' | 'most_fields' | 'cross_fields' | 'phrase' | 'phrase_prefix';
}

export interface Occur {
    MUST: 'must';
    SHOULD: 'should';
    MUST_NOT: 'must_not';
}

export interface BooleanQueryClause {
    occur: string;
    query: any;
}

export interface RerankerConfig {
    type: 'rrf' | 'cohere' | 'cross-encoder' | 'colbert';
    model?: string;
    apiKey?: string;
    normalize?: 'score' | 'rank';
}

export interface BinaryVectorOptions {
    dimension?: number;
    packBits?: boolean;
}

export interface BatchSearchOptions extends SearchOptions {
    queryVectors: number[][];
}
