import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
import { VectorDBComponents } from './components';
import { VectorDBSkills } from './skills';
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

export * from './components';
export * from './skills';
export * from './types';

export class LanceDBPlugin implements Plugin {
    public metadata: PluginMetadata = {
        name: 'lancedb',
        version: '0.1.0',
        description: 'LanceDB vector database integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: []
    };

    private context!: PluginContext;
    private components!: VectorDBComponents;
    public skills!: VectorDBSkills;
    private config!: VectorDBConfig;
    private initialized: boolean = false;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        const userConfig = context.config as VectorDBConfig;

        this.context.logger.info('Initializing LanceDB plugin...');

        this.config = {
            uri: userConfig.uri || './lancedb',
            vectorDimension: userConfig.vectorDimension || 384,
            region: userConfig.region,
            apiKey: userConfig.apiKey,
            hostOverride: userConfig.hostOverride,
            storageOptions: userConfig.storageOptions,
            readConsistencyInterval: userConfig.readConsistencyInterval,
            defaultTableName: userConfig.defaultTableName
        };

        this.components = new VectorDBComponents(this.context, this.config);
        this.skills = new VectorDBSkills(this.context, this.components, this.config);

        this.initialized = true;
        this.context.logger.info('LanceDB plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.context.logger.info('LanceDB plugin activated');

        try {
            await this.components.initialize();
            this.skills.setReady(true);

            const stats = await this.skills.getDatabaseStats();
            this.context.logger.info(`LanceDB ready with ${stats.tables.length} tables`);

            this.context.events.emit('lancedb:activated', {
                uri: this.config.uri,
                tables: stats.tables.length
            });
        } catch (error) {
            this.context.logger.error('Failed to activate LanceDB plugin:', error);
            throw error;
        }
    }

    async onDeactivate(): Promise<void> {
        this.context.logger.info('LanceDB plugin deactivated');

        await this.components.cleanup();
        this.skills.setReady(false);

        this.context.events.emit('lancedb:deactivated');
    }

    async shutdown(): Promise<void> {
        this.context.logger.info('LanceDB plugin shutting down...');

        await this.components.cleanup();
        this.initialized = false;

        this.context.logger.info('LanceDB plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        const oldUri = this.config.uri;

        const updatedConfig: VectorDBConfig = {
            uri: newConfig.uri || this.config.uri,
            vectorDimension: newConfig.vectorDimension || this.config.vectorDimension,
            region: newConfig.region !== undefined ? newConfig.region : this.config.region,
            apiKey: newConfig.apiKey !== undefined ? newConfig.apiKey : this.config.apiKey,
            hostOverride: newConfig.hostOverride !== undefined ? newConfig.hostOverride : this.config.hostOverride,
            storageOptions: newConfig.storageOptions || this.config.storageOptions,
            readConsistencyInterval: newConfig.readConsistencyInterval !== undefined ? newConfig.readConsistencyInterval : this.config.readConsistencyInterval,
            defaultTableName: newConfig.defaultTableName !== undefined ? newConfig.defaultTableName : this.config.defaultTableName
        };

        this.config = updatedConfig;
        this.context.logger.info('LanceDB config updated');

        if (oldUri !== this.config.uri) {
            await this.components.cleanup();
            await this.components.initialize();
            this.skills.setReady(true);
            this.context.events.emit('lancedb:reconnected');
        }

        this.context.events.emit('lancedb:config:updated', this.config);
    }

    async createTable(tableName: string, data: any[]): Promise<void> {
        this.checkInitialized();
        return this.skills.createTable(tableName, data);
    }

    async createEmptyTable(tableName: string, schema: any): Promise<void> {
        this.checkInitialized();
        return this.skills.createEmptyTable(tableName, schema);
    }

    async dropTable(tableName: string): Promise<void> {
        this.checkInitialized();
        return this.skills.dropTable(tableName);
    }

    async listTables(): Promise<string[]> {
        this.checkInitialized();
        return this.skills.listTables();
    }

    async tableExists(tableName: string): Promise<boolean> {
        this.checkInitialized();
        return this.skills.tableExists(tableName);
    }

    async addToTable(tableName: string, records: VectorRecord[]): Promise<void> {
        this.checkInitialized();
        return this.skills.addToTable(tableName, records);
    }

    async searchInTable(tableName: string, queryVector: number[], options?: SearchOptions): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchInTable(tableName, queryVector, options);
    }

    async textSearch(tableName: string, queryText: string, options?: SearchOptions): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.textSearch(tableName, queryText, options);
    }

    async hybridSearch(tableName: string, queryVector: number[], queryText: string, options?: SearchOptions): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.hybridSearch(tableName, queryVector, queryText, options);
    }

    async batchSearch(tableName: string, options: BatchSearchOptions): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.batchSearch(tableName, options);
    }

    async queryTable(tableName: string, options?: { filter?: string; columns?: string[]; limit?: number }): Promise<any[]> {
        this.checkInitialized();
        return this.skills.queryTable(tableName, options);
    }

    async countRowsInTable(tableName: string, filter?: string): Promise<number> {
        this.checkInitialized();
        return this.skills.countRowsInTable(tableName, filter);
    }

    async updateInTable(tableName: string, where: string, values: Record<string, any>): Promise<void> {
        this.checkInitialized();
        return this.skills.updateInTable(tableName, where, values);
    }

    async deleteFromTable(tableName: string, filter: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteFromTable(tableName, filter);
    }

    async addVector(tableName: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
        this.checkInitialized();
        return this.skills.addVector(tableName, vector, metadata);
    }

    async addVectors(tableName: string, vectors: number[][], metadatas?: Record<string, any>[]): Promise<void> {
        this.checkInitialized();
        return this.skills.addVectors(tableName, vectors, metadatas);
    }

    async findSimilar(tableName: string, queryVector: number[], limit?: number, distanceType?: 'l2' | 'cosine' | 'dot'): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.findSimilar(tableName, queryVector, limit, distanceType);
    }

    async findSimilarWithFilter(tableName: string, queryVector: number[], filter: string, limit?: number): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.findSimilarWithFilter(tableName, queryVector, filter, limit);
    }

    async getTableVersion(tableName: string): Promise<number> {
        this.checkInitialized();
        return this.skills.getTableVersion(tableName);
    }

    async listVersions(tableName: string): Promise<VersionInfo[]> {
        this.checkInitialized();
        return this.skills.listVersions(tableName);
    }

    async checkoutVersion(tableName: string, version: number): Promise<void> {
        this.checkInitialized();
        return this.skills.checkoutVersion(tableName, version);
    }

    async checkoutLatestVersion(tableName: string): Promise<void> {
        this.checkInitialized();
        return this.skills.checkoutLatestVersion(tableName);
    }

    async restoreTable(tableName: string): Promise<void> {
        this.checkInitialized();
        return this.skills.restoreTable(tableName);
    }

    async addColumns(tableName: string, columns: AddColumnsSql[]): Promise<void> {
        this.checkInitialized();
        return this.skills.addColumns(tableName, columns);
    }

    async alterColumns(tableName: string, alterations: ColumnAlteration[]): Promise<void> {
        this.checkInitialized();
        return this.skills.alterColumns(tableName, alterations);
    }

    async dropColumns(tableName: string, columns: string[]): Promise<void> {
        this.checkInitialized();
        return this.skills.dropColumns(tableName, columns);
    }

    async mergeInsert(tableName: string, on: string | string[], source: any[]): Promise<void> {
        this.checkInitialized();
        return this.skills.mergeInsert(tableName, on, source);
    }

    async upsert(tableName: string, on: string | string[], source: any[]): Promise<void> {
        this.checkInitialized();
        return this.skills.upsert(tableName, on, source);
    }

    async createIndex(tableName: string, column: string, options?: any): Promise<void> {
        this.checkInitialized();
        return this.skills.createIndex(tableName, column, options);
    }

    async createFTSIndex(tableName: string, column: string, config?: FTSConfig): Promise<void> {
        this.checkInitialized();
        return this.skills.createFTSIndex(tableName, column, config);
    }

    async listIndices(tableName: string): Promise<IndexInfo[]> {
        this.checkInitialized();
        return this.skills.listIndices(tableName);
    }

    async dropIndex(tableName: string, indexName: string): Promise<void> {
        this.checkInitialized();
        return this.skills.dropIndex(tableName, indexName);
    }

    async getDatabaseStats(): Promise<DatabaseStats> {
        this.checkInitialized();
        return this.skills.getDatabaseStats();
    }

    async getTableInfo(tableName: string): Promise<any> {
        this.checkInitialized();
        return this.skills.getTableInfo(tableName);
    }

    async registerEmbeddingFunction(name: string, config: EmbeddingConfig): Promise<EmbeddingModel> {
        this.checkInitialized();
        return this.skills.registerEmbeddingFunction(name, config);
    }

    listEmbeddingFunctions(): string[] {
        this.checkInitialized();
        return this.skills.listEmbeddingFunctions();
    }

    getEmbeddingModel(name: string): EmbeddingModel | undefined {
        this.checkInitialized();
        return this.skills.getEmbeddingModel(name);
    }

    getEmbeddingFunction(name: string): any {
        this.checkInitialized();
        return this.skills.getEmbeddingFunction(name);
    }

    async createEmbeddingSchema(embeddingFuncName: string, textFields?: Record<string, any>, vectorFieldName?: string): Promise<any> {
        this.checkInitialized();
        return this.skills.createEmbeddingSchema(embeddingFuncName, textFields, vectorFieldName);
    }

    async createEmbeddingTable(tableName: string, embeddingFuncName: string, schema: any): Promise<void> {
        this.checkInitialized();
        return this.skills.createEmbeddingTable(tableName, embeddingFuncName, schema);
    }

    setExternalEmbedder(embedder: EmbeddingFunction): void {
        this.checkInitialized();
        return this.skills.setExternalEmbedder(embedder);
    }

    async getExternalEmbedding(text: string): Promise<number[]> {
        this.checkInitialized();
        return this.skills.getExternalEmbedding(text);
    }

    async getExternalEmbeddings(texts: string[]): Promise<number[][]> {
        this.checkInitialized();
        return this.skills.getExternalEmbeddings(texts);
    }

    async searchWithDistanceRange(
        tableName: string,
        queryVector: number[],
        minDistance: number,
        maxDistance: number,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchWithDistanceRange(tableName, queryVector, minDistance, maxDistance, limit);
    }

    async searchWithRefinement(
        tableName: string,
        queryVector: number[],
        refineFactor: number,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchWithRefinement(tableName, queryVector, refineFactor, limit);
    }

    async searchWithNProbes(
        tableName: string,
        queryVector: number[],
        nprobes: number,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchWithNProbes(tableName, queryVector, nprobes, limit);
    }

    async searchWithPrefilter(
        tableName: string,
        queryVector: number[],
        filter: string,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchWithPrefilter(tableName, queryVector, filter, limit);
    }

    async searchWithPostfilter(
        tableName: string,
        queryVector: number[],
        filter: string,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchWithPostfilter(tableName, queryVector, filter, limit);
    }

    async bypassVectorIndex(
        tableName: string,
        queryVector: number[],
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.bypassVectorIndex(tableName, queryVector, limit);
    }

    async fastSearch(
        tableName: string,
        queryVector: number[],
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.fastSearch(tableName, queryVector, limit);
    }

    async createBinaryTable(tableName: string, dimension?: number): Promise<void> {
        this.checkInitialized();
        return this.skills.createBinaryTable(tableName, dimension);
    }

    packBits(data: number[]): Uint8Array {
        this.checkInitialized();
        return this.skills.packBits(data);
    }

    async addBinaryVectors(tableName: string, vectors: number[][], ids?: number[]): Promise<void> {
        this.checkInitialized();
        return this.skills.addBinaryVectors(tableName, vectors, ids);
    }

    async searchBinaryVectors(
        tableName: string,
        queryVector: number[],
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchBinaryVectors(tableName, queryVector, limit);
    }

    async createMultivectorTable(tableName: string, dimension?: number): Promise<void> {
        this.checkInitialized();
        return this.skills.createMultivectorTable(tableName, dimension);
    }

    async addMultivectors(tableName: string, multivectors: number[][][], ids?: number[]): Promise<void> {
        this.checkInitialized();
        return this.skills.addMultivectors(tableName, multivectors, ids);
    }

    async searchMultivector(
        tableName: string,
        queryVectors: number[][],
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.searchMultivector(tableName, queryVectors, limit);
    }

    async createFTSIndexWithOptions(tableName: string, column: string, config: FTSConfig): Promise<void> {
        this.checkInitialized();
        return this.skills.createFTSIndexWithOptions(tableName, column, config);
    }

    async fuzzySearch(
        tableName: string,
        column: string,
        term: string,
        fuzziness?: number,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.fuzzySearch(tableName, column, term, fuzziness, limit);
    }

    async phraseSearch(
        tableName: string,
        column: string,
        phrase: string,
        slop?: number,
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.phraseSearch(tableName, column, phrase, slop, limit);
    }

    async booleanSearch(
        tableName: string,
        clauses: BooleanQueryClause[],
        limit?: number
    ): Promise<SearchResult[]> {
        this.checkInitialized();
        return this.skills.booleanSearch(tableName, clauses, limit);
    }

    async makeArrowTable(data: any[], schema?: any): Promise<any> {
        this.checkInitialized();
        return this.skills.makeArrowTable(data, schema);
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    getMetrics() {
        this.checkInitialized();
        return {
            tables: this.components['tables'].size,
            uri: this.config.uri,
            embeddingFunctions: this.skills.listEmbeddingFunctions().length
        };
    }

    private checkInitialized(): void {
        if (!this.initialized) {
            throw new Error('Plugin not initialized. Call initialize() first.');
        }
    }
}
