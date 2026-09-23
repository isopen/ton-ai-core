import { BasePlugin } from '@ton-ai/core';
import { OpencodeSkills } from './skills';
import { SpawnedProcess } from './serve';
import { ContextSnapshot, OpencodeConfig, OpencodeServerEvent, PermissionDecision, PermissionRequest, PromptReceipt, QuestionRequest, RadarEvent, SessionEvent, SessionRow, TodoRow } from './types';

export * from './types';
export * from './skills';
export * from './projector';
export * from './store';
export * from './serve';

export class OpencodePlugin extends BasePlugin<OpencodeConfig> {
    readonly metadata = {
        name: 'opencode',
        version: '0.1.0',
        description: 'Local opencode server integration (sessions, messages, todos)',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private skills!: OpencodeSkills;

    protected defaults(): Partial<OpencodeConfig> {
        return {
            baseUrl: process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096',
            timeoutMs: 10000,
            maxRetries: 2,
            dbPath: process.env.OPENCODE_DB_PATH || '',
            autoServe: process.env.OPENCODE_AUTO_SERVE !== '0',
            binPath: process.env.OPENCODE_BIN || 'opencode',
        };
    }

    protected async onInit() {
        this.logger.info('Initializing opencode plugin...');
        this.skills = new OpencodeSkills(this.context, this.config);
        this.logger.info('opencode plugin initialized');
    }

    async onActivate() {
        this.logger.info('opencode plugin activated');
        const reachable = await this.skills.ensureServer();
        if (reachable) {
            this.logger.info(`opencode server reachable at ${this.config.baseUrl}`);
        } else {
            this.logger.warn('opencode server unavailable, session control is degraded');
        }
        this.events.emit('opencode:activated', { baseUrl: this.config.baseUrl, managed: this.skills.ownsManagedServer() });
    }

    async onDeactivate() {
        this.logger.info('opencode plugin deactivated');
        this.skills.close();
        this.events.emit('opencode:deactivated');
    }

    async shutdown() {
        this.logger.info('opencode plugin shutting down...');
        this.skills.close();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('opencode config updated');
        this.skills.configure(this.config);
        this.events.emit('opencode:config:updated');
    }

    async waitForReady(timeout?: number): Promise<void> {
        this.checkInitialized();
        return this.skills.waitForReady(timeout);
    }

    isReady(): boolean {
        return this.skills.isReady();
    }

    setBaseUrl(baseUrl: string): void {
        this.checkInitialized();
        this.config.baseUrl = baseUrl;
        this.skills.setBaseUrl(baseUrl);
        this.events.emit('opencode:base-url:updated');
    }

    async health(): Promise<boolean> {
        this.checkInitialized();
        return this.skills.health();
    }

    async ensureServer(): Promise<boolean> {
        this.checkInitialized();
        return this.skills.ensureServer();
    }

    async listSessions(directory?: string, limit?: number): Promise<SessionRow[]> {
        this.checkInitialized();
        return this.skills.listSessions(directory, limit);
    }

    async getSession(sessionId: string): Promise<SessionRow | null> {
        this.checkInitialized();
        return this.skills.getSession(sessionId);
    }

    async readEvents(sessionId: string, limit?: number): Promise<SessionEvent[]> {
        this.checkInitialized();
        return this.skills.readEvents(sessionId, limit);
    }

    async readTodos(sessionId: string): Promise<TodoRow[]> {
        this.checkInitialized();
        return this.skills.readTodos(sessionId);
    }

    async readContextSnapshot(sessionId: string): Promise<ContextSnapshot | null> {
        this.checkInitialized();
        return this.skills.readContextSnapshot(sessionId);
    }

    async getModelLimit(modelId: string): Promise<number | null> {
        this.checkInitialized();
        return this.skills.getModelLimit(modelId);
    }

    async sendPrompt(sessionId: string, text: string): Promise<PromptReceipt> {
        this.checkInitialized();
        return this.skills.sendPrompt(sessionId, text);
    }

    async interruptSession(sessionId: string): Promise<boolean> {
        this.checkInitialized();
        return this.skills.interruptSession(sessionId);
    }

    subscribeEvents(handler: (event: OpencodeServerEvent) => void): () => void {
        this.checkInitialized();
        return this.skills.subscribeEvents(handler);
    }

    async hasMessage(sessionId: string, messageId: string): Promise<boolean> {
        this.checkInitialized();
        return this.skills.hasMessage(sessionId, messageId);
    }

    spawnRun(sessionId: string, text: string): SpawnedProcess {
        this.checkInitialized();
        return this.skills.spawnRun(sessionId, text);
    }

    async createSession(directory: string): Promise<SessionRow> {
        this.checkInitialized();
        return this.skills.createSession(directory);
    }

    async listPermissions(sessionId: string): Promise<PermissionRequest[]> {
        this.checkInitialized();
        return this.skills.listPermissions(sessionId);
    }

    async replyPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<boolean> {
        this.checkInitialized();
        return this.skills.replyPermission(sessionId, requestId, decision);
    }

    async listQuestions(sessionId: string): Promise<QuestionRequest[]> {
        this.checkInitialized();
        return this.skills.listQuestions(sessionId);
    }

    async replyQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<boolean> {
        this.checkInitialized();
        return this.skills.replyQuestion(sessionId, requestId, answers);
    }

    async renameSession(sessionId: string, title: string): Promise<boolean> {
        this.checkInitialized();
        return this.skills.renameSession(sessionId, title);
    }
}
