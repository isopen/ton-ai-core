import { PluginContext } from '@ton-ai/core';
import { VectorDBComponents } from './components';
import * as lancedb from '@lancedb/lancedb';
import * as arrow from 'apache-arrow';
import {
    VectorDBConfig,
    VectorRecord,
    SearchResult,
    DatabaseStats,
    VersionInfo,
    IndexInfo,
    SearchOptions,
    AddColumnsSql,
    ColumnAlteration,
    EmbeddingConfig,
    EmbeddingModel,
    FTSConfig,
    MatchQueryOptions,
    PhraseQueryOptions,
    BooleanQueryClause,
    RerankerConfig,
    BinaryVectorOptions,
    BatchSearchOptions,
    EmbeddingFunction
} from './types';
import { getRegistry, LanceSchema } from '@lancedb/lancedb/embedding';
import { Field, FixedSizeList, Int32, Schema, Uint8, Utf8, Float32 } from 'apache-arrow';

export class VectorDBSkills {
    private context: PluginContext;
    private components: VectorDBComponents;
    private config: VectorDBConfig;
    private ready: boolean = false;
    private embeddingFunctions: Map<string, any> = new Map();
    private embeddingModels: Map<string, EmbeddingModel> = new Map();
    private externalEmbedder: EmbeddingFunction | null = null;

    constructor(context: PluginContext, components: VectorDBComponents, config: VectorDBConfig) {
        this.context = context;
        this.components = components;
        this.config = config;
    }

    setExternalEmbedder(embedder: EmbeddingFunction): void {
        this.externalEmbedder = embedder;
        this.context.logger.info('External embedder set successfully');
    }

    async getExternalEmbedding(text: string): Promise<number[]> {
        if (!this.externalEmbedder) {
            throw new Error('External embedder not set. Call setExternalEmbedder first.');
        }
        return this.externalEmbedder.embed(text);
    }

    async getExternalEmbeddings(texts: string[]): Promise<number[][]> {
        if (!this.externalEmbedder) {
            throw new Error('External embedder not set. Call setExternalEmbedder first.');
        }
        if (this.externalEmbedder.embedBatch) {
            return this.externalEmbedder.embedBatch(texts);
        }
        const embeddings: number[][] = [];
        for (const text of texts) {
            embeddings.push(await this.externalEmbedder.embed(text));
        }
        return embeddings;
    }

    isReady(): boolean {
        return this.ready && this.components.connection.isReady();
    }

    setReady(ready: boolean): void {
        this.ready = ready;
    }

    private async ensureReady(): Promise<void> {
        if (!this.isReady()) {
            throw new Error('LanceDB plugin not ready');
        }
    }

    async registerEmbeddingFunction(name: string, config: EmbeddingConfig): Promise<EmbeddingModel> {
        try {
            const registry = getRegistry();
            const func = registry.get(config.provider)?.create({
                model: config.model,
                device: config.device,
                apiKey: config.apiKey
            });

            if (!func) {
                throw new Error(`Failed to create embedding function for ${config.provider}`);
            }

            let dimensions = 384;

            if (config.dimensions !== undefined) {
                dimensions = config.dimensions;
            } else if (func.ndims && typeof func.ndims === 'function') {
                const ndims = func.ndims();
                if (ndims !== undefined && ndims !== null) {
                    dimensions = ndims;
                }
            }

            const model: EmbeddingModel = {
                name: config.model,
                provider: config.provider,
                dimensions: dimensions
            };

            this.embeddingFunctions.set(name, func);
            this.embeddingModels.set(name, model);

            this.context.logger.info(`Registered embedding function ${name} with model ${config.model}`);
            return model;
        } catch (error) {
            this.context.logger.error('Failed to register embedding function:', error);
            throw error;
        }
    }

    getEmbeddingModel(name: string): EmbeddingModel | undefined {
        return this.embeddingModels.get(name);
    }

    getEmbeddingFunction(name: string): any {
        return this.embeddingFunctions.get(name);
    }

    listEmbeddingFunctions(): string[] {
        return Array.from(this.embeddingModels.keys());
    }

    async createEmbeddingSchema(embeddingFuncName: string, textFields: Record<string, any> = { text: new Utf8() }, vectorFieldName: string = 'vector'): Promise<any> {
        const func = this.embeddingFunctions.get(embeddingFuncName);
        if (!func) {
            throw new Error(`Embedding function ${embeddingFuncName} not found`);
        }

        return LanceSchema({
            [Object.keys(textFields)[0]]: func.sourceField(Object.values(textFields)[0]),
            [vectorFieldName]: func.vectorField()
        });
    }

    async createEmbeddingTable(tableName: string, embeddingFuncName: string, schema: any): Promise<void> {
        await this.ensureReady();
        const func = this.embeddingFunctions.get(embeddingFuncName);
        if (!func) {
            throw new Error(`Embedding function ${embeddingFuncName} not found`);
        }

        await this.components.connection.createEmptyTable(tableName, schema);
        this.context.logger.info(`Created embedding table ${tableName}`);
    }

    async createTable(tableName: string, data: any[]): Promise<void> {
        await this.ensureReady();
        await this.components.createTable(tableName, data);
        this.context.logger.info(`Table ${tableName} created`);
    }

    async createEmptyTable(tableName: string, schema: any): Promise<void> {
        await this.ensureReady();
        await this.components.createEmptyTable(tableName, schema);
        this.context.logger.info(`Empty table ${tableName} created`);
    }

    async dropTable(tableName: string): Promise<void> {
        await this.ensureReady();
        await this.components.connection.dropTable(tableName);
        this.context.logger.info(`Table ${tableName} dropped`);
    }

    async listTables(): Promise<string[]> {
        await this.ensureReady();
        return this.components.connection.tableNames();
    }

    async tableExists(tableName: string): Promise<boolean> {
        await this.ensureReady();
        const tables = await this.components.connection.tableNames();
        return tables.includes(tableName);
    }

    async addToTable(tableName: string, records: VectorRecord[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.add(records);
    }

    async searchInTable(tableName: string, queryVector: number[], options?: SearchOptions): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, options);
    }

    async textSearch(tableName: string, queryText: string, options?: SearchOptions): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);

        try {
            const indices = await manager.listIndices();
            const hasFtsIndex = indices.some(idx => idx.indexType === 'fts');

            if (hasFtsIndex) {
                return manager.search(queryText, { ...options, queryType: 'fts' });
            }
        } catch (error) {
            this.context.logger.debug('FTS index not available, falling back to LIKE query');
        }

        const filter = `message LIKE '%${queryText}%'`;
        const results = await manager.query({ filter, limit: options?.limit || 10 });

        return results.map((r: any) => ({
            id: String(r.id),
            score: 1.0,
            level: r.level,
            message: r.message,
            timestamp: Number(r.timestamp),
            source: r.source,
            metadata: r.metadata
        }));
    }

    async hybridSearch(tableName: string, queryVector: number[], queryText: string, options?: SearchOptions): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);

        try {
            const results = await (manager.getNativeTable() as any)
                .query()
                .fullTextSearch(queryText)
                .nearestTo(queryVector)
                .select(options?.columns || ['*'])
                .limit(options?.limit || 10)
                .toArray();

            return results.map((r: any) => ({
                id: String(r.id),
                score: r._relevance_score || r._distance || 0,
                _distance: r._distance,
                _relevance_score: r._relevance_score,
                ...r
            }));
        } catch (error) {
            this.context.logger.warn('Hybrid search failed, falling back to vector search:', error);
            return manager.search(queryVector, options);
        }
    }

    async batchSearch(tableName: string, options: BatchSearchOptions): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.batchSearch(options);
    }

    async queryTable(tableName: string, options?: { filter?: string; columns?: string[]; limit?: number }): Promise<any[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.query(options);
    }

    async countRowsInTable(tableName: string, filter?: string): Promise<number> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.countRows(filter);
    }

    async updateInTable(tableName: string, where: string, values: Record<string, any>): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.update({ where, values });
    }

    async deleteFromTable(tableName: string, filter: string): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.delete(filter);
    }

    async addVector(
        tableName: string,
        vector: number[],
        metadata: Record<string, any> = {}
    ): Promise<void> {
        await this.addToTable(tableName, [{
            vector,
            ...metadata,
            timestamp: Date.now()
        }]);
    }

    async addVectors(
        tableName: string,
        vectors: number[][],
        metadatas: Record<string, any>[] = []
    ): Promise<void> {
        const records: VectorRecord[] = vectors.map((vector, i) => ({
            vector,
            ...(metadatas[i] || {}),
            timestamp: Date.now()
        }));
        await this.addToTable(tableName, records);
    }

    async findSimilar(
        tableName: string,
        queryVector: number[],
        limit: number = 10,
        distanceType?: 'l2' | 'cosine' | 'dot'
    ): Promise<SearchResult[]> {
        return this.searchInTable(tableName, queryVector, { limit, distanceType });
    }

    async findSimilarWithFilter(
        tableName: string,
        queryVector: number[],
        filter: string,
        limit: number = 10
    ): Promise<SearchResult[]> {
        return this.searchInTable(tableName, queryVector, { limit, filter });
    }

    async getTableVersion(tableName: string): Promise<number> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.version();
    }

    async listVersions(tableName: string): Promise<VersionInfo[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.listVersions();
    }

    async checkoutVersion(tableName: string, version: number): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.checkout(version);
    }

    async checkoutLatestVersion(tableName: string): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.checkoutLatest();
    }

    async restoreTable(tableName: string): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.restore();
    }

    async addColumns(tableName: string, columns: AddColumnsSql[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.addColumns(columns);
    }

    async alterColumns(tableName: string, alterations: ColumnAlteration[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.alterColumns(alterations);
    }

    async dropColumns(tableName: string, columns: string[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.dropColumns(columns);
    }

    async mergeInsert(tableName: string, on: string | string[], source: any[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const builder = manager.mergeInsert(on);
        await builder.execute(source);
    }

    async upsert(tableName: string, on: string | string[], source: any[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const builder = manager.mergeInsert(on);
        builder.whenMatchedUpdateAll();
        builder.whenNotMatchedInsertAll();
        await builder.execute(source);
    }

    async createIndex(tableName: string, column: string, options?: any): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.createIndex(column, options);
    }

    async createFTSIndex(tableName: string, column: string, config?: FTSConfig): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.createFTSIndex(column, config);
    }

    async listIndices(tableName: string): Promise<IndexInfo[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.listIndices();
    }

    async dropIndex(tableName: string, indexName: string): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        await manager.dropIndex(indexName);
    }

    async getDatabaseStats(): Promise<DatabaseStats> {
        await this.ensureReady();
        return this.components.getStats();
    }

    async getTableInfo(tableName: string): Promise<any> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const indices = await manager.listIndices();
        return {
            name: tableName,
            rowCount: await manager.countRows(),
            schema: manager.schema(),
            vectorDimension: this.config.vectorDimension || 0,
            version: await manager.version(),
            indices
        };
    }

    async searchWithDistanceRange(
        tableName: string,
        queryVector: number[],
        minDistance: number,
        maxDistance: number,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, {
            limit,
            distanceRange: [minDistance, maxDistance] as any
        });
    }

    async searchWithRefinement(
        tableName: string,
        queryVector: number[],
        refineFactor: number,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, { limit, refineFactor });
    }

    async searchWithNProbes(
        tableName: string,
        queryVector: number[],
        nprobes: number,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, { limit, nprobes });
    }

    async searchWithPrefilter(
        tableName: string,
        queryVector: number[],
        filter: string,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, { limit, filter, prefilter: true });
    }

    async searchWithPostfilter(
        tableName: string,
        queryVector: number[],
        filter: string,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, { limit, filter, postfilter: true });
    }

    async bypassVectorIndex(
        tableName: string,
        queryVector: number[],
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, { limit, bypassVectorIndex: true });
    }

    async fastSearch(
        tableName: string,
        queryVector: number[],
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVector, { limit, fastSearch: true });
    }

    async createBinaryTable(tableName: string, dimension: number = 256): Promise<void> {
        await this.ensureReady();
        const schema = new Schema([
            new Field("id", new Int32(), true),
            new Field("vec", new FixedSizeList(dimension / 8, new Field("item", new Uint8()))),
        ]);

        await this.components.connection.createEmptyTable(tableName, schema);
        this.context.logger.info(`Created binary table ${tableName} with dimension ${dimension}`);
    }

    packBits(data: number[]): Uint8Array {
        const uint8Data = new Uint8Array(Math.ceil(data.length / 8));
        for (let i = 0; i < data.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++) {
                if (i + j < data.length && data[i + j] === 1) {
                    byte |= (1 << (7 - j));
                }
            }
            uint8Data[Math.floor(i / 8)] = byte;
        }
        return uint8Data;
    }

    async addBinaryVectors(tableName: string, vectors: number[][], ids?: number[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const records = vectors.map((vec, i) => ({
            id: ids?.[i] || i,
            vec: this.packBits(vec)
        }));
        await manager.add(records);
    }

    async searchBinaryVectors(
        tableName: string,
        queryVector: number[],
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const packedQuery = Array.from(this.packBits(queryVector));
        const results = await (manager.getNativeTable() as any)
            .query()
            .nearestTo(packedQuery)
            .limit(limit)
            .toArray();

        return results.map((r: any) => ({
            id: r.id,
            score: r._distance || 0,
            ...r
        }));
    }

    async createMultivectorTable(tableName: string, dimension: number = 256): Promise<void> {
        await this.ensureReady();

        const innerListField = new Field('item', new Float32());
        const innerListType = new arrow.List(innerListField);
        const innerListField2 = new Field('item', innerListType);
        const vectorType = new arrow.List(innerListField2);

        const schema = new Schema([
            new Field('id', new Int32()),
            new Field('vector', vectorType)
        ]);

        await this.components.connection.createEmptyTable(tableName, schema);
        this.context.logger.info(`Created multivector table ${tableName} with dimension ${dimension}`);
    }

    async addMultivectors(tableName: string, multivectors: number[][][], ids?: number[]): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const records = multivectors.map((mv, i) => ({
            id: ids?.[i] || i,
            vector: mv
        }));
        await manager.add(records as any);
    }

    async searchMultivector(
        tableName: string,
        queryVectors: number[][],
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        return manager.search(queryVectors as any, { limit, distanceType: 'cosine' });
    }

    async createFTSIndexWithOptions(tableName: string, column: string, config: FTSConfig): Promise<void> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);

        const ftsConfig: any = {};

        if (config.language) ftsConfig.language = config.language;
        if (config.stem !== undefined) ftsConfig.stem = config.stem;
        if (config.removeStopWords !== undefined) ftsConfig.removeStopWords = config.removeStopWords;
        if (config.asciiFolding !== undefined) ftsConfig.asciiFolding = config.asciiFolding;
        if (config.withPosition !== undefined) ftsConfig.withPosition = config.withPosition;
        if (config.maxTokenLength) ftsConfig.maxTokenLength = config.maxTokenLength;
        if (config.ngramMinLength) ftsConfig.ngramMinLength = config.ngramMinLength;
        if (config.ngramMaxLength) ftsConfig.ngramMaxLength = config.ngramMaxLength;
        if (config.prefixOnly !== undefined) ftsConfig.prefixOnly = config.prefixOnly;

        if (config.baseTokenizer) {
            if (['simple', 'whitespace', 'raw', 'ngram'].includes(config.baseTokenizer)) {
                ftsConfig.baseTokenizer = config.baseTokenizer as 'simple' | 'whitespace' | 'raw' | 'ngram';
            }
        }

        await (manager.getNativeTable() as any).createIndex(column, {
            config: (lancedb.Index as any).fts(ftsConfig)
        });

        this.context.logger.info(`Created FTS index with options on ${tableName}.${column}`);
    }

    async fuzzySearch(
        tableName: string,
        column: string,
        term: string,
        fuzziness: number = 2,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const results = await (manager.getNativeTable() as any)
            .query()
            .fullTextSearch(new (lancedb as any).MatchQuery(term, column, { fuzziness }))
            .limit(limit)
            .toArray();

        return results.map((r: any) => ({
            id: r.id || r._rowid,
            score: r.score || 0,
            ...r
        }));
    }

    async phraseSearch(
        tableName: string,
        column: string,
        phrase: string,
        slop?: number,
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const options = slop ? { slop } : undefined;
        const results = await (manager.getNativeTable() as any)
            .query()
            .fullTextSearch(new (lancedb as any).PhraseQuery(phrase, column, options))
            .limit(limit)
            .toArray();

        return results.map((r: any) => ({
            id: r.id || r._rowid,
            score: r.score || 0,
            ...r
        }));
    }

    async booleanSearch(
        tableName: string,
        clauses: BooleanQueryClause[],
        limit: number = 10
    ): Promise<SearchResult[]> {
        await this.ensureReady();
        const manager = await this.components.getOrCreateTable(tableName);
        const booleanQuery = new (lancedb as any).BooleanQuery(clauses);
        const results = await (manager.getNativeTable() as any)
            .query()
            .fullTextSearch(booleanQuery)
            .limit(limit)
            .toArray();

        return results.map((r: any) => ({
            id: r.id || r._rowid,
            score: r.score || 0,
            ...r
        }));
    }

    async makeArrowTable(data: any[], schema?: any): Promise<any> {
        return lancedb.makeArrowTable(data, { schema });
    }
}
