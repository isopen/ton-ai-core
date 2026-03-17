import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
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

export class RailwayPlugin implements Plugin {
    public metadata: PluginMetadata = {
        name: 'railway',
        version: '0.1.0',
        description: 'Railway GraphQL API integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: []
    };

    private context!: PluginContext;
    private components!: RailwayComponents;
    public skills!: RailwaySkills;
    private config!: RailwayPluginConfig;
    private initialized: boolean = false;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        const userConfig = context.config as RailwayPluginConfig;

        this.context.logger.info('Initializing Railway GraphQL plugin...');

        if (!userConfig.apiToken) {
            throw new Error('Railway API token is required');
        }

        this.config = {
            apiToken: userConfig.apiToken,
            tokenType: userConfig.tokenType || 'account',
            teamId: userConfig.teamId,
            defaultProjectName: userConfig.defaultProjectName
        };

        this.components = new RailwayComponents(this.context, this.config);
        this.skills = new RailwaySkills(this.context, this.components, this.config);

        this.initialized = true;
        this.context.logger.info('Railway GraphQL plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.context.logger.info('Railway plugin activated');

        try {
            await this.components.initialize();
            this.skills.setReady(true);

            const projects = await this.skills.listProjects(this.config.teamId);
            this.context.logger.info(`Railway ready with ${projects.length} projects`);

            this.context.events.emit('railway:activated', {
                teamId: this.config.teamId,
                projectsCount: projects.length
            });
        } catch (error) {
            this.context.logger.error('Failed to activate Railway plugin:', error);
            throw error;
        }
    }

    async onDeactivate(): Promise<void> {
        this.context.logger.info('Railway plugin deactivated');

        await this.components.cleanup();
        this.skills.setReady(false);

        this.context.events.emit('railway:deactivated');
    }

    async shutdown(): Promise<void> {
        this.context.logger.info('Railway plugin shutting down...');

        await this.components.cleanup();
        this.initialized = false;

        this.context.logger.info('Railway plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        const oldToken = this.config.apiToken;

        const updatedConfig: RailwayPluginConfig = {
            apiToken: newConfig.apiToken || this.config.apiToken,
            tokenType: newConfig.tokenType || this.config.tokenType,
            teamId: newConfig.teamId !== undefined ? newConfig.teamId : this.config.teamId,
            defaultProjectName: newConfig.defaultProjectName || this.config.defaultProjectName
        };

        this.config = updatedConfig;
        this.context.logger.info('Railway config updated');

        if (oldToken !== this.config.apiToken) {
            await this.components.cleanup();
            await this.components.initialize();
            this.skills.setReady(true);
            this.context.events.emit('railway:reconnected');
        }

        this.context.events.emit('railway:config:updated', {
            teamId: this.config.teamId,
            tokenType: this.config.tokenType
        });
    }

    async listProjects(): Promise<RailwayProject[]> {
        this.checkInitialized();
        return this.skills.listProjects(this.config.teamId);
    }

    async getProject(projectId: string): Promise<RailwayProject> {
        this.checkInitialized();
        return this.skills.getProject(projectId);
    }

    async createProject(options: CreateProjectOptions): Promise<RailwayProject> {
        this.checkInitialized();
        return this.skills.createProject(options);
    }

    async deleteProject(projectId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteProject(projectId);
    }

    async createService(options: DeployServiceOptions): Promise<RailwayService> {
        this.checkInitialized();
        return this.skills.createService(options);
    }

    async listServices(projectId: string): Promise<RailwayService[]> {
        this.checkInitialized();
        return this.skills.listServices(projectId);
    }

    async getService(serviceId: string): Promise<RailwayService> {
        this.checkInitialized();
        return this.skills.getService(serviceId);
    }

    async deleteService(serviceId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteService(serviceId);
    }

    async updateServiceInstance(serviceId: string, environmentId: string, config: UpdateServiceInstanceOptions): Promise<void> {
        this.checkInitialized();
        return this.skills.updateServiceInstance(serviceId, environmentId, config);
    }

    async triggerDeploy(serviceId: string, environmentId: string): Promise<string> {
        this.checkInitialized();
        return this.skills.triggerDeploy(serviceId, environmentId);
    }

    async getDeployments(serviceId: string, environmentId: string): Promise<RailwayDeployment[]> {
        this.checkInitialized();
        return this.skills.getDeployments(serviceId, environmentId);
    }

    async getLatestDeployment(serviceId: string, environmentId: string): Promise<RailwayDeployment | null> {
        this.checkInitialized();
        return this.skills.getLatestDeployment(serviceId, environmentId);
    }

    async waitForServiceReady(serviceId: string, environmentId: string, timeout?: number): Promise<RailwayDeployment> {
        this.checkInitialized();
        return this.skills.waitForServiceReady(serviceId, environmentId, timeout);
    }

    async createEnvironment(projectId: string, name: string): Promise<RailwayEnvironment> {
        this.checkInitialized();
        return this.skills.createEnvironment(projectId, name);
    }

    async listEnvironments(projectId: string): Promise<RailwayEnvironment[]> {
        this.checkInitialized();
        return this.skills.listEnvironments(projectId);
    }

    async deleteEnvironment(environmentId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteEnvironment(environmentId);
    }

    async setEnvironmentVariables(projectId: string, environmentId: string, variables: Record<string, string>, serviceId?: string): Promise<void> {
        this.checkInitialized();
        return this.skills.setEnvironmentVariables(projectId, environmentId, variables, serviceId);
    }

    async getEnvironmentVariables(projectId: string, environmentId: string, serviceId?: string): Promise<Record<string, string>> {
        this.checkInitialized();
        return this.skills.getEnvironmentVariables(projectId, environmentId, serviceId);
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    getMetrics() {
        this.checkInitialized();
        return {
            projects: this.components.projects ? 'available' : 'unavailable',
            services: this.components.services ? 'available' : 'unavailable',
            environments: this.components.environments ? 'available' : 'unavailable',
            teamId: this.config.teamId || 'personal',
            tokenType: this.config.tokenType
        };
    }

    private checkInitialized(): void {
        if (!this.initialized) {
            throw new Error('Plugin not initialized. Call initialize() first.');
        }
    }
}
