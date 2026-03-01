import { GigaChatAgent } from './agent';

async function main() {
    const apiKey = process.env.GIGACHAT_API_KEY;

    if (!apiKey) {
        console.error('Missing required environment variable: GIGACHAT_API_KEY');
        console.error('Please set it in your environment.');
        process.exit(1);
    }

    const agent = new GigaChatAgent({
        name: 'gigachat-agent',
        apiKey: apiKey,
        systemPrompt: 'You are a helpful assistant',
        temperature: 0.7,
        maxTokens: 500
    });

    agent.on('initialized', (data) => {
        console.log('Agent initialized:', {
            id: data.id,
            name: data.name
        });
    });

    agent.on('started', (data) => {
        console.log(`Agent started: ${data.name}`);
        runExample(agent);
    });

    agent.on('stopped', (data) => {
        console.log(`Agent stopped: ${data.name}`);
    });

    agent.on('error', (error) => {
        console.error('Agent error:', error);
    });

    agent.on('log:info', (data) => {
        console.log(`[${data.plugin}] ${data.message}`, ...data.args);
    });

    agent.on('log:error', (data) => {
        console.error(`[${data.plugin}] ${data.message}`, ...data.args);
    });

    try {
        await agent.initialize();
        await agent.start();

        const cleanup = async () => {
            console.log('\nShutting down gracefully...');
            await agent.stop();
            console.log('Shutdown complete');
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

async function runExample(agent: GigaChatAgent) {
    try {
        const response = await agent.sendMessage('What is the capital of Russia?');
        console.log(`Assistant: ${response}`);

        const status = agent.getStatus();
        console.log('\nAgent Status:', {
            historyLength: status.historyLength,
            hasSystemPrompt: status.hasSystemPrompt,
            uptime: `${Math.floor(status.uptime / 1000)}s`
        });

        const metrics = agent.getMetrics();
        if (metrics) {
            console.log('\nMetrics:', metrics);
        }
    } catch (error) {
        console.error('Error in example:', error);
    }
}

main().catch(console.error);
