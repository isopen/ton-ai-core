export interface RenderPluginConfig {
    apiKey: string;
    workspaceId?: string;
    defaultServiceName?: string;
}

export interface RenderProject {
    id: string;
    name: string;
    owner: RenderOwner;
    environmentIds: string[];
    createdAt: string;
    updatedAt: string;
}

export interface RenderService {
    id: string;
    name: string;
    ownerId: string;
    type: 'static_site' | 'web_service' | 'private_service' | 'background_worker' | 'cron_job';
    autoDeploy: 'yes' | 'no';
    branch?: string;
    repo?: string;
    rootDir: string;
    slug: string;
    suspended: 'suspended' | 'not_suspended';
    suspenders: Array<'admin' | 'billing' | 'user' | 'parent_service' | 'stuck_crashlooping' | 'hipaa_enablement' | 'unknown'>;
    createdAt: string;
    updatedAt: string;
    dashboardUrl: string;
    serviceDetails: RenderServiceDetails;
}

export type RenderServiceDetails =
    | RenderStaticSiteDetails
    | RenderWebServiceDetails
    | RenderPrivateServiceDetails
    | RenderBackgroundWorkerDetails
    | RenderCronJobDetails;

export interface RenderStaticSiteDetails {
    buildCommand: string;
    publishPath: string;
    url: string;
    buildPlan: 'starter' | 'performance';
    ipAllowList?: RenderCIDRBlock[];
    pullRequestPreviewsEnabled: 'yes' | 'no';
    previews: {
        generation: 'off' | 'manual' | 'automatic';
    };
    renderSubdomainPolicy: 'enabled' | 'disabled';
}

export interface RenderWebServiceDetails {
    env: string;
    runtime: 'docker' | 'elixir' | 'go' | 'node' | 'python' | 'ruby' | 'rust' | 'image';
    plan: string;
    region: 'frankfurt' | 'oregon' | 'ohio' | 'singapore' | 'virginia';
    numInstances: number;
    buildPlan: 'starter' | 'performance';
    healthCheckPath: string;
    url: string;
    envSpecificDetails: RenderEnvSpecificDetails;
    autoscaling?: RenderAutoScalingConfig;
    disk?: RenderDisk;
    ipAllowList?: RenderCIDRBlock[];
    maintenanceMode?: RenderMaintenanceMode;
    maxShutdownDelaySeconds?: number;
    renderSubdomainPolicy?: 'enabled' | 'disabled';
}

export interface RenderPrivateServiceDetails {
    env: string;
    runtime: 'docker' | 'elixir' | 'go' | 'node' | 'python' | 'ruby' | 'rust' | 'image';
    plan: string;
    region: 'frankfurt' | 'oregon' | 'ohio' | 'singapore' | 'virginia';
    numInstances: number;
    buildPlan: 'starter' | 'performance';
    envSpecificDetails: RenderEnvSpecificDetails;
    autoscaling?: RenderAutoScalingConfig;
    disk?: RenderDisk;
    maxShutdownDelaySeconds?: number;
}

export interface RenderBackgroundWorkerDetails {
    env: string;
    runtime: 'docker' | 'elixir' | 'go' | 'node' | 'python' | 'ruby' | 'rust' | 'image';
    plan: string;
    region: 'frankfurt' | 'oregon' | 'ohio' | 'singapore' | 'virginia';
    numInstances: number;
    buildPlan: 'starter' | 'performance';
    envSpecificDetails: RenderEnvSpecificDetails;
    autoscaling?: RenderAutoScalingConfig;
    disk?: RenderDisk;
    maxShutdownDelaySeconds?: number;
}

export interface RenderCronJobDetails {
    env: string;
    runtime: 'docker' | 'elixir' | 'go' | 'node' | 'python' | 'ruby' | 'rust' | 'image';
    plan: string;
    region: 'frankfurt' | 'oregon' | 'ohio' | 'singapore' | 'virginia';
    schedule: string;
    buildPlan: 'starter' | 'performance';
    envSpecificDetails: RenderEnvSpecificDetails;
    lastSuccessfulRunAt?: string;
}

export type RenderEnvSpecificDetails = RenderDockerDetails | RenderNativeEnvironmentDetails;

export interface RenderDockerDetails {
    dockerCommand: string;
    dockerContext: string;
    dockerfilePath: string;
    preDeployCommand?: string;
    registryCredential?: RenderRegistryCredentialSummary;
}

export interface RenderNativeEnvironmentDetails {
    buildCommand: string;
    startCommand: string;
    preDeployCommand?: string;
}

export interface RenderAutoScalingConfig {
    enabled: boolean;
    min: number;
    max: number;
    criteria: {
        cpu: {
            enabled: boolean;
            percentage: number;
        };
        memory: {
            enabled: boolean;
            percentage: number;
        };
    };
}

export interface RenderDisk {
    id: string;
    name: string;
    sizeGB: number;
    mountPath: string;
}

export interface RenderCIDRBlock {
    cidrBlock: string;
    description: string;
}

export interface RenderMaintenanceMode {
    enabled: boolean;
    uri: string;
}

export interface RenderRegistryCredentialSummary {
    id: string;
    name: string;
}

export interface RenderOwner {
    id: string;
    name: string;
    email: string;
    type: 'user' | 'team';
    twoFactorAuthEnabled?: boolean;
    ipAllowList?: RenderCIDRBlock[];
}

export interface RenderDeploy {
    id: string;
    status: 'created' | 'queued' | 'build_in_progress' | 'update_in_progress' | 'live' | 'deactivated' | 'build_failed' | 'update_failed' | 'canceled' | 'pre_deploy_in_progress' | 'pre_deploy_failed';
    trigger: 'api' | 'blueprint_sync' | 'deploy_hook' | 'deployed_by_render' | 'manual' | 'other' | 'new_commit' | 'rollback' | 'service_resumed' | 'service_updated';
    startedAt?: string;
    finishedAt?: string;
    createdAt: string;
    updatedAt: string;
    commit?: {
        id: string;
        message: string;
        createdAt: string;
    };
    image?: {
        ref: string;
        sha: string;
        registryCredential?: string;
    };
}

export interface RenderEnvVar {
    key: string;
    value: string;
}

export interface RenderSecretFile {
    name: string;
    content: string;
}

export interface RenderCustomDomain {
    id: string;
    name: string;
    domainType: 'apex' | 'subdomain';
    publicSuffix: string;
    redirectForName: string;
    verificationStatus: 'verified' | 'unverified';
    createdAt: string;
    server?: {
        id: string;
        name: string;
    };
}

export interface CreateServiceOptions {
    name: string;
    type: 'static_site' | 'web_service' | 'private_service' | 'background_worker' | 'cron_job';
    ownerId: string;
    repo?: string;
    branch?: string;
    autoDeploy?: 'yes' | 'no';
    rootDir?: string;
    envVars?: RenderEnvVar[];
    secretFiles?: RenderSecretFile[];
    environmentId?: string;
    serviceDetails: any;
}

export interface CreateDeployOptions {
    serviceId: string;
    clearCache?: 'clear' | 'do_not_clear';
    commitId?: string;
    imageUrl?: string;
    deployMode?: 'deploy_only' | 'build_and_deploy';
}

export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}
