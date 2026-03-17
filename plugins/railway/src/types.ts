export interface RailwayPluginConfig {
    apiToken: string;
    tokenType: 'account' | 'workspace' | 'project';
    teamId?: string;
    defaultProjectName?: string;
}

export interface RailwayProject {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    isPublic: boolean;
}

export interface RailwayService {
    id: string;
    name: string;
    projectId: string;
    source?: {
        repo?: string;
        branch?: string;
    };
}

export interface RailwayEnvironment {
    id: string;
    name: string;
    projectId: string;
}

export interface RailwayDeployment {
    id: string;
    status: string;
    url?: string;
    createdAt: string;
}

export interface CreateProjectOptions {
    name: string;
    description?: string;
    workspaceId?: string;
}

export interface DeployServiceOptions {
    projectId: string;
    serviceName: string;
    source: {
        repo: string;
    };
    branch?: string;
}

export interface UpdateServiceInstanceOptions {
    buildCommand?: string;
    startCommand?: string;
}

export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}
