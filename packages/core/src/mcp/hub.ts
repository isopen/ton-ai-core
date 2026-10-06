import { McpHttpTransport } from './http-transport';
import { McpStdioTransport } from './stdio-transport';
import {
    McpEmptyStreamError,
    McpError,
    mcpContentText,
    type McpCallOptions,
    type McpInputHandler,
    type McpDiscoverResult,
    type McpEra,
    type McpHubOptions,
    type McpJsonRpcResponse,
    type McpLogger,
    type McpRequestHeaders,
    type McpJsonRpcNotification,
    type McpInputRequests,
    type McpPrompt,
    type McpPromptArgument,
    type McpPromptMessage,
    type McpResource,
    type McpResourceContent,
    type McpResourceTemplate,
    type McpServerConfig,
    type McpServerInfo,
    type McpServerStatus,
    type McpSubscriptionFilter,
    type McpSubscriptionHandler,
    type McpTool,
    type McpToolResult,
    type McpTransport,
} from './types';

export const MCP_MODERN_VERSION = '2026-07-28';
export const MCP_PRIOR_VERSION = '2025-06-18';
export const MCP_LEGACY_VERSION = '2024-11-05';
export const MCP_PROTOCOL_VERSION = MCP_MODERN_VERSION;
const MODERN_KNOWN_VERSIONS = [MCP_MODERN_VERSION, MCP_PRIOR_VERSION];
const UNSUPPORTED_VERSION_CODE = -32022;

interface McpCacheEntry {
    value: unknown[];
    expiresAt: number;
}

interface McpSubscription {
    id: number | string;
    filter: McpSubscriptionFilter;
    onEvent: McpSubscriptionHandler;
    ack: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout | null };
}

interface McpConnection {
    transport: McpTransport;
    serverInfo: McpServerInfo;
    status: McpServerStatus;
    era: McpEra;
    protocolVersion: string;
    listsCache: Map<string, McpCacheEntry>;
    readsCache: Map<string, McpCacheEntry>;
    subscriptions: Map<number | string, McpSubscription>;
}

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_MAX_LIST_PAGES = 1000;

const DEFAULT_CLIENT_INFO = { name: '@ton-ai/core', version: '0.1.0' };
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const HANDSHAKE_MIN_TIMEOUT_MS = 1000;

function createTransport(config: McpServerConfig, logger?: McpLogger): McpTransport {
    if (config.transport === 'http') {
        return new McpHttpTransport({ url: config.url, headers: config.headers, logger });
    }
    return new McpStdioTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
        logger,
    });
}

function metaParams(protocolVersion: string, clientInfo: { name: string; version: string }): Record<string, unknown> {
    return {
        _meta: {
            'io.modelcontextprotocol/protocolVersion': protocolVersion,
            'io.modelcontextprotocol/clientInfo': clientInfo,
            'io.modelcontextprotocol/clientCapabilities': {},
        },
    };
}

function listCacheKey(method: string): string {
    return `${method}:list`;
}

function encodeHeaderValue(value: string): string {
    const looksEncoded = value.startsWith('=?base64?') && value.endsWith('?=');
    if (/^[\x20\x09\x21-\x7E]*$/.test(value) && value.trim() === value && !looksEncoded) {
        return value;
    }
    return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const HEADER_TOKEN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

function collectHeaderAnnotations(
    inputSchema: Record<string, unknown>,
): Array<{ path: string[]; header: string }> {
    const found: Array<{ path: string[]; header: string }> = [];
    const visit = (node: unknown, path: string[]) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        const record = node as Record<string, unknown>;
        const properties = record.properties;
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return;
        for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
            if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
            const header = (child as Record<string, unknown>)['x-mcp-header'];
            if (typeof header === 'string' && header.length > 0) {
                found.push({ path: [...path, key], header });
            }
            visit(child, [...path, key]);
        }
    };
    visit(inputSchema, []);
    return found;
}

function readPath(args: Record<string, unknown>, path: string[]): unknown {
    let current: unknown = args;
    for (const key of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function collectAllHeaderAnnotations(inputSchema: Record<string, unknown>): number {
    let count = 0;
    const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const entry of node) visit(entry);
            return;
        }
        for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
            if (key === 'x-mcp-header' && typeof child === 'string') {
                count += 1;
            }
            visit(child);
        }
    };
    visit(inputSchema);
    return count;
}

function validateHeaderAnnotations(toolName: string, inputSchema: Record<string, unknown>): boolean {
    const annotations = collectHeaderAnnotations(inputSchema);
    if (collectAllHeaderAnnotations(inputSchema) !== annotations.length) return false;
    const seen = new Set<string>();
    for (const { path, header } of annotations) {
        if (!HEADER_TOKEN.test(header)) return false;
        const lowered = header.toLowerCase();
        if (seen.has(lowered)) return false;
        seen.add(lowered);
        let node: unknown = inputSchema;
        for (const key of path) {
            const properties = (node as Record<string, unknown>).properties as Record<string, unknown>;
            node = properties[key];
        }
        const type = (node as Record<string, unknown>).type;
        if (type !== 'string' && type !== 'integer' && type !== 'boolean') return false;
    }
    return true;
}

export async function mcpCallJson<T>(
    hub: McpHub | null | undefined,
    server: string,
    tool: string,
    args: Record<string, unknown> = {},
    opts: McpCallOptions = {},
): Promise<T> {
    if (!hub) {
        throw new McpError('MCP hub is not connected');
    }
    const result = await hub.callTool(server, tool, args, opts);
    if (result.isError === true) {
        const errorText = mcpContentText(result);
        throw new McpError(
            `MCP tool failed (server=${server} tool=${tool}): ${errorText.slice(0, 200)}`,
            { server, data: result },
        );
    }
    const text = mcpContentText(result);
    if (!text) {
        throw new McpError(`MCP tool returned no text content (server=${server} tool=${tool})`, { server });
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new McpError(
            `MCP tool returned non-JSON text (server=${server} tool=${tool}): ${text.slice(0, 120)}`,
            { server, data: text },
        );
    }
}

export class McpHub {
    private readonly connections = new Map<string, McpConnection>();
    private readonly connecting = new Map<string, Promise<void>>();
    private nextRequestId = 1;
    private readonly logger?: McpLogger;
    private readonly clientInfo: { name: string; version: string };
    private readonly requestTimeoutMs: number;
    private readonly maxListPages: number;

    constructor(
        private readonly servers: Record<string, McpServerConfig> = {},
        options: McpHubOptions = {},
    ) {
        this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.maxListPages = options.maxListPages ?? DEFAULT_MAX_LIST_PAGES;
        this.logger = options.logger;
    }

    serverNames(): string[] {
        return Object.keys(this.servers);
    }

    status(name: string): McpServerStatus {
        return this.connections.get(name)?.status ?? 'closed';
    }

    async connect(name?: string): Promise<void> {
        const names = name === undefined ? Object.keys(this.servers) : [name];
        const failures: Array<{ name: string; error: unknown }> = [];
        for (const serverName of names) {
            try {
                await this.connectOne(serverName);
            } catch (error) {
                failures.push({ name: serverName, error });
            }
        }
        if (failures.length === 1) {
            throw failures[0].error;
        }
        if (failures.length > 1) {
            const summary = failures
                .map((entry) => `${entry.name}: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`)
                .join('; ');
            throw new McpError(`Failed to connect ${failures.length} MCP servers: ${summary}`, {
                data: failures.map((entry) => ({
                    name: entry.name,
                    message: entry.error instanceof Error ? entry.error.message : String(entry.error),
                })),
            });
        }
    }

    private async collectAcrossServers(
        names: string[],
        collect: (name: string) => Promise<void>,
    ): Promise<Array<{ name: string; error: unknown }>> {
        const failures: Array<{ name: string; error: unknown }> = [];
        for (const name of names) {
            try {
                await collect(name);
            } catch (error) {
                failures.push({ name, error });
            }
        }
        return failures;
    }

    private throwServerFailures(failures: Array<{ name: string; error: unknown }>, method: string): void {
        if (failures.length === 1) {
            throw failures[0].error;
        }
        if (failures.length > 1) {
            const summary = failures
                .map((entry) => `${entry.name}: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`)
                .join('; ');
            throw new McpError(`MCP ${method} failed for ${failures.length} servers: ${summary}`, {
                data: failures.map((entry) => ({
                    name: entry.name,
                    message: entry.error instanceof Error ? entry.error.message : String(entry.error),
                })),
            });
        }
    }

    async disconnect(name: string): Promise<void> {
        const connection = this.connections.get(name);
        this.connections.delete(name);
        if (!connection) return;
        connection.status = 'closed';
        connection.listsCache.clear();
        connection.readsCache.clear();
        connection.transport.onNotification(null);
        for (const id of [...connection.subscriptions.keys()]) {
            await this.dropSubscription(connection, name, id);
        }
        await connection.transport.close();
    }

    private async dropSubscription(
        connection: McpConnection,
        server: string,
        id: number | string,
    ): Promise<void> {
        const sub = connection.subscriptions.get(id);
        connection.subscriptions.delete(id);
        if (!sub) return;
        if (sub.ack.timer) {
            clearTimeout(sub.ack.timer);
            sub.ack.timer = null;
            sub.ack.reject(new McpError(`MCP subscription dropped before ack (server=${server})`));
        }
        try {
            await connection.transport.cancelRequest(id);
        } catch (error) {
            this.logger?.debug(`MCP unsubscribe failed (server=${server}):`, error);
        }
    }

    async close(): Promise<void> {
        const names = [...this.connections.keys()];
        for (const name of names) {
            try {
                await this.disconnect(name);
            } catch (error) {
                this.logger?.debug(`MCP disconnect failed (${name}):`, error);
            }
        }
    }

    async listTools(server?: string): Promise<Array<McpTool & { server: string }>> {
        const names = server === undefined
            ? [...this.connections.keys()].filter((name) => this.connections.get(name)?.status === 'ready')
            : [server];
        const tools: Array<McpTool & { server: string }> = [];
        const failures = await this.collectAcrossServers(names, async (name) => {
            for (const tool of await this.listServerTools(name)) {
                tools.push({ ...tool, server: name });
            }
        });
        this.throwServerFailures(failures, 'tools/list');
        return tools;
    }

    async callTool(
        server: string,
        tool: string,
        args: Record<string, unknown> = {},
        opts: McpCallOptions = {},
    ): Promise<McpToolResult> {
        const connection = this.requireReady(server);
        const headers = await this.callHeaders(connection, server, tool, args);
        const result = await this.roundTrip(
            connection,
            server,
            'tools/call',
            { name: tool, arguments: args },
            headers,
            opts,
        );
        if (!result || !Array.isArray((result as McpToolResult).content)) {
            throw new McpError(`MCP tools/call returned no content (server=${server} tool=${tool})`, { server });
        }
        return result as McpToolResult;
    }

    async listResources(server?: string): Promise<Array<McpResource & { server: string }>> {
        const names = server === undefined ? this.readyNames() : [server];
        const out: Array<McpResource & { server: string }> = [];
        const failures = await this.collectAcrossServers(names, async (name) => {
            for (const resource of await this.listServerResources(name)) {
                out.push({ ...resource, server: name });
            }
        });
        this.throwServerFailures(failures, 'resources/list');
        return out;
    }

    private async listServerResources(name: string): Promise<McpResource[]> {
        const connection = this.requireReady(name);
        return this.fetchList<McpResource>(
            connection,
            name,
            'resources/list',
            'resources',
            (entry) => {
                if (!entry || typeof entry.uri !== 'string' || typeof entry.name !== 'string') return null;
                return {
                    uri: entry.uri as string,
                    name: entry.name as string,
                    title: typeof entry.title === 'string' ? (entry.title as string) : undefined,
                    description: typeof entry.description === 'string' ? (entry.description as string) : undefined,
                    mimeType: typeof entry.mimeType === 'string' ? (entry.mimeType as string) : undefined,
                    size: typeof entry.size === 'number' ? (entry.size as number) : undefined,
                };
            },
        );
    }

    async readResource(
        server: string,
        uri: string,
        opts: McpCallOptions = {},
    ): Promise<McpResourceContent[]> {
        const connection = this.requireReady(server);
        const cacheKey = `read:${uri}`;
        const cached = connection.readsCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            return this.copyResourceContents(cached.value as McpResourceContent[]);
        }
        const raw: unknown = await this.roundTrip(
            connection,
            server,
            'resources/read',
            { uri },
            this.methodHeaders(connection, 'resources/read', uri),
            opts,
        );
        const record = (raw ?? {}) as { contents?: unknown; ttlMs?: unknown };
        const contents = Array.isArray(raw)
            ? (raw as McpResourceContent[])
            : Array.isArray(record.contents)
              ? (record.contents as McpResourceContent[])
              : null;
        if (!contents) {
            throw new McpError(`MCP resources/read returned no contents (server=${server} uri=${uri})`, { server });
        }
        if (typeof record.ttlMs === 'number' && record.ttlMs > 0) {
            this.pruneExpired(connection.readsCache);
            connection.readsCache.set(cacheKey, { value: contents, expiresAt: Date.now() + record.ttlMs });
        }
        return this.copyResourceContents(contents);
    }

    private copyResourceContents(entries: McpResourceContent[]): McpResourceContent[] {
        return entries.map((entry) => ({ ...entry }));
    }

    async listResourceTemplates(server?: string): Promise<Array<McpResourceTemplate & { server: string }>> {
        const names = server === undefined ? this.readyNames() : [server];
        const out: Array<McpResourceTemplate & { server: string }> = [];
        const failures = await this.collectAcrossServers(names, async (name) => {
            const connection = this.requireReady(name);
            const templates = await this.fetchList<McpResourceTemplate>(
                connection,
                name,
                'resources/templates/list',
                'resourceTemplates',
                (entry) => {
                    if (!entry || typeof entry.uriTemplate !== 'string' || typeof entry.name !== 'string') return null;
                    return {
                        uriTemplate: entry.uriTemplate as string,
                        name: entry.name as string,
                        title: typeof entry.title === 'string' ? (entry.title as string) : undefined,
                        description: typeof entry.description === 'string' ? (entry.description as string) : undefined,
                        mimeType: typeof entry.mimeType === 'string' ? (entry.mimeType as string) : undefined,
                    };
                },
            );
            for (const template of templates) {
                out.push({ ...template, server: name });
            }
        });
        this.throwServerFailures(failures, 'resources/templates/list');
        return out;
    }

    async listPrompts(server?: string): Promise<Array<McpPrompt & { server: string }>> {
        const names = server === undefined ? this.readyNames() : [server];
        const out: Array<McpPrompt & { server: string }> = [];
        const failures = await this.collectAcrossServers(names, async (name) => {
            const connection = this.requireReady(name);
            const prompts = await this.fetchList<McpPrompt>(
                connection,
                name,
                'prompts/list',
                'prompts',
                (entry) => {
                    if (!entry || typeof entry.name !== 'string') return null;
                    const args = Array.isArray(entry.arguments)
                        ? (entry.arguments as McpPromptArgument[]).filter(
                            (item): item is McpPromptArgument => !!item && typeof item.name === 'string',
                        )
                        : undefined;
                    return {
                        name: entry.name as string,
                        title: typeof entry.title === 'string' ? (entry.title as string) : undefined,
                        description: typeof entry.description === 'string' ? (entry.description as string) : undefined,
                        arguments: args,
                    };
                },
            );
            for (const prompt of prompts) {
                out.push({ ...prompt, server: name });
            }
        });
        this.throwServerFailures(failures, 'prompts/list');
        return out;
    }

    async getPrompt(
        server: string,
        name: string,
        args: Record<string, unknown> = {},
        opts: McpCallOptions = {},
    ): Promise<{ description?: string; messages: McpPromptMessage[] }> {
        const connection = this.requireReady(server);
        const result = (await this.roundTrip(
            connection,
            server,
            'prompts/get',
            { name, arguments: args },
            this.methodHeaders(connection, 'prompts/get', name),
            opts,
        )) as { description?: unknown; messages?: unknown } | null | undefined;
        if (!result || !Array.isArray(result.messages)) {
            throw new McpError(`MCP prompts/get returned no messages (server=${server} prompt=${name})`, { server });
        }
        return {
            description: typeof result.description === 'string' ? result.description : undefined,
            messages: result.messages as McpPromptMessage[],
        };
    }

    async subscribe(
        server: string,
        filter: McpSubscriptionFilter,
        onEvent: McpSubscriptionHandler,
    ): Promise<() => Promise<void>> {
        const connection = this.requireReady(server);
        const id = this.nextRequestId++;
        const sub: McpSubscription = {
            id,
            filter,
            onEvent,
            ack: { resolve: () => {}, reject: () => {}, timer: null },
        };
        const acked = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new McpError(`MCP subscribe timed out (server=${server})`));
            }, this.requestTimeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
            sub.ack = { resolve, reject, timer };
        });
        connection.subscriptions.set(id, sub);
        try {
            const pending = connection.transport.request(
                {
                    jsonrpc: '2.0',
                    id,
                    method: 'subscriptions/listen',
                    params: this.withMeta(connection, { notifications: filter }),
                },
                0,
                this.methodHeaders(connection, 'subscriptions/listen'),
            );
            pending.then(
                () => this.dropSubscription(connection, server, id),
                (error) => {
                    this.logger?.debug(`MCP subscription request failed (server=${server}):`, error);
                    return this.dropSubscription(connection, server, id);
                },
            );
            await acked;
        } catch (error) {
            await this.dropSubscription(connection, server, id);
            throw error;
        }
        return async () => {
            await this.dropSubscription(connection, server, id);
        };
    }

    private readyNames(): string[] {
        return [...this.connections.keys()].filter((name) => this.connections.get(name)?.status === 'ready');
    }

    private withMeta(connection: McpConnection, params: Record<string, unknown>): Record<string, unknown> {
        if (connection.era !== 'modern') return params;
        return { ...params, ...this.metaParams(connection) };
    }

    private metaParams(connection: McpConnection): Record<string, unknown> {
        return metaParams(connection.protocolVersion, this.clientInfo);
    }

    private async roundTrip(
        connection: McpConnection,
        server: string,
        method: string,
        params: Record<string, unknown>,
        headers: McpRequestHeaders,
        opts: McpCallOptions,
    ): Promise<Record<string, unknown>> {
        const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
        let current: Record<string, unknown> = { ...params };
        for (let round = 0; round < maxRounds; round += 1) {
            const response = await this.sendOnce(connection, server, method, current, headers);
            if (response.error) {
                throw new McpError(`MCP ${method} failed (server=${server}): ${response.error.message}`, {
                    code: response.error.code,
                    server,
                    data: response.error.data,
                });
            }
            const result = (response.result ?? {}) as Record<string, unknown> & {
                resultType?: string;
                inputRequests?: McpInputRequests;
                requestState?: string;
            };
            if (result.resultType !== 'input_required') {
                return result;
            }
            const handler = opts.onInput;
            if (!handler) {
                throw new McpError(
                    `MCP server requested additional input (server=${server} method=${method}); multi round-trip requests are not supported`,
                    { server, data: result.inputRequests },
                );
            }
            const inputRequests = result.inputRequests ?? {};
            const inputResponses = await handler(server, method, inputRequests);
            if (!inputResponses) {
                throw new McpError(`MCP input handler aborted (server=${server} method=${method})`, { server });
            }
            current = { ...params, inputResponses };
            if (typeof result.requestState === 'string') {
                current.requestState = result.requestState;
            }
        }
        throw new McpError(
            `MCP input rounds exhausted (server=${server} method=${method} rounds=${maxRounds})`,
            { server },
        );
    }

    private async sendOnce(
        connection: McpConnection,
        server: string,
        method: string,
        params: Record<string, unknown>,
        headers: McpRequestHeaders,
    ): Promise<McpJsonRpcResponse> {
        try {
            return await this.rawRequest(connection, server, method, params, headers, this.nextRequestId++);
        } catch (error) {
            if (error instanceof McpEmptyStreamError && method !== 'tools/call') {
                return this.rawRequest(connection, server, method, params, headers, this.nextRequestId++);
            }
            throw error;
        }
    }

    private routeNotification(
        connection: McpConnection,
        server: string,
        notification: McpJsonRpcNotification,
    ): void {
        const meta = (notification.params as { _meta?: Record<string, unknown> } | undefined)?._meta;
        const subscriptionId = meta?.['io.modelcontextprotocol/subscriptionId'];
        if (subscriptionId === undefined) return;
        const sub = connection.subscriptions.get(subscriptionId as number | string);
        if (!sub) return;
        if (notification.method === 'notifications/subscriptions/acknowledged') {
            if (sub.ack.timer) clearTimeout(sub.ack.timer);
            sub.ack.timer = null;
            sub.ack.resolve();
        }
        if (notification.method === 'notifications/tools/list_changed') {
            connection.listsCache.delete(listCacheKey('tools/list'));
        } else if (notification.method === 'notifications/prompts/list_changed') {
            connection.listsCache.delete(listCacheKey('prompts/list'));
        } else if (
            notification.method === 'notifications/resources/list_changed'
        ) {
            connection.listsCache.delete(listCacheKey('resources/list'));
            connection.listsCache.delete(listCacheKey('resources/templates/list'));
        } else if (notification.method === 'notifications/resources/updated') {
            const uri = (notification.params as { uri?: unknown } | undefined)?.uri;
            if (typeof uri === 'string') {
                connection.readsCache.delete(`read:${uri}`);
            }
        }
        try {
            sub.onEvent(notification);
        } catch (error) {
            this.logger?.debug(`MCP subscription handler failed (server=${server}):`, error);
        }
    }

    private async connectOne(name: string): Promise<void> {
        const inFlight = this.connecting.get(name);
        if (inFlight) {
            return inFlight;
        }
        const run = this.doConnect(name);
        run.then(() => undefined, () => undefined);
        this.connecting.set(name, run);
        try {
            await run;
        } finally {
            this.connecting.delete(name);
        }
    }

    private async doConnect(name: string): Promise<void> {
        const existing = this.connections.get(name);
        if (existing?.status === 'ready') return;
        if (existing) {
            await this.disconnect(name);
        }
        const config = this.servers[name];
        if (!config) {
            throw new McpError(`Unknown MCP server: ${name}`, { server: name });
        }
        const transport = createTransport(config, this.logger);
        const connection: McpConnection = {
            transport,
            serverInfo: { name, version: '' },
            status: 'connecting',
            era: 'legacy',
            protocolVersion: MCP_LEGACY_VERSION,
            listsCache: new Map(),
            readsCache: new Map(),
            subscriptions: new Map(),
        };
        this.connections.set(name, connection);
        try {
            await transport.start();
            transport.onNotification((notification) => this.routeNotification(connection, name, notification));
            await this.negotiateEra(transport, connection, name);
            connection.status = 'ready';
            this.logger?.debug(
                `MCP server ready (${name} ${connection.serverInfo.name} ${connection.serverInfo.version} era=${connection.era})`,
            );
        } catch (error) {
            await transport.close().catch(() => {});
            this.connections.delete(name);
            throw error;
        }
    }

    private handshakeTimeoutMs(): number {
        return Math.max(this.requestTimeoutMs, HANDSHAKE_MIN_TIMEOUT_MS);
    }

    private async negotiateEra(
        transport: McpTransport,
        connection: McpConnection,
        name: string,
    ): Promise<void> {
        let discover: McpDiscoverResult | null = null;
        let inputRequired: { inputRequests?: unknown } | null = null;
        try {
            const response = await transport.request(
                {
                    jsonrpc: '2.0',
                    id: this.nextRequestId++,
                    method: 'server/discover',
                    params: metaParams(MCP_MODERN_VERSION, this.clientInfo),
                },
                this.handshakeTimeoutMs(),
            );
            if (response.error) {
                if (response.error.code === UNSUPPORTED_VERSION_CODE) {
                    discover = this.pickAdvertisedVersion(response.error.data, name);
                } else if (response.error.code === -32601 || response.error.code === -32602) {
                    await this.legacyHandshake(transport, connection);
                    return;
                } else {
                    throw new McpError(
                        `MCP version negotiation failed (server=${name}): ${response.error.message}`,
                        { code: response.error.code, server: name, data: response.error.data },
                    );
                }
            } else {
                const result = (response.result ?? {}) as McpDiscoverResult & { inputRequests?: unknown };
                if (result.resultType === 'input_required') {
                    inputRequired = result;
                } else {
                    discover = result;
                }
            }
        } catch (error) {
            this.logger?.debug(
                `MCP discover failed, falling back to legacy initialize (server=${name}):`,
                error,
            );
            await this.legacyHandshake(transport, connection);
            return;
        }
        if (inputRequired) {
            throw new McpError(
                `MCP server requested additional input during version negotiation (server=${name}); multi round-trip discovery is not supported`,
                { server: name, data: inputRequired.inputRequests },
            );
        }
        if (!discover || !Array.isArray(discover.supportedVersions)) {
            await this.legacyHandshake(transport, connection);
            return;
        }
        const version = MODERN_KNOWN_VERSIONS.find((known) => discover?.supportedVersions?.includes(known));
        if (!version) {
            throw new McpError(
                `MCP server supports no known protocol version (server=${name} supported=${discover.supportedVersions.join(',')})`,
                { server: name, data: discover.supportedVersions },
            );
        }
        connection.era = 'modern';
        connection.protocolVersion = version;
        const info = discover.serverInfo;
        connection.serverInfo = {
            name: typeof info?.name === 'string' && info.name.length > 0 ? info.name : name,
            version: typeof info?.version === 'string' ? info.version : '',
        };
    }

    private pickAdvertisedVersion(data: unknown, name: string): McpDiscoverResult {
        const supported = (data as { supported?: unknown } | null)?.supported;
        if (!Array.isArray(supported)) {
            throw new McpError(`MCP version negotiation failed (server=${name})`, { server: name, data });
        }
        return { supportedVersions: supported.filter((entry): entry is string => typeof entry === 'string') };
    }

    private async legacyHandshake(transport: McpTransport, connection: McpConnection): Promise<void> {
        const response = await transport.request(
            {
                jsonrpc: '2.0',
                id: this.nextRequestId++,
                method: 'initialize',
                params: {
                    protocolVersion: MCP_LEGACY_VERSION,
                    capabilities: {},
                    clientInfo: this.clientInfo,
                },
            },
            this.handshakeTimeoutMs(),
        );
        if (response.error) {
            throw new McpError(`MCP initialize failed: ${response.error.message}`, {
                code: response.error.code,
                data: response.error.data,
            });
        }
        const info = (response.result ?? {}) as { serverInfo?: { name?: unknown; version?: unknown } };
        connection.serverInfo = {
            name: typeof info.serverInfo?.name === 'string' && info.serverInfo.name.length > 0
                ? info.serverInfo.name
                : connection.serverInfo.name,
            version: typeof info.serverInfo?.version === 'string' ? info.serverInfo.version : connection.serverInfo.version,
        };
        await transport.notify(
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            this.methodHeaders(connection, 'notifications/initialized'),
        );
        connection.era = 'legacy';
        connection.protocolVersion = MCP_LEGACY_VERSION;
    }

    private async rawRequest(
        connection: McpConnection,
        server: string,
        method: string,
        params: Record<string, unknown>,
        headers: McpRequestHeaders,
        id: number | string,
    ): Promise<McpJsonRpcResponse> {
        const body =
            connection.era === 'modern'
                ? { ...params, ...metaParams(connection.protocolVersion, this.clientInfo) }
                : params;
        return connection.transport.request(
            { jsonrpc: '2.0', id, method, params: body },
            this.requestTimeoutMs,
            headers,
        );
    }

    private async callHeaders(
        connection: McpConnection,
        server: string,
        tool: string,
        args: Record<string, unknown>,
    ): Promise<McpRequestHeaders> {
        const headers: McpRequestHeaders = {};
        if (connection.era !== 'modern') {
            return headers;
        }
        headers['MCP-Protocol-Version'] = connection.protocolVersion;
        headers['Mcp-Method'] = 'tools/call';
        headers['Mcp-Name'] = encodeHeaderValue(tool);
        let schema = this.cachedSchema(connection, tool);
        if (!schema) {
            try {
                await this.listServerTools(server);
                schema = this.cachedSchema(connection, tool);
            } catch (error) {
                this.logger?.debug(
                    `MCP tools/list failed while resolving call headers (server=${server} tool=${tool}):`,
                    error,
                );
            }
        }
        if (schema) {
            for (const { path, header } of collectHeaderAnnotations(schema)) {
                const value = readPath(args, path);
                if (value === undefined || value === null) continue;
                if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
                headers[`Mcp-Param-${header}`] = encodeHeaderValue(String(value));
            }
        }
        return headers;
    }

    private cachedList<T>(connection: McpConnection, key: string): T[] | null {
        const cached = connection.listsCache.get(key);
        if (!cached || Date.now() >= cached.expiresAt) return null;
        return (cached.value as T[]).slice();
    }

    private storeList<T>(connection: McpConnection, key: string, value: T[], ttlMs: number | null): void {
        if (ttlMs === null || ttlMs <= 0) return;
        this.pruneExpired(connection.listsCache);
        connection.listsCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    }

    private pruneExpired(cache: Map<string, McpCacheEntry>): void {
        const now = Date.now();
        for (const [key, entry] of cache) {
            if (now >= entry.expiresAt) cache.delete(key);
        }
    }

    private cachedSchema(connection: McpConnection, tool: string): Record<string, unknown> | null {
        const cached = this.cachedList<McpTool>(connection, listCacheKey('tools/list'));
        if (!cached) return null;
        const found = cached.find((entry) => entry.name === tool);
        if (!found || !found.inputSchema || typeof found.inputSchema !== 'object') return null;
        return found.inputSchema as Record<string, unknown>;
    }

    private async listServerTools(name: string): Promise<McpTool[]> {
        const connection = this.requireReady(name);
        const cached = this.cachedList<McpTool>(connection, listCacheKey('tools/list'));
        if (cached) return cached;
        const tools = await this.fetchList<McpTool>(connection, name, 'tools/list', 'tools', (entry) => {
            if (!entry || typeof entry.name !== 'string') return null;
            const inputSchema =
                entry.inputSchema && typeof entry.inputSchema === 'object'
                    ? (entry.inputSchema as Record<string, unknown>)
                    : {};
            if (!validateHeaderAnnotations(entry.name, inputSchema)) {
                this.logger?.warn(
                    `MCP tool excluded for invalid x-mcp-header annotations (server=${name} tool=${entry.name})`,
                );
                return null;
            }
            return {
                name: entry.name,
                description: typeof entry.description === 'string' ? entry.description : undefined,
                inputSchema,
            };
        });
        return tools;
    }

    private async fetchList<T>(
        connection: McpConnection,
        server: string,
        method: string,
        itemKey: string,
        normalize: (entry: McpTool & Record<string, unknown>) => T | null,
    ): Promise<T[]> {
        const cacheKey = listCacheKey(method);
        const cached = this.cachedList<T>(connection, cacheKey);
        if (cached) return cached;
        const items: T[] = [];
        let listTtl: number | null = null;
        let cursor: string | undefined;
        let pages = 0;
        do {
            pages += 1;
            if (pages > this.maxListPages) {
                throw new McpError(
                    `MCP ${method} pagination exceeded ${this.maxListPages} pages (server=${server})`,
                    { server },
                );
            }
            const response = await this.rawRequest(
                connection,
                server,
                method,
                cursor === undefined ? {} : { cursor },
                this.methodHeaders(connection, method),
                this.nextRequestId++,
            );
            if (response.error) {
                throw new McpError(`MCP ${method} failed (server=${server}): ${response.error.message}`, {
                    code: response.error.code,
                    server,
                    data: response.error.data,
                });
            }
            const result = (response.result ?? {}) as {
                [key: string]: unknown;
                nextCursor?: string;
                resultType?: string;
                ttlMs?: number;
            };
            this.assertComplete(result, server, method);
            const raw = result[itemKey];
            if (Array.isArray(raw)) {
                for (const entry of raw) {
                    const normalized = normalize(entry as McpTool & Record<string, unknown>);
                    if (normalized !== null) items.push(normalized);
                }
            }
            if (typeof result.ttlMs === 'number' && result.ttlMs > 0) {
                listTtl = listTtl === null ? result.ttlMs : Math.min(listTtl, result.ttlMs);
            }
            cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
        } while (cursor !== undefined);
        this.storeList(connection, cacheKey, items, listTtl);
        return items;
    }

    private methodHeaders(connection: McpConnection, method: string, name?: string): McpRequestHeaders {
        if (connection.era !== 'modern') return {};
        const headers: McpRequestHeaders = {
            'MCP-Protocol-Version': connection.protocolVersion,
            'Mcp-Method': method,
        };
        if (name !== undefined) {
            headers['Mcp-Name'] = encodeHeaderValue(name);
        }
        return headers;
    }

    private assertComplete(
        result: { resultType?: string; inputRequests?: unknown } | null | undefined,
        server: string,
        method: string,
    ): void {
        if (result && result.resultType === 'input_required') {
            throw new McpError(
                `MCP server requested additional input (server=${server} method=${method}); multi round-trip requests are not supported`,
                { server, data: result.inputRequests },
            );
        }
    }

    private requireReady(name: string): McpConnection {
        const connection = this.connections.get(name);
        if (!connection || connection.status !== 'ready') {
            throw new McpError(`MCP server is not connected: ${name}`, { server: name });
        }
        return connection;
    }
}
