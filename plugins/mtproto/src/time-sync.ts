import { EventEmitter } from 'events';

export class TimeSync {
    private offset: number = 0;
    private lastSyncTime: number = 0;
    private syncInterval: number = 30000;
    private timer: NodeJS.Timeout | null = null;
    private events: EventEmitter;

    constructor(events: EventEmitter) {
        this.events = events;
    }

    start(): void {
        this.timer = setInterval(() => this.sync(), this.syncInterval);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async sync(): Promise<void> {
        try {
            const clientTime = Math.floor(Date.now() / 1000);
            this.events.emit('mtproto:time:sync_request', { clientTime });
        } catch (error) {
            this.events.emit('mtproto:time:sync_error', { error });
        }
    }

    updateOffset(serverTime: number): void {
        const clientTime = Math.floor(Date.now() / 1000);
        this.offset = serverTime - clientTime;
        this.lastSyncTime = Date.now();
        this.events.emit('mtproto:time:offset_updated', { offset: this.offset });
    }

    getServerTime(): number {
        return Math.floor(Date.now() / 1000) + this.offset;
    }

    getOffset(): number {
        return this.offset;
    }

    generateMessageId(): bigint {
        const serverTime = this.getServerTime();
        const now = BigInt(serverTime) << 32n;
        const randomPart = BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
        const raw = now | randomPart;
        return (raw - (raw % 4n)) & 0x7FFFFFFFFFFFFFFFn;
    }

    generateServerMessageId(): bigint {
        const serverTime = this.getServerTime();
        const now = BigInt(serverTime) << 32n;
        const randomPart = BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
        const raw = now | randomPart;
        return ((raw - (raw % 4n)) + 1n) & 0x7FFFFFFFFFFFFFFFn;
    }

    validateMessageId(msgId: bigint, tolerance: number = 300): boolean {
        const serverTime = this.getServerTime();
        const msgTime = Number(msgId >> 32n);
        const diff = Math.abs(serverTime - msgTime);
        return diff <= tolerance;
    }

    isTimeSynced(): boolean {
        return this.offset !== 0 || Date.now() - this.lastSyncTime < 60000;
    }

    handleTimeOffset(serverTime: number, salt: Buffer): void {
        this.updateOffset(serverTime);
        this.events.emit('mtproto:time:server_offset', { serverTime, salt: salt.toString('hex') });
    }
}
