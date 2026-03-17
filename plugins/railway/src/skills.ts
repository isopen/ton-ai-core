import { PluginContext } from '@ton-ai/core';
import {
    RailwayComponents,
    ProjectManager,
    ServiceManager,
    EnvironmentManager
} from './components';
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

export class RailwaySkills {
    private context: PluginContext;
    private components: RailwayComponents;
    private config: RailwayPluginConfig;
    private ready: boolean = false;

    constructor(context: PluginContext, components: RailwayComponents, config: RailwayPluginConfig) {
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
            throw new Error('Railway plugin not ready');
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

    private getEnvironments(): EnvironmentManager {
        if (!this.components.environments) {
            throw new Error('Environment manager not initialized');
        }
        return this.components.environments;
    }

    async listProjects(workspaceId?: string): Promise<RailwayProject[]> {
        await this.ensureReady();
        return this.getProjects().listProjects(workspaceId);
    }

    async getProject(projectId: string): Promise<RailwayProject> {
        await this.ensureReady();
        return this.getProjects().getProject(projectId);
    }

    async createProject(options: CreateProjectOptions): Promise<RailwayProject> {
        await this.ensureReady();
        const project = await this.getProjects().createProject(options);
        this.context.events.emit('railway:project:created', {
            projectId: project.id,
            name: project.name
        });
        return project;
    }

    async deleteProject(projectId: string): Promise<void> {
        await this.ensureReady();
        await this.getProjects().deleteProject(projectId);
        this.context.events.emit('railway:project:deleted', { projectId });
    }

    async createService(options: DeployServiceOptions): Promise<RailwayService> {
        await this.ensureReady();
        const service = await this.getServices().createService(options);
        this.context.events.emit('railway:service:created', {
            serviceId: service.id,
            projectId: options.projectId,
            name: service.name
        });
        return service;
    }

    async listServices(projectId: string): Promise<RailwayService[]> {
        await this.ensureReady();
        return this.getServices().listServices(projectId);
    }

    async getService(serviceId: string): Promise<RailwayService> {
        await this.ensureReady();
        return this.getServices().getService(serviceId);
    }

    async deleteService(serviceId: string): Promise<void> {
        await this.ensureReady();
        await this.getServices().deleteService(serviceId);
        this.context.events.emit('railway:service:deleted', { serviceId });
    }

    async updateServiceInstance(serviceId: string, environmentId: string, config: UpdateServiceInstanceOptions): Promise<void> {
        await this.ensureReady();
        await this.getServices().updateServiceInstance(serviceId, environmentId, config);
        this.context.events.emit('railway:service:updated', { serviceId, environmentId });
    }

    async triggerDeploy(serviceId: string, environmentId: string): Promise<string> {
        await this.ensureReady();
        const deploymentId = await this.getServices().triggerDeploy(serviceId, environmentId);
        this.context.events.emit('railway:deployment:triggered', {
            serviceId,
            environmentId,
            deploymentId
        });
        return deploymentId;
    }

    async getDeployments(serviceId: string, environmentId: string): Promise<RailwayDeployment[]> {
        await this.ensureReady();
        return this.getServices().getDeployments(serviceId, environmentId);
    }

    async getLatestDeployment(serviceId: string, environmentId: string): Promise<RailwayDeployment | null> {
        await this.ensureReady();
        return this.getServices().getLatestDeployment(serviceId, environmentId);
    }

    async waitForServiceReady(serviceId: string, environmentId: string, timeout: number = 300000): Promise<RailwayDeployment> {
        await this.ensureReady();
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const deployment = await this.getServices().getLatestDeployment(serviceId, environmentId);

            if (deployment) {
                if (deployment.status === 'SUCCESS') {
                    this.context.events.emit('railway:service:ready', {
                        serviceId,
                        deploymentId: deployment.id,
                        url: deployment.url
                    });
                    return deployment;
                }

                if (deployment.status === 'FAILED') {
                    throw new Error(`Deployment failed with status: ${deployment.status}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        throw new Error(`Timeout waiting for service ${serviceId} to be ready`);
    }

    async createEnvironment(projectId: string, name: string): Promise<RailwayEnvironment> {
        await this.ensureReady();
        return this.getEnvironments().createEnvironment(projectId, name);
    }

    async listEnvironments(projectId: string): Promise<RailwayEnvironment[]> {
        await this.ensureReady();
        return this.getEnvironments().listEnvironments(projectId);
    }

    async deleteEnvironment(environmentId: string): Promise<void> {
        await this.ensureReady();
        await this.getEnvironments().deleteEnvironment(environmentId);
        this.context.events.emit('railway:environment:deleted', { environmentId });
    }

    async setEnvironmentVariables(projectId: string, environmentId: string, variables: Record<string, string>, serviceId?: string): Promise<void> {
        await this.ensureReady();
        await this.getEnvironments().setEnvironmentVariables(projectId, environmentId, variables, serviceId);
        this.context.events.emit('railway:variables:updated', { environmentId, serviceId });
    }

    async getEnvironmentVariables(projectId: string, environmentId: string, serviceId?: string): Promise<Record<string, string>> {
        await this.ensureReady();
        return this.getEnvironments().getVariables(projectId, environmentId, serviceId);
    }
}
