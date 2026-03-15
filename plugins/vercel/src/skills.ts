import { PluginContext } from '@ton-ai/core';
import { VercelComponents } from './components';
import { ProjectManager } from './components';
import { DeploymentManager } from './components';
import {
    VercelPluginConfig,
    VercelProject,
    VercelDeployment,
    CreateProjectOptions,
    DeployOptions,
    ProjectDeploymentOptions
} from './types';

export class VercelSkills {
    private context: PluginContext;
    private components: VercelComponents;
    private config: VercelPluginConfig;
    private ready: boolean = false;

    constructor(context: PluginContext, components: VercelComponents, config: VercelPluginConfig) {
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
            throw new Error('Vercel plugin not ready');
        }
    }

    private getProjects(): ProjectManager {
        if (!this.components.projects) {
            throw new Error('Project manager not initialized');
        }
        return this.components.projects;
    }

    private getDeployments(): DeploymentManager {
        if (!this.components.deployments) {
            throw new Error('Deployment manager not initialized');
        }
        return this.components.deployments;
    }

    async listProjects(): Promise<VercelProject[]> {
        await this.ensureReady();
        return this.getProjects().listProjects(this.config.teamId);
    }

    async getProject(projectId: string): Promise<VercelProject> {
        await this.ensureReady();
        return this.getProjects().getProject(projectId, this.config.teamId);
    }

    async createProject(options: CreateProjectOptions): Promise<VercelProject> {
        await this.ensureReady();
        const project = await this.getProjects().createProject(options, this.config.teamId);
        this.context.events.emit('vercel:project:created', { projectId: project.id, name: project.name });
        return project;
    }

    async deleteProject(projectId: string): Promise<void> {
        await this.ensureReady();
        await this.getProjects().deleteProject(projectId, this.config.teamId);
        this.context.events.emit('vercel:project:deleted', { projectId });
    }

    async listDeployments(projectId?: string, limit?: number): Promise<VercelDeployment[]> {
        await this.ensureReady();
        return this.getDeployments().listDeployments(projectId, limit, this.config.teamId);
    }

    async getDeployment(deploymentId: string): Promise<VercelDeployment> {
        await this.ensureReady();
        return this.getDeployments().getDeployment(deploymentId, this.config.teamId);
    }

    async createDeployment(options: DeployOptions): Promise<VercelDeployment> {
        await this.ensureReady();
        const deployment = await this.getDeployments().createDeployment(options, this.config.teamId);
        this.context.events.emit('vercel:deployment:created', {
            deploymentId: deployment.id,
            projectId: options.project,
            url: deployment.url
        });
        return deployment;
    }

    async deployProject(projectId: string, options?: ProjectDeploymentOptions): Promise<VercelDeployment> {
        await this.ensureReady();
        const deployment = await this.getDeployments().deployProject(projectId, options, this.config.teamId);
        this.context.events.emit('vercel:deployment:started', {
            deploymentId: deployment.id,
            projectId,
            target: options?.target
        });
        return deployment;
    }

    async cancelDeployment(deploymentId: string): Promise<void> {
        await this.ensureReady();
        await this.getDeployments().cancelDeployment(deploymentId, this.config.teamId);
        this.context.events.emit('vercel:deployment:cancelled', { deploymentId });
    }

    async waitForDeployment(deploymentId: string, interval: number = 2000, timeout: number = 300000): Promise<VercelDeployment> {
        await this.ensureReady();
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const deployment = await this.getDeployment(deploymentId);

            if (deployment.status === 'READY' || deployment.status === 'ERROR' || deployment.status === 'CANCELED') {
                if (deployment.status === 'READY') {
                    this.context.events.emit('vercel:deployment:ready', { deploymentId, url: deployment.url });
                } else if (deployment.status === 'ERROR') {
                    this.context.events.emit('vercel:deployment:failed', { deploymentId });
                }
                return deployment;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error(`Timeout waiting for deployment ${deploymentId}`);
    }

    async getDeploymentLogs(deploymentId: string): Promise<any> {
        await this.ensureReady();
        return this.getDeployments().getDeploymentLogs(deploymentId, this.config.teamId);
    }

    async addEnvironmentVariable(
        projectId: string,
        key: string,
        value: string,
        isSensitive: boolean = true,
        targets: Array<'production' | 'preview' | 'development'> = ['production', 'preview'],
        gitBranch?: string
    ): Promise<void> {
        await this.ensureReady();
        return this.getProjects().addEnvironmentVariable(projectId, key, value, isSensitive, targets, gitBranch);
    }

    async addEnvironmentVariables(
        projectId: string,
        variables: Array<{ key: string; value: string; isSensitive?: boolean; gitBranch?: string }>,
        defaultTargets: Array<'production' | 'preview' | 'development'> = ['production', 'preview']
    ): Promise<void> {
        await this.ensureReady();
        return this.getProjects().addEnvironmentVariables(projectId, variables, defaultTargets);
    }

    async listEnvironmentVariables(
        projectId: string,
        target?: 'production' | 'preview' | 'development',
        gitBranch?: string
    ): Promise<any[]> {
        await this.ensureReady();
        return this.getProjects().listEnvironmentVariables(projectId, target, gitBranch);
    }

    async updateEnvironmentVariable(
        projectId: string,
        envId: string,
        value: string,
        targets?: Array<'production' | 'preview' | 'development'>
    ): Promise<void> {
        await this.ensureReady();
        return this.getProjects().updateEnvironmentVariable(projectId, envId, value, targets);
    }

    async deleteEnvironmentVariable(
        projectId: string,
        envId: string
    ): Promise<void> {
        await this.ensureReady();
        return this.getProjects().deleteEnvironmentVariable(projectId, envId);
    }
}
