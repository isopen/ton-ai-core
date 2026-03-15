import { BaseAgentSimple } from '@ton-ai/core';
import { VercelPlugin } from '@ton-ai/vercel';

class DeployerAgent extends BaseAgentSimple {
    protected async onInitialize(): Promise<void> {
        console.log('Deployer agent initializing...');
    }

    protected async onStart(): Promise<void> {
        console.log('Deployer agent started');
    }

    protected async onStop(): Promise<void> {
        console.log('Deployer agent stopped');
    }
}

async function deployStaticSite() {
    const agent = new DeployerAgent({
        name: 'vercel-file-deployer'
    });

    try {
        await agent.initialize();
        await agent.start();

        const vercelPlugin = new VercelPlugin();
        await agent.registerPlugin(vercelPlugin, {
            accessToken: process.env.VERCEL_TOKEN
        });

        const vercel = agent.getPlugin('vercel') as VercelPlugin;

        const project = await vercel.createProject({
            name: 'my-static-site'
        });
        console.log('Project created:', project.name);

        const deployment = await vercel.createDeployment({
            name: 'my-static-site-deployment',
            project: project.id,
            files: [
                { file: 'index.html', data: '<h1>Hello from TON AI</h1>' },
                { file: 'style.css', data: 'body { font-family: sans-serif; }' },
                { file: 'script.js', data: 'console.log("Hello from TON AI");' }
            ],

            projectSettings: {
                framework: null,
                buildCommand: null,
                installCommand: null,
                outputDirectory: '.',
                devCommand: null
            }
        });

        console.log('🚀 Deployment started:', deployment.id);
        console.log('📦 Deployment URL:', deployment.url);

        const result = await vercel.waitForDeployment(deployment.id);

        if (result.status === 'READY') {
            console.log('Deployment successful!');
            console.log('Live at:', result.url);
        } else {
            console.log('Deployment failed:', result.status);
        }

    } catch (error) {
        console.error('Deployment failed:', error);
    } finally {
        await agent.stop();
    }
}

deployStaticSite();
