import { Vercel } from '@vercel/sdk';
import { PluginContext } from '@ton-ai/core';
import EventEmitter from 'events';
import {
    VercelPluginConfig,
    VercelProject,
    VercelDeployment,
    CreateProjectOptions,
    DeployOptions,
    EnvironmentVariableOptions
} from './types';

export class VercelClientManager extends EventEmitter {
    private client: Vercel | null = null;
    private context: PluginContext;
    private config: VercelPluginConfig;
    private isConnected: boolean = false;

    constructor(context: PluginContext, config: VercelPluginConfig) {
        super();
        this.context = context;
        this.config = config;
    }

    async initialize(): Promise<void> {
        try {
            this.context.logger.info('Initializing Vercel client');
            this.client = new Vercel({
                bearerToken: this.config.accessToken,
            });
            this.isConnected = true;
            this.emit('ready');
            this.context.logger.info('Vercel client initialized successfully');
        } catch (error) {
            this.context.logger.error('Failed to initialize Vercel client:', error);
            this.emit('error', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        this.client = null;
        this.isConnected = false;
        this.emit('disconnected');
        this.context.logger.info('Vercel client disconnected');
    }

    isReady(): boolean {
        return this.isConnected && this.client !== null;
    }

    getClient(): Vercel {
        if (!this.isReady() || !this.client) {
            throw new Error('Vercel client not initialized');
        }
        return this.client;
    }
}

export class ProjectManager {
    private client: Vercel;
    private context: PluginContext;

    constructor(context: PluginContext, client: Vercel) {
        this.context = context;
        this.client = client;
    }

    async listProjects(teamId?: string): Promise<VercelProject[]> {
        try {
            const response = await this.client.projects.getProjects({
                teamId
            });

            let projects: any[] = [];
            if (Array.isArray(response)) {
                projects = response;
            } else if (response && typeof response === 'object' && 'projects' in response) {
                projects = (response as any).projects || [];
            }

            return projects.map((p: any) => ({
                id: p.id,
                name: p.name,
                accountId: p.accountId || '',
                createdAt: p.createdAt || Date.now(),
                updatedAt: p.updatedAt || Date.now(),
                framework: p.framework,
                gitRepository: p.link ? {
                    type: p.link.type || 'github',
                    repo: p.link.repo || '',
                    owner: p.link.owner || '',
                    path: p.link.path
                } : null
            }));
        } catch (error) {
            this.context.logger.error('Failed to list projects:', error);
            throw error;
        }
    }

    async getProject(projectId: string, teamId?: string): Promise<VercelProject> {
        try {
            const project = await this.client.projects.getProjectDomain({
                idOrName: projectId,
                domain: projectId,
                teamId
            });

            return {
                id: (project as any).id,
                name: (project as any).name,
                accountId: (project as any).accountId || '',
                createdAt: (project as any).createdAt || Date.now(),
                updatedAt: (project as any).updatedAt || Date.now(),
                framework: (project as any).framework,
                gitRepository: (project as any).link ? {
                    type: (project as any).link.type || 'github',
                    repo: (project as any).link.repo || '',
                    owner: (project as any).link.owner || '',
                    path: (project as any).link.path
                } : null
            };
        } catch (error) {
            this.context.logger.error(`Failed to get project ${projectId}:`, error);
            throw error;
        }
    }

    async createProject(options: CreateProjectOptions, teamId?: string): Promise<VercelProject> {
        try {
            let envVars = undefined;

            if (options.environmentVariables) {
                if (Array.isArray(options.environmentVariables)) {
                    envVars = options.environmentVariables;
                } else {
                    envVars = Object.entries(options.environmentVariables).map(([key, value]) => ({
                        key,
                        value,
                        target: ['production', 'preview', 'development'] as const,
                        type: key === 'NODE_ENV' ? 'plain' : 'encrypted'
                    }));
                }
            }

            const project = await this.client.projects.createProject({
                teamId,
                requestBody: {
                    name: options.name,
                    framework: options.framework as any,
                    gitRepository: options.gitRepository,
                    environmentVariables: envVars as any,
                    rootDirectory: options.rootDirectory,
                    buildCommand: options.buildCommand,
                    installCommand: options.installCommand,
                    devCommand: options.devCommand,
                    outputDirectory: options.outputDirectory
                }
            });

            this.context.logger.info(`Project ${options.name} created successfully`);

            return {
                id: (project as any).id,
                name: (project as any).name,
                accountId: (project as any).accountId || '',
                createdAt: (project as any).createdAt || Date.now(),
                updatedAt: (project as any).updatedAt || Date.now(),
                framework: (project as any).framework,
                gitRepository: (project as any).link ? {
                    type: (project as any).link.type || 'github',
                    repo: (project as any).link.repo || '',
                    owner: (project as any).link.owner || '',
                    path: (project as any).link.path
                } : null
            };
        } catch (error) {
            this.context.logger.error(`Failed to create project ${options.name}:`, error);
            throw error;
        }
    }

    async addEnvironmentVariable(
        projectId: string,
        key: string,
        value: string,
        isSensitive: boolean = true,
        targets: Array<'production' | 'preview' | 'development'> = ['production', 'preview'],
        gitBranch?: string
    ): Promise<void> {
        try {
            this.context.logger.info(`Adding environment variable ${key} to project ${projectId}`);

            const requestBody: any = {
                key,
                value,
                type: isSensitive ? 'sensitive' : 'plain',
                target: targets
            };

            if (gitBranch) {
                requestBody.gitBranch = gitBranch;
            }

            await this.client.projects.createProjectEnv({
                idOrName: projectId,
                requestBody
            });

            this.context.logger.info(`Environment variable ${key} added successfully to project ${projectId}`);
        } catch (error) {
            this.context.logger.error(`Failed to add environment variable ${key}:`, error);
            throw error;
        }
    }

    async addEnvironmentVariables(
        projectId: string,
        variables: Array<{ key: string; value: string; isSensitive?: boolean; gitBranch?: string }>,
        defaultTargets: Array<'production' | 'preview' | 'development'> = ['production', 'preview']
    ): Promise<void> {
        try {
            this.context.logger.info(`Adding ${variables.length} environment variables to project ${projectId}`);

            for (const variable of variables) {
                await this.addEnvironmentVariable(
                    projectId,
                    variable.key,
                    variable.value,
                    variable.isSensitive ?? true,
                    defaultTargets,
                    variable.gitBranch
                );
            }

            this.context.logger.info(`Successfully added ${variables.length} environment variables`);
        } catch (error) {
            this.context.logger.error('Failed to add environment variables:', error);
            throw error;
        }
    }

    async updateEnvironmentVariable(
        projectId: string,
        envId: string,
        value: string,
        targets?: Array<'production' | 'preview' | 'development'>
    ): Promise<void> {
        try {
            this.context.logger.info(`Updating environment variable ${envId} for project ${projectId}`);

            const requestBody: any = { value };

            if (targets) {
                requestBody.target = targets;
            }

            await this.client.projects.editProjectEnv({
                idOrName: projectId,
                id: envId,
                requestBody
            });

            this.context.logger.info(`Environment variable ${envId} updated successfully`);
        } catch (error) {
            this.context.logger.error(`Failed to update environment variable ${envId}:`, error);
            throw error;
        }
    }

    async listEnvironmentVariables(
        projectId: string,
        target?: 'production' | 'preview' | 'development',
        gitBranch?: string
    ): Promise<any[]> {
        try {
            this.context.logger.info(`Listing environment variables for project ${projectId}`);

            const requestParams: any = {
                idOrName: projectId
            };

            if (target) {
                requestParams.target = target;
            }

            if (gitBranch) {
                requestParams.gitBranch = gitBranch;
            }

            const response = await this.client.projects.filterProjectEnvs(requestParams);

            let envs: any[] = [];
            if (Array.isArray(response)) {
                envs = response;
            } else if (response && typeof response === 'object') {
                if ('envs' in response) {
                    envs = (response as any).envs || [];
                } else {
                    envs = [response];
                }
            }

            return envs;
        } catch (error) {
            this.context.logger.error('Failed to list environment variables:', error);
            throw error;
        }
    }

    async deleteEnvironmentVariable(
        projectId: string,
        envId: string
    ): Promise<void> {
        try {
            this.context.logger.info(`Deleting environment variable ${envId} from project ${projectId}`);

            await this.client.projects.removeProjectEnv({
                idOrName: projectId,
                id: envId
            });

            this.context.logger.info(`Environment variable ${envId} deleted successfully`);
        } catch (error) {
            this.context.logger.error(`Failed to delete environment variable ${envId}:`, error);
            throw error;
        }
    }

    async deleteProject(projectId: string, teamId?: string): Promise<void> {
        try {
            await this.client.projects.deleteProject({
                idOrName: projectId,
                teamId
            });
            this.context.logger.info(`Project ${projectId} deleted successfully`);
        } catch (error) {
            this.context.logger.error(`Failed to delete project ${projectId}:`, error);
            throw error;
        }
    }
}

export class DeploymentManager {
    private client: Vercel;
    private context: PluginContext;

    constructor(context: PluginContext, client: Vercel) {
        this.context = context;
        this.client = client;
    }

    async listDeployments(projectId?: string, limit?: number, teamId?: string): Promise<VercelDeployment[]> {
        try {
            const response = await this.client.deployments.getDeployments({
                projectId,
                limit,
                teamId
            });

            let deployments: any[] = [];
            if (Array.isArray(response)) {
                deployments = response;
            } else if (response && typeof response === 'object' && 'deployments' in response) {
                deployments = (response as any).deployments || [];
            }

            return deployments.map((d: any) => ({
                id: d.uid || d.id,
                name: d.name,
                url: d.url,
                status: this.mapDeploymentStatus(d.state),
                createdAt: d.createdAt || Date.now(),
                buildingAt: d.buildingAt,
                ready: d.ready,
                target: d.target
            }));
        } catch (error) {
            this.context.logger.error('Failed to list deployments:', error);
            throw error;
        }
    }

    async getDeployment(deploymentId: string, teamId?: string): Promise<VercelDeployment> {
        try {
            const deployment = await this.client.deployments.getDeployment({
                idOrUrl: deploymentId,
                teamId
            });

            return {
                id: (deployment as any).uid || (deployment as any).id,
                name: (deployment as any).name,
                url: (deployment as any).url,
                status: this.mapDeploymentStatus((deployment as any).state || (deployment as any).readyState),
                createdAt: (deployment as any).createdAt || Date.now(),
                buildingAt: (deployment as any).buildingAt,
                ready: (deployment as any).ready,
                target: (deployment as any).target
            };
        } catch (error) {
            this.context.logger.error(`Failed to get deployment ${deploymentId}:`, error);
            throw error;
        }
    }

    async createDeployment(options: DeployOptions, teamId?: string): Promise<VercelDeployment> {
        try {
            const requestBody: any = {
                project: options.project,
                target: options.target,
                files: options.files,
                deploymentId: options.deploymentId
            };

            if (options.name) {
                requestBody.name = options.name;
            }

            if (options.projectSettings) {
                requestBody.projectSettings = options.projectSettings;
            }

            const deployment = await this.client.deployments.createDeployment({
                teamId,
                requestBody
            });

            this.context.logger.info(`Deployment created for project ${options.project}`);

            return {
                id: (deployment as any).id,
                name: (deployment as any).name,
                url: (deployment as any).url,
                status: this.mapDeploymentStatus((deployment as any).readyState || (deployment as any).state),
                createdAt: (deployment as any).createdAt || Date.now(),
                buildingAt: (deployment as any).buildingAt,
                ready: (deployment as any).ready,
                target: (deployment as any).target
            };
        } catch (error) {
            this.context.logger.error('Failed to create deployment:', error);
            throw error;
        }
    }

    async deployProject(projectId: string, options?: {
        branch?: string;
        commitSha?: string;
        target?: 'production' | 'staging';
    }, teamId?: string): Promise<VercelDeployment> {
        try {
            const requestBody: any = {
                project: projectId,
                target: options?.target,
                deploymentId: `${Date.now()}`
            };

            if (options?.branch) {
                requestBody.gitSource = {
                    type: 'github' as const,
                    ref: options.branch
                };
            } else if (options?.commitSha) {
                requestBody.gitSource = {
                    type: 'github' as const,
                    sha: options.commitSha
                };
            }

            const deployment = await this.client.deployments.createDeployment({
                teamId,
                requestBody
            });

            this.context.logger.info(`Deployment triggered for project ${projectId}`);

            return {
                id: (deployment as any).id,
                name: (deployment as any).name,
                url: (deployment as any).url,
                status: this.mapDeploymentStatus((deployment as any).readyState || (deployment as any).state),
                createdAt: (deployment as any).createdAt || Date.now(),
                buildingAt: (deployment as any).buildingAt,
                ready: (deployment as any).ready,
                target: (deployment as any).target
            };
        } catch (error) {
            this.context.logger.error(`Failed to deploy project ${projectId}:`, error);
            throw error;
        }
    }

    async cancelDeployment(deploymentId: string, teamId?: string): Promise<void> {
        try {
            await this.client.deployments.cancelDeployment({
                id: deploymentId,
                teamId
            });
            this.context.logger.info(`Deployment ${deploymentId} cancelled`);
        } catch (error) {
            this.context.logger.error(`Failed to cancel deployment ${deploymentId}:`, error);
            throw error;
        }
    }

    async getDeploymentLogs(deploymentId: string, teamId?: string): Promise<any> {
        try {
            const logs = await this.client.deployments.getDeploymentEvents({
                idOrUrl: deploymentId,
                teamId
            });
            return logs;
        } catch (error) {
            this.context.logger.error(`Failed to get logs for deployment ${deploymentId}:`, error);
            throw error;
        }
    }

    private mapDeploymentStatus(status?: string): VercelDeployment['status'] {
        switch (status) {
            case 'QUEUED':
            case 'INITIALIZING':
                return 'QUEUED';
            case 'BUILDING':
            case 'DEPLOYING':
                return 'BUILDING';
            case 'READY':
                return 'READY';
            case 'ERROR':
            case 'ERRORED':
                return 'ERROR';
            case 'CANCELED':
            case 'CANCELLED':
                return 'CANCELED';
            default:
                return 'QUEUED';
        }
    }
}

export class VercelComponents {
    public client: VercelClientManager;
    public projects: ProjectManager | null = null;
    public deployments: DeploymentManager | null = null;
    private context: PluginContext;
    private config: VercelPluginConfig;

    constructor(context: PluginContext, config: VercelPluginConfig) {
        this.context = context;
        this.config = config;
        this.client = new VercelClientManager(context, config);
    }

    async initialize(): Promise<void> {
        await this.client.initialize();
        const vercelClient = this.client.getClient();
        this.projects = new ProjectManager(this.context, vercelClient);
        this.deployments = new DeploymentManager(this.context, vercelClient);
        this.context.logger.info('Vercel components initialized');
    }

    async cleanup(): Promise<void> {
        await this.client.disconnect();
        this.projects = null;
        this.deployments = null;
    }
}
