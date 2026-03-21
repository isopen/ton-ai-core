import { ContentCheckerAgent } from './agent';

async function main() {
    if (!process.env.OPENROUTER_API_KEY) {
        console.error('Error: OPENROUTER_API_KEY is not set in environment variables');
        process.exit(1);
    }

    const mediaPath = process.argv[2];
    const customPrompt = process.argv[3];

    if (!mediaPath) {
        console.error('Error: Media path is required');
        console.log('Usage: content-checker <media-path> [custom-prompt]');
        process.exit(1);
    }

    const agent = new ContentCheckerAgent({
        openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
        defaultModel: process.env.DEFAULT_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free',
        approveThreshold: parseInt(process.env.APPROVE_THRESHOLD || '30'),
        rejectThreshold: parseInt(process.env.REJECT_THRESHOLD || '70'),
        verbose: process.env.VERBOSE === 'true'
    });

    try {
        console.log('Initializing agent...');
        await agent.initialize();

        console.log('Starting agent...');
        await agent.start();

        console.log(`\nAnalyzing: ${mediaPath}`);

        const response = await agent.analyzeMedia(mediaPath, customPrompt);

        console.log('\n' + '='.repeat(50));
        console.log('ANALYSIS RESULT');
        console.log('='.repeat(50));
        console.log(response.analysis);

        console.log('\n' + '='.repeat(50));
        console.log('CONTENT RATING');
        console.log('='.repeat(50));

        const getScoreColor = (score: number) => {
            if (score <= 30) return '\x1b[32m';
            if (score <= 70) return '\x1b[33m';
            return '\x1b[31m';
        };

        console.log(`Score: ${getScoreColor(response.rating.score)}${response.rating.score}/100\x1b[0m`);
        console.log(`Categories: ${response.rating.categories.join(', ')}`);

        const getRecommendationColor = (rec: string) => {
            switch (rec) {
                case 'approve': return '\x1b[32m';
                case 'moderate': return '\x1b[33m';
                case 'reject': return '\x1b[31m';
                default: return '\x1b[0m';
            }
        };

        console.log(`Recommendation: ${getRecommendationColor(response.rating.recommendation)}${response.rating.recommendation.toUpperCase()}\x1b[0m`);
        console.log(`Confidence: ${response.rating.confidence}%`);
        console.log(`Reason: ${response.rating.reason}`);

        console.log('='.repeat(50));

        if (response.usage) {
            console.log(`\nToken usage:`);
            console.log(`  Prompt tokens: ${response.usage.prompt_tokens}`);
            console.log(`  Completion tokens: ${response.usage.completion_tokens}`);
            console.log(`  Total tokens: ${response.usage.total_tokens}`);
        }

        console.log(`Model: ${response.model}`);
        console.log(`Type: ${response.mediaType}`);
        console.log(`Processing time: ${response.processingTime}ms`);

        console.log('\nStatistics:', agent.getStats());

        if (response.rating.recommendation === 'reject') {
            process.exit(1);
        }

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    } finally {
        console.log('\nStopping agent...');
        await agent.stop();
        console.log('Agent stopped');
    }
}

main().catch(console.error);
