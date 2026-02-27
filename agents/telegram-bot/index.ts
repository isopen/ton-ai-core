import { TelegramBotApiAgent } from './agent';

async function main() {
    console.log('Starting Telegram Bot API Agent...');

    const requiredEnvVars = ['TELEGRAM_BOT_API_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error('Missing required environment variables:');
        missingVars.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        console.error('\nPlease set them in your .env file or environment.');
        process.exit(1);
    }

    const agent = new TelegramBotApiAgent({
        name: 'my-telegram-bot',
        botToken: process.env.TELEGRAM_BOT_API_TOKEN,
        adminChatId: Number(process.env.TELEGRAM_ADMIN_CHAT_ID)
    });

    agent.on('initialized', (data) => {
        console.log('Agent initialized:', {
            id: data.id,
            name: data.name,
            startTime: data.startTime?.toLocaleTimeString()
        });
    });

    agent.on('started', (data) => {
        console.log(`Agent started: ${data.name}`);
        console.log('Bot is now running. Press Ctrl+C to stop.');
    });

    agent.on('stopped', (data) => {
        console.log(`Agent stopped: ${data.name}`);
    });

    agent.on('plugin:registered', (data) => {
        console.log(`Plugin registered: ${data.name}`);
    });

    agent.on('plugin:activated', (data) => {
        console.log(`Plugin activated: ${data.name}`);
    });

    agent.on('plugin:deactivated', (data) => {
        console.log(`Plugin deactivated: ${data.name}`);
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

    agent.on('log:warn', (data) => {
        console.warn(`[${data.plugin}] ${data.message}`, ...data.args);
    });

    agent.on('log:debug', (data) => {
        if (process.env.DEBUG === 'true') {
            console.debug(`[${data.plugin}] ${data.message}`, ...data.args);
        }
    });

    try {
        await agent.initialize();
        await agent.start();

        const status = agent.getStatus();
        console.log('\nAgent Status:');
        console.log(`   ID: ${status.id}`);
        console.log(`   Name: ${status.name}`);
        console.log(`   Running: ${status.isRunning ? 'Yes' : 'No'}`);
        console.log(`   Initialized: ${status.initialized ? 'Yes' : 'No'}`);
        console.log(`   Uptime: ${Math.floor((status.uptime || 0) / 1000)}s`);
        console.log(`   Active plugins: ${status.activePlugins?.length || 0}`);
        console.log('');

        const cleanup = async () => {
            console.log('\nShutting down gracefully...');

            try {
                await agent.broadcastToAdmins('Bot is shutting down...');
                await agent.stop();
                console.log('Shutdown complete');
                process.exit(0);
            } catch (error) {
                console.error('Error during shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        process.on('uncaughtException', async (error) => {
            console.error('Uncaught exception:', error);
            await cleanup();
        });

        process.on('unhandledRejection', async (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
        });

    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

main().catch(console.error);
