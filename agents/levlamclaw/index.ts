import { LevlamClawAgent } from './agent';

async function main() {
    const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'OPENROUTER_API_KEY'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error('Missing required environment variables:');
        missing.forEach(key => console.error(`  - ${key}`));
        console.error('\nCreate .env file with:');
        console.error('TELEGRAM_BOT_TOKEN=your_bot_token');
        console.error('TELEGRAM_API_ID=123456');
        console.error('TELEGRAM_API_HASH=your_api_hash');
        console.error('OPENROUTER_API_KEY=sk-or-v1-xxxxx');
        console.error('OPENROUTER_MODEL=arcee-ai/trinity-large-preview:free');
        console.error('TDLIB_LIBRARY_PATH=/usr/local/lib/libtdjson.so (optional)');
        console.error('TDLIB_DATABASE_DIRECTORY=./tdlib_data (optional)');
        console.error('TDLIB_FILES_DIRECTORY=./tdlib_files (optional)');
        console.error('ALLOWED_CHATS=123456789,987654321 (optional)');
        console.error('ADMIN_IDS=123456789 (optional)');
        process.exit(1);
    }

    const allowedChats = process.env.ALLOWED_CHATS
        ? process.env.ALLOWED_CHATS.split(',').map(Number)
        : undefined;

    const adminIds = process.env.ADMIN_IDS
        ? process.env.ADMIN_IDS.split(',').map(Number)
        : undefined;

    const agent = new LevlamClawAgent({
        name: 'LevlamClaw',
        telegram: {
            botToken: process.env.TELEGRAM_BOT_TOKEN!,
            apiId: parseInt(process.env.TELEGRAM_API_ID!),
            apiHash: process.env.TELEGRAM_API_HASH!
        },
        openrouter: {
            apiKey: process.env.OPENROUTER_API_KEY!,
            defaultModel: process.env.OPENROUTER_MODEL || 'arcee-ai/trinity-large-preview:free'
        },
        tdlib: {
            libraryPath: process.env.TDLIB_LIBRARY_PATH,
            databaseDirectory: process.env.TDLIB_DATABASE_DIRECTORY,
            filesDirectory: process.env.TDLIB_FILES_DIRECTORY
        },
        allowedChats,
        adminIds,
        silentMode: process.env.SILENT_MODE === 'true'
    });

    const shutdown = async () => {
        console.log('\nShutting down...');
        await agent.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await agent.initialize();
    await agent.start();

    const status = agent.getAgentStatus();
    console.log('\nLevlamClaw bot is running!');
    console.log(`   OpenRouter: ${status.openRouterReady ? 'Yes' : 'No'}`);
    console.log(`   Allowed chats: ${allowedChats?.join(', ') || 'all'}`);
    console.log('   Commands: /start, /help, /stats, /about, /clear');
    console.log('   Press Ctrl+C to stop\n');
}

main().catch(console.error);
