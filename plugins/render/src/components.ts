import { PluginContext } from '@ton-ai/core';
import { EventEmitter } from 'events';
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

export class RenderClientManager {
    private baseUrl = 'https://api.render.com/v1';
    private apiKey: string;
    private context: PluginContext;
    private connected: boolean = false;
    private eventEmitter: EventEmitter;

    constructor(context: PluginContext, config: RenderPluginConfig) {
        this.context = context;
        this.apiKey = config.apiKey;
        this.eventEmitter = new EventEmitter();
    }

    async initialize(): Promise<void> {
        try {
            this.context.logger.info('Initializing Render client');
            await this.validateApiKey();
            this.connected = true;
            this.eventEmitter.emit('ready');
            this.context.logger.info('Render client initialized');
        } catch (error) {
            this.context.logger.error('Failed to initialize Render client:', error);
            this.eventEmitter.emit('error', error);
            throw error;
        }
    }

    private async validateApiKey(): Promise<void> {
        await this.request<RenderOwner>('/users');
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.eventEmitter.emit('disconnected');
        this.context.logger.info('Render client disconnected');
    }

    isReady(): boolean {
        return this.connected;
    }

    on(event: string, listener: (...args: any[]) => void): void {
        this.eventEmitter.on(event, listener);
    }

    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        if (!this.connected && !endpoint.includes('/users')) {
            throw new Error('Render client not initialized');
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Render API error: ${response.status} ${response.statusText} - ${text}`);
        }

        if (response.status === 204) {
            return {} as T;
        }

        const data = await response.json();
        return data as T;
    }
}

export class ProjectManager {
    private client: RenderClientManager;
    private context: PluginContext;

    constructor(context: PluginContext, client: RenderClientManager) {
        this.context = context;
        this.client = client;
    }

    async listProjects(ownerId?: string): Promise<RenderProject[]> {
        try {
            const params = ownerId ? `?ownerId=${ownerId}` : '';
            const projects = await this.client.request<RenderProject[]>(`/projects${params}`);
            this.context.logger.info(`Found ${projects.length} projects`);
            return projects;
        } catch (error) {
            this.context.logger.error('Failed to list projects:', error);
            return [];
        }
    }

    async getProject(projectId: string): Promise<RenderProject> {
        try {
            return await this.client.request<RenderProject>(`/projects/${projectId}`);
        } catch (error) {
            this.context.logger.error(`Failed to get project ${projectId}:`, error);
            throw error;
        }
    }

    async createProject(name: string, ownerId: string, environments: Array<{ name: string }>): Promise<RenderProject> {
        try {
            const project = await this.client.request<RenderProject>('/projects', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    ownerId,
                    environments
                })
            });
            this.context.logger.info(`Project ${name} created`);
            return project;
        } catch (error) {
            this.context.logger.error('Failed to create project:', error);
            throw error;
        }
    }

    async updateProject(projectId: string, name: string): Promise<RenderProject> {
        try {
            return await this.client.request<RenderProject>(`/projects/${projectId}`, {
                method: 'PATCH',
                body: JSON.stringify({ name })
            });
        } catch (error) {
            this.context.logger.error(`Failed to update project ${projectId}:`, error);
            throw error;
        }
    }

    async deleteProject(projectId: string): Promise<void> {
        try {
            await this.client.request(`/projects/${projectId}`, {
                method: 'DELETE'
            });
            this.context.logger.info(`Project ${projectId} deleted`);
        } catch (error) {
            this.context.logger.error(`Failed to delete project ${projectId}:`, error);
            throw error;
        }
    }
}

export class ServiceManager {
    private client: RenderClientManager;
    private context: PluginContext;

    constructor(context: PluginContext, client: RenderClientManager) {
        this.context = context;
        this.client = client;
    }

    async listServices(ownerId?: string, environmentId?: string): Promise<RenderService[]> {
        try {
            const params = new URLSearchParams();
            if (ownerId) params.append('ownerId', ownerId);
            if (environmentId) params.append('environmentId', environmentId);

            const query = params.toString() ? `?${params.toString()}` : '';
            const services = await this.client.request<RenderService[]>(`/services${query}`);
            this.context.logger.info(`Found ${services.length} services`);
            return services;
        } catch (error) {
            this.context.logger.error('Failed to list services:', error);
            return [];
        }
    }

    async getService(serviceId: string): Promise<RenderService> {
        try {
            return await this.client.request<RenderService>(`/services/${serviceId}`);
        } catch (error) {
            this.context.logger.error(`Failed to get service ${serviceId}:`, error);
            throw error;
        }
    }

    async createService(options: CreateServiceOptions): Promise<{ service: RenderService; deployId: string }> {
        try {
            this.context.logger.info('=== CREATE SERVICE DEBUG ===');
            this.context.logger.info('Options: ' + JSON.stringify(options, null, 2));

            const result = await this.client.request<{ service: RenderService; deployId: string }>('/services', {
                method: 'POST',
                body: JSON.stringify(options)
            });

            this.context.logger.info(`Service ${options.name} created with ID: ${result.service.id}`);
            return result;
        } catch (error) {
            this.context.logger.error('Failed to create service:', error);
            throw error;
        }
    }

    async updateService(serviceId: string, updates: Partial<CreateServiceOptions>): Promise<RenderService> {
        try {
            const service = await this.client.request<RenderService>(`/services/${serviceId}`, {
                method: 'PATCH',
                body: JSON.stringify(updates)
            });
            this.context.logger.info(`Service ${serviceId} updated`);
            return service;
        } catch (error) {
            this.context.logger.error(`Failed to update service ${serviceId}:`, error);
            throw error;
        }
    }

    async deleteService(serviceId: string): Promise<void> {
        try {
            await this.client.request(`/services/${serviceId}`, {
                method: 'DELETE'
            });
            this.context.logger.info(`Service ${serviceId} deleted`);
        } catch (error) {
            this.context.logger.error(`Failed to delete service ${serviceId}:`, error);
            throw error;
        }
    }

    async suspendService(serviceId: string): Promise<void> {
        try {
            await this.client.request(`/services/${serviceId}/suspend`, {
                method: 'POST'
            });
            this.context.logger.info(`Service ${serviceId} suspended`);
        } catch (error) {
            this.context.logger.error(`Failed to suspend service ${serviceId}:`, error);
            throw error;
        }
    }

    async resumeService(serviceId: string): Promise<void> {
        try {
            await this.client.request(`/services/${serviceId}/resume`, {
                method: 'POST'
            });
            this.context.logger.info(`Service ${serviceId} resumed`);
        } catch (error) {
            this.context.logger.error(`Failed to resume service ${serviceId}:`, error);
            throw error;
        }
    }

    async restartService(serviceId: string): Promise<void> {
        try {
            await this.client.request(`/services/${serviceId}/restart`, {
                method: 'POST'
            });
            this.context.logger.info(`Service ${serviceId} restarted`);
        } catch (error) {
            this.context.logger.error(`Failed to restart service ${serviceId}:`, error);
            throw error;
        }
    }

    async scaleService(serviceId: string, numInstances: number): Promise<void> {
        try {
            await this.client.request(`/services/${serviceId}/scale`, {
                method: 'POST',
                body: JSON.stringify({ numInstances })
            });
            this.context.logger.info(`Service ${serviceId} scaled to ${numInstances} instances`);
        } catch (error) {
            this.context.logger.error(`Failed to scale service ${serviceId}:`, error);
            throw error;
        }
    }

    async getEnvVars(serviceId: string): Promise<RenderEnvVar[]> {
        try {
            return await this.client.request<RenderEnvVar[]>(`/services/${serviceId}/env-vars`);
        } catch (error) {
            this.context.logger.error(`Failed to get env vars for service ${serviceId}:`, error);
            throw error;
        }
    }

    async updateEnvVars(serviceId: string, envVars: RenderEnvVar[]): Promise<RenderEnvVar[]> {
        try {
            const result = await this.client.request<RenderEnvVar[]>(`/services/${serviceId}/env-vars`, {
                method: 'PUT',
                body: JSON.stringify(envVars)
            });
            this.context.logger.info(`Environment variables updated for service ${serviceId}`);
            return result;
        } catch (error) {
            this.context.logger.error(`Failed to update env vars for service ${serviceId}:`, error);
            throw error;
        }
    }

    async getCustomDomains(serviceId: string): Promise<RenderCustomDomain[]> {
        try {
            return await this.client.request<RenderCustomDomain[]>(`/services/${serviceId}/custom-domains`);
        } catch (error) {
            this.context.logger.error(`Failed to get custom domains for service ${serviceId}:`, error);
            throw error;
        }
    }

    async addCustomDomain(serviceId: string, domain: string): Promise<RenderCustomDomain[]> {
        try {
            const domains = await this.client.request<RenderCustomDomain[]>(`/services/${serviceId}/custom-domains`, {
                method: 'POST',
                body: JSON.stringify({ name: domain })
            });
            this.context.logger.info(`Custom domain ${domain} added to service ${serviceId}`);
            return domains;
        } catch (error) {
            this.context.logger.error(`Failed to add custom domain to service ${serviceId}:`, error);
            throw error;
        }
    }

    async deleteCustomDomain(serviceId: string, domainIdOrName: string): Promise<void> {
        try {
            await this.client.request(`/services/${serviceId}/custom-domains/${domainIdOrName}`, {
                method: 'DELETE'
            });
            this.context.logger.info(`Custom domain ${domainIdOrName} removed from service ${serviceId}`);
        } catch (error) {
            this.context.logger.error(`Failed to remove custom domain from service ${serviceId}:`, error);
            throw error;
        }
    }
}

export class DeployManager {
    private client: RenderClientManager;
    private context: PluginContext;

    constructor(context: PluginContext, client: RenderClientManager) {
        this.context = context;
        this.client = client;
    }

    async listDeploys(serviceId: string, status?: string[]): Promise<RenderDeploy[]> {
        try {
            const params = status ? `?status=${status.join(',')}` : '';
            const deploys = await this.client.request<RenderDeploy[]>(`/services/${serviceId}/deploys${params}`);
            this.context.logger.info(`Found ${deploys.length} deploys for service ${serviceId}`);
            return deploys;
        } catch (error) {
            this.context.logger.error(`Failed to list deploys for service ${serviceId}:`, error);
            return [];
        }
    }

    async getDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        try {
            return await this.client.request<RenderDeploy>(`/services/${serviceId}/deploys/${deployId}`);
        } catch (error) {
            this.context.logger.error(`Failed to get deploy ${deployId}:`, error);
            throw error;
        }
    }

    async createDeploy(options: CreateDeployOptions): Promise<RenderDeploy> {
        try {
            this.context.logger.info('=== CREATE DEPLOY DEBUG ===');
            this.context.logger.info('Options: ' + JSON.stringify(options, null, 2));

            const deploy = await this.client.request<RenderDeploy>(`/services/${options.serviceId}/deploys`, {
                method: 'POST',
                body: JSON.stringify({
                    clearCache: options.clearCache || 'do_not_clear',
                    commitId: options.commitId,
                    imageUrl: options.imageUrl,
                    deployMode: options.deployMode || 'build_and_deploy'
                })
            });

            this.context.logger.info(`Deploy created for service ${options.serviceId}: ${deploy.id}`);
            return deploy;
        } catch (error) {
            this.context.logger.error('Failed to create deploy:', error);
            throw error;
        }
    }

    async cancelDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        try {
            const deploy = await this.client.request<RenderDeploy>(`/services/${serviceId}/deploys/${deployId}/cancel`, {
                method: 'POST'
            });
            this.context.logger.info(`Deploy ${deployId} cancelled`);
            return deploy;
        } catch (error) {
            this.context.logger.error(`Failed to cancel deploy ${deployId}:`, error);
            throw error;
        }
    }

    async rollbackDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
        try {
            const deploy = await this.client.request<RenderDeploy>(`/services/${serviceId}/rollback`, {
                method: 'POST',
                body: JSON.stringify({ deployId })
            });
            this.context.logger.info(`Rollback to deploy ${deployId} initiated for service ${serviceId}`);
            return deploy;
        } catch (error) {
            this.context.logger.error(`Failed to rollback to deploy ${deployId}:`, error);
            throw error;
        }
    }

    async waitForDeploy(serviceId: string, deployId: string, timeout: number = 300000): Promise<RenderDeploy> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const deploy = await this.getDeploy(serviceId, deployId);

            if (deploy.status === 'live') {
                this.context.logger.info(`Deploy ${deployId} is live`);
                return deploy;
            }

            if (['build_failed', 'update_failed', 'canceled'].includes(deploy.status)) {
                throw new Error(`Deploy ${deployId} failed with status: ${deploy.status}`);
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        throw new Error(`Timeout waiting for deploy ${deployId}`);
    }
}

export class UserManager {
    private client: RenderClientManager;
    private context: PluginContext;

    constructor(context: PluginContext, client: RenderClientManager) {
        this.context = context;
        this.client = client;
    }

    async getCurrentUser(): Promise<RenderOwner> {
        try {
            return await this.client.request<RenderOwner>('/users');
        } catch (error) {
            this.context.logger.error('Failed to get current user:', error);
            throw error;
        }
    }

    async listWorkspaces(): Promise<RenderOwner[]> {
        try {
            const owners = await this.client.request<RenderOwner[]>('/owners');
            this.context.logger.info(`Found ${owners.length} workspaces`);
            return owners;
        } catch (error) {
            this.context.logger.error('Failed to list workspaces:', error);
            return [];
        }
    }

    async getWorkspace(workspaceId: string): Promise<RenderOwner> {
        try {
            return await this.client.request<RenderOwner>(`/owners/${workspaceId}`);
        } catch (error) {
            this.context.logger.error(`Failed to get workspace ${workspaceId}:`, error);
            throw error;
        }
    }
}

export class RenderComponents {
    public client: RenderClientManager;
    public projects: ProjectManager | null = null;
    public services: ServiceManager | null = null;
    public deploys: DeployManager | null = null;
    public users: UserManager | null = null;
    private context: PluginContext;
    private config: RenderPluginConfig;

    constructor(context: PluginContext, config: RenderPluginConfig) {
        this.context = context;
        this.config = config;
        this.client = new RenderClientManager(context, config);
    }

    async initialize(): Promise<void> {
        await this.client.initialize();
        this.projects = new ProjectManager(this.context, this.client);
        this.services = new ServiceManager(this.context, this.client);
        this.deploys = new DeployManager(this.context, this.client);
        this.users = new UserManager(this.context, this.client);
        this.context.logger.info('Render components initialized');
    }

    async cleanup(): Promise<void> {
        await this.client.disconnect();
        this.projects = null;
        this.services = null;
        this.deploys = null;
        this.users = null;
    }
}
