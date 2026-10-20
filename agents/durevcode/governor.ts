export interface GovernorClassConfig {
    cost: number;
    capacity: number;
    failLimit: number;
    failBaseMs: number;
    failFactor: number;
    failCapMs: number;
}

export const GOVERNOR_CLASS_DEFAULTS: Record<string, GovernorClassConfig> = {
    'topic-edit': { cost: 1, capacity: 40, failLimit: 4, failBaseMs: 2400, failFactor: 1.5, failCapMs: 8000 },
    'topic-send': { cost: 1, capacity: 24, failLimit: 4, failBaseMs: 1000, failFactor: 2, failCapMs: 20000 },
    'topic-markup': { cost: 1, capacity: 8, failLimit: 4, failBaseMs: 3000, failFactor: 1.6, failCapMs: 30000 },
    draft: { cost: 1, capacity: 60, failLimit: 4, failBaseMs: 2000, failFactor: 1, failCapMs: 2000 },
};

export interface FailOutcome {
    parked: boolean;
    waitMs: number;
    attempt: number;
}

export class TelegramRateGovernor {
    private tokens = new Map<string, number>();
    private penaltyUntil = new Map<string, number>();
    private failCounts = new Map<string, number>();

    constructor(
        private readonly now: () => number = Date.now,
        private readonly rng: () => number = Math.random,
        private readonly configs: Record<string, GovernorClassConfig> = GOVERNOR_CLASS_DEFAULTS,
    ) {}

    private config(scope: string): GovernorClassConfig {
        return this.configs[scope] ?? { cost: 1, capacity: 10, failLimit: 4, failBaseMs: 2000, failFactor: 1.5, failCapMs: 30000 };
    }

    budget(scope: string): number {
        if (!this.tokens.has(scope)) this.tokens.set(scope, this.config(scope).capacity);
        return this.tokens.get(scope) ?? 0;
    }

    capacity(scope: string): number {
        return this.config(scope).capacity;
    }

    refill(scope: string): void {
        this.tokens.set(scope, this.config(scope).capacity);
    }

    spend(scope: string): void {
        const left = this.budget(scope) - this.config(scope).cost;
        this.tokens.set(scope, Math.max(0, left));
    }

    canSpend(scope: string, cost?: number): boolean {
        return this.budget(scope) >= (cost ?? this.config(scope).cost);
    }

    note429(scope: string, retryAfterSec: number, marginMs = 1000): number {
        const until = this.now() + Math.max(0, retryAfterSec) * 1000 + marginMs;
        this.penaltyUntil.set(scope, Math.max(until, this.penaltyUntil.get(scope) ?? 0));
        return until;
    }

    penaltyMsLeft(scope: string): number {
        const until = this.penaltyUntil.get(scope) ?? 0;
        const left = until - this.now();
        return left > 0 ? left : 0;
    }

    pressure(): number {
        let max = 0;
        for (const until of this.penaltyUntil.values()) {
            max = Math.max(max, until - this.now());
        }
        if (max <= 0) return 0;
        return Math.min(1, max / 60000);
    }

    registerFail(scope: string): FailOutcome {
        const attempt = (this.failCounts.get(scope) ?? 0) + 1;
        this.failCounts.set(scope, attempt);
        const cfg = this.config(scope);
        if (attempt > cfg.failLimit) {
            return { parked: true, waitMs: 0, attempt };
        }
        const waitMs = Math.round(Math.min(cfg.failCapMs, cfg.failBaseMs * Math.pow(cfg.failFactor, attempt - 1)));
        return { parked: false, waitMs, attempt };
    }

    resetFails(scope: string): void {
        this.failCounts.delete(scope);
    }

    fails(scope: string): number {
        return this.failCounts.get(scope) ?? 0;
    }

    fullJitter(baseMs: number, attempt: number, capMs: number): number {
        const ceiling = Math.min(capMs, Math.round(baseMs * Math.pow(2, Math.max(0, attempt))));
        return Math.round(this.rng() * ceiling);
    }

    uniform(jitterMs: number): number {
        return Math.round(this.rng() * Math.max(0, jitterMs));
    }

    decorrelated(baseMs: number, prevMs: number, capMs: number): number {
        const low = baseMs;
        const high = Math.min(capMs, Math.round(prevMs * 3));
        return Math.round(low + this.rng() * Math.max(0, high - low));
    }
}
