import { BaseAgent, AgentConfig, MCPClient } from '@ton-ai/core';
import { OpenRouterPlugin, Message } from '@ton-ai/openrouter';
import { EventEmitter } from 'events';

export interface PaidAIAssistantConfig extends AgentConfig {
    openRouterApiKey: string;
    defaultModel?: string;
    systemPrompt?: string;
    costPerRequest?: string;
    treasuryAddress: string;
    minBalanceThreshold?: string;
}

export interface PaidAIResponse {
    text: string;
    transaction: {
        hash: string;
        amount: string;
        success: boolean;
    };
    usage?: {
        prompt: number;
        completion: number;
        total: number;
    };
    model: string;
}

interface AgentEvents {
    'mcp:ready': [];
    'plugin:ready': [];
    'agent:initialized': [];
    'agent:started': [];
    'agent:stopped': [];
    'payment:processed': [data: { hash: string; amount: string; requestNumber: number }];
    'payment:failed': [data: { error: string; amount?: string }];
    'warning': [data: { type: string; message: string }];
}

export class PaidAIAssistant extends BaseAgent {
    private openRouter: OpenRouterPlugin;
    private assistantConfig: PaidAIAssistantConfig;
    private requestCounter: number = 0;
    private totalSpent: string = '0';

    private mcpReady: boolean = false;
    private pluginReady: boolean = false;
    private agentFullyInitialized: boolean = false;

    private mcpReadyPromise: Promise<void>;
    private mcpReadyResolver!: (value: void | PromiseLike<void>) => void;

    private pluginReadyPromise: Promise<void>;
    private pluginReadyResolver!: (value: void | PromiseLike<void>) => void;

    private initializationPromise: Promise<void>;
    private initializationResolver!: (value: void | PromiseLike<void>) => void;

    private eventEmitter: EventEmitter;

    constructor(config: PaidAIAssistantConfig) {
        super(config);

        this.assistantConfig = {
            defaultModel: 'arcee-ai/trinity-large-preview:free',
            systemPrompt: 'You are a helpful AI assistant.',
            costPerRequest: '0.000001',
            minBalanceThreshold: '0.1',
            ...config
        };

        this.openRouter = new OpenRouterPlugin();
        this.eventEmitter = new EventEmitter();

        this.mcpReadyPromise = new Promise((resolve) => {
            this.mcpReadyResolver = resolve;
        });

        this.pluginReadyPromise = new Promise((resolve) => {
            this.pluginReadyResolver = resolve;
        });

        this.initializationPromise = new Promise((resolve) => {
            this.initializationResolver = resolve;
        });

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        (this.mcp as any).on('ready', () => {
            console.log('MCP client ready event received');
            this.mcpReady = true;
            this.mcpReadyResolver();
        });

        (this.mcp as any).on('error', (error: Error) => {
            console.error('MCP client error:', error);
        });
    }

    on<K extends keyof AgentEvents>(event: K, listener: (...args: AgentEvents[K]) => void): this {
        this.eventEmitter.on(event, listener as any);
        return this;
    }

    private emitEvent<K extends keyof AgentEvents>(event: K, ...args: AgentEvents[K]): void {
        this.eventEmitter.emit(event, ...args);
    }

    async waitForMCPReady(timeout: number = 30000): Promise<void> {
        if (this.mcpReady) {
            return;
        }

        return Promise.race([
            this.mcpReadyPromise,
            new Promise<void>((_, reject) => 
                setTimeout(() => reject(new Error('MCP ready timeout')), timeout)
            )
        ]);
    }

    async waitForPluginReady(timeout: number = 30000): Promise<void> {
        if (this.pluginReady) {
            return;
        }

        return Promise.race([
            this.pluginReadyPromise,
            new Promise<void>((_, reject) => 
                setTimeout(() => reject(new Error('Plugin ready timeout')), timeout)
            )
        ]);
    }

    async waitForInitialization(timeout: number = 30000): Promise<void> {
        if (this.agentFullyInitialized) {
            return;
        }

        return Promise.race([
            this.initializationPromise,
            new Promise<void>((_, reject) => 
                setTimeout(() => reject(new Error('Agent initialization timeout')), timeout)
            )
        ]);
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Paid AI Assistant...');

        try {
            console.log('Waiting for MCP to be ready...');
            await this.waitForMCPReady();
            console.log('MCP is ready');

            const pluginContext = {
                mcp: this.mcp as MCPClient,
                events: this.eventEmitter,
                logger: {
                    info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
                    error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
                    warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
                    debug: (message: string, ...args: any[]) => console.debug(`[DEBUG] ${message}`, ...args)
                },
                config: { 
                    apiKey: this.assistantConfig.openRouterApiKey,
                    ...this.assistantConfig 
                }
            };

            console.log('Initializing OpenRouter plugin...');
            await this.openRouter.initialize(pluginContext as any);
            this.openRouter.setApiKey(this.assistantConfig.openRouterApiKey);

            if (this.openRouter.isReady()) {
                this.pluginReady = true;
                this.pluginReadyResolver();
            } else {
                const checkInterval = setInterval(() => {
                    if (this.openRouter.isReady()) {
                        this.pluginReady = true;
                        this.pluginReadyResolver();
                        clearInterval(checkInterval);
                    }
                }, 100);
            }

            console.log('Waiting for OpenRouter plugin to be ready...');
            await this.waitForPluginReady();
            console.log('OpenRouter plugin is ready');

            //await this.checkBalance();

            this.setupEventHandlers();

            this.agentFullyInitialized = true;
            this.initializationResolver();

            console.log('Paid AI Assistant initialized');
            console.log(`Cost per request: ${this.assistantConfig.costPerRequest} TON`);
            console.log(`Treasury address: ${this.assistantConfig.treasuryAddress}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Initialization failed:', errorMessage);
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        await this.waitForInitialization();

        console.log('Paid AI Assistant is running');
        console.log('Current wallet:', this.getWalletAddress());

        //this.startBalanceMonitoring();
    }

    async ensureReady(): Promise<void> {
        await this.waitForInitialization();

        if (!this.isRunning) {
            await this.start();
        }
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping Paid AI Assistant...');
        console.log(`Statistics: ${this.requestCounter} requests processed`);
        console.log(`Total spent: ${this.totalSpent} TON`);

        await this.openRouter.shutdown();

        this.agentFullyInitialized = false;
        this.mcpReady = false;
        this.pluginReady = false;
    }

    private setupEventHandlers(): void {
        this.openRouter.onChatCompleted((info) => {
            console.log(`Chat completed: ${info.id} (${info.tokens || 0} tokens)`);
        });

        this.openRouter.onCreditsLow((info) => {
            console.warn(`Low credits: ${info.remaining.toFixed(2)} remaining`);
        });
    }

    private async checkBalance(): Promise<void> {
        const balance = await this.mcp.getBalance();
        const tonBalance = parseFloat(balance.ton);
        const threshold = parseFloat(this.assistantConfig.minBalanceThreshold!);

        console.log(`Current balance: ${balance.ton} TON`);

        if (tonBalance < threshold) {
            throw new Error(`Insufficient balance: ${balance.ton} TON (minimum: ${threshold} TON)`);
        }
    }

    private startBalanceMonitoring(): void {
        setInterval(async () => {
            try {
                await this.checkBalance();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.emitEvent('warning', { 
                    type: 'low_balance', 
                    message: errorMessage 
                });
            }
        }, 60000);
    }

    private async chargeForRequest(): Promise<{ hash: string; amount: string; success: boolean }> {
        try {
            const response = await this.mcp.sendTON(
                this.assistantConfig.treasuryAddress,
                this.assistantConfig.costPerRequest!,
                `AI Request`
            );

            this.requestCounter++;
            this.totalSpent = (parseFloat(this.totalSpent) + parseFloat(this.assistantConfig.costPerRequest!)).toString();

            this.emitEvent('payment:processed', {
                hash: response.hash,
                amount: this.assistantConfig.costPerRequest!,
                requestNumber: this.requestCounter
            });

            return {
                hash: response.hash,
                amount: this.assistantConfig.costPerRequest!,
                success: true
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Payment failed:', errorMessage);

            this.emitEvent('payment:failed', {
                error: errorMessage,
                amount: this.assistantConfig.costPerRequest
            });

            return {
                hash: '',
                amount: this.assistantConfig.costPerRequest!,
                success: false
            };
        }
    }

    async ask(
        prompt: string,
        options: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            systemPrompt?: string;
        } = {}
    ): Promise<PaidAIResponse> {
        await this.ensureReady();

        console.log(`\nProcessing request...`);
        console.log(`Prompt: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`);

        console.log(`Charging ${this.assistantConfig.costPerRequest} TON...`);
        const payment = await this.chargeForRequest();

        if (!payment.success) {
            throw new Error('Payment failed. Request cancelled.');
        }

        console.log(`Payment processed: ${payment.hash}`);

        try {
            const messages: Message[] = [
                {
                    role: 'system',
                    content: options.systemPrompt || this.assistantConfig.systemPrompt!
                },
                {
                    role: 'user',
                    content: prompt
                }
            ];

            const response = await this.openRouter.chat(messages, {
                model: options.model || this.assistantConfig.defaultModel,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 1000
            });

            const text = response.choices[0]?.message?.content;
            const responseText = typeof text === 'string' ? text : 
                Array.isArray(text) ? JSON.stringify(text) : 'No response';

            console.log(`AI response received`);

            return {
                text: responseText,
                transaction: payment,
                usage: response.usage ? {
                    prompt: response.usage.prompt_tokens,
                    completion: response.usage.completion_tokens,
                    total: response.usage.total_tokens
                } : undefined,
                model: response.model
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('AI request failed:', errorMessage);
            throw error;
        }
    }

    async askBatch(
        prompts: string[],
        options: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        } = {}
    ): Promise<PaidAIResponse[]> {
        await this.ensureReady();

        const results: PaidAIResponse[] = [];

        console.log(`\nProcessing batch of ${prompts.length} requests`);

        for (let i = 0; i < prompts.length; i++) {
            try {
                const result = await this.ask(prompts[i], options);
                results.push(result);

                if (i < prompts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`Request ${i + 1} failed:`, errorMessage);
                results.push({
                    text: `Error: ${errorMessage}`,
                    transaction: { 
                        hash: '', 
                        amount: this.assistantConfig.costPerRequest!, 
                        success: false 
                    },
                    model: options.model || this.assistantConfig.defaultModel!
                });
            }
        }

        return results;
    }

    getStats() {
        return {
            requestsProcessed: this.requestCounter,
            totalSpent: this.totalSpent,
            costPerRequest: this.assistantConfig.costPerRequest,
            treasuryAddress: this.assistantConfig.treasuryAddress,
            model: this.assistantConfig.defaultModel,
            uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0
        };
    }

    async canMakeRequest(): Promise<boolean> {
        try {
            await this.ensureReady();
            const balance = await this.mcp.getBalance();
            const tonBalance = parseFloat(balance.ton);
            const cost = parseFloat(this.assistantConfig.costPerRequest!);
            return tonBalance >= cost;
        } catch {
            return false;
        }
    }

    getOpenRouterPlugin(): OpenRouterPlugin {
        return this.openRouter;
    }
}
