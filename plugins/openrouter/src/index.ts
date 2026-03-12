import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
import { OpenRouterComponents } from './components';
import { OpenRouterSkills } from './skills';
import {
    OpenRouterConfig,
    OpenResponsesRequest,
    OpenResponsesNonStreamingResponse,
    OpenResponsesStreamEvent,
    AnthropicMessagesRequest,
    AnthropicMessagesResponse,
    AnthropicMessagesStreamEvent,
    Model,
    ModelsListResponse,
    ModelsCountResponse,
    ListEndpointsResponse,
    PublicEndpoint,
    ActivityItem,
    CreateChargeRequest,
    EmbeddingsRequest,
    GenerationInfo,
    ApiKey,
    ApiKeyInfo,
    CreateApiKeyRequest,
    CreateApiKeyResponse,
    Guardrail,
    ExchangeAuthCodeRequest,
    ExchangeAuthCodeResponse,
    CreateAuthCodeRequest,
    ChatCompletionRequest,
    ChatResponse,
    ChatStreamingResponseChunk,
    Message,
    ToolDefinitionJson,
    ChatHistory,
    Provider,
    VisionAnalysisOptions,
    VisionAnalysisResult
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class OpenRouterPlugin implements Plugin {
    public metadata: PluginMetadata = {
        name: 'openrouter',
        version: '0.1.0',
        description: 'Complete OpenRouter API integration',
        author: 'TON AI Core Team',
        dependencies: []
    };

    private context!: PluginContext;
    private components!: OpenRouterComponents;
    private skills!: OpenRouterSkills;
    private config!: OpenRouterConfig;
    private initialized: boolean = false;
    private creditMonitorInterval?: NodeJS.Timeout;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        this.config = context.config as OpenRouterConfig;

        this.context.logger.info('Initializing OpenRouter plugin...');

        this.config = {
            apiKey: process.env.OPENROUTER_API_KEY || '',
            baseUrl: 'https://openrouter.ai/api/v1',
            defaultModel: 'arcee-ai/trinity-large-preview:free',
            appIdentifier: 'https://ton-ai.core',
            appDisplayName: 'TON AI Core',
            maxHistory: 100,
            monitorInterval: 60000,
            ...this.config
        };

        this.components = new OpenRouterComponents(this.context, this.config);
        this.skills = new OpenRouterSkills(this.context, this.components, this.config);

        if (this.config.apiKey) {
            await this.skills.waitForReady();
        }

        this.initialized = true;
        this.context.logger.info('OpenRouter plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.context.logger.info('OpenRouter plugin activated');

        this.startCreditMonitoring();

        this.skills.listModels().catch(error => {
            this.context.logger.debug('Failed to preload models:', error);
        });

        this.context.events.emit('openrouter:activated', {
            defaultModel: this.config.defaultModel,
            baseUrl: this.config.baseUrl
        });
    }

    async onDeactivate(): Promise<void> {
        this.context.logger.info('OpenRouter plugin deactivated');

        this.stopCreditMonitoring();
        this.context.events.emit('openrouter:deactivated');
    }

    async shutdown(): Promise<void> {
        this.context.logger.info('OpenRouter plugin shutting down...');

        this.stopCreditMonitoring();
        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        this.config = { ...this.config, ...newConfig } as OpenRouterConfig;
        this.context.logger.info('OpenRouter config updated');

        this.components.updateConfig(this.config);

        if (this.config.apiKey) {
            this.skills.setApiKey(this.config.apiKey);
        }

        if (newConfig.monitorInterval) {
            this.restartCreditMonitoring();
        }

        this.context.events.emit('openrouter:config:updated', this.config);
    }

    private startCreditMonitoring(): void {
        if (!this.config.monitorInterval || this.config.monitorInterval <= 0) {
            return;
        }

        if (this.creditMonitorInterval) return;

        this.creditMonitorInterval = setInterval(
            async () => {
                await this.monitorCredits();
            },
            this.config.monitorInterval
        );

        this.context.logger.info(`Credit monitoring started (interval: ${this.config.monitorInterval}ms)`);
    }

    private stopCreditMonitoring(): void {
        if (this.creditMonitorInterval) {
            clearInterval(this.creditMonitorInterval);
            this.creditMonitorInterval = undefined;
            this.context.logger.info('Credit monitoring stopped');
        }
    }

    private restartCreditMonitoring(): void {
        this.stopCreditMonitoring();
        this.startCreditMonitoring();
    }

    private async monitorCredits(): Promise<void> {
        try {
            const response = await this.skills.getCredits();
            const remaining = response.data.total_credits - response.data.total_usage;

            if (remaining < 1.0) {
                this.context.events.emit('openrouter:credits:low', {
                    remaining,
                    total: response.data.total_credits,
                    usage: response.data.total_usage
                });
                this.context.logger.warn(`Low credits: ${remaining.toFixed(2)} remaining`);
            }
        } catch (error) {
            this.context.logger.debug('Error monitoring credits:', error);
        }
    }

    async waitForReady(timeout?: number): Promise<void> {
        this.checkInitialized();
        return this.skills.waitForReady(timeout);
    }

    setApiKey(apiKey: string): void {
        this.checkInitialized();
        this.config.apiKey = apiKey;
        this.skills.setApiKey(apiKey);
        this.context.events.emit('openrouter:apiKey:updated');
    }

    async analyzeImage(imagePath: string, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
        this.checkInitialized();
        return this.skills.analyzeImage(imagePath, options);
    }

    async analyzeVideo(videoPath: string, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
        this.checkInitialized();
        return this.skills.analyzeVideo(videoPath, options);
    }

    async analyzeMedia(mediaPath: string, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
        this.checkInitialized();
        return this.skills.analyzeMedia(mediaPath, options);
    }

    async createResponse(
        request: OpenResponsesRequest,
        onStream?: (event: OpenResponsesStreamEvent) => void
    ): Promise<OpenResponsesNonStreamingResponse> {
        this.checkInitialized();
        return this.skills.createResponse(request, onStream);
    }

    getResponse(id: string): OpenResponsesNonStreamingResponse | undefined {
        this.checkInitialized();
        return this.components.responses.getResponse(id);
    }

    async createAnthropicMessage(
        request: AnthropicMessagesRequest,
        onStream?: (event: AnthropicMessagesStreamEvent) => void
    ): Promise<AnthropicMessagesResponse> {
        this.checkInitialized();
        return this.skills.createAnthropicMessage(request, onStream);
    }

    async listModels(params?: {
        category?: string;
        supported_parameters?: string;
    }): Promise<ModelsListResponse> {
        this.checkInitialized();
        return this.skills.listModels(params);
    }

    async listModelsForUser(): Promise<ModelsListResponse> {
        this.checkInitialized();
        return this.skills.listModelsForUser();
    }

    async getModelsCount(): Promise<ModelsCountResponse> {
        this.checkInitialized();
        return this.skills.getModelsCount();
    }

    async getModel(id: string): Promise<Model | null> {
        this.checkInitialized();

        const cached = this.components.models.getModel(id);
        if (cached) return cached;

        const response = await this.listModels();
        return response.data.find(m => m.id === id || m.canonical_slug === id) || null;
    }

    async listEndpoints(author: string, slug: string): Promise<{ data: ListEndpointsResponse }> {
        this.checkInitialized();
        return this.skills.listEndpoints(author, slug);
    }

    async listZdrEndpoints(): Promise<{ data: PublicEndpoint[] }> {
        this.checkInitialized();
        return this.skills.listZdrEndpoints();
    }

    async getUserActivity(date?: string): Promise<{ data: ActivityItem[] }> {
        this.checkInitialized();
        return this.skills.getUserActivity(date);
    }

    async getCredits(): Promise<{ data: { total_credits: number; total_usage: number } }> {
        this.checkInitialized();
        return this.skills.getCredits();
    }

    async createCoinbaseCharge(request: CreateChargeRequest): Promise<{ data: any }> {
        this.checkInitialized();
        return this.skills.createCoinbaseCharge(request);
    }

    async createEmbeddings(request: EmbeddingsRequest): Promise<any> {
        this.checkInitialized();
        return this.skills.createEmbeddings(request);
    }

    async listEmbeddingsModels(): Promise<ModelsListResponse> {
        this.checkInitialized();
        return this.skills.listEmbeddingsModels();
    }

    async getGeneration(id: string): Promise<{ data: GenerationInfo }> {
        this.checkInitialized();
        return this.skills.getGeneration(id);
    }

    async listApiKeys(params?: {
        include_disabled?: string;
        offset?: string;
    }): Promise<{ data: ApiKey[] }> {
        this.checkInitialized();
        return this.skills.listApiKeys(params);
    }

    async createApiKey(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
        this.checkInitialized();
        return this.skills.createApiKey(request);
    }

    async getApiKey(hash: string): Promise<{ data: ApiKey }> {
        this.checkInitialized();
        return this.skills.getApiKey(hash);
    }

    async updateApiKey(
        hash: string,
        request: {
            name?: string;
            disabled?: boolean;
            limit?: number | null;
            limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
            include_byok_in_limit?: boolean;
        }
    ): Promise<{ data: ApiKey }> {
        this.checkInitialized();
        return this.skills.updateApiKey(hash, request);
    }

    async deleteApiKey(hash: string): Promise<{ deleted: boolean }> {
        this.checkInitialized();
        return this.skills.deleteApiKey(hash);
    }

    async getCurrentKeyInfo(): Promise<{ data: ApiKeyInfo }> {
        this.checkInitialized();
        return this.skills.getCurrentKeyInfo();
    }

    async listGuardrails(params?: {
        offset?: string;
        limit?: string;
    }): Promise<{ data: Guardrail[]; total_count: number }> {
        this.checkInitialized();
        return this.skills.listGuardrails(params);
    }

    async createGuardrail(request: any): Promise<{ data: Guardrail }> {
        this.checkInitialized();
        return this.skills.createGuardrail(request);
    }

    async getGuardrail(id: string): Promise<{ data: Guardrail }> {
        this.checkInitialized();
        return this.skills.getGuardrail(id);
    }

    async updateGuardrail(id: string, request: any): Promise<{ data: Guardrail }> {
        this.checkInitialized();
        return this.skills.updateGuardrail(id, request);
    }

    async deleteGuardrail(id: string): Promise<{ deleted: boolean }> {
        this.checkInitialized();
        return this.skills.deleteGuardrail(id);
    }

    async listProviders(): Promise<{ data: Provider[] }> {
        this.checkInitialized();
        return this.skills.listProviders();
    }

    async exchangeAuthCodeForApiKey(
        request: ExchangeAuthCodeRequest
    ): Promise<ExchangeAuthCodeResponse> {
        this.checkInitialized();
        return this.skills.exchangeAuthCodeForApiKey(request);
    }

    async createAuthCode(request: CreateAuthCodeRequest): Promise<{ data: any }> {
        this.checkInitialized();
        return this.skills.createAuthCode(request);
    }

    async createChatCompletion(
        request: ChatCompletionRequest,
        onStream?: (chunk: ChatStreamingResponseChunk) => void
    ): Promise<ChatResponse> {
        this.checkInitialized();
        return this.skills.createChatCompletion(request, onStream);
    }

    async chat(
        messages: Message[],
        options: Partial<ChatCompletionRequest> = {}
    ): Promise<ChatResponse> {
        this.checkInitialized();

        const request: ChatCompletionRequest = {
            messages,
            model: options.model || this.config.defaultModel,
            temperature: options.temperature,
            top_p: options.top_p,
            max_tokens: options.max_tokens,
            tools: options.tools,
            tool_choice: options.tool_choice,
            response_format: options.response_format,
            reasoning: options.reasoning,
            stream: false,
            ...options
        };

        const response = await this.skills.createChatCompletion(request);

        if (response.choices && response.choices.length > 0) {
            const history: ChatHistory = {
                id: response.id,
                model: response.model,
                messages,
                response: response.choices[0].message,
                usage: response.usage,
                timestamp: Date.now()
            };
            this.components.history.addHistory(history);
        }

        this.context.events.emit('openrouter:chat:completed', {
            id: response.id,
            model: response.model,
            tokens: response.usage?.total_tokens
        });

        return response;
    }

    async chatWithTools(
        messages: Message[],
        tools: ToolDefinitionJson[],
        options: Partial<ChatCompletionRequest> = {}
    ): Promise<ChatResponse> {
        return this.chat(messages, {
            ...options,
            tools,
            tool_choice: 'auto',
            parallel_tool_calls: true
        });
    }

    async *chatStream(
        messages: Message[],
        options: Partial<ChatCompletionRequest> = {}
    ): AsyncGenerator<ChatStreamingResponseChunk, void, unknown> {
        this.checkInitialized();

        const request: ChatCompletionRequest = {
            messages,
            model: options.model || this.config.defaultModel,
            temperature: options.temperature,
            top_p: options.top_p,
            max_tokens: options.max_tokens,
            tools: options.tools,
            tool_choice: options.tool_choice,
            stream: true,
            stream_options: { include_usage: true },
            ...options
        };

        const streamId = `chat_stream_${Date.now()}`;
        const controller = this.components.streams.createStream(streamId);

        try {
            const generator = await this.skills.createChatCompletion(request, (chunk) => {
            });

            yield* [] as any;
        } finally {
            this.components.streams.cancelStream(streamId);
        }
    }

    cancelStream(streamId: string): boolean {
        this.checkInitialized();
        return this.components.streams.cancelStream(streamId);
    }

    getChatHistory(limit: number = 10): ChatHistory[] {
        this.checkInitialized();
        return this.components.history.getRecentHistories(limit);
    }

    getChatHistoryByModel(model: string, limit: number = 10): ChatHistory[] {
        this.checkInitialized();
        return this.components.history.getHistoriesByModel(model, limit);
    }

    getStats(): {
        total: number;
        totalTokens: number;
        models: Record<string, number>;
    } {
        this.checkInitialized();
        return this.components.history.getStats();
    }

    isReady(): boolean {
        return this.skills.isReady();
    }

    onResponseCompleted(callback: (response: OpenResponsesNonStreamingResponse) => void): void {
        this.context.events.on('openrouter:response:completed', callback);
    }

    offResponseCompleted(callback: (response: OpenResponsesNonStreamingResponse) => void): void {
        this.context.events.off('openrouter:response:completed', callback);
    }

    onChatCompleted(callback: (info: { id: string; model: string; tokens?: number }) => void): void {
        this.context.events.on('openrouter:chat:completed', callback);
    }

    offChatCompleted(callback: (info: { id: string; model: string; tokens?: number }) => void): void {
        this.context.events.off('openrouter:chat:completed', callback);
    }

    onCreditsLow(callback: (info: { remaining: number; total: number; usage: number }) => void): void {
        this.context.events.on('openrouter:credits:low', callback);
    }

    offCreditsLow(callback: (info: { remaining: number; total: number; usage: number }) => void): void {
        this.context.events.off('openrouter:credits:low', callback);
    }

    onApiKeyUpdated(callback: () => void): void {
        this.context.events.on('openrouter:apiKey:updated', callback);
    }

    offApiKeyUpdated(callback: () => void): void {
        this.context.events.off('openrouter:apiKey:updated', callback);
    }

    private checkInitialized(): void {
        if (!this.initialized) {
            throw new Error('Plugin not initialized. Call initialize() first.');
        }
    }
}
