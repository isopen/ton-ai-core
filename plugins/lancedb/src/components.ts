import { PluginContext } from '@ton-ai/core';
import * as lancedb from '@lancedb/lancedb';
import {
    VectorDBConfig,
    VectorRecord,
    SearchOptions,
    SearchResult,
    TableInfo,
    DatabaseStats,
    VersionInfo,
    IndexInfo,
    AddColumnsSql,
    ColumnAlteration,
    MergeInsertBuilder,
    FTSConfig,
    MatchQueryOptions,
    PhraseQueryOptions,
    BooleanQueryClause,
    BatchSearchOptions
} from './types';
import EventEmitter from 'events';

export class ConnectionManager extends EventEmitter {
    private connection: lancedb.Connection | null = null;
    private context: PluginContext;
    private config: VectorDBConfig;
    private tables: Map<string, lancedb.Table> = new Map();
    private isConnected: boolean = false;

    constructor(context: PluginContext, config: VectorDBConfig) {
        super();
        this.context = context;
        this.config = config;
    }

    async connect(): Promise<void> {
        try {
            this.context.logger.info(`Connecting to LanceDB at ${this.config.uri}`);

            const connectOptions: any = {};

            if (this.config.region) {
                connectOptions.region = this.config.region;
            }

            if (this.config.apiKey) {
                connectOptions.apiKey = this.config.apiKey;
            }

            if (this.config.hostOverride) {
                connectOptions.hostOverride = this.config.hostOverride;
            }

            if (this.config.storageOptions) {
                connectOptions.storageOptions = this.config.storageOptions;
            }

            if (this.config.readConsistencyInterval !== undefined) {
                connectOptions.readConsistencyInterval = this.config.readConsistencyInterval;
            }

            this.connection = await lancedb.connect(this.config.uri, connectOptions);
            this.isConnected = true;
            this.emit('connected', { uri: this.config.uri });
            this.context.logger.info('LanceDB connected successfully');
        } catch (error) {
            this.context.logger.error('Failed to connect to LanceDB:', error);
            this.emit('error', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (this.connection) {
            this.connection = null;
            this.tables.clear();
            this.isConnected = false;
            this.emit('disconnected');
            this.context.logger.info('LanceDB disconnected');
        }
    }

    isReady(): boolean {
        return this.isConnected && this.connection !== null;
    }

    getConnection(): lancedb.Connection {
        if (!this.isReady() || !this.connection) {
            throw new Error('LanceDB not connected');
        }
        return this.connection;
    }

    async createTable(tableName: string, data: any[], options?: { mode?: 'create' | 'overwrite' }): Promise<lancedb.Table> {
        const conn = this.getConnection();
        try {
            this.context.logger.info(`Creating table ${tableName}`);
            const table = await conn.createTable(tableName, data, options);
            this.tables.set(tableName, table);
            this.emit('table:created', { name: tableName });
            return table;
        } catch (error) {
            this.context.logger.error(`Failed to create table ${tableName}:`, error);
            throw error;
        }
    }

    async createEmptyTable(tableName: string, schema: any, options?: { mode?: 'create' | 'overwrite' }): Promise<lancedb.Table> {
        const conn = this.getConnection();
        try {
            this.context.logger.info(`Creating empty table ${tableName}`);
            const table = await conn.createEmptyTable(tableName, schema, options);
            this.tables.set(tableName, table);
            this.emit('table:created', { name: tableName });
            return table;
        } catch (error) {
            this.context.logger.error(`Failed to create empty table ${tableName}:`, error);
            throw error;
        }
    }

    async openTable(tableName: string): Promise<lancedb.Table> {
        if (this.tables.has(tableName)) {
            return this.tables.get(tableName)!;
        }

        const conn = this.getConnection();
        try {
            this.context.logger.info(`Opening table ${tableName}`);
            const table = await conn.openTable(tableName);
            this.tables.set(tableName, table);
            return table;
        } catch (error) {
            this.context.logger.error(`Failed to open table ${tableName}:`, error);
            throw error;
        }
    }

    async dropTable(tableName: string): Promise<void> {
        const conn = this.getConnection();
        try {
            this.context.logger.info(`Dropping table ${tableName}`);
            await conn.dropTable(tableName);
            this.tables.delete(tableName);
            this.emit('table:dropped', { name: tableName });
        } catch (error) {
            this.context.logger.error(`Failed to drop table ${tableName}:`, error);
            throw error;
        }
    }

    async tableNames(): Promise<string[]> {
        const conn = this.getConnection();
        return conn.tableNames();
    }

    getTable(tableName: string): lancedb.Table | undefined {
        return this.tables.get(tableName);
    }
}

export class TableManager {
    private table: lancedb.Table;
    private context: PluginContext;
    private tableName: string;

    constructor(context: PluginContext, table: lancedb.Table, tableName: string) {
        this.context = context;
        this.table = table;
        this.tableName = tableName;
    }

    async add(records: VectorRecord[]): Promise<void> {
        try {
            this.context.logger.debug(`Adding ${records.length} records to ${this.tableName}`);
            await this.table.add(records);
            this.context.logger.info(`Added ${records.length} records to ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to add records to ${this.tableName}:`, error);
            throw error;
        }
    }

    async search(query: number[] | string, options?: SearchOptions): Promise<SearchResult[]> {
        try {
            const limit = options?.limit || 10;
            let searchQuery: any;

            if (Array.isArray(query)) {
                // Векторный поиск
                searchQuery = this.table.search(query);

                if (options?.distanceType) {
                    searchQuery = searchQuery.distanceType(options.distanceType);
                }

                if (options?.nprobes) {
                    searchQuery = searchQuery.nprobes(options.nprobes);
                }

                if (options?.refineFactor) {
                    searchQuery = searchQuery.refineFactor(options.refineFactor);
                }

                if (options?.bypassVectorIndex) {
                    searchQuery = searchQuery.bypassVectorIndex();
                }

                if (options?.fastSearch) {
                    searchQuery = searchQuery.fastSearch();
                }

                if (options?.column) {
                    searchQuery = searchQuery.column(options.column);
                }

                if (options?.distanceRange && options.distanceRange.length === 2) {
                    const [min, max] = options.distanceRange;
                    searchQuery = searchQuery.distanceRange(min, max);
                }

                if (options?.queryType === 'hybrid' && options.text) {
                    searchQuery = (searchQuery as any).text(options.text);
                }
            } else {
                if (options?.queryType === 'fts') {
                    searchQuery = (this.table as any).search(query, { queryType: 'fts' });
                } else {
                    throw new Error('Use queryTable with filter for text search');
                }
            }

            if (options?.filter) {
                searchQuery = searchQuery.where(options.filter);
            }

            if (options?.prefilter !== undefined) {
                searchQuery = searchQuery.prefilter(options.prefilter);
            }

            if (options?.postfilter) {
                searchQuery = searchQuery.postfilter();
            }

            if (options?.columns) {
                searchQuery = searchQuery.select(options.columns);
            }

            const results = await searchQuery.limit(limit).toArray();

            return results.map((r: any) => ({
                id: r.id || r._rowid,
                score: r._distance || r._relevance_score || r.score || 0,
                _distance: r._distance,
                _relevance_score: r._relevance_score,
                query_index: r.query_index,
                ...r
            }));
        } catch (error) {
            this.context.logger.error(`Search failed in ${this.tableName}:`, error);
            throw error;
        }
    }

    async batchSearch(options: BatchSearchOptions): Promise<SearchResult[]> {
        try {
            const { queryVectors, limit = 10 } = options;

            if (queryVectors.length === 0) {
                return [];
            }

            let batchQuery = this.table.search(queryVectors[0]);

            for (let i = 1; i < queryVectors.length; i++) {
                batchQuery = (batchQuery as any).addQueryVector(queryVectors[i]);
            }

            if (options.filter) {
                batchQuery = batchQuery.where(options.filter);
            }

            if (options.columns) {
                batchQuery = batchQuery.select(options.columns);
            }

            if (options.distanceType) {
                batchQuery = (batchQuery as any).distanceType(options.distanceType);
            }

            if (options.nprobes) {
                batchQuery = (batchQuery as any).nprobes(options.nprobes);
            }

            if (options.refineFactor) {
                batchQuery = (batchQuery as any).refineFactor(options.refineFactor);
            }

            if (options.bypassVectorIndex) {
                batchQuery = (batchQuery as any).bypassVectorIndex();
            }

            if (options.fastSearch) {
                batchQuery = (batchQuery as any).fastSearch();
            }

            const results = await batchQuery.limit(limit).toArray();

            return results.map((r: any) => ({
                id: r.id || r._rowid,
                score: r._distance || 0,
                _distance: r._distance,
                query_index: r.query_index,
                ...r
            }));
        } catch (error) {
            this.context.logger.error(`Batch search failed in ${this.tableName}:`, error);
            throw error;
        }
    }

    async query(options?: { filter?: string; columns?: string[]; limit?: number }): Promise<any[]> {
        try {
            let query = this.table.query();

            if (options?.filter) {
                query = query.where(options.filter);
            }

            if (options?.columns) {
                query = query.select(options.columns);
            }

            if (options?.limit) {
                query = query.limit(options.limit);
            }

            return await query.toArray();
        } catch (error) {
            this.context.logger.error(`Query failed in ${this.tableName}:`, error);
            throw error;
        }
    }

    async countRows(filter?: string): Promise<number> {
        try {
            if (filter) {
                const results = await this.table.query().filter(filter).toArray();
                return results.length;
            }
            return await this.table.countRows();
        } catch (error) {
            this.context.logger.error(`Failed to count rows in ${this.tableName}:`, error);
            throw error;
        }
    }

    async update(options: { where: string; values: Record<string, any> }): Promise<void> {
        try {
            await (this.table as any).update(options.where, options.values);
            this.context.logger.info(`Updated records in ${this.tableName} with filter: ${options.where}`);
        } catch (error) {
            this.context.logger.error(`Failed to update ${this.tableName}:`, error);
            throw error;
        }
    }

    async delete(filter: string): Promise<void> {
        try {
            await this.table.delete(filter);
            this.context.logger.info(`Deleted records from ${this.tableName} with filter: ${filter}`);
        } catch (error) {
            this.context.logger.error(`Failed to delete from ${this.tableName}:`, error);
            throw error;
        }
    }

    schema(): any {
        return this.table.schema;
    }

    async version(): Promise<number> {
        try {
            return await this.table.version();
        } catch (error) {
            this.context.logger.error(`Failed to get version for ${this.tableName}:`, error);
            throw error;
        }
    }

    async listVersions(): Promise<VersionInfo[]> {
        try {
            const versions = await this.table.listVersions();
            return versions.map((v: any) => ({
                version: v.version,
                timestamp: new Date(v.timestamp)
            }));
        } catch (error) {
            this.context.logger.error(`Failed to list versions for ${this.tableName}:`, error);
            throw error;
        }
    }

    async checkout(version: number): Promise<void> {
        try {
            await this.table.checkout(version);
            this.context.logger.info(`Checked out version ${version} of ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to checkout version ${version} for ${this.tableName}:`, error);
            throw error;
        }
    }

    async checkoutLatest(): Promise<void> {
        try {
            await this.table.checkoutLatest();
            this.context.logger.info(`Checked out latest version of ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to checkout latest version for ${this.tableName}:`, error);
            throw error;
        }
    }

    async restore(): Promise<void> {
        try {
            await this.table.restore();
            this.context.logger.info(`Restored ${this.tableName} to current version`);
        } catch (error) {
            this.context.logger.error(`Failed to restore ${this.tableName}:`, error);
            throw error;
        }
    }

    async addColumns(columns: AddColumnsSql[]): Promise<void> {
        try {
            await this.table.addColumns(columns);
            this.context.logger.info(`Added columns to ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to add columns to ${this.tableName}:`, error);
            throw error;
        }
    }

    async alterColumns(alterations: ColumnAlteration[]): Promise<void> {
        try {
            await this.table.alterColumns(alterations);
            this.context.logger.info(`Altered columns in ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to alter columns in ${this.tableName}:`, error);
            throw error;
        }
    }

    async dropColumns(columns: string[]): Promise<void> {
        try {
            await this.table.dropColumns(columns);
            this.context.logger.info(`Dropped columns from ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to drop columns from ${this.tableName}:`, error);
            throw error;
        }
    }

    mergeInsert(on: string | string[]): any {
        return this.table.mergeInsert(on);
    }

    async createIndex(column: string, options?: any): Promise<void> {
        try {
            await this.table.createIndex(column, options);
            this.context.logger.info(`Created index on ${this.tableName}.${column}`);
        } catch (error) {
            this.context.logger.error(`Failed to create index on ${this.tableName}.${column}:`, error);
            throw error;
        }
    }

    async createFTSIndex(column: string, config?: FTSConfig): Promise<void> {
        try {
            const ftsConfig: any = {};

            if (config) {
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
            }

            await (this.table as any).createIndex(column, {
                config: (lancedb.Index as any).fts(ftsConfig)
            });

            this.context.logger.info(`Created FTS index on ${this.tableName}.${column}`);
        } catch (error) {
            this.context.logger.error(`Failed to create FTS index on ${this.tableName}.${column}:`, error);
            throw error;
        }
    }

    async listIndices(): Promise<IndexInfo[]> {
        try {
            const indices = await this.table.listIndices();
            return indices.map((idx: any) => ({
                name: idx.name,
                columns: idx.columns,
                indexType: idx.indexType,
                metric: idx.metric
            }));
        } catch (error) {
            this.context.logger.error(`Failed to list indices for ${this.tableName}:`, error);
            throw error;
        }
    }

    async dropIndex(indexName: string): Promise<void> {
        try {
            await this.table.dropIndex(indexName);
            this.context.logger.info(`Dropped index ${indexName} from ${this.tableName}`);
        } catch (error) {
            this.context.logger.error(`Failed to drop index ${indexName} from ${this.tableName}:`, error);
            throw error;
        }
    }

    getNativeTable(): lancedb.Table {
        return this.table;
    }
}

export class VectorDBComponents {
    public connection: ConnectionManager;
    private context: PluginContext;
    private config: VectorDBConfig;
    private tables: Map<string, TableManager> = new Map();

    constructor(context: PluginContext, config: VectorDBConfig) {
        this.context = context;
        this.config = config;
        this.connection = new ConnectionManager(context, config);
    }

    async initialize(): Promise<void> {
        await this.connection.connect();

        if (this.config.defaultTableName) {
            try {
                await this.getOrCreateTable(this.config.defaultTableName);
            } catch (error) {
                this.context.logger.warn(`Default table ${this.config.defaultTableName} not found`);
            }
        }

        this.context.logger.info('VectorDB components initialized');
    }

    async getOrCreateTable(tableName: string): Promise<TableManager> {
        if (this.tables.has(tableName)) {
            return this.tables.get(tableName)!;
        }

        try {
            const table = await this.connection.openTable(tableName);
            const manager = new TableManager(this.context, table, tableName);
            this.tables.set(tableName, manager);
            return manager;
        } catch (error) {
            throw new Error(`Table ${tableName} not found`);
        }
    }

    async createTable(tableName: string, data: any[]): Promise<TableManager> {
        try {
            const newTable = await this.connection.createTable(tableName, data);
            const manager = new TableManager(this.context, newTable, tableName);
            this.tables.set(tableName, manager);
            return manager;
        } catch (error) {
            this.context.logger.error(`Failed to create table ${tableName}:`, error);
            throw error;
        }
    }

    async createEmptyTable(tableName: string, schema: any): Promise<TableManager> {
        try {
            const newTable = await this.connection.createEmptyTable(tableName, schema);
            const manager = new TableManager(this.context, newTable, tableName);
            this.tables.set(tableName, manager);
            return manager;
        } catch (error) {
            this.context.logger.error(`Failed to create empty table ${tableName}:`, error);
            throw error;
        }
    }

    async listTables(): Promise<TableInfo[]> {
        const names = await this.connection.tableNames();
        const tables: TableInfo[] = [];

        for (const name of names) {
            try {
                const manager = await this.getOrCreateTable(name);
                const indices = await manager.listIndices();
                tables.push({
                    name,
                    rowCount: await manager.countRows(),
                    schema: manager.schema(),
                    vectorDimension: this.config.vectorDimension || 0,
                    version: await manager.version(),
                    indices
                });
            } catch (error) {
                this.context.logger.error(`Failed to get info for table ${name}:`, error);
            }
        }

        return tables;
    }

    async getStats(): Promise<DatabaseStats> {
        const tables = await this.listTables();
        const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);

        return {
            tables,
            totalRows,
            uri: this.config.uri
        };
    }

    async cleanup(): Promise<void> {
        await this.connection.disconnect();
        this.tables.clear();
    }
}
