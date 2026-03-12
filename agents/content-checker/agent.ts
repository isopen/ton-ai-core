import { BaseAgentSimple, SimpleAgentConfig, AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';
import { OpenRouterPlugin, VisionAnalysisOptions, VisionAnalysisResult } from '@ton-ai/openrouter';

export interface ContentCheckerConfig extends SimpleAgentConfig {
    openRouterApiKey: string;
    defaultModel?: string;
    systemPrompt?: string;
    verbose?: boolean;
}

export interface AnalysisResult extends VisionAnalysisResult {
    mediaType: 'image' | 'video';
    mediaPath: string;
}

export class ContentCheckerAgent extends BaseAgentSimple {
    private openRouter: OpenRouterPlugin;
    private agentConfig: ContentCheckerConfig;
    private requestCounter: number = 0;

    constructor(config: ContentCheckerConfig) {
        super(config);

        this.agentConfig = {
            defaultModel: 'nvidia/nemotron-nano-12b-v2-vl:free',
            systemPrompt: 'You are a content analysis assistant. Analyze the provided media in detail.',
            verbose: false,
            ...config
        };

        this.openRouter = new OpenRouterPlugin();

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
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Content Checker Agent...');

        try {
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
            this.setupEventHandlers();

            console.log('Content Checker Agent initialized');
            console.log(`Default model: ${this.agentConfig.defaultModel}`);

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

    private setupEventHandlers(): void {
        this.openRouter.onChatCompleted((info) => {
            console.log(`Analysis completed: ${info.id} (${info.tokens || 0} tokens)`);
        });

        this.openRouter.onCreditsLow((info) => {
            console.warn(`Low credits: ${info.remaining.toFixed(2)} remaining`);
        });
    }

    async analyzeImage(
        imagePath: string,
        customPrompt?: string
    ): Promise<AnalysisResult> {
        await this.ensureReady();

        console.log(`\nProcessing image: ${imagePath}`);

        try {
            const visionOptions: VisionAnalysisOptions = {
                prompt: customPrompt,
                model: this.agentConfig.defaultModel
            };

            const result = await this.openRouter.analyzeImage(imagePath, visionOptions);

            console.log(`Analysis completed`);

            this.requestCounter++;

            return {
                ...result,
                mediaType: 'image',
                mediaPath: imagePath
            };

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async analyzeVideo(
        videoPath: string,
        customPrompt?: string
    ): Promise<AnalysisResult> {
        await this.ensureReady();

        console.log(`\nProcessing video: ${videoPath}`);

        try {
            const visionOptions: VisionAnalysisOptions = {
                prompt: customPrompt,
                model: this.agentConfig.defaultModel
            };

            const result = await this.openRouter.analyzeVideo(videoPath, visionOptions);

            console.log(`Analysis completed`);

            this.requestCounter++;

            return {
                ...result,
                mediaType: 'video',
                mediaPath: videoPath
            };

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async analyzeMedia(
        mediaPath: string,
        customPrompt?: string
    ): Promise<AnalysisResult> {
        const isVideo = mediaPath.match(/\.(mp4|webm|mov|avi)$/i);

        if (isVideo) {
            return this.analyzeVideo(mediaPath, customPrompt);
        } else {
            return this.analyzeImage(mediaPath, customPrompt);
        }
    }

    async analyzeBatch(
        mediaPaths: string[],
        customPrompt?: string
    ): Promise<AnalysisResult[]> {
        await this.ensureReady();

        const results: AnalysisResult[] = [];

        console.log(`\nProcessing batch of ${mediaPaths.length} media files`);

        for (let i = 0; i < mediaPaths.length; i++) {
            try {
                const result = await this.analyzeMedia(mediaPaths[i], customPrompt);
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
        return {
            ...this.getStatus(),
            requestsProcessed: this.requestCounter,
            model: this.agentConfig.defaultModel
        };
    }

    getOpenRouterPlugin(): OpenRouterPlugin {
        return this.openRouter;
    }
}
