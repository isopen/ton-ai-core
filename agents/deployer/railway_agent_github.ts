import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { RailwayPlugin } from '@ton-ai/railway';
import type {
    RailwayPluginConfig,
    RailwayProject,
    RailwayService
} from '@ton-ai/railway';

const PLUGIN_NAMES = {
    RAILWAY: 'railway'
} as const;

export interface DeployerConfig extends SimpleAgentConfig {
    railway: RailwayPluginConfig;
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

export class RailwayDeployerAgent extends BaseAgentSimple {
    public readonly config: DeployerConfig;
    private project: RailwayProject | null = null;
    private service: RailwayService | null = null;
    private environmentId: string | null = null;

    constructor(config: DeployerConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Railway Deployer agent...');

        try {
            console.log('Creating Railway plugin...');
            const railway = new RailwayPlugin();

            console.log('Registering Railway plugin...');
            await this.registerPlugin(railway);
            console.log('Railway plugin registered');

            this.plugins.on('plugin:activated', this.handlePluginActivated.bind(this));
            this.plugins.on('plugin:error', this.handlePluginError.bind(this));

            console.log('Railway Deployer agent initialized');
        } catch (error) {
            console.error('Failed to initialize Deployer agent:', error);
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        console.log('Railway Deployer agent starting...');

        try {
            if (!this.isPluginActive(PLUGIN_NAMES.RAILWAY)) {
                console.log('Activating Railway plugin...');
                await this.activatePlugin(PLUGIN_NAMES.RAILWAY, this.config.railway);
                console.log('Railway plugin activated');
            }

            const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
            if (!railway) throw new Error('Railway plugin not available');

            console.log('Waiting for Railway client to be ready...');

            let ready = false;
            let attempts = 0;
            const maxAttempts = 10;

            while (!ready && attempts < maxAttempts) {
                try {
                    if (railway.isReady()) {
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
                throw new Error('Railway plugin failed to become ready');
            }

            const projects = await railway.listProjects();
            console.log(`Found ${projects.length} existing projects`);

            console.log('Railway Deployer agent started');
            console.log('\nAvailable commands:');
            console.log(`  • deployAgent('${this.config.agent.name}') - Deploy agent to Railway`);
            console.log('  • checkStatus() - Check deployment status');
            console.log('  • getLogs() - Get deployment logs');
            console.log('  • redeploy() - Redeploy current agent\n');

        } catch (error) {
            console.error('Failed to start Deployer agent:', error);
            throw error;
        }
    }

    protected async onStop(): Promise<void> {
        console.log('Railway Deployer agent stopping...');

        if (this.isPluginActive(PLUGIN_NAMES.RAILWAY)) {
            await this.deactivatePlugin(PLUGIN_NAMES.RAILWAY);
        }

        console.log('Railway Deployer agent stopped');
    }

    private async handlePluginActivated(event: { name: string }): Promise<void> {
        console.log(`Plugin activated: ${event.name}`);
    }

    private async handlePluginError(event: { name: string; error: Error }): Promise<void> {
        console.error(`Plugin ${event.name} error:`, event.error);
    }

    async deployAgent(agentName?: string): Promise<{
        project: RailwayProject;
        service: RailwayService;
    }> {
        const targetAgent = agentName || this.config.agent.name;
        const branch = this.config.github.branch || 'master';
        const envPrefix = this.config.agent.envPrefix || targetAgent.toUpperCase();
        const workspaceId = this.config.railway.teamId;
        const repoFull = `${this.config.github.owner}/${this.config.github.repo}`;

        console.log(`\nDeploying agent: ${targetAgent} to Railway...`);
        console.log(`Repository: ${repoFull}`);
        console.log(`Branch: ${branch}`);
        if (workspaceId) {
            console.log(`Workspace ID: ${workspaceId}`);
        }

        const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
        if (!railway) throw new Error('Railway plugin not available');

        const envVars: Record<string, string> = {
            NODE_ENV: 'production',
            ...this.config.environmentVariables
        };

        for (const key of Object.keys(process.env)) {
            if (key.startsWith(`${envPrefix}_`)) {
                envVars[key] = process.env[key] || '';
            }
        }

        if (!envVars.GIGACHAT_API_KEY) {
            console.error('WARNING: GIGACHAT_API_KEY is not set!');
        }
        if (!envVars.TELEGRAM_BOT_API_TOKEN) {
            console.error('WARNING: TELEGRAM_BOT_API_TOKEN is not set!');
        }

        const projectName = this.config.projectName || `${targetAgent}-bot`;
        console.log(`Creating Railway project: ${projectName}`);

        const projectOptions: any = {
            name: projectName,
            description: `Deployed ${targetAgent} agent`
        };

        if (workspaceId) {
            projectOptions.workspaceId = workspaceId;
        }

        this.project = await railway.createProject(projectOptions);

        console.log(`Project created: ${this.project.name} (${this.project.id})`);

        const environments = await railway.listEnvironments(this.project.id);
        let environment = environments.find(env => env.name === 'production');

        if (!environment) {
            environment = await railway.createEnvironment(this.project.id, 'production');
        }

        this.environmentId = environment.id;

        console.log(`Creating service on Railway...`);

        const serviceOptions: any = {
            projectId: this.project.id,
            serviceName: targetAgent,
            source: {
                repo: repoFull
            },
            branch: branch
        };

        this.service = await railway.createService(serviceOptions);
        console.log(`Service created: ${this.service.id}`);

        console.log(`Configuring service with build and start commands...`);
        await railway.updateServiceInstance(
            this.service.id,
            environment.id,
            {
                buildCommand: `make build-${targetAgent}`,
                startCommand: `cd agents/${targetAgent} && npx ts-node index.ts`
            }
        );
        console.log(`Service configured successfully`);

        console.log(`Setting environment variables for service...`);
        await railway.setEnvironmentVariables(
            this.project.id,
            environment.id,
            envVars,
            this.service.id
        );
        console.log(`Environment variables set successfully`);

        console.log(`Verifying environment variables...`);
        const setVars = await railway.getEnvironmentVariables(
            this.project.id,
            environment.id,
            this.service.id
        );
        console.log(`Variables found for service:`, Object.keys(setVars).join(', '));

        console.log(`Triggering deployment...`);
        const deploymentId = await railway.triggerDeploy(this.service.id, environment.id);
        console.log(`Deployment triggered: ${deploymentId}`);

        return {
            project: this.project,
            service: this.service
        };
    }

    async checkStatus(): Promise<any> {
        if (!this.service || !this.environmentId) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
        if (!railway) throw new Error('Railway plugin not available');

        console.log(`\nChecking deployment status...`);

        const deployment = await railway.getLatestDeployment(this.service.id, this.environmentId);

        if (deployment) {
            console.log(`Status: ${deployment.status}`);
            if (deployment.url) {
                console.log(`URL: ${deployment.url}`);
            }
        } else {
            console.log('No deployments found');
        }

        return deployment;
    }

    async waitForReady(timeout: number = 300000): Promise<any> {
        if (!this.service || !this.environmentId) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
        if (!railway) throw new Error('Railway plugin not available');

        console.log(`\nWaiting for deployment to be ready (timeout: ${timeout / 1000}s)...`);

        const deployment = await railway.waitForServiceReady(this.service.id, this.environmentId, timeout);

        console.log(`Agent is live!`);
        if (deployment.url) {
            console.log(`URL: ${deployment.url}`);
        }

        return deployment;
    }

    async getLogs(): Promise<string[]> {
        if (!this.service || !this.environmentId) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
        if (!railway) throw new Error('Railway plugin not available');

        console.log(`\nFetching deployment logs...`);
        const deployments = await railway.getDeployments(this.service.id, this.environmentId);

        if (deployments.length === 0) {
            return [];
        }

        return deployments.map(d => `${d.status}: ${d.url || 'no url'}`);
    }

    async redeploy(): Promise<string> {
        if (!this.service || !this.environmentId) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
        if (!railway) throw new Error('Railway plugin not available');

        console.log(`\nRedeploying agent...`);

        const deploymentId = await railway.triggerDeploy(this.service.id, this.environmentId);
        console.log(`Redeployment triggered: ${deploymentId}`);

        return deploymentId;
    }

    async getProjectInfo(): Promise<RailwayProject | null> {
        return this.project;
    }

    async getDeploymentInfo(): Promise<any | null> {
        if (!this.service || !this.environmentId) {
            return null;
        }

        const railway = this.getPlugin<RailwayPlugin>(PLUGIN_NAMES.RAILWAY);
        if (!railway) return null;

        return railway.getLatestDeployment(this.service.id, this.environmentId);
    }
}
