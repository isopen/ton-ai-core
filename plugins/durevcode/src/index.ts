import { BasePlugin } from '@ton-ai/core';
import { DurevcodeComponents } from './components';
import { AgentToolSpec, DurevcodeSkills } from './skills';
import { DurevAnalyzeParams, DurevcodeConfig, DurevDiffStat, DurevReview } from './types';
import { FREE_MODELS } from './components';

export * from './components';
export * from './skills';
export * from './types';

export class DurevcodePlugin extends BasePlugin<DurevcodeConfig> {
    readonly metadata = {
        name: 'durevcode',
        version: '0.1.0',
        description: 'durev-core engine binding for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: DurevcodeComponents;
    private skills!: DurevcodeSkills;

    protected async onInit() {
        this.logger.info('Initializing durevcode plugin...');
        this.components = new DurevcodeComponents(this.context);
        this.skills = new DurevcodeSkills(this.context, this.components, this.config);
        this.skills.markReady();
        this.logger.info('durevcode plugin initialized');
    }

    async onActivate() {
        this.logger.info('durevcode plugin activated');
        this.events.emit('durevcode:ready');
    }

    async onDeactivate() {
        this.logger.info('durevcode plugin deactivated');
        this.components.cleanup();
        this.events.emit('durevcode:deactivated');
    }

    async shutdown() {
        this.logger.info('durevcode plugin shutting down...');
        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('durevcode config updated');
        this.skills.updateConfig(this.config);
        this.events.emit('durevcode:config:updated');
    }

    async analyze(params: DurevAnalyzeParams): Promise<DurevDiffStat> {
        this.checkInitialized();
        return this.skills.analyze(params);
    }

    async review(params: DurevAnalyzeParams): Promise<DurevReview> {
        this.checkInitialized();
        return this.skills.review(params);
    }

    async chat(messages: Array<{ role: string; content: string }>, opts?: { model?: string; maxTokens?: number; apiKey?: string; userId?: string; tools?: AgentToolSpec[]; signal?: AbortSignal }): Promise<string> {
        this.checkInitialized();
        return this.skills.chat(messages, opts);
    }

    resolveModel() {
        this.checkInitialized();
        return this.skills.resolveModel();
    }

    chatUrl(): string {
        this.checkInitialized();
        return this.skills.chatUrl();
    }

    listFreeModels() {
        return FREE_MODELS;
    }

    async createSession(directory: string, model?: string) {
        this.checkInitialized();
        return this.skills.createSession(directory, model);
    }

    async listSessions() {
        this.checkInitialized();
        return this.skills.listSessions();
    }

    async appendEvent(session: string, kind: string, text: string) {
        this.checkInitialized();
        return this.skills.appendEvent(session, kind, text);
    }

    async readEvents(session: string, limit = 0) {
        this.checkInitialized();
        return this.skills.readEvents(session, limit);
    }

    async requestPermission(session: string, action: string, resource: string) {
        this.checkInitialized();
        return this.skills.requestPermission(session, action, resource);
    }

    async listPermissions(session: string) {
        this.checkInitialized();
        return this.skills.listPermissions(session);
    }

    async replyPermission(session: string, id: string, decision: 'once' | 'deny') {
        this.checkInitialized();
        return this.skills.replyPermission(session, id, decision);
    }

    async askQuestion(session: string, question: string, options: string[], multiple = false) {
        this.checkInitialized();
        return this.skills.askQuestion(session, question, options, multiple);
    }

    async listQuestions(session: string) {
        this.checkInitialized();
        return this.skills.listQuestions(session);
    }

    async replyQuestion(session: string, id: string, answers: string[][]) {
        this.checkInitialized();
        return this.skills.replyQuestion(session, id, answers);
    }

    async putTodos(session: string, contents: string[]) {
        this.checkInitialized();
        return this.skills.putTodos(session, contents);
    }

    async readTodos(session: string) {
        this.checkInitialized();
        return this.skills.readTodos(session);
    }

    async completeTodo(session: string, position: number) {
        this.checkInitialized();
        return this.skills.completeTodo(session, position);
    }

    async runToolLocal(root: string, kind: 'read' | 'write', args: string[]) {
        this.checkInitialized();
        return this.skills.runToolLocal(root, kind, args);
    }

    async runGatedTool(root: string, session: string, permId: string, tool: string, args: string[]) {
        this.checkInitialized();
        return this.skills.runGatedTool(root, session, permId, tool, args);
    }

    runAgent(session: string, prompt: string, opts: { model?: string; userId?: string; root: string; tools?: string[]; maxTurns?: number; approvalTimeoutMs?: number }) {
        this.checkInitialized();
        return this.skills.runAgent(session, prompt, opts);
    }

    interrupt(session: string): boolean {
        this.checkInitialized();
        return this.skills.interrupt(session);
    }

    agentBusy(session: string): boolean {
        this.checkInitialized();
        return this.skills.agentBusy(session);
    }

    getAgentContext(session: string) {
        this.checkInitialized();
        return this.skills.getAgentContext(session);
    }

    lastAnsweredModel(): string | null {
        this.checkInitialized();
        return this.skills.lastAnsweredModel();
    }

    hasUserKey(userId: string, provider: string): boolean {
        this.checkInitialized();
        return this.skills.hasUserKey(userId, provider);
    }

    async saveUserKey(userId: string, provider: string, key: string): Promise<boolean> {
        this.checkInitialized();
        return this.skills.saveUserKey(userId, provider, key);
    }

    getMetrics() {
        this.checkInitialized();
        return this.skills.getMetrics();
    }

    resetMetrics(): void {
        this.checkInitialized();
        this.skills.resetMetrics();
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }
}
