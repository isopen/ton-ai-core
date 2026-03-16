import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { VercelPlugin, VercelPluginConfig, VercelProject, VercelDeployment } from '@ton-ai/vercel';
import * as fs from 'fs';
import * as path from 'path';

const PLUGIN_NAMES = {
    VERCEL: 'vercel'
} as const;

export interface DeployerConfig extends SimpleAgentConfig {
    vercel: VercelPluginConfig;
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

export class UniversalDeployerAgent extends BaseAgentSimple {
    public readonly config: DeployerConfig;
    private project: VercelProject | null = null;
    private deployment: VercelDeployment | null = null;

    constructor(config: DeployerConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Universal Deployer agent...');

        try {
            console.log('Creating Vercel plugin...');
            const vercel = new VercelPlugin();

            console.log('Registering Vercel plugin...');
            await this.registerPlugin(vercel);
            console.log('Vercel plugin registered');

            this.plugins.on('plugin:activated', this.handlePluginActivated.bind(this));
            this.plugins.on('plugin:error', this.handlePluginError.bind(this));

            console.log('Universal Deployer agent initialized');
        } catch (error) {
            console.error('Failed to initialize Deployer agent:', error);
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        console.log('Universal Deployer agent starting...');

        try {
            if (!this.isPluginActive(PLUGIN_NAMES.VERCEL)) {
                console.log('Activating Vercel plugin...');
                await this.activatePlugin(PLUGIN_NAMES.VERCEL, this.config.vercel);
                console.log('Vercel plugin activated');
            }

            const vercel = this.getPlugin<VercelPlugin>(PLUGIN_NAMES.VERCEL);
            if (!vercel) throw new Error('Vercel plugin not available');

            console.log('Waiting for Vercel client to be ready...');

            let ready = false;
            let attempts = 0;
            const maxAttempts = 10;

            while (!ready && attempts < maxAttempts) {
                try {
                    if (vercel.isReady()) {
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
                throw new Error('Vercel plugin failed to become ready');
            }

            const projects = await vercel.listProjects();
            console.log(`Found ${projects.length} existing projects`);

            console.log('Universal Deployer agent started');
            console.log('\nAvailable commands:');
            console.log(`  • deployAgent('${this.config.agent.name}') - Deploy agent to Vercel`);
            console.log('  • checkStatus() - Check deployment status');
            console.log('  • getLogs() - Get deployment logs');
            console.log('  • redeploy() - Redeploy current agent\n');

        } catch (error) {
            console.error('Failed to start Deployer agent:', error);
            throw error;
        }
    }

    protected async onStop(): Promise<void> {
        console.log('Universal Deployer agent stopping...');

        if (this.isPluginActive(PLUGIN_NAMES.VERCEL)) {
            await this.deactivatePlugin(PLUGIN_NAMES.VERCEL);
        }

        console.log('Universal Deployer agent stopped');
    }

    private async handlePluginActivated(event: { name: string }): Promise<void> {
        console.log(`Plugin activated: ${event.name}`);
    }

    private async handlePluginError(event: { name: string; error: Error }): Promise<void> {
        console.error(`Plugin ${event.name} error:`, event.error);
    }

    private async fetchWithRetry(url: string, options: RequestInit = {}, retries: number = 3): Promise<Response | null> {
        for (let i = 0; i < retries; i++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    return response;
                }
            } catch (error) {
                console.warn(`Attempt ${i + 1}/${retries} failed for ${url}:`, error);
                if (i === retries - 1) {
                    console.error(`All ${retries} attempts failed for ${url}`);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        return null;
    }

    private generateRootPackageJson(agentName: string): any {
        return {
            name: `@ton-ai/${agentName}-deploy`,
            version: "0.1.0",
            description: `Deployed ${agentName} agent`,
            scripts: {
                "vercel-build": "bash setup.sh",
                "build": "bash setup.sh",
                "start": `cd ${agentName} && npx ts-node index.ts`
            },
            devDependencies: {
                "typescript": "^5.0.0",
                "ts-node": "^10.9.0"
            }
        };
    }

    private generateVercelJson(): any {
        return {
            "version": 2,
            "builds": [
                {
                    "src": "package.json",
                    "use": "@vercel/static-build",
                    "config": {
                        "distDir": "."
                    }
                }
            ],
            "routes": [
                {
                    "src": "/(.*)",
                    "dest": "/"
                }
            ]
        };
    }

    private async readSetupScript(agentName: string, plugins: string[], repoUrl: string, branch: string): Promise<string> {
        const templatePath = path.join(__dirname, 'vercel_setup.sh');
        let template = await fs.promises.readFile(templatePath, 'utf8');

        const pluginsList = plugins.map(p => `"${p}"`).join(' ');
        const dependenciesStr = plugins.map(p => `    "@ton-ai/${p}": "file:./${p}.tgz",`).join('\n');

        template = template
            .replace(/\${AGENT_NAME}/g, agentName)
            .replace(/\${REPO_URL}/g, repoUrl)
            .replace(/\${BRANCH}/g, branch)
            .replace(/\${PLUGINS_LIST}/g, pluginsList)
            .replace(/\${DEPENDENCIES_STR}/g, dependenciesStr);

        return template;
    }

    async deployAgent(agentName?: string): Promise<{
        project: VercelProject;
        deployment: VercelDeployment;
    }> {
        const targetAgent = agentName || this.config.agent.name;
        const plugins = this.config.agent.plugins || [];
        const branch = this.config.github.branch || 'master';
        const repoUrl = `https://github.com/${this.config.github.owner}/${this.config.github.repo}.git`;
        const envPrefix = this.config.agent.envPrefix || targetAgent.toUpperCase();

        console.log(`\nDeploying agent: ${targetAgent} to Vercel...`);
        console.log(`Repository: ${repoUrl}`);
        console.log(`Branch: ${branch}`);
        console.log(`Plugins: ${plugins.join(', ') || 'none'}`);

        const vercel = this.getPlugin<VercelPlugin>(PLUGIN_NAMES.VERCEL);
        if (!vercel) throw new Error('Vercel plugin not available');

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
        console.log(`Creating project: ${projectName}`);

        this.project = await vercel.createProject({
            name: projectName,
            framework: 'node',
            buildCommand: 'bash setup.sh',
            installCommand: 'bash setup.sh',
            outputDirectory: '.'
        });

        console.log(`Project created: ${this.project.name} (${this.project.id})`);

        for (const [key, value] of Object.entries(envVars)) {
            if (!value) {
                console.log(`  Variable ${key} is empty, skipping`);
                continue;
            }

            const isSensitive = !key.startsWith('NEXT_PUBLIC_') && key !== 'NODE_ENV';

            try {
                await vercel.addEnvironmentVariable(
                    this.project.id,
                    key,
                    value,
                    isSensitive
                );
                console.log(`  Added ${key} as ${isSensitive ? 'sensitive' : 'plain'} variable`);
            } catch (error: any) {
                if (error.message?.includes('ENV_CONFLICT')) {
                    console.log(`  Variable ${key} already exists, skipping`);
                } else {
                    console.error(`  Failed to add ${key}:`, error.message);
                    throw error;
                }
            }
        }

        console.log('\nPreparing deployment files...');
        const files: Array<{ file: string; data: string }> = [];

        const rootPackageJson = this.generateRootPackageJson(targetAgent);
        files.push({
            file: 'package.json',
            data: JSON.stringify(rootPackageJson, null, 2)
        });
        console.log('Generated root package.json');

        const setupScript = await this.readSetupScript(targetAgent, plugins, repoUrl, branch);
        files.push({
            file: 'setup.sh',
            data: setupScript
        });
        console.log('Prepared setup.sh from template');

        const vercelJson = this.generateVercelJson();
        files.push({
            file: 'vercel.json',
            data: JSON.stringify(vercelJson, null, 2)
        });
        console.log('Generated vercel.json');

        console.log(`\nCreating deployment with ${files.length} files...`);

        this.deployment = await vercel.createDeployment({
            name: projectName,
            project: this.project.id,
            target: 'production',
            files: files.map(f => ({
                file: f.file,
                data: f.data
            }))
        });

        console.log(`Deployment started: ${this.deployment.id}`);
        console.log(`Preview URL: ${this.deployment.url}`);

        return {
            project: this.project,
            deployment: this.deployment
        };
    }

    async checkStatus(): Promise<VercelDeployment> {
        if (!this.deployment) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const vercel = this.getPlugin<VercelPlugin>(PLUGIN_NAMES.VERCEL);
        if (!vercel) throw new Error('Vercel plugin not available');

        console.log(`\nChecking status of deployment ${this.deployment.id}...`);

        const deployment = await vercel.getDeployment(this.deployment.id);
        this.deployment = deployment;

        console.log(`Status: ${deployment.status}`);
        if (deployment.status === 'READY') {
            console.log(`Live at: ${deployment.url}`);
        } else if (deployment.status === 'ERROR') {
            console.log('Deployment failed');
        }

        return deployment;
    }

    async waitForReady(timeout: number = 300000): Promise<VercelDeployment> {
        if (!this.deployment) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const vercel = this.getPlugin<VercelPlugin>(PLUGIN_NAMES.VERCEL);
        if (!vercel) throw new Error('Vercel plugin not available');

        console.log(`\nWaiting for deployment to be ready (timeout: ${timeout / 1000}s)...`);

        const deployment = await vercel.waitForDeployment(this.deployment.id, 5000, timeout);
        this.deployment = deployment;

        if (deployment.status === 'READY') {
            console.log(`Agent is live!`);
            console.log(`URL: ${deployment.url}`);
        } else {
            console.log(`Deployment failed with status: ${deployment.status}`);
        }

        return deployment;
    }

    async getLogs(): Promise<any> {
        if (!this.deployment) {
            throw new Error('No active deployment. Call deployAgent() first.');
        }

        const vercel = this.getPlugin<VercelPlugin>(PLUGIN_NAMES.VERCEL);
        if (!vercel) throw new Error('Vercel plugin not available');

        console.log(`\nFetching deployment logs...`);
        const logs = await vercel.getDeploymentLogs(this.deployment.id);
        return logs;
    }

    async redeploy(): Promise<VercelDeployment> {
        if (!this.project) {
            throw new Error('No project. Call deployAgent() first.');
        }

        const vercel = this.getPlugin<VercelPlugin>(PLUGIN_NAMES.VERCEL);
        if (!vercel) throw new Error('Vercel plugin not available');

        console.log(`\nRedeploying agent...`);

        this.deployment = await vercel.deployProject(this.project.id, {
            branch: this.config.github.branch || 'master',
            target: 'production'
        });

        console.log(`Redeployment started: ${this.deployment.id}`);
        console.log(`Preview URL: ${this.deployment.url}`);

        return this.deployment;
    }

    async getProjectInfo(): Promise<VercelProject | null> {
        return this.project;
    }

    async getDeploymentInfo(): Promise<VercelDeployment | null> {
        return this.deployment;
    }
}
