import { PluginContext } from '@ton-ai/core';
import { EventEmitter } from 'events';
import {
    RailwayPluginConfig,
    RailwayProject,
    RailwayService,
    RailwayEnvironment,
    RailwayDeployment,
    CreateProjectOptions,
    DeployServiceOptions,
    UpdateServiceInstanceOptions,
    GraphQLResponse
} from './types';

export class RailwayGraphQLClient {
    private endpoint = 'https://backboard.railway.com/graphql/v2';
    private apiToken: string;
    private tokenType: string;
    private teamId?: string;
    private context: PluginContext;
    private connected: boolean = false;
    private eventEmitter: EventEmitter;

    constructor(context: PluginContext, config: RailwayPluginConfig) {
        this.context = context;
        this.apiToken = config.apiToken;
        this.tokenType = config.tokenType;
        this.teamId = config.teamId;
        this.eventEmitter = new EventEmitter();
    }

    async initialize(): Promise<void> {
        try {
            this.context.logger.info('Initializing Railway GraphQL client');
            await this.validateToken();
            this.connected = true;
            this.eventEmitter.emit('ready');
            this.context.logger.info('Railway client initialized');
        } catch (error) {
            this.context.logger.error('Failed to initialize Railway client:', error);
            this.eventEmitter.emit('error', error);
            throw error;
        }
    }

    private async validateToken(): Promise<void> {
        try {
            let query = '';
            let variables = {};

            if (this.tokenType === 'project') {
                query = 'query { projectToken { projectId } }';
            } else if (this.tokenType === 'workspace') {
                if (!this.teamId) {
                    throw new Error('teamId is required for workspace token');
                }
                query = 'query GetWorkspace($workspaceId: String!) { workspace(workspaceId: $workspaceId) { id name } }';
                variables = { workspaceId: this.teamId };
            } else {
                query = 'query { me { id } }';
            }

            const result = await this.request(query, variables);

            if (this.tokenType === 'workspace') {
                const workspace = (result as any)?.workspace;
                if (!workspace) {
                    throw new Error('Workspace not found');
                }
                this.context.logger.info(`Workspace validated: ${workspace.name} (${workspace.id})`);
            }

            this.context.logger.info(`Token validated successfully (type: ${this.tokenType})`);
        } catch (error) {
            this.context.logger.error('Token validation failed:', error);
            throw new Error(`Invalid Railway API token (type: ${this.tokenType})`);
        }
    }

    async request<T>(query: string, variables?: any): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.tokenType === 'project') {
            headers['Project-Access-Token'] = this.apiToken;
        } else {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query,
                variables
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Railway API error: ${response.status} ${response.statusText} - ${text}`);
        }

        const result = await response.json() as GraphQLResponse<T>;

        if (result.errors) {
            throw new Error(result.errors[0].message);
        }

        return result.data as T;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.eventEmitter.emit('disconnected');
        this.context.logger.info('Railway client disconnected');
    }

    isReady(): boolean {
        return this.connected;
    }

    on(event: string, listener: (...args: any[]) => void): void {
        this.eventEmitter.on(event, listener);
    }
}

export class ProjectManager {
    private client: RailwayGraphQLClient;
    private context: PluginContext;

    constructor(context: PluginContext, client: RailwayGraphQLClient) {
        this.context = context;
        this.client = client;
    }

    async listProjects(workspaceId?: string): Promise<RailwayProject[]> {
        try {
            let query: string;
            let variables: any = {};

            if (workspaceId) {
                query = `
                    query workspaceProjects($workspaceId: String!) {
                        projects(workspaceId: $workspaceId) {
                            edges {
                                node {
                                    id
                                    name
                                    description
                                    createdAt
                                    updatedAt
                                }
                            }
                        }
                    }
                `;
                variables = { workspaceId };
            } else {
                query = `
                    query {
                        projects {
                            edges {
                                node {
                                    id
                                    name
                                    description
                                    createdAt
                                    updatedAt
                                }
                            }
                        }
                    }
                `;
            }

            this.context.logger.info(`Listing projects${workspaceId ? ` for workspace: ${workspaceId}` : ''}`);
            const data = await this.client.request<{ projects: { edges: Array<{ node: RailwayProject }> } }>(
                query,
                variables
            );

            const projects = data?.projects?.edges?.map(edge => edge.node) || [];
            this.context.logger.info(`Found ${projects.length} projects`);
            return projects;
        } catch (error) {
            this.context.logger.error('Failed to list projects:', error);
            return [];
        }
    }

    async getProject(projectId: string): Promise<RailwayProject> {
        try {
            const query = `
                query project($id: String!) {
                    project(id: $id) {
                        id
                        name
                        description
                        createdAt
                        updatedAt
                        services {
                            edges {
                                node {
                                    id
                                    name
                                }
                            }
                        }
                        environments {
                            edges {
                                node {
                                    id
                                    name
                                }
                            }
                        }
                    }
                }
            `;
            const data = await this.client.request<{ project: RailwayProject }>(query, { id: projectId });
            return data.project;
        } catch (error) {
            this.context.logger.error(`Failed to get project ${projectId}:`, error);
            throw error;
        }
    }

    async createProject(options: CreateProjectOptions): Promise<RailwayProject> {
        try {
            const mutation = `
                mutation projectCreate($input: ProjectCreateInput!) {
                    projectCreate(input: $input) {
                        id
                        name
                        description
                    }
                }
            `;
            const variables = {
                input: {
                    name: options.name,
                    description: options.description,
                    ...(options.workspaceId && { workspaceId: options.workspaceId })
                }
            };
            const data = await this.client.request<{ projectCreate: RailwayProject }>(mutation, variables);
            this.context.logger.info(`Project ${options.name} created`);
            return data.projectCreate;
        } catch (error) {
            this.context.logger.error('Failed to create project:', error);
            throw error;
        }
    }

    async deleteProject(projectId: string): Promise<void> {
        try {
            const mutation = `
                mutation projectDelete($id: String!) {
                    projectDelete(id: $id)
                }
            `;
            await this.client.request(mutation, { id: projectId });
            this.context.logger.info(`Project ${projectId} deleted`);
        } catch (error) {
            this.context.logger.error('Failed to delete project:', error);
            throw error;
        }
    }
}

export class ServiceManager {
    private client: RailwayGraphQLClient;
    private context: PluginContext;

    constructor(context: PluginContext, client: RailwayGraphQLClient) {
        this.context = context;
        this.client = client;
    }

    async listServices(projectId: string): Promise<RailwayService[]> {
        try {
            const query = `
                query project($id: String!) {
                    project(id: $id) {
                        services {
                            edges {
                                node {
                                    id
                                    name
                                    source {
                                        repo
                                        branch
                                    }
                                }
                            }
                        }
                    }
                }
            `;
            const data = await this.client.request<{ project: { services: { edges: Array<{ node: RailwayService }> } } }>(
                query,
                { id: projectId }
            );
            return data?.project?.services?.edges?.map(edge => edge.node) || [];
        } catch (error) {
            this.context.logger.error('Failed to list services:', error);
            throw error;
        }
    }

    async getService(serviceId: string): Promise<RailwayService> {
        try {
            const query = `
                query service($id: String!) {
                    service(id: $id) {
                        id
                        name
                        projectId
                        source {
                            repo
                            branch
                        }
                    }
                }
            `;
            const data = await this.client.request<{ service: RailwayService }>(query, { id: serviceId });
            return data.service;
        } catch (error) {
            this.context.logger.error('Failed to get service:', error);
            throw error;
        }
    }

    async createService(options: DeployServiceOptions): Promise<RailwayService> {
        try {
            this.context.logger.info('=== CREATE SERVICE DEBUG ===');
            this.context.logger.info('Options received: ' + JSON.stringify(options, null, 2));

            const mutation = `
                mutation serviceCreate($input: ServiceCreateInput!) {
                    serviceCreate(input: $input) {
                        id
                        name
                    }
                }
            `;

            const variables = {
                input: {
                    projectId: options.projectId,
                    name: options.serviceName,
                    source: {
                        repo: options.source.repo
                    },
                    ...(options.branch && { branch: options.branch })
                }
            };

            this.context.logger.info('Mutation: ' + mutation);
            this.context.logger.info('Variables: ' + JSON.stringify(variables, null, 2));

            const data = await this.client.request<{ serviceCreate: RailwayService }>(mutation, variables);
            this.context.logger.info('Response data: ' + JSON.stringify(data, null, 2));

            return {
                ...data.serviceCreate,
                projectId: options.projectId
            };
        } catch (error) {
            this.context.logger.error('Failed to create service: ' + error);
            throw error;
        }
    }

    async deleteService(serviceId: string): Promise<void> {
        try {
            const mutation = `
                mutation serviceDelete($id: String!) {
                    serviceDelete(id: $id)
                }
            `;
            await this.client.request(mutation, { id: serviceId });
            this.context.logger.info(`Service ${serviceId} deleted`);
        } catch (error) {
            this.context.logger.error('Failed to delete service:', error);
            throw error;
        }
    }

    async updateServiceInstance(serviceId: string, environmentId: string, config: UpdateServiceInstanceOptions): Promise<void> {
        try {
            this.context.logger.info('=== UPDATE SERVICE INSTANCE DEBUG ===');
            this.context.logger.info('ServiceId: ' + serviceId);
            this.context.logger.info('EnvironmentId: ' + environmentId);
            this.context.logger.info('Config: ' + JSON.stringify(config, null, 2));

            const mutation = `
                mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
                    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
                }
            `;

            const variables = {
                serviceId,
                environmentId,
                input: {
                    ...(config.buildCommand && { buildCommand: config.buildCommand }),
                    ...(config.startCommand && { startCommand: config.startCommand })
                }
            };

            this.context.logger.info('Mutation: ' + mutation);
            this.context.logger.info('Variables: ' + JSON.stringify(variables, null, 2));

            await this.client.request(mutation, variables);
            this.context.logger.info('Service instance updated successfully');
        } catch (error) {
            this.context.logger.error('Failed to update service instance: ' + error);
            throw error;
        }
    }

    async getDeployments(serviceId: string, environmentId: string): Promise<RailwayDeployment[]> {
        try {
            const query = `
                query deployments($input: DeploymentListInput!, $first: Int) {
                    deployments(input: $input, first: $first) {
                        edges {
                            node {
                                id
                                status
                                url
                                createdAt
                            }
                        }
                    }
                }
            `;
            const variables = {
                input: {
                    serviceId,
                    environmentId
                },
                first: 10
            };
            const data = await this.client.request<{ deployments: { edges: Array<{ node: RailwayDeployment }> } }>(query, variables);
            return data?.deployments?.edges?.map(edge => edge.node) || [];
        } catch (error) {
            this.context.logger.error('Failed to get deployments:', error);
            throw error;
        }
    }

    async getLatestDeployment(serviceId: string, environmentId: string): Promise<RailwayDeployment | null> {
        try {
            const query = `
                query latestDeployment($input: DeploymentListInput!) {
                    deployments(input: $input, first: 1) {
                        edges {
                            node {
                                id
                                status
                                url
                                createdAt
                            }
                        }
                    }
                }
            `;
            const variables = {
                input: {
                    serviceId,
                    environmentId
                }
            };
            const data = await this.client.request<{ deployments: { edges: Array<{ node: RailwayDeployment }> } }>(query, variables);
            return data?.deployments?.edges[0]?.node || null;
        } catch (error) {
            this.context.logger.error('Failed to get latest deployment:', error);
            return null;
        }
    }

    async triggerDeploy(serviceId: string, environmentId: string): Promise<string> {
        try {
            const mutation = `
                mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
                    serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
                }
            `;
            const deploymentId = await this.client.request<string>(mutation, { serviceId, environmentId });
            this.context.logger.info(`Deployment triggered for service ${serviceId}`);
            return deploymentId;
        } catch (error) {
            this.context.logger.error('Failed to trigger deploy:', error);
            throw error;
        }
    }
}

export class EnvironmentManager {
    private client: RailwayGraphQLClient;
    private context: PluginContext;

    constructor(context: PluginContext, client: RailwayGraphQLClient) {
        this.context = context;
        this.client = client;
    }

    async listEnvironments(projectId: string): Promise<RailwayEnvironment[]> {
        try {
            const query = `
                query environments($projectId: String!) {
                    environments(projectId: $projectId) {
                        edges {
                            node {
                                id
                                name
                            }
                        }
                    }
                }
            `;
            const data = await this.client.request<{ environments: { edges: Array<{ node: RailwayEnvironment }> } }>(
                query,
                { projectId }
            );
            return data?.environments?.edges?.map(edge => edge.node) || [];
        } catch (error) {
            this.context.logger.error('Failed to list environments:', error);
            throw error;
        }
    }

    async createEnvironment(projectId: string, name: string): Promise<RailwayEnvironment> {
        try {
            const mutation = `
                mutation environmentCreate($input: EnvironmentCreateInput!) {
                    environmentCreate(input: $input) {
                        id
                        name
                    }
                }
            `;
            const variables = {
                input: {
                    projectId,
                    name
                }
            };
            const data = await this.client.request<{ environmentCreate: RailwayEnvironment }>(mutation, variables);
            this.context.logger.info(`Environment ${name} created`);
            return data.environmentCreate;
        } catch (error) {
            this.context.logger.error('Failed to create environment:', error);
            throw error;
        }
    }

    async deleteEnvironment(environmentId: string): Promise<void> {
        try {
            const mutation = `
                mutation environmentDelete($id: String!) {
                    environmentDelete(id: $id)
                }
            `;
            await this.client.request(mutation, { id: environmentId });
            this.context.logger.info(`Environment ${environmentId} deleted`);
        } catch (error) {
            this.context.logger.error('Failed to delete environment:', error);
            throw error;
        }
    }

    async setEnvironmentVariables(projectId: string, environmentId: string, variables: Record<string, string>, serviceId?: string): Promise<void> {
        try {
            this.context.logger.info('=== SET ENVIRONMENT VARIABLES DEBUG ===');
            this.context.logger.info('ProjectId: ' + projectId);
            this.context.logger.info('EnvironmentId: ' + environmentId);
            this.context.logger.info('ServiceId: ' + (serviceId || 'not provided (shared variables)'));
            this.context.logger.info('Variables to set: ' + Object.keys(variables).join(', '));

            const mutation = `
                mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
                    variableCollectionUpsert(input: $input)
                }
            `;

            const input: any = {
                projectId,
                environmentId,
                variables: {}
            };

            if (serviceId) {
                input.serviceId = serviceId;
            }

            Object.entries(variables).forEach(([key, value]) => {
                if (value) {
                    input.variables[key] = value;
                }
            });

            this.context.logger.info('Input: ' + JSON.stringify(input, null, 2));

            await this.client.request(mutation, { input });
            this.context.logger.info('Variables set successfully');
        } catch (error) {
            this.context.logger.error('Failed to set environment variables: ' + error);
            throw error;
        }
    }

    async getVariables(projectId: string, environmentId: string, serviceId?: string): Promise<Record<string, string>> {
        try {
            const query = `
                query variables($projectId: String!, $environmentId: String!, $serviceId: String) {
                    variables(
                        projectId: $projectId
                        environmentId: $environmentId
                        serviceId: $serviceId
                    )
                }
            `;
            const variables = {
                projectId,
                environmentId,
                ...(serviceId && { serviceId })
            };
            const data = await this.client.request<{ variables: Record<string, string> }>(query, variables);
            return data.variables || {};
        } catch (error) {
            this.context.logger.error('Failed to get variables: ' + error);
            return {};
        }
    }
}

export class RailwayComponents {
    public client: RailwayGraphQLClient;
    public projects: ProjectManager | null = null;
    public services: ServiceManager | null = null;
    public environments: EnvironmentManager | null = null;
    private context: PluginContext;
    private config: RailwayPluginConfig;

    constructor(context: PluginContext, config: RailwayPluginConfig) {
        this.context = context;
        this.config = config;
        this.client = new RailwayGraphQLClient(context, config);
    }

    async initialize(): Promise<void> {
        await this.client.initialize();
        this.projects = new ProjectManager(this.context, this.client);
        this.services = new ServiceManager(this.context, this.client);
        this.environments = new EnvironmentManager(this.context, this.client);
        this.context.logger.info('Railway components initialized');
    }

    async cleanup(): Promise<void> {
        await this.client.disconnect();
        this.projects = null;
        this.services = null;
        this.environments = null;
    }
}
