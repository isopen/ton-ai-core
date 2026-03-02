import { GigaClawAgent, GigaClawConfig } from './agent_draft';

const config: GigaClawConfig = {
    name: 'gigaclaw',
    plugins: {},
    gigachat: {
        apiKey: process.env.GIGACHAT_API_KEY || '',
        model: 'GigaChat',
        maxTokens: 200,
        temperature: 0.7,
        scope: 'GIGACHAT_API_PERS'
    },
    telegram: {
        token: process.env.TELEGRAM_BOT_API_TOKEN || '',
        pollingTimeout: 30,
        pollingLimit: 100,
        retryOnError: true,
        maxRetries: 3
    },
    systemPrompt: "You are a helpful AI assistant powered by GigaChat. Respond to user queries in a friendly and informative way.",
    maxHistoryLength: 10
};

async function main() {
    console.log('Starting GigaClaw agent...');

    const requiredEnvVars = ['GIGACHAT_API_KEY', 'TELEGRAM_BOT_API_TOKEN'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error(`Error: Missing environment variables: ${missingVars.join(', ')}`);
        process.exit(1);
    }

    console.log('Environment variables check passed');

    const agent = new GigaClawAgent(config);

    agent.on('initialized', () => {
        console.log('Agent initialized');
    });

    agent.on('started', () => {
        console.log('Agent started, waiting for Telegram messages...');
        console.log('Send /start to begin');
    });

    agent.on('stopped', () => {
        console.log('Agent stopped');
    });

    agent.on('error', (error) => {
        console.error('Agent error:', error);
    });

    agent.on('plugin:activated', (event) => {
        console.log(`Plugin activated: ${event.name}`);
    });

    agent.on('plugin:deactivated', (event) => {
        console.log(`Plugin deactivated: ${event.name}`);
    });

    agent.on('plugin:error', (event) => {
        console.error(`Plugin ${event.name} error:`, event.error);
    });

    try {
        await agent.start();

        const shutdown = async (signal: string) => {
            console.log(`\nReceived ${signal}, shutting down...`);
            await agent.stop();
            process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
            shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
        });

    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

main().catch(console.error);
