import { BaseAgentSimple, SimpleAgentConfig, AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';
import { OpenRouterPlugin, VisionAnalysisOptions, VisionAnalysisResult } from '@ton-ai/openrouter';

export interface ContentCheckerConfig extends SimpleAgentConfig {
    openRouterApiKey: string;
    defaultModel?: string;
    systemPrompt?: string;
    verbose?: boolean;
    approveThreshold?: number;
    rejectThreshold?: number;
}

export interface ContentRating {
    score: number;
    categories: string[];
    recommendation: 'approve' | 'moderate' | 'reject';
    confidence: number;
    reason: string;
}

export interface EnhancedAnalysisResult extends VisionAnalysisResult {
    mediaType: 'image' | 'video';
    mediaPath: string;
    rating: ContentRating;
}

export class ContentCheckerAgent extends BaseAgentSimple {
    private openRouter: OpenRouterPlugin;
    private agentConfig: ContentCheckerConfig;
    private requestCounter: number = 0;

    constructor(config: ContentCheckerConfig) {
        super(config);

        this.agentConfig = {
            defaultModel: 'nvidia/nemotron-nano-12b-v2-vl:free',
            systemPrompt: `You are a content analysis and moderation assistant.

Analyze the provided media and return a JSON response with:
{
    "analysis": "detailed analysis of the content",
    "rating": {
        "score": number (0-100, 0=safe, 100=highly inappropriate),
        "categories": string[] (e.g., ["violence", "nsfw", "safe", "hate_speech", "spam"]),
        "recommendation": "approve" | "moderate" | "reject",
        "confidence": number (0-100),
        "reason": "brief explanation for the rating"
    }
}

Respond ONLY with valid JSON, no other text.`,
            verbose: false,
            approveThreshold: 30,
            rejectThreshold: 70,
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

    private parseResponse(analysisText: string): { analysis: string; rating: ContentRating } {
        try {
            const parsed = JSON.parse(analysisText);
            return {
                analysis: parsed.analysis || analysisText,
                rating: {
                    score: parsed.rating?.score ?? 50,
                    categories: parsed.rating?.categories ?? ['unknown'],
                    recommendation: parsed.rating?.recommendation ?? 'moderate',
                    confidence: parsed.rating?.confidence ?? 0,
                    reason: parsed.rating?.reason ?? 'Unable to parse rating'
                }
            };
        } catch {
            return {
                analysis: analysisText,
                rating: {
                    score: 50,
                    categories: ['unknown'],
                    recommendation: 'moderate',
                    confidence: 0,
                    reason: 'Failed to parse JSON response'
                }
            };
        }
    }

    private applyThresholds(rating: ContentRating): ContentRating {
        if (rating.score <= this.agentConfig.approveThreshold!) {
            rating.recommendation = 'approve';
        } else if (rating.score >= this.agentConfig.rejectThreshold!) {
            rating.recommendation = 'reject';
        } else {
            rating.recommendation = 'moderate';
        }
        return rating;
    }

    async analyzeImage(imagePath: string, customPrompt?: string): Promise<EnhancedAnalysisResult> {
        await this.ensureReady();

        console.log(`\nProcessing image: ${imagePath}`);

        try {
            const prompt = customPrompt || this.agentConfig.systemPrompt;

            const visionOptions: VisionAnalysisOptions = {
                prompt: prompt,
                model: this.agentConfig.defaultModel,
                temperature: 0.3
            };

            const result = await this.openRouter.analyzeImage(imagePath, visionOptions);

            const { analysis, rating } = this.parseResponse(result.analysis);
            const finalRating = this.applyThresholds(rating);

            console.log(`Rating: ${finalRating.score}/100 - ${finalRating.recommendation.toUpperCase()}`);

            this.requestCounter++;

            return {
                analysis,
                rating: finalRating,
                model: result.model,
                usage: result.usage,
                processingTime: result.processingTime,
                mediaType: 'image',
                mediaPath: imagePath
            };

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async analyzeVideo(videoPath: string, customPrompt?: string): Promise<EnhancedAnalysisResult> {
        await this.ensureReady();

        console.log(`\nProcessing video: ${videoPath}`);

        try {
            const prompt = customPrompt || this.agentConfig.systemPrompt;

            const visionOptions: VisionAnalysisOptions = {
                prompt: prompt,
                model: this.agentConfig.defaultModel,
                temperature: 0.3
            };

            const result = await this.openRouter.analyzeVideo(videoPath, visionOptions);

            const { analysis, rating } = this.parseResponse(result.analysis);
            const finalRating = this.applyThresholds(rating);

            console.log(`Rating: ${finalRating.score}/100 - ${finalRating.recommendation.toUpperCase()}`);

            this.requestCounter++;

            return {
                analysis,
                rating: finalRating,
                model: result.model,
                usage: result.usage,
                processingTime: result.processingTime,
                mediaType: 'video',
                mediaPath: videoPath
            };

        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async analyzeMedia(mediaPath: string, customPrompt?: string): Promise<EnhancedAnalysisResult> {
        const isVideo = mediaPath.match(/\.(mp4|webm|mov|avi)$/i);

        if (isVideo) {
            return this.analyzeVideo(mediaPath, customPrompt);
        } else {
            return this.analyzeImage(mediaPath, customPrompt);
        }
    }

    async analyzeBatch(mediaPaths: string[], customPrompt?: string): Promise<EnhancedAnalysisResult[]> {
        await this.ensureReady();

        const results: EnhancedAnalysisResult[] = [];

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

                results.push({
                    analysis: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    model: this.agentConfig.defaultModel!,
                    processingTime: 0,
                    mediaType: mediaPaths[i].match(/\.(mp4|webm|mov|avi)$/i) ? 'video' : 'image',
                    mediaPath: mediaPaths[i],
                    rating: {
                        score: 50,
                        categories: ['error'],
                        recommendation: 'moderate',
                        confidence: 0,
                        reason: 'Analysis failed'
                    }
                } as EnhancedAnalysisResult);

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
            model: this.agentConfig.defaultModel,
            thresholds: {
                approve: this.agentConfig.approveThreshold,
                reject: this.agentConfig.rejectThreshold
            }
        };
    }

    getOpenRouterPlugin(): OpenRouterPlugin {
        return this.openRouter;
    }
}
