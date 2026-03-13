import { BaseAgentSimple, SimpleAgentConfig, AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';
import { LanceDBPlugin } from '@ton-ai/lancedb';
import * as arrow from 'apache-arrow';
import { pipeline } from '@huggingface/transformers';

export interface LoggerConfig extends SimpleAgentConfig {
    lancedbUri?: string;
    defaultTable?: string;
    vectorDimension?: number;
    verbose?: boolean;
    embeddingModel?: string;
}

export interface LogEntry {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    timestamp: number;
    source?: string;
    metadata?: Record<string, any>;
}

export interface SearchResult {
    id: string;
    score: number;
    log: LogEntry;
}

export interface SearchOptions {
    limit?: number;
    filter?: string;
    distanceType?: 'l2' | 'cosine' | 'dot';
    prefilter?: boolean;
    postfilter?: boolean;
    refineFactor?: number;
    nprobes?: number;
    bypassVectorIndex?: boolean;
    fastSearch?: boolean;
}

export class LoggerAgent extends BaseAgentSimple {
    private agentConfig: LoggerConfig;
    private lancedb!: LanceDBPlugin;
    private logCounter: number = 0;
    private readonly LOG_TABLE = 'logs';
    private embedder: any = null;
    private embedderInitialized: boolean = false;

    constructor(config: LoggerConfig) {
        super(config);

        this.agentConfig = {
            lancedbUri: './lancedb-logs',
            defaultTable: 'logs',
            vectorDimension: 384,
            verbose: false,
            embeddingModel: 'Xenova/bge-small-en-v1.5',
            ...config
        };

        this.lancedb = new LanceDBPlugin();

        this.on(AGENT_EVENTS.INITIALIZED, () => {
            console.log('Logger agent initialized');
        });

        this.on(AGENT_EVENTS.STARTED, () => {
            console.log('Logger agent started');
        });

        this.on(AGENT_EVENTS.STOPPED, () => {
            console.log('Logger agent stopped');
        });

        this.on(AGENT_EVENTS.ERROR, (error) => {
            console.error('Logger agent error:', error);
        });

        this.on(PLUGIN_EVENTS.REGISTERED, ({ name }) => {
            console.log(`Plugin registered: ${name}`);
        });

        this.on(PLUGIN_EVENTS.ACTIVATED, ({ name }) => {
            console.log(`Plugin activated: ${name}`);
        });
    }

    private async initializeEmbedder(): Promise<void> {
        if (this.embedderInitialized) return;

        try {
            console.log(`Loading embedding model: ${this.agentConfig.embeddingModel}...`);
            this.embedder = await pipeline('feature-extraction', this.agentConfig.embeddingModel);
            this.embedderInitialized = true;
            console.log('Embedding model loaded successfully');
        } catch (error) {
            console.error('Failed to load embedding model:', error);
            throw error;
        }
    }

    async getEmbedding(text: string): Promise<number[]> {
        if (!this.embedderInitialized || !this.embedder) {
            await this.initializeEmbedder();
        }

        try {
            const result = await this.embedder(text, {
                pooling: 'mean',
                normalize: true
            });

            let embeddingArray: number[] = [];

            if (result && result.data) {
                if (Array.isArray(result.data)) {
                    embeddingArray = result.data as number[];
                } else if (result.data.buffer) {
                    embeddingArray = Array.from(result.data) as number[];
                }
            } else if (Array.isArray(result)) {
                embeddingArray = result as number[];
            } else if (result && typeof result === 'object') {
                const possibleArray = Object.values(result).find(val => Array.isArray(val));
                if (possibleArray) {
                    embeddingArray = possibleArray as number[];
                }
            }

            if (embeddingArray.length === 0) {
                console.warn('Could not extract embedding from result, using zero vector');
                return new Array(this.agentConfig.vectorDimension!).fill(0);
            }

            const targetDim = this.agentConfig.vectorDimension || 384;

            if (embeddingArray.length > targetDim) {
                return embeddingArray.slice(0, targetDim);
            } else if (embeddingArray.length < targetDim) {
                const padded = new Array(targetDim).fill(0);
                for (let i = 0; i < embeddingArray.length; i++) {
                    padded[i] = embeddingArray[i];
                }
                return padded;
            }
            return embeddingArray;
        } catch (error) {
            console.error('Error generating embedding:', error);
            return new Array(this.agentConfig.vectorDimension!).fill(0);
        }
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Logger Agent...');

        try {
            await this.initializeEmbedder();

            const pluginContext = {
                events: this,
                logger: {
                    info: (message: string, ...args: any[]) =>
                        this.agentConfig.verbose ? console.log(`[INFO] ${message}`, ...args) : null,
                    error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
                    warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
                    debug: (message: string, ...args: any[]) =>
                        this.agentConfig.verbose ? console.debug(`[DEBUG] ${message}`, ...args) : null
                },
                config: {
                    uri: this.agentConfig.lancedbUri,
                    vectorDimension: this.agentConfig.vectorDimension,
                    defaultTableName: this.agentConfig.defaultTable
                }
            };

            console.log('Initializing LanceDB plugin...');
            await this.lancedb.initialize(pluginContext as any);
            await this.registerPlugin(this.lancedb as any, {
                uri: this.agentConfig.lancedbUri,
                vectorDimension: this.agentConfig.vectorDimension,
                defaultTableName: this.agentConfig.defaultTable
            });

            await this.lancedb.onActivate();

            const embedderInterface = {
                embed: async (text: string) => this.getEmbedding(text),
                embedBatch: async (texts: string[]) => {
                    const embeddings: number[][] = [];
                    for (const text of texts) {
                        embeddings.push(await this.getEmbedding(text));
                    }
                    return embeddings;
                }
            };

            this.lancedb.setExternalEmbedder(embedderInterface);
            console.log('External embedder set in plugin');

            await this.ensureLogTable();

            try {
                const tables = await this.lancedb.listTables();
                if (tables.includes(this.LOG_TABLE)) {
                    const indices = await this.lancedb.listIndices(this.LOG_TABLE);
                    const hasFtsIndex = indices.some((idx: any) => idx.indexType === 'fts');

                    if (!hasFtsIndex) {
                        console.log('Creating FTS index on message column...');
                        await this.lancedb.createFTSIndex(this.LOG_TABLE, 'message', {
                            language: 'English',
                            stem: true,
                            removeStopWords: true,
                            asciiFolding: true
                        });
                        console.log('FTS index created successfully');
                    } else {
                        console.log('FTS index already exists');
                    }
                }
            } catch (error) {
                console.warn('Could not create FTS index:', error);
            }

            console.log('Logger Agent initialized');
            console.log(`Log table: ${this.LOG_TABLE}`);
            console.log(`Vector dimension: ${this.agentConfig.vectorDimension}`);
            console.log(`Embedding model: ${this.agentConfig.embeddingModel}`);

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        console.log('Logger Agent is running');
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping Logger Agent...');
        console.log(`Total logs processed: ${this.logCounter}`);
        await this.lancedb.onDeactivate();
        await this.lancedb.shutdown();
    }

    private async ensureLogTable(): Promise<void> {
        const tables = await this.lancedb.listTables();
        if (tables.includes(this.LOG_TABLE)) {
            console.log('Recreating log table with correct schema...');
            await this.lancedb.dropTable(this.LOG_TABLE);
        }

        const schema = new arrow.Schema([
            new arrow.Field('id', new arrow.Int32()),
            new arrow.Field('level', new arrow.Utf8()),
            new arrow.Field('message', new arrow.Utf8()),
            new arrow.Field('timestamp', new arrow.Int64()),
            new arrow.Field('source', new arrow.Utf8()),
            new arrow.Field('metadata', new arrow.Utf8()),
            new arrow.Field('vector', new arrow.FixedSizeList(this.agentConfig.vectorDimension!, new arrow.Field('item', new arrow.Float32())))
        ]);

        await this.lancedb.createEmptyTable(this.LOG_TABLE, schema);
        console.log(`Created log table: ${this.LOG_TABLE} with vector column (${this.agentConfig.vectorDimension} dimensions)`);

        this.logCounter = 0;
    }

    async log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
        const logEntry: LogEntry = {
            ...entry,
            timestamp: Date.now()
        };

        this.logCounter++;

        const metadataStr = entry.metadata ? JSON.stringify(entry.metadata) : '';

        const textToEmbed = `${entry.level} ${entry.message} ${entry.source || ''}`;
        const vector = await this.lancedb.getExternalEmbedding(textToEmbed);

        await this.lancedb.addToTable(this.LOG_TABLE, [{
            id: this.logCounter,
            level: entry.level,
            message: entry.message,
            timestamp: logEntry.timestamp,
            source: entry.source || 'unknown',
            metadata: metadataStr,
            vector
        }]);

        const levelColors = {
            info: '\x1b[32m',
            warn: '\x1b[33m',
            error: '\x1b[31m',
            debug: '\x1b[36m'
        };
        const reset = '\x1b[0m';

        console.log(
            `${levelColors[entry.level]}[${entry.level.toUpperCase()}]${reset} ${entry.message}` +
            (entry.source ? ` \x1b[90m(${entry.source})${reset}` : '')
        );
    }

    async info(message: string, source?: string, metadata?: Record<string, any>): Promise<void> {
        await this.log({ level: 'info', message, source, metadata });
    }

    async warn(message: string, source?: string, metadata?: Record<string, any>): Promise<void> {
        await this.log({ level: 'warn', message, source, metadata });
    }

    async error(message: string, source?: string, metadata?: Record<string, any>): Promise<void> {
        await this.log({ level: 'error', message, source, metadata });
    }

    async debug(message: string, source?: string, metadata?: Record<string, any>): Promise<void> {
        await this.log({ level: 'debug', message, source, metadata });
    }

    async vectorSearch(query: string, options?: SearchOptions): Promise<SearchResult[]> {
        const queryVector = await this.lancedb.getExternalEmbedding(query);
        const results = await this.lancedb.searchInTable(this.LOG_TABLE, queryVector, options);

        return results.map(r => ({
            id: String(r.id),
            score: r.score,
            log: {
                level: r.level as any,
                message: r.message,
                timestamp: Number(r.timestamp),
                source: r.source,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined
            }
        }));
    }

    async fullTextSearch(query: string, limit: number = 10): Promise<LogEntry[]> {
        try {
            const results = await this.lancedb.textSearch(this.LOG_TABLE, query, { limit });

            return results.map((r: any) => ({
                level: r.level,
                message: r.message,
                timestamp: Number(r.timestamp),
                source: r.source,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined
            }));
        } catch (error) {
            console.warn('FTS search failed, using vector search as fallback:', error);
            const vectorResults = await this.vectorSearch(query, { limit });
            return vectorResults.map(r => r.log);
        }
    }

    async hybridSearch(query: string, options?: SearchOptions): Promise<SearchResult[]> {
        try {
            const queryVector = await this.lancedb.getExternalEmbedding(query);

            const results = await this.lancedb.hybridSearch(this.LOG_TABLE, queryVector, query, {
                ...options,
                distanceType: 'cosine',
                columns: ['id', 'level', 'message', 'timestamp', 'source', 'metadata']
            });

            return results.map(r => ({
                id: String(r.id),
                score: r.score,
                log: {
                    level: r.level as any,
                    message: r.message,
                    timestamp: Number(r.timestamp),
                    source: r.source,
                    metadata: r.metadata ? JSON.parse(r.metadata) : undefined
                }
            }));
        } catch (error) {
            console.warn('Hybrid search failed, using vector search as fallback:', error);
            return this.vectorSearch(query, options);
        }
    }

    async searchByLevel(level: LogEntry['level'], limit: number = 10): Promise<SearchResult[]> {
        const results = await this.lancedb.queryTable(this.LOG_TABLE, {
            filter: `level = '${level}'`,
            limit
        });

        return results.map((r: any) => ({
            id: String(r.id),
            score: 1.0,
            log: {
                level: r.level,
                message: r.message,
                timestamp: Number(r.timestamp),
                source: r.source,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined
            }
        }));
    }

    async searchBySource(source: string, limit: number = 10): Promise<SearchResult[]> {
        const results = await this.lancedb.queryTable(this.LOG_TABLE, {
            filter: `source = '${source}'`,
            limit
        });

        return results.map((r: any) => ({
            id: String(r.id),
            score: 1.0,
            log: {
                level: r.level,
                message: r.message,
                timestamp: Number(r.timestamp),
                source: r.source,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined
            }
        }));
    }

    async searchByTimeRange(startTime: number, endTime: number, limit: number = 100): Promise<SearchResult[]> {
        const results = await this.lancedb.queryTable(this.LOG_TABLE, {
            filter: `timestamp >= ${startTime} AND timestamp <= ${endTime}`,
            limit
        });

        return results.map((r: any) => ({
            id: String(r.id),
            score: 1.0,
            log: {
                level: r.level,
                message: r.message,
                timestamp: Number(r.timestamp),
                source: r.source,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined
            }
        }));
    }

    async getRecentLogs(limit: number = 50): Promise<LogEntry[]> {
        const results = await this.lancedb.queryTable(this.LOG_TABLE, { limit });
        return results.map((r: any) => ({
            level: r.level,
            message: r.message,
            timestamp: Number(r.timestamp),
            source: r.source,
            metadata: r.metadata ? JSON.parse(r.metadata) : undefined
        })).sort((a, b) => b.timestamp - a.timestamp);
    }

    async getStats(): Promise<{
        totalLogs: number;
        byLevel: Record<string, number>;
        bySource: Record<string, number>;
    }> {
        const allLogs = await this.lancedb.queryTable(this.LOG_TABLE);

        const stats = {
            totalLogs: allLogs.length,
            byLevel: {} as Record<string, number>,
            bySource: {} as Record<string, number>
        };

        for (const log of allLogs) {
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            stats.bySource[log.source] = (stats.bySource[log.source] || 0) + 1;
        }

        return stats;
    }

    async deleteOldLogs(olderThan: number): Promise<number> {
        const cutoff = Date.now() - olderThan;
        const logs = await this.lancedb.queryTable(this.LOG_TABLE, {
            filter: `timestamp < ${cutoff}`
        });

        for (const log of logs) {
            await this.lancedb.deleteFromTable(this.LOG_TABLE, `id = ${log.id}`);
        }

        return logs.length;
    }

    async clearAllLogs(): Promise<void> {
        await this.lancedb.dropTable(this.LOG_TABLE);
        await this.ensureLogTable();
        this.logCounter = 0;
        console.log('All logs cleared');
    }
}
