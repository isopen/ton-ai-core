import { PluginContext } from '@ton-ai/core';
import { RenderComponents, ProjectManager, ServiceManager, DeployManager, UserManager } from './components';
import {
    RenderPluginConfig,
    RenderProject,
    RenderService,
    RenderDeploy,
    RenderEnvVar,
    RenderSecretFile,
    RenderCustomDomain,
    RenderOwner,
    CreateServiceOptions,
    CreateDeployOptions
} from './types';

export class RenderSkills {
    private context: PluginContext;
    private components: RenderComponents;
    private config: RenderPluginConfig;
    private ready: boolean = false;

    constructor(context: PluginContext, components: RenderComponents, config: RenderPluginConfig) {
        this.context = context;
        this.components = components;
        this.config = config;
    }

    isReady(): boolean {
        return this.ready && this.components.client.isReady();
    }

    setReady(ready: boolean): void {
        this.ready = ready;
    }

    private async ensureReady(): Promise<void> {
        if (!this.isReady()) {
            throw new Error('Render plugin not ready');
        }
    }

    private getProjects(): ProjectManager {
        if (!this.components.projects) {
            throw new Error('Project manager not initialized');
        }
        return this.components.projects;
    }

    private getServices(): ServiceManager {
        if (!this.components.services) {
            throw new Error('Service manager not initialized');
        }
        return this.components.services;
    }

    private getDeploys(): DeployManager {
        if (!this.components.deploys) {
            throw new Error('Deploy manager not initialized');
        }
        return this.components.deploys;
    }

    private getUsers(): UserManager {
        if (!this.components.users) {
            throw new Error('User manager not initialized');
        }
        return this.components.users;
    }

    async listProjects(): Promise<RenderProject[]> {
        await this.ensureReady();
        return this.getProjects().listProjects(this.config.workspaceId);
    }

    async getProject(projectId: string): Promise<RenderProject> {
        await this.ensureReady();
        return this.getProjects().getProject(projectId);
    }

    async createProject(name: string, environments: Array<{ name: string }>): Promise<RenderProject> {
        await this.ensureReady();
        const ownerId = this.config.workspaceId || (await this.getUsers().getCurrentUser()).id;
        const project = await this.getProjects().createProject(name, ownerId, environments);
        this.context.events.emit('render:project:created', {
            projectId: project.id,
            name: project.name
        });
        return project;
    }

    async deleteProject(projectId: string): Promise<void> {
        await this.ensureReady();
        await this.getProjects().deleteProject(projectId);
        this.context.events.emit('render:project:deleted', { projectId });
    }

    async listServices(environmentId?: string): Promise<RenderService[]> {
        await this.ensureReady();
        return this.getServices().listServices(this.config.workspaceId, environmentId);
    }

    async getService(serviceId: string): Promise<RenderService> {
        await this.ensureReady();
        return this.getServices().getService(serviceId);
    }

    async createService(options: CreateServiceOptions): Promise<{ service: RenderService; deployId: string }> {
        await this.ensureReady();
        const result = await this.getServices().createService(options);
        this.context.events.emit('render:service:created', {
            serviceId: result.service.id,
            name: result.service.name,
            deployId: result.deployId
        });
        return result;
    }

    async deleteService(serviceId: string): Promise<void> {
        await this.ensureReady();
        await this.getServices().deleteService(serviceId);
        this.context.events.emit('render:service:deleted', { serviceId });
    }

    async suspendService(serviceId: string): Promise<void> {
        await this.ensureReady();
        await this.getServices().suspendService(serviceId);
        this.context.events.emit('render:service:suspended', { serviceId });
    }

    async resumeService(serviceId: string): Promise<void> {
        await this.ensureReady();
        await this.getServices().resumeService(serviceId);
        this.context.events.emit('render:service:resumed', { serviceId });
    }

    async restartService(serviceId: string): Promise<void> {
        await this.ensureReady();
        await this.getServices().restartService(serviceId);
        this.context.events.emit('render:service:restarted', { serviceId });
    }

    async scaleService(serviceId: string, numInstances: number): Promise<void> {
        await this.ensureReady();
        await this.getServices().scaleService(serviceId, numInstances);
        this.context.events.emit('render:service:scaled', { serviceId, numInstances });
    }

    async getEnvVars(serviceId: string): Promise<RenderEnvVar[]> {
        await this.ensureReady();
        return this.getServices().getEnvVars(serviceId);
    }

    async updateEnvVars(serviceId: string, envVars: RenderEnvVar[]): Promise<RenderEnvVar[]> {
        await this.ensureReady();
        const result = await this.getServices().updateEnvVars(serviceId, envVars);
        this.context.events.emit('render:envvars:updated', { serviceId });
        return result;
    }

    async getCustomDomains(serviceId: string): Promise<RenderCustomDomain[]> {
        await this.ensureReady();
        return this.getServices().getCustomDomains(serviceId);
    }

    async addCustomDomain(serviceId: string, domain: string): Promise<RenderCustomDomain[]> {
        await this.ensureReady();
        const result = await this.getServices().addCustomDomain(serviceId, domain);
        this.context.events.emit('render:domain:added', { serviceId, domain });
        return result;
    }

    async deleteCustomDomain(serviceId: string, domainIdOrName: string): Promise<void> {
        await this.ensureReady();
        await this.getServices().deleteCustomDomain(serviceId, domainIdOrName);
        this.context.events.emit('render:domain:deleted', { serviceId, domain: domainIdOrName });
    }

    async listDeploys(serviceId: string, status?: string[]): Promise<RenderDeploy[]> {
        await this.ensureReady();
        return this.getDeploys().listDeploys(serviceId, status);
    }

    async getDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        await this.ensureReady();
        return this.getDeploys().getDeploy(serviceId, deployId);
    }

    async createDeploy(options: CreateDeployOptions): Promise<RenderDeploy> {
        await this.ensureReady();
        const deploy = await this.getDeploys().createDeploy(options);
        this.context.events.emit('render:deploy:created', {
            serviceId: options.serviceId,
            deployId: deploy.id,
            status: deploy.status
        });
        return deploy;
    }

    async cancelDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        await this.ensureReady();
        const deploy = await this.getDeploys().cancelDeploy(serviceId, deployId);
        this.context.events.emit('render:deploy:cancelled', { serviceId, deployId });
        return deploy;
    }

    async rollbackDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        await this.ensureReady();
        const deploy = await this.getDeploys().rollbackDeploy(serviceId, deployId);
        this.context.events.emit('render:deploy:rollback', { serviceId, deployId });
        return deploy;
    }

    async waitForDeploy(serviceId: string, deployId: string, timeout?: number): Promise<RenderDeploy> {
        await this.ensureReady();
        const deploy = await this.getDeploys().waitForDeploy(serviceId, deployId, timeout);
        this.context.events.emit('render:deploy:ready', { serviceId, deployId });
        return deploy;
    }

    async getCurrentUser(): Promise<RenderOwner> {
        await this.ensureReady();
        return this.getUsers().getCurrentUser();
    }

    async listWorkspaces(): Promise<RenderOwner[]> {
        await this.ensureReady();
        return this.getUsers().listWorkspaces();
    }

    async getWorkspace(workspaceId: string): Promise<RenderOwner> {
        await this.ensureReady();
        return this.getUsers().getWorkspace(workspaceId);
    }
}
