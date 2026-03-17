export default {
    name: 'railway-gigaclaw-deployer',
    railway: {
        apiToken: process.env.RAILWAY_TOKEN || '',
        tokenType: (process.env.RAILWAY_TOKEN_TYPE as 'account' | 'workspace' | 'project') || 'account',
        teamId: process.env.RAILWAY_TEAM_ID
    },
    agent: {
        name: 'GigaClaw',
        entryPoint: 'index.ts',
        plugins: ['gigachat', 'telegram-bot-api'],
        envPrefix: 'GIGACLAW'
    },
    projectName: process.env.RAILWAY_PROJECT_NAME || 'gigaclaw-bot',
    environmentVariables: {
        GIGACHAT_API_KEY: process.env.GIGACHAT_API_KEY || '',
        GIGACHAT_SCOPE: 'GIGACHAT_API_PERS',
        GIGACHAT_MODEL: 'GigaChat',
        GIGACHAT_MAX_TOKENS: '100',
        GIGACHAT_TEMPERATURE: '0.7',
        TELEGRAM_BOT_API_TOKEN: process.env.TELEGRAM_BOT_API_TOKEN || '',
        TELEGRAM_POLLING_TIMEOUT: '30',
        TELEGRAM_POLLING_LIMIT: '100'
    }
};
