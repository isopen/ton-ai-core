export default {
    name: 'render-gigaclaw-deployer',
    render: {
        apiKey: process.env.RENDER_API_KEY,
        workspaceId: process.env.RENDER_WORKSPACE_ID
    },
    github: {
        owner: 'isopen',
        repo: 'ton-ai-core',
        branch: 'master'
    },
    agent: {
        name: 'gigaclaw',
        entryPoint: 'index.ts',
        plugins: ['gigachat', 'telegram-bot-api'],
        envPrefix: 'GIGACLAW'
    },
    projectName: 'gigaclaw-bot',
    environmentVariables: {
        GIGACHAT_API_KEY: process.env.GIGACHAT_API_KEY,
        GIGACHAT_SCOPE: 'GIGACHAT_API_PERS',
        GIGACHAT_MODEL: 'GigaChat',
        GIGACHAT_MAX_TOKENS: '100',
        GIGACHAT_TEMPERATURE: '0.7',
        TELEGRAM_BOT_API_TOKEN: process.env.TELEGRAM_BOT_API_TOKEN,
        TELEGRAM_POLLING_TIMEOUT: '30',
        TELEGRAM_POLLING_LIMIT: '100'
    }
};
