import { PluginContext } from '@ton-ai/core';
import { OpenRouterComponents } from './components';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import {
    OpenResponsesRequest,
    OpenResponsesNonStreamingResponse,
    OpenResponsesStreamEvent,
    AnthropicMessagesRequest,
    AnthropicMessagesResponse,
    AnthropicMessagesStreamEvent,
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
    OpenRouterConfig,
    Provider,
    VisionAnalysisOptions,
    VisionAnalysisResult,
    Message
} from './types';

export class OpenRouterSkills {
    private context: PluginContext;
    private components: OpenRouterComponents;
    private baseUrl: string;
    private apiKey: string;
    private appIdentifier: string;
    private appDisplayName: string;

    constructor(
        context: PluginContext,
        components: OpenRouterComponents,
        config: OpenRouterConfig
    ) {
        this.context = context;
        this.components = components;
        this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
        this.apiKey = config.apiKey || '';
        this.appIdentifier = config.appIdentifier || 'https://ton-ai.core';
        this.appDisplayName = config.appDisplayName || 'TON AI Core';

        this.components.apiKeys.setCurrentKey(this.apiKey);
    }

    isReady(): boolean {
        return !!this.apiKey;
    }

    async waitForReady(timeout: number = 10000): Promise<void> {
        if (this.isReady()) return;

        const start = Date.now();
        while (!this.isReady()) {
            if (Date.now() - start > timeout) {
                throw new Error('OpenRouter plugin not ready: API key not configured');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.components.apiKeys.setCurrentKey(apiKey);
    }

    private getHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.appIdentifier,
            'X-Title': this.appDisplayName,
            ...additionalHeaders
        };
        return headers;
    }

    private async downloadFile(url: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: ${response.statusCode}`));
                    return;
                }

                const chunks: Buffer[] = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            }).on('error', reject);
        });
    }

    private async readMediaFile(mediaPath: string): Promise<{ buffer: Buffer; mimeType: string }> {
        let buffer: Buffer;

        if (mediaPath.startsWith('http://') || mediaPath.startsWith('https://')) {
            buffer = await this.downloadFile(mediaPath);
        } else {
            const resolvedPath = path.resolve(mediaPath);
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`File not found: ${resolvedPath}`);
            }
            buffer = fs.readFileSync(resolvedPath);
        }

        const ext = path.extname(mediaPath).toLowerCase();
        let mimeType: string;

        if (mediaPath.startsWith('http')) {
            if (mediaPath.match(/\.(jpg|jpeg)/i)) mimeType = 'image/jpeg';
            else if (mediaPath.match(/\.png/i)) mimeType = 'image/png';
            else if (mediaPath.match(/\.gif/i)) mimeType = 'image/gif';
            else if (mediaPath.match(/\.webp/i)) mimeType = 'image/webp';
            else if (mediaPath.match(/\.mp4/i)) mimeType = 'video/mp4';
            else if (mediaPath.match(/\.webm/i)) mimeType = 'video/webm';
            else if (mediaPath.match(/\.mov/i)) mimeType = 'video/quicktime';
            else if (mediaPath.match(/\.avi/i)) mimeType = 'video/x-msvideo';
            else mimeType = 'application/octet-stream';
        } else {
            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.mov': 'video/quicktime',
                '.avi': 'video/x-msvideo'
            };
            mimeType = mimeTypes[ext] || 'application/octet-stream';
        }

        return { buffer, mimeType };
    }

    async analyzeImage(imagePath: string, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
        const startTime = Date.now();

        try {
            const { buffer, mimeType } = await this.readMediaFile(imagePath);
            const base64Image = buffer.toString('base64');

            const prompt = options?.prompt || 'Analyze this image in detail. Describe what you see, including objects, people, text, colors, composition, and any notable elements.';

            const messages = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`
                            }
                        },
                        {
                            type: 'text',
                            text: prompt
                        }
                    ]
                }
            ];

            const response = await this.request<ChatResponse>('POST', '/chat/completions', {
                model: options?.model || 'nvidia/nemotron-nano-12b-v2-vl:free',
                messages: messages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens
            });

            const processingTime = Date.now() - startTime;
            const content = response.choices[0]?.message?.content;

            return {
                analysis: typeof content === 'string' ? content : JSON.stringify(content),
                model: response.model,
                usage: response.usage,
                processingTime
            };

        } catch (error) {
            throw new Error(`Image analysis failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async analyzeVideo(videoPath: string, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
        const startTime = Date.now();

        try {
            const { buffer, mimeType } = await this.readMediaFile(videoPath);

            if (buffer.length > 10 * 1024 * 1024) {
                this.context.logger.warn('Video file is large (>10MB). Processing may be slow.');
            }

            const base64Video = buffer.toString('base64');

            const prompt = options?.prompt || 'Analyze this video. Describe what is happening, including actions, people, objects, scenes, and any notable elements.';

            const messages = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'video_url',
                            video_url: {
                                url: `data:${mimeType};base64,${base64Video}`
                            }
                        },
                        {
                            type: 'text',
                            text: prompt
                        }
                    ]
                }
            ];

            const response = await this.request<ChatResponse>('POST', '/chat/completions', {
                model: options?.model || 'nvidia/nemotron-nano-12b-v2-vl:free',
                messages: messages,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens
            });

            const processingTime = Date.now() - startTime;
            const content = response.choices[0]?.message?.content;

            return {
                analysis: typeof content === 'string' ? content : JSON.stringify(content),
                model: response.model,
                usage: response.usage,
                processingTime
            };

        } catch (error) {
            throw new Error(`Video analysis failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async analyzeMedia(mediaPath: string, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
        const isVideo = mediaPath.match(/\.(mp4|webm|mov|avi)$/i) ||
            (mediaPath.startsWith('http') && mediaPath.match(/\.(mp4|webm|mov|avi)/i));

        if (isVideo) {
            return this.analyzeVideo(mediaPath, options);
        } else {
            return this.analyzeImage(mediaPath, options);
        }
    }

    private async request<T>(
        method: string,
        endpoint: string,
        body?: any,
        options?: { signal?: AbortSignal; headers?: Record<string, string> }
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = this.getHeaders(options?.headers);

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: options?.signal
            });

            if (!response.ok) {
                await this.handleErrorResponse(response);
            }

            if (response.status === 204) {
                return {} as T;
            }

            return await response.json() as T;
        } catch (error) {
            this.context.logger.error(`OpenRouter API error (${method} ${endpoint}):`, error);
            throw error;
        }
    }

    private async handleErrorResponse(response: Response): Promise<never> {
        let errorData: any;
        try {
            errorData = await response.json();
        } catch {
            errorData = { error: { message: response.statusText } };
        }

        const error = errorData.error || {};
        const message = error.message || `HTTP error ${response.status}`;

        switch (response.status) {
            case 400:
                throw new Error(`Bad Request: ${message}`);
            case 401:
                throw new Error(`Unauthorized: ${message}`);
            case 402:
                throw new Error(`Payment Required: ${message}`);
            case 403:
                throw new Error(`Forbidden: ${message}`);
            case 404:
                throw new Error(`Not Found: ${message}`);
            case 408:
                throw new Error(`Request Timeout: ${message}`);
            case 413:
                throw new Error(`Payload Too Large: ${message}`);
            case 422:
                throw new Error(`Unprocessable Entity: ${message}`);
            case 429:
                throw new Error(`Too Many Requests: ${message}`);
            case 500:
                throw new Error(`Internal Server Error: ${message}`);
            case 502:
                throw new Error(`Bad Gateway: ${message}`);
            case 503:
                throw new Error(`Service Unavailable: ${message}`);
            case 524:
                throw new Error(`Edge Network Timeout: ${message}`);
            case 529:
                throw new Error(`Provider Overloaded: ${message}`);
            default:
                throw new Error(`OpenRouter API error (${response.status}): ${message}`);
        }
    }

    private async *streamRequest<T>(
        method: string,
        endpoint: string,
        body?: any,
        signal?: AbortSignal
    ): AsyncGenerator<T, void, unknown> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = this.getHeaders();

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal
        });

        if (!response.ok) {
            await this.handleErrorResponse(response);
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data) as T;
                            yield parsed;
                        } catch (e) {
                            this.context.logger.debug('Failed to parse stream data:', data);
                        }
                    } else if (line.startsWith('event: ')) {
                        const event = line.slice(7);
                        const nextLine = lines[lines.indexOf(line) + 1];
                        if (nextLine?.startsWith('data: ')) {
                            const data = nextLine.slice(6);
                            try {
                                const parsed = JSON.parse(data) as T;
                                yield parsed;
                            } catch (e) {
                                this.context.logger.debug('Failed to parse event stream data:', data);
                            }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    async createResponse(
        request: OpenResponsesRequest,
        onStream?: (event: OpenResponsesStreamEvent) => void
    ): Promise<OpenResponsesNonStreamingResponse> {
        this.context.logger.info('Creating response...');

        const isStream = request.stream === true && !!onStream;

        if (isStream) {
            const streamId = `resp_${Date.now()}`;
            const controller = this.components.streams.createStream(streamId);

            try {
                const generator = this.streamRequest<OpenResponsesStreamEvent>(
                    'POST',
                    '/responses',
                    request,
                    controller.signal
                );

                let finalResponse: OpenResponsesNonStreamingResponse | null = null;

                for await (const event of generator) {
                    onStream(event);

                    if (event.type === 'response.completed' || event.type === 'response.failed') {
                        finalResponse = event.response as OpenResponsesNonStreamingResponse;
                    }
                }

                if (finalResponse) {
                    this.components.responses.setResponse(finalResponse.id, finalResponse);
                    this.context.events.emit('openrouter:response:completed', finalResponse);
                    return finalResponse;
                }

                throw new Error('Stream ended without completion event');
            } catch (error) {
                this.components.streams.cancelStream(streamId);
                throw error;
            } finally {
                this.components.streams.cancelStream(streamId);
            }
        } else {
            const response = await this.request<OpenResponsesNonStreamingResponse>(
                'POST',
                '/responses',
                request
            );

            this.components.responses.setResponse(response.id, response);
            this.context.events.emit('openrouter:response:created', response);

            return response;
        }
    }

    async createAnthropicMessage(
        request: AnthropicMessagesRequest,
        onStream?: (event: AnthropicMessagesStreamEvent) => void
    ): Promise<AnthropicMessagesResponse> {
        this.context.logger.info('Creating Anthropic message...');

        const isStream = request.stream === true && !!onStream;

        if (isStream) {
            const streamId = `anth_${Date.now()}`;
            const controller = this.components.streams.createStream(streamId);

            try {
                const generator = this.streamRequest<AnthropicMessagesStreamEvent>(
                    'POST',
                    '/messages',
                    request,
                    controller.signal
                );

                for await (const event of generator) {
                    onStream(event);
                }

                throw new Error('Stream handling for Anthropic messages needs full implementation');
            } catch (error) {
                this.components.streams.cancelStream(streamId);
                throw error;
            } finally {
                this.components.streams.cancelStream(streamId);
            }
        } else {
            const response = await this.request<AnthropicMessagesResponse>(
                'POST',
                '/messages',
                request
            );

            this.components.responses.setAnthropicResponse(response.id, response);

            return response;
        }
    }

    async listModels(
        params?: {
            category?: string;
            supported_parameters?: string;
        }
    ): Promise<ModelsListResponse> {
        this.context.logger.info('Fetching models...');

        let endpoint = '/models';
        if (params) {
            const query = new URLSearchParams();
            if (params.category) query.append('category', params.category);
            if (params.supported_parameters) query.append('supported_parameters', params.supported_parameters);
            endpoint += `?${query.toString()}`;
        }

        const response = await this.request<ModelsListResponse>('GET', endpoint);

        this.components.models.setModels(response.data);

        return response;
    }

    async listModelsForUser(): Promise<ModelsListResponse> {
        this.context.logger.info('Fetching models for user...');

        const response = await this.request<ModelsListResponse>('GET', '/models/user');

        return response;
    }

    async getModelsCount(): Promise<ModelsCountResponse> {
        this.context.logger.info('Fetching models count...');

        return this.request<ModelsCountResponse>('GET', '/models/count');
    }

    async listEndpoints(author: string, slug: string): Promise<{ data: ListEndpointsResponse }> {
        this.context.logger.info(`Fetching endpoints for ${author}/${slug}...`);

        return this.request<{ data: ListEndpointsResponse }>(
            'GET',
            `/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`
        );
    }

    async listZdrEndpoints(): Promise<{ data: PublicEndpoint[] }> {
        this.context.logger.info('Fetching ZDR endpoints...');

        return this.request<{ data: PublicEndpoint[] }>('GET', '/endpoints/zdr');
    }

    async getUserActivity(date?: string): Promise<{ data: ActivityItem[] }> {
        this.context.logger.info(`Fetching user activity${date ? ` for ${date}` : ''}...`);

        const endpoint = date ? `/activity?date=${date}` : '/activity';

        const response = await this.request<{ data: ActivityItem[] }>('GET', endpoint);

        if (date) {
            this.components.activities.setActivities(date, response.data);
        }

        return response;
    }

    async getCredits(): Promise<{ data: { total_credits: number; total_usage: number } }> {
        this.context.logger.info('Fetching credits...');

        return this.request<{ data: { total_credits: number; total_usage: number } }>('GET', '/credits');
    }

    async createCoinbaseCharge(request: CreateChargeRequest): Promise<{ data: any }> {
        this.context.logger.info('Creating Coinbase charge...');

        return this.request<{ data: any }>('POST', '/credits/coinbase', request);
    }

    async createEmbeddings(request: EmbeddingsRequest): Promise<any> {
        this.context.logger.info('Creating embeddings...');

        return this.request<any>('POST', '/embeddings', request);
    }

    async listEmbeddingsModels(): Promise<ModelsListResponse> {
        this.context.logger.info('Fetching embeddings models...');

        return this.request<ModelsListResponse>('GET', '/embeddings/models');
    }

    async getGeneration(id: string): Promise<{ data: GenerationInfo }> {
        this.context.logger.info(`Fetching generation ${id}...`);

        const response = await this.request<{ data: GenerationInfo }>('GET', `/generation?id=${id}`);

        this.components.generations.setGeneration(id, response.data);

        return response;
    }

    async listApiKeys(params?: {
        include_disabled?: string;
        offset?: string;
    }): Promise<{ data: ApiKey[] }> {
        this.context.logger.info('Listing API keys...');

        let endpoint = '/keys';
        if (params) {
            const query = new URLSearchParams();
            if (params.include_disabled) query.append('include_disabled', params.include_disabled);
            if (params.offset) query.append('offset', params.offset);
            endpoint += `?${query.toString()}`;
        }

        const response = await this.request<{ data: ApiKey[] }>('GET', endpoint);

        this.components.apiKeys.setKeys(response.data);

        return response;
    }

    async createApiKey(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
        this.context.logger.info('Creating API key...');

        const response = await this.request<CreateApiKeyResponse>('POST', '/keys', request);

        await this.listApiKeys();

        return response;
    }

    async getApiKey(hash: string): Promise<{ data: ApiKey }> {
        this.context.logger.info(`Fetching API key ${hash}...`);

        return this.request<{ data: ApiKey }>('GET', `/keys/${hash}`);
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
        this.context.logger.info(`Updating API key ${hash}...`);

        const response = await this.request<{ data: ApiKey }>('PATCH', `/keys/${hash}`, request);

        await this.listApiKeys();

        return response;
    }

    async deleteApiKey(hash: string): Promise<{ deleted: boolean }> {
        this.context.logger.info(`Deleting API key ${hash}...`);

        const response = await this.request<{ deleted: boolean }>('DELETE', `/keys/${hash}`);

        await this.listApiKeys();

        return response;
    }

    async getCurrentKeyInfo(): Promise<{ data: ApiKeyInfo }> {
        this.context.logger.info('Fetching current key info...');

        return this.request<{ data: ApiKeyInfo }>('GET', '/key');
    }

    async listGuardrails(params?: {
        offset?: string;
        limit?: string;
    }): Promise<{ data: Guardrail[]; total_count: number }> {
        this.context.logger.info('Listing guardrails...');

        let endpoint = '/guardrails';
        if (params) {
            const query = new URLSearchParams();
            if (params.offset) query.append('offset', params.offset);
            if (params.limit) query.append('limit', params.limit);
            endpoint += `?${query.toString()}`;
        }

        const response = await this.request<{ data: Guardrail[]; total_count: number }>('GET', endpoint);

        this.components.guardrails.setGuardrails(response.data);

        return response;
    }

    async createGuardrail(request: any): Promise<{ data: Guardrail }> {
        this.context.logger.info('Creating guardrail...');

        const response = await this.request<{ data: Guardrail }>('POST', '/guardrails', request);

        await this.listGuardrails();

        return response;
    }

    async getGuardrail(id: string): Promise<{ data: Guardrail }> {
        this.context.logger.info(`Fetching guardrail ${id}...`);

        return this.request<{ data: Guardrail }>('GET', `/guardrails/${id}`);
    }

    async updateGuardrail(id: string, request: any): Promise<{ data: Guardrail }> {
        this.context.logger.info(`Updating guardrail ${id}...`);

        const response = await this.request<{ data: Guardrail }>('PATCH', `/guardrails/${id}`, request);

        await this.listGuardrails();

        return response;
    }

    async deleteGuardrail(id: string): Promise<{ deleted: boolean }> {
        this.context.logger.info(`Deleting guardrail ${id}...`);

        const response = await this.request<{ deleted: boolean }>('DELETE', `/guardrails/${id}`);

        await this.listGuardrails();

        return response;
    }

    async listProviders(): Promise<{ data: Provider[] }> {
        this.context.logger.info('Listing providers...');

        const response = await this.request<{ data: Provider[] }>('GET', '/providers');

        this.components.providers.setProviders(response.data);

        return response;
    }

    async exchangeAuthCodeForApiKey(
        request: ExchangeAuthCodeRequest
    ): Promise<ExchangeAuthCodeResponse> {
        this.context.logger.info('Exchanging auth code for API key...');

        return this.request<ExchangeAuthCodeResponse>('POST', '/auth/keys', request);
    }

    async createAuthCode(request: CreateAuthCodeRequest): Promise<{ data: any }> {
        this.context.logger.info('Creating auth code...');

        return this.request<{ data: any }>('POST', '/auth/keys/code', request);
    }

    async createChatCompletion(
        request: ChatCompletionRequest,
        onStream?: (chunk: ChatStreamingResponseChunk) => void
    ): Promise<ChatResponse> {
        this.context.logger.info('Creating chat completion...');

        const isStream = request.stream === true && !!onStream;

        if (isStream) {
            const streamId = `chat_${Date.now()}`;
            const controller = this.components.streams.createStream(streamId);

            try {
                const generator = this.streamRequest<ChatStreamingResponseChunk>(
                    'POST',
                    '/chat/completions',
                    request,
                    controller.signal
                );

                for await (const chunk of generator) {
                    onStream(chunk);
                }

                throw new Error('Stream handling for chat completions needs full implementation');
            } catch (error) {
                this.components.streams.cancelStream(streamId);
                throw error;
            } finally {
                this.components.streams.cancelStream(streamId);
            }
        } else {
            return this.request<ChatResponse>('POST', '/chat/completions', request);
        }
    }
}
