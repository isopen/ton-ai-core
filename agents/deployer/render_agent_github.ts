import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { RenderPlugin } from '@ton-ai/render';
import type { 
    RenderPluginConfig, 
    RenderProject, 
    RenderService,
    RenderDeploy 
} from '@ton-ai/render';

const PLUGIN_NAMES = {
    RENDER: 'render'
} as const;

export interface DeployerConfig extends SimpleAgentConfig {
    render: RenderPluginConfig;
    github: {
        owner: string;
        repo: string;
        branch?: string;
    };
    agent: {
        name: string;
        entryPoint?: string;
        plugins?: string[];
        envPrefix?: string;
    };
    projectName?: string;
    environmentVariables?: Record<string, string>;
}

export class RenderDeployerAgent extends BaseAgentSimple {
    public readonly config: DeployerConfig;
    private project: RenderProject | null = null;
    private service: RenderService | null = null;
    private deploy: RenderDeploy | null = null;

    constructor(config: DeployerConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Render Deployer agent...');

        try {
            console.log('Creating Render plugin...');
            const render = new RenderPlugin();

            console.log('Registering Render plugin...');
            await this.registerPlugin(render);
            console.log('Render plugin registered');

            this.plugins.on('plugin:activated', this.handlePluginActivated.bind(this));
            this.plugins.on('plugin:error', this.handlePluginError.bind(this));

            console.log('Render Deployer agent initialized');
        } catch (error) {
            console.error('Failed to initialize Deployer agent:', error);
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        console.log('Render Deployer agent starting...');

        try {
            if (!this.isPluginActive(PLUGIN_NAMES.RENDER)) {
                console.log('Activating Render plugin...');
                await this.activatePlugin(PLUGIN_NAMES.RENDER, this.config.render);
                console.log('Render plugin activated');
            }

            const render = this.getPlugin<RenderPlugin>(PLUGIN_NAMES.RENDER);
            if (!render) throw new Error('Render plugin not available');

            console.log('Waiting for Render client to be ready...');

            let ready = false;
            let attempts = 0;
            const maxAttempts = 10;

            while (!ready && attempts < maxAttempts) {
                try {
                    if (render.isReady()) {
                        ready = true;
                        break;
                    }
                } catch (error) {
                    attempts++;
                    console.log(`Waiting... attempt ${attempts}/${maxAttempts}`);
                }

                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            if (!ready) {
                throw new Error('Render plugin failed to become ready');
            }

            const projects = await render.listProjects();
            console.log(`Found ${projects.length} existing projects`);

            console.log('Render Deployer agent started');
            console.log('\nAvailable commands:');
            console.log(`  • deployAgent('${this.config.agent.name}') - Deploy agent to Render`);
            console.log('  • checkStatus() - Check deployment status');
            console.log('  • getLogs() - Get deployment logs');
            console.log('  • redeploy() - Redeploy current agent\n');

        } catch (error) {
            console.error('Failed to start Deployer agent:', error);
            throw error;
        }
    }

    protected async onStop(): Promise<void> {
        console.log('Render Deployer agent stopping...');

        if (this.isPluginActive(PLUGIN_NAMES.RENDER)) {
            await this.deactivatePlugin(PLUGIN_NAMES.RENDER);
        }

        console.log('Render Deployer agent stopped');
    }

    private async handlePluginActivated(event: { name: string }): Promise<void> {
        console.log(`Plugin activated: ${event.name}`);
    }

    private async handlePluginError(event: { name: string; error: Error }): Promise<void> {
        console.error(`Plugin ${event.name} error:`, event.error);
    }

    async deployAgent(agentName?: string): Promise<{
        project: RenderProject;
        service: RenderService;
        deploy: RenderDeploy;
    }> {
        const targetAgent = agentName || this.config.agent.name;
        const branch = this.config.github.branch || 'master';
        const envPrefix = this.config.agent.envPrefix || targetAgent.toUpperCase();
        const workspaceId = this.config.render.workspaceId;
        const repoFull = `https://github.com/${this.config.github.owner}/${this.config.github.repo}.git`;

        console.log(`\nDeploying agent: ${targetAgent} to Render...`);
        console.log(`Repository: ${repoFull}`);
        console.log(`Branch: ${branch}`);
        if (workspaceId) {
            console.log(`Workspace ID: ${workspaceId}`);
        }

        const render = this.getPlugin<RenderPlugin>(PLUGIN_NAMES.RENDER);
        if (!render) throw new Error('Render plugin not available');

        const envVars: Record<string, string> = {
            NODE_ENV: 'production',
            ...this.config.environmentVariables
        };

        for (const key of Object.keys(process.env)) {
            if (key.startsWith(`${envPrefix}_`)) {
                envVars[key] = process.env[key] || '';
            }
        }

        const projectName = this.config.projectName || `${targetAgent}-bot`;
        console.log(`Creating Render project: ${projectName}`);

        const user = await render.getCurrentUser();
        const ownerId = workspaceId || user.id;

        this.project = await render.createProject(
            projectName,
            [{ name: 'production' }]
        );

        console.log(`Project created: ${this.project.name} (${this.project.id})`);

        console.log(`Creating service on Render...`);

        const envVarArray = Object.entries(envVars).map(([key, value]) => ({
            key,
            value
        }));

        const serviceResult = await render.createService({
            name: targetAgent,
            type: 'web_service',
            ownerId,
            repo: repoFull,
            branch,
            autoDeploy: 'yes',
            envVars: envVarArray,
            serviceDetails: {
                runtime: 'node',
                envSpecificDetails: {
                    buildCommand: `make build-${targetAgent}`,
                    startCommand: `cd agents/${targetAgent} && npx ts-node index.ts`
                },
                plan: 'starter',
                region: 'oregon',
                numInstances: 1,
                healthCheckPath: '/health'
            }
        });

        this.service = serviceResult.service;
        console.log(`Service created: ${this.service.id}`);

        console.log(`Fetching initial deploy info...`);
        this.deploy = await render.getDeploy(this.service.id, serviceResult.deployId);
        console.log(`Deploy status: ${this.deploy.status}`);

        return {
            project: this.project,
            service: this.service,
            deploy: this.deploy
        };
    }

    async checkStatus(): Promise<RenderDeploy> {
        if (!this.service || !this.deploy) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const render = this.getPlugin<RenderPlugin>(PLUGIN_NAMES.RENDER);
        if (!render) throw new Error('Render plugin not available');

        console.log(`\nChecking deployment status...`);

        this.deploy = await render.getDeploy(this.service.id, this.deploy.id);
        
        console.log(`Status: ${this.deploy.status}`);
        if (this.deploy.commit) {
            console.log(`Commit: ${this.deploy.commit.id}`);
        }

        return this.deploy;
    }

    async waitForReady(timeout: number = 300000): Promise<RenderDeploy> {
        if (!this.service || !this.deploy) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const render = this.getPlugin<RenderPlugin>(PLUGIN_NAMES.RENDER);
        if (!render) throw new Error('Render plugin not available');

        console.log(`\nWaiting for deployment to be ready (timeout: ${timeout / 1000}s)...`);

        this.deploy = await render.waitForDeploy(this.service.id, this.deploy.id, timeout);
        
        console.log(`Agent is live!`);

        return this.deploy;
    }

    async getLogs(): Promise<RenderDeploy[]> {
        if (!this.service) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const render = this.getPlugin<RenderPlugin>(PLUGIN_NAMES.RENDER);
        if (!render) throw new Error('Render plugin not available');

        console.log(`\nFetching deployment logs...`);
        const deploys = await render.listDeploys(this.service.id);
        
        if (deploys.length === 0) {
            return [];
        }

        console.log(`Last ${Math.min(5, deploys.length)} deployments:`);
        deploys.slice(0, 5).forEach(d => {
            console.log(`  ${d.id}: ${d.status} (${new Date(d.createdAt).toLocaleString()})`);
        });

        return deploys;
    }

    async redeploy(): Promise<RenderDeploy> {
        if (!this.service) {
            throw new Error('No service. Call deployAgent() first.');
        }

        const render = this.getPlugin<RenderPlugin>(PLUGIN_NAMES.RENDER);
        if (!render) throw new Error('Render plugin not available');

        console.log(`\nRedeploying agent...`);

        this.deploy = await render.createDeploy({
            serviceId: this.service.id
        });
        console.log(`Redeployment started: ${this.deploy.id}`);
        console.log(`Status: ${this.deploy.status}`);
        
        return this.deploy;
    }

    async getProjectInfo(): Promise<RenderProject | null> {
        return this.project;
    }

    async getDeploymentInfo(): Promise<RenderDeploy | null> {
        return this.deploy;
    }

    async getServiceInfo(): Promise<RenderService | null> {
        return this.service;
    }
}
