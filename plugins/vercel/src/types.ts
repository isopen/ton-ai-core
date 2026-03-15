export interface VercelPluginConfig {
    accessToken: string;
    teamId?: string;
}

export interface VercelProject {
    id: string;
    name: string;
    accountId: string;
    createdAt: number;
    updatedAt: number;
    framework?: string | null;
    gitRepository?: {
        type: string;
        repo: string;
        owner: string;
        path?: string;
    } | null;
}

export interface VercelDeployment {
    id: string;
    name: string;
    url: string;
    status: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';
    createdAt: number;
    buildingAt?: number;
    ready?: number;
    target?: string;
}

export interface CreateProjectOptions {
    name: string;
    framework?: string;
    gitRepository?: {
        type: 'github' | 'gitlab' | 'bitbucket';
        repo: string;
        owner: string;
        path?: string;
    };
    environmentVariables?: Record<string, string>;
    rootDirectory?: string;
    buildCommand?: string;
    installCommand?: string;
    devCommand?: string;
    outputDirectory?: string;
}

export interface DeployOptions {
    name?: string;
    project: string;
    target?: 'production' | 'staging';
    files?: Array<{ file: string; data: string }>;
    deploymentId?: string;
    projectSettings?: {
        framework?: string | null;
        buildCommand?: string | null;
        installCommand?: string | null;
        outputDirectory?: string | null;
        devCommand?: string | null;
    };
}

export interface ProjectDeploymentOptions {
    branch?: string;
    commitSha?: string;
    target?: 'production' | 'staging';
}

export interface EnvironmentVariableOptions {
    key: string;
    value: string;
    isSensitive?: boolean;
    targets?: Array<'production' | 'preview' | 'development'>;
    gitBranch?: string;
}
