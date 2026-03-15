import { GigaClawAgent, GigaClawConfig } from './agent';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';

const config: GigaClawConfig = {
    name: 'gigaclaw',
    plugins: {},
    gigachat: {
        apiKey: process.env.GIGACHAT_API_KEY || '',
        model: 'GigaChat',
        maxTokens: 100,
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
    maxHistoryLength: 10,
    smoothStreaming: true,
    streamingMaxSpeed: true
};

async function main() {
    console.log('Starting GigaClaw agent...');

    ['GIGACHAT_API_KEY', 'TELEGRAM_BOT_API_TOKEN'].forEach(varName => {
        if (!process.env[varName]) {
            console.error(`Error: ${varName} is not set in environment variables`);
            process.exit(1);
        }
    });

    const agent = new GigaClawAgent(config);

    agent.on(AGENT_EVENTS.INITIALIZED, () => {
        console.log('Agent initialized');
    });

    agent.on(AGENT_EVENTS.STARTED, () => {
        console.log('Agent started, waiting for Telegram messages...');
    });

    agent.on(AGENT_EVENTS.STOPPED, () => {
        console.log('Agent stopped');
    });

    agent.on(AGENT_EVENTS.ERROR, (error) => {
        console.error('Agent error:', error);
    });

    agent.on(PLUGIN_EVENTS.REGISTERED, (data) => {
        console.log(`Plugin registered: ${data.name}`);
    });

    agent.on(PLUGIN_EVENTS.UNREGISTERED, (data) => {
        console.log(`Plugin unregistered: ${data.name}`);
    });

    agent.on(PLUGIN_EVENTS.ACTIVATED, (data) => {
        console.log(`Plugin activated: ${data.name}`);
    });

    agent.on(PLUGIN_EVENTS.DEACTIVATED, (data) => {
        console.log(`Plugin deactivated: ${data.name}`);
    });

    try {
        await agent.start();

        process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            await agent.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\nShutting down...');
            await agent.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

main().catch(console.error);
