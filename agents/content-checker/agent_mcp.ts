import { BaseAgent, AgentConfig, AGENT_EVENTS, PLUGIN_EVENTS, MCP_EVENTS } from '@ton-ai/core';
import { OpenRouterPlugin, VisionAnalysisOptions, VisionAnalysisResult } from '@ton-ai/openrouter';

export interface ContentCheckerConfig extends AgentConfig {
    openRouterApiKey: string;
    defaultModel?: string;
    systemPrompt?: string;
    verbose?: boolean;
    costPerRequest?: string;
    treasuryAddress?: string;
}

export interface AnalysisResult extends VisionAnalysisResult {
    mediaType: 'image' | 'video';
    mediaPath: string;
    payment?: {
        hash: string;
        amount: string;
        success: boolean;
    };
}

export class ContentCheckerAgent extends BaseAgent {
    private openRouter: OpenRouterPlugin;
    private agentConfig: ContentCheckerConfig;
    private requestCounter: number = 0;
    private totalSpent: string = '0';

    constructor(config: ContentCheckerConfig) {
        super(config);

        this.agentConfig = {
            defaultModel: 'nvidia/nemotron-nano-12b-v2-vl:free',
            systemPrompt: 'You are a content analysis assistant. Analyze the provided media in detail.',
            costPerRequest: '0.000001',
            verbose: false,
            ...config
        };

        this.openRouter = new OpenRouterPlugin();

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.on(AGENT_EVENTS.INITIALIZED, () => {
            console.log('Agent initialized');
        });

        this.on(AGENT_EVENTS.STARTED, () => {
            console.log('Agent started');
        });

        this.on(AGENT_EVENTS.STOPPED, () => {
            console.log('Agent stopped');
        });

        this.on(AGENT_EVENTS.ERROR, (error) => {
            console.error('Agent error:', error);
        });

        this.on(PLUGIN_EVENTS.REGISTERED, ({ name }) => {
            console.log(`Plugin registered: ${name}`);
        });

        this.on(PLUGIN_EVENTS.ACTIVATED, ({ name }) => {
            console.log(`Plugin activated: ${name}`);
        });

        this.on(MCP_EVENTS.READY, () => {
            console.log('MCP client ready');
        });

        this.on(MCP_EVENTS.ERROR, (error) => {
            console.error('MCP error:', error);
        });

        this.on(MCP_EVENTS.BALANCE_UPDATE, (balance) => {
            console.log(`Balance update: ${balance}`);
        });

        this.on(MCP_EVENTS.TRANSACTION, (tx) => {
            console.log(`Transaction: ${JSON.stringify(tx)}`);
        });
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Content Checker Agent...');

        try {
            console.log('Waiting for MCP client...');
            await this.mcp.waitForReady();

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
                    apiKey: this.agentConfig.openRouterApiKey,
                    defaultModel: this.agentConfig.defaultModel
                }
            };

            console.log('Initializing OpenRouter plugin...');
            await this.openRouter.initialize(pluginContext as any);

            await this.registerPlugin(this.openRouter as any, {
                apiKey: this.agentConfig.openRouterApiKey,
                defaultModel: this.agentConfig.defaultModel
            });

            const startTime = Date.now();
            while (!this.openRouter.isReady()) {
                if (Date.now() - startTime > 30000) {
                    throw new Error('OpenRouter plugin ready timeout');
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log('OpenRouter plugin is ready');
            this.setupOpenRouterHandlers();

            console.log('Content Checker Agent initialized');
            console.log(`Default model: ${this.agentConfig.defaultModel}`);
            console.log(`Wallet address: ${this.getWalletAddress()}`);

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        console.log('Content Checker Agent is running');
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping Content Checker Agent...');
        console.log(`Statistics: ${this.requestCounter} media files analyzed`);
        await this.openRouter.shutdown();
    }

    private setupOpenRouterHandlers(): void {
        this.openRouter.onChatCompleted((info) => {
            console.log(`Analysis completed: ${info.id} (${info.tokens || 0} tokens)`);
        });

        this.openRouter.onCreditsLow((info) => {
            console.warn(`Low credits: ${info.remaining.toFixed(2)} remaining`);
        });
    }

    private async ensureModelAvailable(modelId: string): Promise<boolean> {
        try {
            const models = await this.openRouter.listModels();
            const modelExists = models.data.some(m => m.id === modelId || m.canonical_slug === modelId);

            if (!modelExists) {
                console.error(`Model ${modelId} not found in available models`);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error checking model availability:', error);
            return false;
        }
    }

    private async ensureSufficientBalance(): Promise<void> {
        if (!this.agentConfig.treasuryAddress) return;

        const balance = await this.mcp.getBalance();
        const tonBalance = parseFloat(balance.ton);
        const cost = 0.1;

        if (tonBalance < cost) {
            throw new Error(`Insufficient balance: ${balance.ton} TON (need ${cost} TON)`);
        }
    }

    private async chargeForRequest(): Promise<{ hash: string; amount: string; success: boolean } | undefined> {
        if (!this.agentConfig.treasuryAddress) {
            return undefined;
        }

        try {
            const modelAvailable = await this.ensureModelAvailable(this.agentConfig.defaultModel!);
            if (!modelAvailable) {
                throw new Error(`Model ${this.agentConfig.defaultModel} is not available`);
            }

            await this.ensureSufficientBalance();

            const response = await this.mcp.sendTON(
                this.agentConfig.treasuryAddress,
                this.agentConfig.costPerRequest!,
                `Media Analysis Request`
            );

            this.totalSpent = (parseFloat(this.totalSpent) + parseFloat(this.agentConfig.costPerRequest!)).toString();

            return {
                hash: response.hash,
                amount: this.agentConfig.costPerRequest!,
                success: true
            };
        } catch (error) {
            console.error('Payment failed:', error);
            return {
                hash: '',
                amount: this.agentConfig.costPerRequest!,
                success: false
            };
        }
    }

    async analyzeImage(
        imagePath: string,
        customPrompt?: string,
        maxTokens: number = 1000
    ): Promise<AnalysisResult> {
        await this.ensureReady();

        console.log(`\nProcessing image: ${imagePath}`);

        const payment = await this.chargeForRequest();

        if (payment && !payment.success) {
            throw new Error('Payment failed. Request cancelled.');
        }

        try {
            const visionOptions: VisionAnalysisOptions = {
                prompt: customPrompt,
                model: this.agentConfig.defaultModel,
                maxTokens
            };

            const result = await this.openRouter.analyzeImage(imagePath, visionOptions);

            console.log(`Analysis completed`);

            this.requestCounter++;

            return {
                ...result,
                mediaType: 'image',
                mediaPath: imagePath,
                payment
            };

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async analyzeVideo(
        videoPath: string,
        customPrompt?: string,
        maxTokens: number = 1000
    ): Promise<AnalysisResult> {
        await this.ensureReady();

        console.log(`\nProcessing video: ${videoPath}`);

        const payment = await this.chargeForRequest();

        if (payment && !payment.success) {
            throw new Error('Payment failed. Request cancelled.');
        }

        try {
            const visionOptions: VisionAnalysisOptions = {
                prompt: customPrompt,
                model: this.agentConfig.defaultModel,
                maxTokens
            };

            const result = await this.openRouter.analyzeVideo(videoPath, visionOptions);

            console.log(`Analysis completed`);

            this.requestCounter++;

            return {
                ...result,
                mediaType: 'video',
                mediaPath: videoPath,
                payment
            };

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async analyzeMedia(
        mediaPath: string,
        customPrompt?: string,
        maxTokens: number = 1000
    ): Promise<AnalysisResult> {
        const isVideo = mediaPath.match(/\.(mp4|webm|mov|avi)$/i);

        if (isVideo) {
            return this.analyzeVideo(mediaPath, customPrompt, maxTokens);
        } else {
            return this.analyzeImage(mediaPath, customPrompt, maxTokens);
        }
    }

    async analyzeBatch(
        mediaPaths: string[],
        customPrompt?: string,
        maxTokens: number = 1000
    ): Promise<AnalysisResult[]> {
        await this.ensureReady();

        const results: AnalysisResult[] = [];

        console.log(`\nProcessing batch of ${mediaPaths.length} media files`);

        for (let i = 0; i < mediaPaths.length; i++) {
            try {
                const result = await this.analyzeMedia(mediaPaths[i], customPrompt, maxTokens);
                results.push(result);

                if (i < mediaPaths.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`File ${i + 1} failed:`, error);

                const isVideo = mediaPaths[i].match(/\.(mp4|webm|mov|avi)$/i);

                results.push({
                    analysis: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    model: this.agentConfig.defaultModel!,
                    processingTime: 0,
                    mediaType: isVideo ? 'video' : 'image',
                    mediaPath: mediaPaths[i]
                } as AnalysisResult);

                this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            }
        }

        return results;
    }

    private async ensureReady(): Promise<void> {
        if (!this.isRunning) {
            await this.start();
        }
    }

    getStats() {
        const status = this.getStatus();
        const { openRouterApiKey, mnemonic, ...restConfig } = this.agentConfig;

        return {
            ...status,
            requestsProcessed: this.requestCounter,
            totalSpent: this.totalSpent,
            model: this.agentConfig.defaultModel,
            config: {
                ...restConfig,
                openRouterApiKey: '***',
                mnemonic: '***'
            }
        };
    }

    getOpenRouterPlugin(): OpenRouterPlugin {
        return this.openRouter;
    }
}
