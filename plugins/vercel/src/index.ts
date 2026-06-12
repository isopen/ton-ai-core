import { BasePlugin } from '@ton-ai/core';
import { VercelComponents } from './components';
import { VercelSkills } from './skills';
import {
    VercelPluginConfig,
    VercelProject,
    VercelDeployment,
    CreateProjectOptions,
    DeployOptions,
    ProjectDeploymentOptions
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class VercelPlugin extends BasePlugin<VercelPluginConfig> {
    readonly metadata = {
        name: 'vercel',
        version: '0.1.0',
        description: 'Vercel deployment platform integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: VercelComponents;
    public skills!: VercelSkills;

    protected async onInit() {
        this.logger.info('Initializing Vercel plugin...');
        if (!this.config.accessToken) throw new Error('Vercel access token is required');
        this.components = new VercelComponents(this.context, this.config);
        this.skills = new VercelSkills(this.context, this.components, this.config);
        this.logger.info('Vercel plugin initialized');
    }

    async onActivate() {
        this.logger.info('Vercel plugin activated');
        await this.components.initialize();
        this.skills.setReady(true);
        const projects = await this.skills.listProjects();
        this.logger.info(`Vercel ready with ${projects.length} projects`);
        this.events.emit('vercel:activated', { teamId: this.config.teamId, projectsCount: projects.length });
    }

    async onDeactivate() {
        this.logger.info('Vercel plugin deactivated');
        await this.components.cleanup();
        this.skills.setReady(false);
        this.events.emit('vercel:deactivated');
    }

    async shutdown() {
        this.logger.info('Vercel plugin shutting down...');
        await this.components.cleanup();
        this.initialized = false;
        this.logger.info('Vercel plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>) {
        const oldToken = this.config.accessToken;
        this.config = { accessToken: newConfig.accessToken || this.config.accessToken, teamId: newConfig.teamId !== undefined ? newConfig.teamId : this.config.teamId };
        this.logger.info('Vercel config updated');
        if (oldToken !== this.config.accessToken) {
            await this.components.cleanup();
            await this.components.initialize();
            this.skills.setReady(true);
            this.events.emit('vercel:reconnected');
        }
        this.events.emit('vercel:config:updated', { teamId: this.config.teamId });
    }

    async listProjects(): Promise<VercelProject[]> { this.checkInitialized(); return this.skills.listProjects(); }
    async getProject(projectId: string): Promise<VercelProject> { this.checkInitialized(); return this.skills.getProject(projectId); }
    async createProject(options: CreateProjectOptions): Promise<VercelProject> { this.checkInitialized(); return this.skills.createProject(options); }
    async deleteProject(projectId: string): Promise<void> { this.checkInitialized(); return this.skills.deleteProject(projectId); }
    async listDeployments(projectId?: string, limit?: number): Promise<VercelDeployment[]> { this.checkInitialized(); return this.skills.listDeployments(projectId, limit); }
    async getDeployment(deploymentId: string): Promise<VercelDeployment> { this.checkInitialized(); return this.skills.getDeployment(deploymentId); }
    async createDeployment(options: DeployOptions): Promise<VercelDeployment> { this.checkInitialized(); return this.skills.createDeployment(options); }
    async deployProject(projectId: string, options?: ProjectDeploymentOptions): Promise<VercelDeployment> { this.checkInitialized(); return this.skills.deployProject(projectId, options); }
    async cancelDeployment(deploymentId: string): Promise<void> { this.checkInitialized(); return this.skills.cancelDeployment(deploymentId); }
    async waitForDeployment(deploymentId: string, interval?: number, timeout?: number): Promise<VercelDeployment> { this.checkInitialized(); return this.skills.waitForDeployment(deploymentId, interval, timeout); }
    async getDeploymentLogs(deploymentId: string): Promise<any> { this.checkInitialized(); return this.skills.getDeploymentLogs(deploymentId); }
    async addEnvironmentVariable(projectId: string, key: string, value: string, isSensitive?: boolean, targets?: Array<'production' | 'preview' | 'development'>, gitBranch?: string): Promise<void> { this.checkInitialized(); return this.skills.addEnvironmentVariable(projectId, key, value, isSensitive, targets, gitBranch); }
    async addEnvironmentVariables(projectId: string, variables: Array<{ key: string; value: string; isSensitive?: boolean; gitBranch?: string }>, defaultTargets?: Array<'production' | 'preview' | 'development'>): Promise<void> { this.checkInitialized(); return this.skills.addEnvironmentVariables(projectId, variables, defaultTargets); }
    async listEnvironmentVariables(projectId: string, target?: 'production' | 'preview' | 'development', gitBranch?: string): Promise<any[]> { this.checkInitialized(); return this.skills.listEnvironmentVariables(projectId, target, gitBranch); }
    async updateEnvironmentVariable(projectId: string, envId: string, value: string, targets?: Array<'production' | 'preview' | 'development'>): Promise<void> { this.checkInitialized(); return this.skills.updateEnvironmentVariable(projectId, envId, value, targets); }
    async deleteEnvironmentVariable(projectId: string, envId: string): Promise<void> { this.checkInitialized(); return this.skills.deleteEnvironmentVariable(projectId, envId); }
    isReady(): boolean { return this.skills?.isReady() || false; }
    getMetrics() { this.checkInitialized(); return { projects: this.components.projects ? 'available' : 'unavailable', deployments: this.components.deployments ? 'available' : 'unavailable', teamId: this.config.teamId || 'personal' }; }
}
