import { UniversalDeployerAgent } from './vercel_agent_github';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

function parseArgs() {
    const args = process.argv.slice(2);
    const configFile = args.find(arg => arg.startsWith('--config='))?.split('=')[1];

    if (!configFile) {
        console.error('Error: --config parameter is required');
        console.error('Usage: npx ts-node vercel_github.ts --config=vercel_config.ts');
        process.exit(1);
    }

    return { configFile };
}

async function loadConfig(configFile: string) {
    try {
        const configPath = path.resolve(process.cwd(), configFile);
        const configModule = await import(configPath);
        const config = configModule.default || configModule;

        if (typeof config === 'function') {
            return config();
        }

        return config;
    } catch (error) {
        console.error(`Failed to load config from ${configFile}:`, error);
        process.exit(1);
    }
}

async function main() {
    const { configFile } = parseArgs();
    const userConfig = await loadConfig(configFile);

    const requiredVars = ['VERCEL_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
    const missingVars = requiredVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
        console.error('Missing required environment variables:');
        missingVars.forEach(v => console.error(`   - ${v}`));
        console.error('\nPlease create a .env file with:');
        process.exit(1);
    }

    const config = {
        name: userConfig.name || 'universal-deployer',
        plugins: {},
        vercel: {
            accessToken: process.env.VERCEL_TOKEN || '',
            teamId: process.env.VERCEL_TEAM_ID
        },
        github: {
            owner: process.env.GITHUB_OWNER || 'isopen',
            repo: process.env.GITHUB_REPO || 'ton-ai-core',
            branch: process.env.GITHUB_BRANCH || 'master'
        },
        agent: {
            name: userConfig.agent?.name || 'gigaclaw',
            entryPoint: userConfig.agent?.entryPoint || 'index.ts',
            plugins: userConfig.agent?.plugins || [],
            envPrefix: userConfig.agent?.envPrefix || 'GIGACLAW'
        },
        projectName: userConfig.projectName || process.env.VERCEL_PROJECT_NAME || 'gigaclaw-bot',
        environmentVariables: {
            NODE_ENV: 'production',
            ...userConfig.environmentVariables
        }
    };

    const agent = new UniversalDeployerAgent(config);

    agent.on(AGENT_EVENTS.INITIALIZED, () => {
        console.log('Agent initialized');
    });

    agent.on(AGENT_EVENTS.STARTED, () => {
        console.log('Agent started\n');
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

    agent.on(PLUGIN_EVENTS.ACTIVATED, (data) => {
        console.log(`Plugin activated: ${data.name}`);
    });

    agent.on(PLUGIN_EVENTS.DEACTIVATED, (data) => {
        console.log(`Plugin deactivated: ${data.name}`);
    });

    try {
        await agent.start();

        console.log('\nDeployment configuration:');
        console.log(`  Repository: ${config.github.owner}/${config.github.repo}`);
        console.log(`  Branch: ${config.github.branch}`);
        console.log(`  Agent: ${config.agent.name}`);
        console.log(`  Plugins: ${config.agent.plugins?.join(', ') || 'none'}`);
        console.log(`  Project: ${config.projectName}`);

        const deployNow = await prompt('\nStart deployment? (y/n): ');

        if (deployNow.toLowerCase() === 'y') {
            console.log('\nStarting deployment process...');

            try {
                const result = await agent.deployAgent();

                console.log(`\nDeployment started successfully!`);
                console.log(`  Project: ${result.project.name}`);
                console.log(`  Project ID: ${result.project.id}`);
                console.log(`  Deployment ID: ${result.deployment.id}`);
                console.log(`  Preview URL: ${result.deployment.url}`);

                let monitoring = true;
                while (monitoring) {
                    console.log('\nDeployment monitoring:');
                    console.log('  1. Check status');
                    console.log('  2. Wait for ready');
                    console.log('  3. View logs');
                    console.log('  4. Redeploy');
                    console.log('  5. Exit monitoring');

                    const option = await prompt('\nSelect option (1-5): ');

                    switch (option) {
                        case '1':
                            await agent.checkStatus();
                            break;
                        case '2':
                            const deployment = await agent.waitForReady();
                            if (deployment.status === 'READY') {
                                console.log(`\nAgent is live at: ${deployment.url}`);
                                console.log('\nYou can now interact with your bot!');
                                monitoring = false;
                            }
                            break;
                        case '3':
                            const logs = await agent.getLogs();
                            console.log('Build logs:', logs);
                            break;
                        case '4':
                            await agent.redeploy();
                            break;
                        case '5':
                            monitoring = false;
                            break;
                        default:
                            console.log('Invalid option');
                    }
                }

            } catch (error) {
                console.error('Deployment failed:', error);
            }
        } else {
            console.log('Deployment cancelled');
        }

        await agent.stop();
        rl.close();

    } catch (error) {
        console.error('Fatal error:', error);
        await agent.stop();
        rl.close();
        process.exit(1);
    }
}

main().catch(console.error);
