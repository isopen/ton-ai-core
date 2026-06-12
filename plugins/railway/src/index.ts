import { BasePlugin } from '@ton-ai/core';
import { RailwayComponents } from './components';
import { RailwaySkills } from './skills';
import {
    RailwayPluginConfig,
    RailwayProject,
    RailwayService,
    RailwayEnvironment,
    RailwayDeployment,
    CreateProjectOptions,
    DeployServiceOptions,
    UpdateServiceInstanceOptions
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class RailwayPlugin extends BasePlugin<RailwayPluginConfig> {
    readonly metadata = {
        name: 'railway',
        version: '0.1.0',
        description: 'Railway GraphQL API integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: RailwayComponents;
    public skills!: RailwaySkills;

    protected defaults() {
        return { tokenType: 'account' as const };
    }

    protected async onInit() {
        this.logger.info('Initializing Railway GraphQL plugin...');
        if (!this.config.apiToken) throw new Error('Railway API token is required');
        this.components = new RailwayComponents(this.context, this.config);
        this.skills = new RailwaySkills(this.context, this.components, this.config);
        this.logger.info('Railway GraphQL plugin initialized');
    }

    async onActivate() {
        this.logger.info('Railway plugin activated');
        await this.components.initialize();
        this.skills.setReady(true);
        const projects = await this.skills.listProjects(this.config.teamId);
        this.logger.info(`Railway ready with ${projects.length} projects`);
        this.events.emit('railway:activated', { teamId: this.config.teamId, projectsCount: projects.length });
    }

    async onDeactivate() {
        this.logger.info('Railway plugin deactivated');
        await this.components.cleanup();
        this.skills.setReady(false);
        this.events.emit('railway:deactivated');
    }

    async shutdown() {
        this.logger.info('Railway plugin shutting down...');
        await this.components.cleanup();
        this.initialized = false;
        this.logger.info('Railway plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>) {
        const oldToken = this.config.apiToken;
        this.config = { apiToken: newConfig.apiToken || this.config.apiToken, tokenType: newConfig.tokenType || this.config.tokenType, teamId: newConfig.teamId !== undefined ? newConfig.teamId : this.config.teamId, defaultProjectName: newConfig.defaultProjectName || this.config.defaultProjectName };
        this.logger.info('Railway config updated');
        if (oldToken !== this.config.apiToken) {
            await this.components.cleanup();
            await this.components.initialize();
            this.skills.setReady(true);
            this.events.emit('railway:reconnected');
        }
        this.events.emit('railway:config:updated', { teamId: this.config.teamId, tokenType: this.config.tokenType });
    }

    async listProjects(): Promise<RailwayProject[]> { this.checkInitialized(); return this.skills.listProjects(this.config.teamId); }
    async getProject(projectId: string): Promise<RailwayProject> { this.checkInitialized(); return this.skills.getProject(projectId); }
    async createProject(options: CreateProjectOptions): Promise<RailwayProject> { this.checkInitialized(); return this.skills.createProject(options); }
    async deleteProject(projectId: string): Promise<void> { this.checkInitialized(); return this.skills.deleteProject(projectId); }
    async createService(options: DeployServiceOptions): Promise<RailwayService> { this.checkInitialized(); return this.skills.createService(options); }
    async listServices(projectId: string): Promise<RailwayService[]> { this.checkInitialized(); return this.skills.listServices(projectId); }
    async getService(serviceId: string): Promise<RailwayService> { this.checkInitialized(); return this.skills.getService(serviceId); }
    async deleteService(serviceId: string): Promise<void> { this.checkInitialized(); return this.skills.deleteService(serviceId); }
    async updateServiceInstance(serviceId: string, environmentId: string, config: UpdateServiceInstanceOptions): Promise<void> { this.checkInitialized(); return this.skills.updateServiceInstance(serviceId, environmentId, config); }
    async triggerDeploy(serviceId: string, environmentId: string): Promise<string> { this.checkInitialized(); return this.skills.triggerDeploy(serviceId, environmentId); }
    async getDeployments(serviceId: string, environmentId: string): Promise<RailwayDeployment[]> { this.checkInitialized(); return this.skills.getDeployments(serviceId, environmentId); }
    async getLatestDeployment(serviceId: string, environmentId: string): Promise<RailwayDeployment | null> { this.checkInitialized(); return this.skills.getLatestDeployment(serviceId, environmentId); }
    async waitForServiceReady(serviceId: string, environmentId: string, timeout?: number): Promise<RailwayDeployment> { this.checkInitialized(); return this.skills.waitForServiceReady(serviceId, environmentId, timeout); }
    async createEnvironment(projectId: string, name: string): Promise<RailwayEnvironment> { this.checkInitialized(); return this.skills.createEnvironment(projectId, name); }
    async listEnvironments(projectId: string): Promise<RailwayEnvironment[]> { this.checkInitialized(); return this.skills.listEnvironments(projectId); }
    async deleteEnvironment(environmentId: string): Promise<void> { this.checkInitialized(); return this.skills.deleteEnvironment(environmentId); }
    async setEnvironmentVariables(projectId: string, environmentId: string, variables: Record<string, string>, serviceId?: string): Promise<void> { this.checkInitialized(); return this.skills.setEnvironmentVariables(projectId, environmentId, variables, serviceId); }
    async getEnvironmentVariables(projectId: string, environmentId: string, serviceId?: string): Promise<Record<string, string>> { this.checkInitialized(); return this.skills.getEnvironmentVariables(projectId, environmentId, serviceId); }
    isReady(): boolean { return this.skills?.isReady() || false; }
    getMetrics() { this.checkInitialized(); return { projects: this.components.projects ? 'available' : 'unavailable', services: this.components.services ? 'available' : 'unavailable', environments: this.components.environments ? 'available' : 'unavailable', teamId: this.config.teamId || 'personal', tokenType: this.config.tokenType }; }
}
