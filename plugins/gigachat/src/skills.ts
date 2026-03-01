import { PluginContext } from '@ton-ai/core';
import { GigaChatComponents } from './components';
import {
    GigaChatConfig,
    GigaChatMessage,
    GigaChatRequest,
    GigaChatResponse,
    GigaChatCompletionParams,
    GigaChatStreamChunk
} from './types';
import https from 'https';
import { URL } from 'url';

const DEFAULT_AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const DEFAULT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
const DEFAULT_MODEL = 'GigaChat';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 0.9;
const DEFAULT_SCOPE = 'GIGACHAT_API_PERS';

export class GigaChatSkills {
    private context: PluginContext;
    private components: GigaChatComponents;
    private config: GigaChatConfig;
    private ready: boolean = false;
    private maxRetries: number = 3;

    constructor(context: PluginContext, components: GigaChatComponents, config: GigaChatConfig) {
        this.context = context;
        this.components = components;
        this.config = {
            authUrl: DEFAULT_AUTH_URL,
            apiUrl: DEFAULT_API_URL,
            model: DEFAULT_MODEL,
            maxTokens: DEFAULT_MAX_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
            topP: DEFAULT_TOP_P,
            scope: DEFAULT_SCOPE,
            ...config
        };
    }

    isReady(): boolean {
        return this.ready && !!this.config.apiKey;
    }

    async waitForReady(timeout: number = 10000): Promise<void> {
        if (this.isReady()) return;

        const start = Date.now();
        while (!this.isReady()) {
            if (Date.now() - start > timeout) {
                throw new Error('GigaChat plugin not ready');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    updateConfig(config: Partial<GigaChatConfig>): void {
        this.config = { ...this.config, ...config };
    }

    private async httpsRequest(options: https.RequestOptions, data?: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const req = https.request({
                ...options,
                rejectUnauthorized: false,
                headers: {
                    ...options.headers
                }
            }, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    const contentType = res.headers['content-type'] || '';

                    if (contentType.includes('application/json')) {
                        try {
                            const parsed = JSON.parse(responseData);
                            resolve({
                                statusCode: res.statusCode,
                                headers: res.headers,
                                data: parsed
                            });
                        } catch (e) {
                            resolve({
                                statusCode: res.statusCode,
                                headers: res.headers,
                                data: responseData
                            });
                        }
                    } else {
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            data: responseData
                        });
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(data);
            }

            req.end();
        });
    }

    async getAccessToken(): Promise<string> {
        const cached = this.components.tokenCache.getToken();
        if (cached) {
            return cached;
        }

        this.context.logger.debug('Requesting new OAuth token...');

        const url = new URL(this.config.authUrl || DEFAULT_AUTH_URL);

        const options: https.RequestOptions = {
            hostname: url.hostname,
            port: url.port || '9443',
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'RqUID': this.components.generateRqUID()
            },
            rejectUnauthorized: false
        };

        const data = new URLSearchParams({
            scope: this.config.scope || DEFAULT_SCOPE
        }).toString();

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.httpsRequest(options, data);

                if (response.statusCode !== 200) {
                    throw new Error(`Auth failed: ${response.statusCode} ${JSON.stringify(response.data)}`);
                }

                if (!response.data.access_token) {
                    throw new Error('No access_token in response');
                }

                const expiresIn = response.data.expires_in || 1800;
                this.components.tokenCache.setToken(response.data.access_token, expiresIn);

                this.context.logger.info('GigaChat OAuth token obtained');
                this.ready = true;
                return response.data.access_token;

            } catch (error) {
                this.context.logger.error(`Auth attempt ${attempt + 1} failed:`, error);
                this.components.metrics.recordError(`Auth failed: ${error}`);

                if (attempt === this.maxRetries) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }

        throw new Error('Max retries exceeded for auth');
    }

    private buildRequest(params: GigaChatCompletionParams): GigaChatRequest {
        return {
            messages: params.messages,
            model: params.model || this.config.model,
            max_tokens: params.maxTokens || this.config.maxTokens,
            temperature: params.temperature ?? this.config.temperature,
            top_p: params.topP ?? this.config.topP
        };
    }

    async chatCompletion(params: GigaChatCompletionParams): Promise<GigaChatResponse> {
        const startTime = Date.now();

        return this.components.requestQueue.add(async () => {
            try {
                const token = await this.getAccessToken();
                const request = this.buildRequest(params);

                this.context.logger.debug('Sending chat completion request', {
                    model: request.model,
                    messages: request.messages.length
                });

                const url = new URL(this.config.apiUrl || DEFAULT_API_URL);

                const options: https.RequestOptions = {
                    hostname: url.hostname,
                    port: url.port || '443',
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    },
                    rejectUnauthorized: false
                };

                const response = await this.httpsRequest(options, JSON.stringify(request));

                const duration = Date.now() - startTime;
                this.context.logger.debug(`Request completed in ${duration}ms`);

                if (response.statusCode !== 200) {
                    this.components.metrics.recordError(`API error: ${response.statusCode}`);
                    throw new Error(`GigaChat API error (${response.statusCode}): ${JSON.stringify(response.data)}`);
                }

                const result = response.data as GigaChatResponse;

                if (result.usage) {
                    this.components.metrics.recordRequest(duration, {
                        prompt: result.usage.prompt_tokens,
                        completion: result.usage.completion_tokens
                    });
                } else {
                    this.components.metrics.recordRequest(duration);
                }

                return result;

            } catch (error) {
                this.context.logger.error('Chat completion failed:', error);
                this.components.metrics.recordError(`Chat completion failed: ${error}`);
                throw error;
            }
        });
    }

    async *streamCompletion(params: GigaChatCompletionParams): AsyncGenerator<GigaChatStreamChunk, void, unknown> {
        const token = await this.getAccessToken();
        const request = this.buildRequest(params);

        const url = new URL(this.config.apiUrl || DEFAULT_API_URL);

        const options: https.RequestOptions = {
            hostname: url.hostname,
            port: url.port || '443',
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'text/event-stream'
            },
            rejectUnauthorized: false
        };

        const bodyData = JSON.stringify({
            ...request,
            stream: true
        });

        let resolveNext: ((value: IteratorResult<GigaChatStreamChunk>) => void) | null = null;
        let rejectNext: ((error: any) => void) | null = null;
        let buffer = '';
        let closed = false;

        const req = https.request({
            ...options,
            rejectUnauthorized: false
        }, (res) => {
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data) as GigaChatStreamChunk;
                            if (resolveNext) {
                                resolveNext({ value: parsed, done: false });
                                resolveNext = null;
                            }
                        } catch (e) {
                            this.context.logger.warn('Failed to parse stream chunk:', data);
                        }
                    }
                }
            });

            res.on('end', () => {
                closed = true;
                if (resolveNext) {
                    resolveNext({ value: null as any, done: true });
                }
            });
        });

        req.on('error', (error) => {
            if (rejectNext) {
                rejectNext(error);
            }
        });

        req.write(bodyData);
        req.end();

        while (!closed) {
            const next = await new Promise<IteratorResult<GigaChatStreamChunk>>((resolve, reject) => {
                resolveNext = resolve;
                rejectNext = reject;
            });

            if (next.done) {
                break;
            }

            yield next.value;
        }
    }

    async getModels(): Promise<any[]> {
        const token = await this.getAccessToken();

        const url = new URL('https://gigachat.devices.sberbank.ru/api/v1/models');

        const options: https.RequestOptions = {
            hostname: url.hostname,
            port: url.port || '443',
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            rejectUnauthorized: false
        };

        const response = await this.httpsRequest(options);

        if (response.statusCode !== 200) {
            throw new Error(`Failed to get models: ${response.statusCode}`);
        }

        return response.data;
    }

    async simpleChat(message: string, systemPrompt?: string): Promise<string> {
        const messages: GigaChatMessage[] = [];

        if (systemPrompt) {
            messages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        messages.push({
            role: 'user',
            content: message
        });

        const response = await this.chatCompletion({ messages });

        if (response.choices && response.choices.length > 0) {
            return response.choices[0].message.content;
        }

        throw new Error('No response from GigaChat');
    }

    async chatWithHistory(messages: GigaChatMessage[]): Promise<string> {
        const response = await this.chatCompletion({ messages });

        if (response.choices && response.choices.length > 0) {
            return response.choices[0].message.content;
        }

        throw new Error('No response from GigaChat');
    }

    getMetrics() {
        return this.components.metrics.getStats();
    }

    resetMetrics(): void {
        this.components.metrics.reset();
    }
}
