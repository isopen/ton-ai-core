import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
import { RenderComponents } from './components';
import { RenderSkills } from './skills';
import {
    RenderPluginConfig,
    RenderProject,
    RenderService,
    RenderDeploy,
    RenderEnvVar,
    RenderCustomDomain,
    RenderOwner,
    CreateServiceOptions,
    CreateDeployOptions
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class RenderPlugin implements Plugin {
    public metadata: PluginMetadata = {
        name: 'render',
        version: '0.1.0',
        description: 'Render deployment platform integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: []
    };

    private context!: PluginContext;
    private components!: RenderComponents;
    public skills!: RenderSkills;
    private config!: RenderPluginConfig;
    private initialized: boolean = false;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        const userConfig = context.config as RenderPluginConfig;

        this.context.logger.info('Initializing Render plugin...');

        if (!userConfig.apiKey) {
            throw new Error('Render API key is required');
        }

        this.config = {
            apiKey: userConfig.apiKey,
            workspaceId: userConfig.workspaceId,
            defaultServiceName: userConfig.defaultServiceName
        };

        this.components = new RenderComponents(this.context, this.config);
        this.skills = new RenderSkills(this.context, this.components, this.config);

        this.initialized = true;
        this.context.logger.info('Render plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.context.logger.info('Render plugin activated');

        try {
            await this.components.initialize();
            this.skills.setReady(true);

            const projects = await this.skills.listProjects();
            this.context.logger.info(`Render ready with ${projects.length} projects`);

            this.context.events.emit('render:activated', {
                workspaceId: this.config.workspaceId,
                projectsCount: projects.length
            });
        } catch (error) {
            this.context.logger.error('Failed to activate Render plugin:', error);
            throw error;
        }
    }

    async onDeactivate(): Promise<void> {
        this.context.logger.info('Render plugin deactivated');

        await this.components.cleanup();
        this.skills.setReady(false);

        this.context.events.emit('render:deactivated');
    }

    async shutdown(): Promise<void> {
        this.context.logger.info('Render plugin shutting down...');

        await this.components.cleanup();
        this.initialized = false;

        this.context.logger.info('Render plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        const oldKey = this.config.apiKey;

        const updatedConfig: RenderPluginConfig = {
            apiKey: newConfig.apiKey || this.config.apiKey,
            workspaceId: newConfig.workspaceId !== undefined ? newConfig.workspaceId : this.config.workspaceId,
            defaultServiceName: newConfig.defaultServiceName || this.config.defaultServiceName
        };

        this.config = updatedConfig;
        this.context.logger.info('Render config updated');

        if (oldKey !== this.config.apiKey) {
            await this.components.cleanup();
            await this.components.initialize();
            this.skills.setReady(true);
            this.context.events.emit('render:reconnected');
        }

        this.context.events.emit('render:config:updated', {
            workspaceId: this.config.workspaceId
        });
    }

    async listProjects(): Promise<RenderProject[]> {
        this.checkInitialized();
        return this.skills.listProjects();
    }

    async getProject(projectId: string): Promise<RenderProject> {
        this.checkInitialized();
        return this.skills.getProject(projectId);
    }

    async createProject(name: string, environments: Array<{ name: string }>): Promise<RenderProject> {
        this.checkInitialized();
        return this.skills.createProject(name, environments);
    }

    async deleteProject(projectId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteProject(projectId);
    }

    async listServices(environmentId?: string): Promise<RenderService[]> {
        this.checkInitialized();
        return this.skills.listServices(environmentId);
    }

    async getService(serviceId: string): Promise<RenderService> {
        this.checkInitialized();
        return this.skills.getService(serviceId);
    }

    async createService(options: CreateServiceOptions): Promise<{ service: RenderService; deployId: string }> {
        this.checkInitialized();
        return this.skills.createService(options);
    }

    async deleteService(serviceId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteService(serviceId);
    }

    async suspendService(serviceId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.suspendService(serviceId);
    }

    async resumeService(serviceId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.resumeService(serviceId);
    }

    async restartService(serviceId: string): Promise<void> {
        this.checkInitialized();
        return this.skills.restartService(serviceId);
    }

    async scaleService(serviceId: string, numInstances: number): Promise<void> {
        this.checkInitialized();
        return this.skills.scaleService(serviceId, numInstances);
    }

    async getEnvVars(serviceId: string): Promise<RenderEnvVar[]> {
        this.checkInitialized();
        return this.skills.getEnvVars(serviceId);
    }

    async updateEnvVars(serviceId: string, envVars: RenderEnvVar[]): Promise<RenderEnvVar[]> {
        this.checkInitialized();
        return this.skills.updateEnvVars(serviceId, envVars);
    }

    async getCustomDomains(serviceId: string): Promise<RenderCustomDomain[]> {
        this.checkInitialized();
        return this.skills.getCustomDomains(serviceId);
    }

    async addCustomDomain(serviceId: string, domain: string): Promise<RenderCustomDomain[]> {
        this.checkInitialized();
        return this.skills.addCustomDomain(serviceId, domain);
    }

    async deleteCustomDomain(serviceId: string, domainIdOrName: string): Promise<void> {
        this.checkInitialized();
        return this.skills.deleteCustomDomain(serviceId, domainIdOrName);
    }

    async listDeploys(serviceId: string, status?: string[]): Promise<RenderDeploy[]> {
        this.checkInitialized();
        return this.skills.listDeploys(serviceId, status);
    }

    async getDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        this.checkInitialized();
        return this.skills.getDeploy(serviceId, deployId);
    }

    async createDeploy(options: CreateDeployOptions): Promise<RenderDeploy> {
        this.checkInitialized();
        return this.skills.createDeploy(options);
    }

    async cancelDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        this.checkInitialized();
        return this.skills.cancelDeploy(serviceId, deployId);
    }

    async rollbackDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        this.checkInitialized();
        return this.skills.rollbackDeploy(serviceId, deployId);
    }

    async waitForDeploy(serviceId: string, deployId: string, timeout?: number): Promise<RenderDeploy> {
        this.checkInitialized();
        return this.skills.waitForDeploy(serviceId, deployId, timeout);
    }

    async getCurrentUser(): Promise<RenderOwner> {
        this.checkInitialized();
        return this.skills.getCurrentUser();
    }

    async listWorkspaces(): Promise<RenderOwner[]> {
        this.checkInitialized();
        return this.skills.listWorkspaces();
    }

    async getWorkspace(workspaceId: string): Promise<RenderOwner> {
        this.checkInitialized();
        return this.skills.getWorkspace(workspaceId);
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    getMetrics() {
        this.checkInitialized();
        return {
            projects: this.components.projects ? 'available' : 'unavailable',
            services: this.components.services ? 'available' : 'unavailable',
            deploys: this.components.deploys ? 'available' : 'unavailable',
            workspaceId: this.config.workspaceId || 'personal'
        };
    }

    private checkInitialized(): void {
        if (!this.initialized) {
            throw new Error('Plugin not initialized. Call initialize() first.');
        }
    }
}
