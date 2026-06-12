import { BasePlugin } from '@ton-ai/core';
import { VectorDBComponents } from './components';
import { VectorDBSkills } from './skills';
import { VectorDBConfig } from './types';

export * from './components';
export * from './skills';
export * from './types';

export class LanceDBPlugin extends BasePlugin<VectorDBConfig> {
    readonly metadata = {
        name: 'lancedb',
        version: '0.1.0',
        description: 'LanceDB vector database integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: VectorDBComponents;
    public skills!: VectorDBSkills;

    protected defaults() {
        return { uri: './lancedb', vectorDimension: 384 };
    }

    protected async onInit() {
        this.logger.info('Initializing LanceDB plugin...');
        this.components = new VectorDBComponents(this.context, this.config);
        this.skills = new VectorDBSkills(this.context, this.components, this.config);
        this.logger.info('LanceDB plugin initialized');
    }

    async onActivate() {
        this.logger.info('LanceDB plugin activated');
        await this.components.initialize();
        this.skills.setReady(true);
        const stats = await this.skills.getDatabaseStats();
        this.logger.info(`LanceDB ready with ${stats.tables.length} tables`);
        this.events.emit('lancedb:activated', { uri: this.config.uri, tables: stats.tables.length });
    }

    async onDeactivate() {
        this.logger.info('LanceDB plugin deactivated');
        await this.components.cleanup();
        this.skills.setReady(false);
        this.events.emit('lancedb:deactivated');
    }

    async shutdown() {
        this.logger.info('LanceDB plugin shutting down...');
        await this.components.cleanup();
        this.initialized = false;
        this.logger.info('LanceDB plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>) {
        const oldUri = this.config.uri;
        this.config = { ...this.config, ...newConfig };
        this.logger.info('LanceDB config updated');
        if (oldUri !== this.config.uri) {
            await this.components.cleanup();
            await this.components.initialize();
            this.skills.setReady(true);
            this.events.emit('lancedb:reconnected');
        }
        this.events.emit('lancedb:config:updated', this.config);
    }

    async createTable(tableName: string, data: any[]): Promise<void> { this.checkInitialized(); return this.skills.createTable(tableName, data); }
    async createEmptyTable(tableName: string, schema: any): Promise<void> { this.checkInitialized(); return this.skills.createEmptyTable(tableName, schema); }
    async dropTable(tableName: string): Promise<void> { this.checkInitialized(); return this.skills.dropTable(tableName); }
    async listTables(): Promise<string[]> { this.checkInitialized(); return this.skills.listTables(); }
    async tableExists(tableName: string): Promise<boolean> { this.checkInitialized(); return this.skills.tableExists(tableName); }
    async addToTable(tableName: string, records: any[]): Promise<void> { this.checkInitialized(); return this.skills.addToTable(tableName, records); }
    async searchInTable(tableName: string, queryVector: number[], options?: any): Promise<any[]> { this.checkInitialized(); return this.skills.searchInTable(tableName, queryVector, options); }
    async textSearch(tableName: string, queryText: string, options?: any): Promise<any[]> { this.checkInitialized(); return this.skills.textSearch(tableName, queryText, options); }
    async hybridSearch(tableName: string, queryVector: number[], queryText: string, options?: any): Promise<any[]> { this.checkInitialized(); return this.skills.hybridSearch(tableName, queryVector, queryText, options); }
    async batchSearch(tableName: string, options: any): Promise<any[]> { this.checkInitialized(); return this.skills.batchSearch(tableName, options); }
    async queryTable(tableName: string, options?: any): Promise<any[]> { this.checkInitialized(); return this.skills.queryTable(tableName, options); }
    async countRowsInTable(tableName: string, filter?: string): Promise<number> { this.checkInitialized(); return this.skills.countRowsInTable(tableName, filter); }
    async updateInTable(tableName: string, where: string, values: Record<string, any>): Promise<void> { this.checkInitialized(); return this.skills.updateInTable(tableName, where, values); }
    async deleteFromTable(tableName: string, filter: string): Promise<void> { this.checkInitialized(); return this.skills.deleteFromTable(tableName, filter); }
    async addVector(tableName: string, vector: number[], metadata?: Record<string, any>): Promise<void> { this.checkInitialized(); return this.skills.addVector(tableName, vector, metadata); }
    async addVectors(tableName: string, vectors: number[][], metadatas?: Record<string, any>[]): Promise<void> { this.checkInitialized(); return this.skills.addVectors(tableName, vectors, metadatas); }
    async findSimilar(tableName: string, queryVector: number[], limit?: number, distanceType?: 'l2' | 'cosine' | 'dot'): Promise<any[]> { this.checkInitialized(); return this.skills.findSimilar(tableName, queryVector, limit, distanceType); }
    async findSimilarWithFilter(tableName: string, queryVector: number[], filter: string, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.findSimilarWithFilter(tableName, queryVector, filter, limit); }
    async getTableVersion(tableName: string): Promise<number> { this.checkInitialized(); return this.skills.getTableVersion(tableName); }
    async listVersions(tableName: string): Promise<any[]> { this.checkInitialized(); return this.skills.listVersions(tableName); }
    async checkoutVersion(tableName: string, version: number): Promise<void> { this.checkInitialized(); return this.skills.checkoutVersion(tableName, version); }
    async checkoutLatestVersion(tableName: string): Promise<void> { this.checkInitialized(); return this.skills.checkoutLatestVersion(tableName); }
    async restoreTable(tableName: string): Promise<void> { this.checkInitialized(); return this.skills.restoreTable(tableName); }
    async addColumns(tableName: string, columns: any[]): Promise<void> { this.checkInitialized(); return this.skills.addColumns(tableName, columns); }
    async alterColumns(tableName: string, alterations: any[]): Promise<void> { this.checkInitialized(); return this.skills.alterColumns(tableName, alterations); }
    async dropColumns(tableName: string, columns: string[]): Promise<void> { this.checkInitialized(); return this.skills.dropColumns(tableName, columns); }
    async mergeInsert(tableName: string, on: string | string[], source: any[]): Promise<void> { this.checkInitialized(); return this.skills.mergeInsert(tableName, on, source); }
    async upsert(tableName: string, on: string | string[], source: any[]): Promise<void> { this.checkInitialized(); return this.skills.upsert(tableName, on, source); }
    async createIndex(tableName: string, column: string, options?: any): Promise<void> { this.checkInitialized(); return this.skills.createIndex(tableName, column, options); }
    async createFTSIndex(tableName: string, column: string, config?: any): Promise<void> { this.checkInitialized(); return this.skills.createFTSIndex(tableName, column, config); }
    async listIndices(tableName: string): Promise<any[]> { this.checkInitialized(); return this.skills.listIndices(tableName); }
    async dropIndex(tableName: string, indexName: string): Promise<void> { this.checkInitialized(); return this.skills.dropIndex(tableName, indexName); }
    async getDatabaseStats(): Promise<any> { this.checkInitialized(); return this.skills.getDatabaseStats(); }
    async getTableInfo(tableName: string): Promise<any> { this.checkInitialized(); return this.skills.getTableInfo(tableName); }
    async registerEmbeddingFunction(name: string, config: any): Promise<any> { this.checkInitialized(); return this.skills.registerEmbeddingFunction(name, config); }
    listEmbeddingFunctions(): string[] { this.checkInitialized(); return this.skills.listEmbeddingFunctions(); }
    getEmbeddingModel(name: string): any { this.checkInitialized(); return this.skills.getEmbeddingModel(name); }
    getEmbeddingFunction(name: string): any { this.checkInitialized(); return this.skills.getEmbeddingFunction(name); }
    async createEmbeddingSchema(embeddingFuncName: string, textFields?: Record<string, any>, vectorFieldName?: string): Promise<any> { this.checkInitialized(); return this.skills.createEmbeddingSchema(embeddingFuncName, textFields, vectorFieldName); }
    async createEmbeddingTable(tableName: string, embeddingFuncName: string, schema: any): Promise<void> { this.checkInitialized(); return this.skills.createEmbeddingTable(tableName, embeddingFuncName, schema); }
    setExternalEmbedder(embedder: any): void { this.checkInitialized(); this.skills.setExternalEmbedder(embedder); }
    async getExternalEmbedding(text: string): Promise<number[]> { this.checkInitialized(); return this.skills.getExternalEmbedding(text); }
    async getExternalEmbeddings(texts: string[]): Promise<number[][]> { this.checkInitialized(); return this.skills.getExternalEmbeddings(texts); }
    async searchWithDistanceRange(tableName: string, queryVector: number[], minDistance: number, maxDistance: number, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchWithDistanceRange(tableName, queryVector, minDistance, maxDistance, limit); }
    async searchWithRefinement(tableName: string, queryVector: number[], refineFactor: number, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchWithRefinement(tableName, queryVector, refineFactor, limit); }
    async searchWithNProbes(tableName: string, queryVector: number[], nprobes: number, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchWithNProbes(tableName, queryVector, nprobes, limit); }
    async searchWithPrefilter(tableName: string, queryVector: number[], filter: string, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchWithPrefilter(tableName, queryVector, filter, limit); }
    async searchWithPostfilter(tableName: string, queryVector: number[], filter: string, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchWithPostfilter(tableName, queryVector, filter, limit); }
    async bypassVectorIndex(tableName: string, queryVector: number[], limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.bypassVectorIndex(tableName, queryVector, limit); }
    async fastSearch(tableName: string, queryVector: number[], limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.fastSearch(tableName, queryVector, limit); }
    async createBinaryTable(tableName: string, dimension?: number): Promise<void> { this.checkInitialized(); return this.skills.createBinaryTable(tableName, dimension); }
    packBits(data: number[]): Uint8Array { this.checkInitialized(); return this.skills.packBits(data); }
    async addBinaryVectors(tableName: string, vectors: number[][], ids?: number[]): Promise<void> { this.checkInitialized(); return this.skills.addBinaryVectors(tableName, vectors, ids); }
    async searchBinaryVectors(tableName: string, queryVector: number[], limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchBinaryVectors(tableName, queryVector, limit); }
    async createMultivectorTable(tableName: string, dimension?: number): Promise<void> { this.checkInitialized(); return this.skills.createMultivectorTable(tableName, dimension); }
    async addMultivectors(tableName: string, multivectors: number[][][], ids?: number[]): Promise<void> { this.checkInitialized(); return this.skills.addMultivectors(tableName, multivectors, ids); }
    async searchMultivector(tableName: string, queryVectors: number[][], limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.searchMultivector(tableName, queryVectors, limit); }
    async createFTSIndexWithOptions(tableName: string, column: string, config: any): Promise<void> { this.checkInitialized(); return this.skills.createFTSIndexWithOptions(tableName, column, config); }
    async fuzzySearch(tableName: string, column: string, term: string, fuzziness?: number, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.fuzzySearch(tableName, column, term, fuzziness, limit); }
    async phraseSearch(tableName: string, column: string, phrase: string, slop?: number, limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.phraseSearch(tableName, column, phrase, slop, limit); }
    async booleanSearch(tableName: string, clauses: any[], limit?: number): Promise<any[]> { this.checkInitialized(); return this.skills.booleanSearch(tableName, clauses, limit); }
    async makeArrowTable(data: any[], schema?: any): Promise<any> { this.checkInitialized(); return this.skills.makeArrowTable(data, schema); }
    isReady(): boolean { return this.skills?.isReady() || false; }
    getMetrics() { this.checkInitialized(); return { tables: this.components['tables'].size, uri: this.config.uri, embeddingFunctions: this.skills.listEmbeddingFunctions().length }; }
}
