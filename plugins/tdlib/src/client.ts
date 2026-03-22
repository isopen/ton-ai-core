import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { TdlibClient } from './types';

export class TdlibJsonClient extends EventEmitter implements TdlibClient {
    private process: ChildProcess | null = null;
    private requestId: number = 0;
    private pendingRequests: Map<number, { resolve: Function; reject: Function; timer: NodeJS.Timeout }> = new Map();
    private buffer: string = '';
    private ready: boolean = false;
    private config: {
        apiId: number;
        apiHash: string;
        databaseDirectory: string;
        filesDirectory: string;
        useTestDc: boolean;
        deviceModel: string;
        systemVersion: string;
        applicationVersion: string;
        tdlibPath?: string;
    };
    private botToken: string | null = null;
    private authState: string = '';

    constructor(config: {
        apiId: number;
        apiHash: string;
        databaseDirectory?: string;
        filesDirectory?: string;
        useTestDc?: boolean;
        deviceModel?: string;
        systemVersion?: string;
        applicationVersion?: string;
        tdlibPath?: string;
        botToken?: string;
    }) {
        super();
        this.config = {
            apiId: config.apiId,
            apiHash: config.apiHash,
            databaseDirectory: config.databaseDirectory || './tdlib_data',
            filesDirectory: config.filesDirectory || './tdlib_files',
            useTestDc: config.useTestDc || false,
            deviceModel: config.deviceModel || 'Node.js',
            systemVersion: config.systemVersion || process.platform,
            applicationVersion: config.applicationVersion || '1.0.0',
            tdlibPath: config.tdlibPath
        };
        this.botToken = config.botToken || null;
    }

    async start(): Promise<void> {
        const tdlibPath = this.findTdlib();
        console.log(`Using TDLib library: ${tdlibPath}`);

        if (!fs.existsSync(this.config.databaseDirectory)) {
            fs.mkdirSync(this.config.databaseDirectory, { recursive: true });
        }
        if (!fs.existsSync(this.config.filesDirectory)) {
            fs.mkdirSync(this.config.filesDirectory, { recursive: true });
        }

        const wrapperPath = this.createWrapper();

        this.process = spawn(wrapperPath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                TDLIB_LIBRARY_PATH: tdlibPath
            }
        });

        console.log(`TDLib wrapper process started with PID: ${this.process.pid}`);

        this.process.stdout?.on('data', (data: Buffer) => {
            this.handleData(data.toString());
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            if (text.includes('Error') || text.includes('error')) {
                console.error('Wrapper stderr:', text);
            }
        });

        this.process.on('error', (error) => {
            console.error('Wrapper process error:', error);
            this.emit('error', error);
        });

        this.process.on('close', (code) => {
            console.log(`Wrapper process closed with code ${code}`);
            this.ready = false;
            this.emit('close', code);
        });

        await this.sendSetTdlibParameters();
    }

    private createWrapper(): string {
        const sourcePath = path.join(__dirname, 'tdjson_wrapper.c');
        const wrapperPath = path.join(__dirname, 'tdjson_wrapper');

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Wrapper source not found: ${sourcePath}`);
        }

        try {
            const { execSync } = require('child_process');
            execSync(`gcc -o ${wrapperPath} ${sourcePath} -ldl -O2`, { stdio: 'inherit' });
            console.log(`Wrapper compiled: ${wrapperPath}`);
        } catch (error) {
            console.error('Failed to compile wrapper:', error);
            throw new Error('Failed to compile TDLib wrapper');
        }

        return wrapperPath;
    }

    private async sendSetTdlibParameters(): Promise<void> {
        console.log('Sending setTdlibParameters...');
        await this.send({
            '@type': 'setTdlibParameters',
            use_test_dc: this.config.useTestDc,
            database_directory: path.resolve(this.config.databaseDirectory),
            files_directory: path.resolve(this.config.filesDirectory),
            use_file_database: true,
            use_chat_info_database: true,
            use_message_database: true,
            use_secret_chats: false,
            api_id: this.config.apiId,
            api_hash: this.config.apiHash,
            system_language_code: 'en',
            device_model: this.config.deviceModel,
            system_version: this.config.systemVersion,
            application_version: this.config.applicationVersion,
            enable_storage_optimizer: true,
            ignore_file_names: false
        });
    }

    private findTdlib(): string {
        const paths = [
            this.config.tdlibPath,
            process.env.TDLIB_LIBRARY_PATH,
            '/usr/local/lib/libtdjson.so',
            '/usr/lib/libtdjson.so',
            '/usr/lib/x86_64-linux-gnu/libtdjson.so',
            '/usr/local/lib/libtdjson.dylib',
            path.join(process.cwd(), 'libtdjson.so'),
            path.join(process.cwd(), 'libtdjson.dylib')
        ].filter(Boolean);

        for (const p of paths) {
            if (p && fs.existsSync(p)) {
                console.log(`Found TDLib at: ${p}`);
                return p;
            }
        }

        throw new Error(`TDLib library not found. Searched paths:\n${paths.join('\n')}`);
    }

    private handleData(data: string): void {
        this.buffer += data;

        let index;
        while ((index = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, index);
            this.buffer = this.buffer.substring(index + 1);

            if (line.trim()) {
                this.handleResponse(line);
            }
        }
    }

    private handleResponse(line: string): void {
        try {
            const response = JSON.parse(line);
            const requestId = response['@extra'];

            console.log(`Received: type=${response['@type']}, extra=${requestId}`);

            if (requestId !== undefined && this.pendingRequests.has(requestId)) {
                const { resolve, reject, timer } = this.pendingRequests.get(requestId)!;
                clearTimeout(timer);
                this.pendingRequests.delete(requestId);

                if (response['@type'] === 'error') {
                    reject(new Error(`${response.code}: ${response.message}`));
                } else {
                    resolve(response);
                }
            } else if (response['@type'] && response['@type'] !== 'error') {
                this.handleUpdate(response);
            }
        } catch (error) {
            console.error('Parse error:', error, 'Line:', line);
        }
    }

    private handleUpdate(update: any): void {
        const type = update['@type'];

        if (type === 'updateAuthorizationState') {
            const state = update.authorization_state['@type'];
            console.log(`Auth state: ${state}`);
            this.authState = state;
            this.emit('auth_state', state);

            if (state === 'authorizationStateWaitTdlibParameters') {
                console.log('Waiting for TDLib parameters...');
            } else if (state === 'authorizationStateWaitPhoneNumber') {
                console.log('Waiting for phone number or bot token...');
                if (this.botToken) {
                    console.log('Bot token detected, sending checkAuthenticationBotToken...');
                    this.sendCheckBotToken().catch(console.error);
                }
            } else if (state === 'authorizationStateReady') {
                console.log('TDLib is ready!');
                this.ready = true;
                this.emit('ready');
            } else if (state === 'authorizationStateClosed') {
                console.log('TDLib closed');
                this.ready = false;
                this.emit('close');
            }
        }

        this.emit('update', update);
    }

    private async sendCheckBotToken(): Promise<void> {
        if (!this.botToken) return;

        console.log(`Sending checkAuthenticationBotToken...`);
        try {
            const result = await this.send({
                '@type': 'checkAuthenticationBotToken',
                token: this.botToken
            }, 30000);
            console.log('Bot token sent, result:', result);
        } catch (error) {
            console.error('Failed to send bot token:', error);
            throw error;
        }
    }

    async send(request: any, timeout: number = 30000): Promise<any> {
        if (!this.process) {
            throw new Error('Client not started');
        }

        const id = ++this.requestId;
        const payload = JSON.stringify({ ...request, '@extra': id });

        console.log(`Sending request ${id}: ${request['@type']}`);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Timeout: ${request['@type']}`));
            }, timeout);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.process!.stdin?.write(payload + '\n');
        });
    }

    async setBotToken(token: string): Promise<void> {
        this.botToken = token;
        if (this.authState === 'authorizationStateWaitPhoneNumber') {
            await this.sendCheckBotToken();
        }
    }

    async setPhoneNumber(phone: string): Promise<void> {
        await this.send({
            '@type': 'setAuthenticationPhoneNumber',
            phone_number: phone
        });
    }

    async checkCode(code: string): Promise<void> {
        await this.send({
            '@type': 'checkAuthenticationCode',
            code: code
        });
    }

    async checkPassword(password: string): Promise<void> {
        await this.send({
            '@type': 'checkAuthenticationPassword',
            password: password
        });
    }

    isReady(): boolean {
        return this.ready;
    }

    getAuthState(): string {
        return this.authState;
    }

    async close(): Promise<void> {
        if (this.process) {
            try {
                await this.send({ '@type': 'close' }, 5000);
            } catch (e) { }
            this.process.kill();
            this.process = null;
        }
        this.ready = false;
    }
}
