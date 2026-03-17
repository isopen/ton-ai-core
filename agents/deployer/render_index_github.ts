import { RenderDeployerAgent, DeployerConfig } from './render_agent_github';
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

    if (configFile) {
        return { configFile };
    }

    console.error('Error: --config parameter is required');
    console.error('Usage: npx ts-node render_index_github.ts --config=your_config.ts');
    process.exit(1);
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
    const config = await loadConfig(configFile);

    console.log('Render Deployer Agent');
    console.log(`Loaded config from: ${configFile}`);
    console.log(`Agent: ${config.agent?.name || 'unknown'}`);
    console.log(`Plugins: ${config.agent?.plugins?.join(', ') || 'none'}\n`);

    const agent = new RenderDeployerAgent(config);

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
        console.log(`  Repository: ${config.github?.owner}/${config.github?.repo}`);
        console.log(`  Branch: ${config.github?.branch}`);
        console.log(`  Agent: ${config.agent?.name}`);
        console.log(`  Plugins: ${config.agent?.plugins?.join(', ') || 'none'}`);
        console.log(`  Project: ${config.projectName}`);
        console.log(`  Workspace ID: ${config.render?.workspaceId || 'personal'}`);

        const deployNow = await prompt('\nStart deployment to Render? (y/n): ');

        if (deployNow.toLowerCase() === 'y') {
            console.log('\nStarting deployment process...');

            try {
                const result = await agent.deployAgent();

                console.log(`\nDeployment started successfully!`);
                console.log(`  Project: ${result.project.name}`);
                console.log(`  Project ID: ${result.project.id}`);
                console.log(`  Service ID: ${result.service.id}`);
                console.log(`  Deploy ID: ${result.deploy.id}`);
                console.log(`  Deploy Status: ${result.deploy.status}`);

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
                            const status = await agent.checkStatus();
                            console.log(`Current status: ${status.status}`);
                            break;
                        case '2':
                            const deploy = await agent.waitForReady();
                            if (deploy.status === 'live') {
                                console.log(`\nAgent is live!`);
                                monitoring = false;
                            }
                            break;
                        case '3':
                            const logs = await agent.getLogs();
                            if (logs.length > 0) {
                                console.log('\nRecent deployments:');
                                logs.slice(0, 5).forEach((d, i) => {
                                    console.log(`  ${i + 1}. ${d.id}: ${d.status}`);
                                });
                            }
                            break;
                        case '4':
                            const redeploy = await agent.redeploy();
                            console.log(`Redeploy triggered: ${redeploy.id} (${redeploy.status})`);
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
