import { PluginContext } from '@ton-ai/core';
import { 
  WalletConfig, 
  TransactionEvent,
  TransactionHistory
} from './types';

export class TransactionMonitor {
  private history: TransactionEvent[] = [];
  private maxHistory: number = 100;
  private lastProcessedHash: string = '';

  constructor(maxHistory: number = 100) {
    this.maxHistory = maxHistory;
  }

  addToHistory(event: TransactionEvent): void {
    this.history.unshift(event);

    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }

    this.lastProcessedHash = event.hash;
  }

  getRecentTransactions(limit: number = 10): TransactionEvent[] {
    return this.history.slice(0, limit);
  }

  getLastProcessedHash(): string {
    return this.lastProcessedHash;
  }

  setLastProcessedHash(hash: string): void {
    this.lastProcessedHash = hash;
  }

  isNewTransaction(hash: string): boolean {
    return hash !== this.lastProcessedHash && 
           !this.history.some(tx => tx.hash === hash);
  }

  clearHistory(): void {
    this.history = [];
    this.lastProcessedHash = '';
  }

  getHistoryStats(): TransactionHistory {
    const total = this.history.length;
    const byType: Record<string, number> = {};

    for (const tx of this.history) {
      const type = tx.jetton ? 'jetton' : tx.nft ? 'nft' : 'ton';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      total,
      byType,
      lastTransaction: this.history[0],
      oldestTransaction: this.history[this.history.length - 1]
    };
  }
}

export class BalanceCache {
  private cache: {
    ton: string;
    nano: string;
    timestamp: number;
  } | null = null;
  private maxAge: number = 30000;

  constructor(maxAge?: number) {
    if (maxAge) this.maxAge = maxAge;
  }

  set(balance: { ton: string; nano: string }): void {
    this.cache = {
      ...balance,
      timestamp: Date.now()
    };
  }

  get(): { ton: string; nano: string } | null {
    if (!this.cache) return null;

    if (Date.now() - this.cache.timestamp > this.maxAge) {
      this.cache = null;
      return null;
    }

    return {
      ton: this.cache.ton,
      nano: this.cache.nano
    };
  }

  clear(): void {
    this.cache = null;
  }

  isFresh(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp <= this.maxAge;
  }
}

export class WalletComponents {
  public monitor: TransactionMonitor;
  public balanceCache: BalanceCache;
  private context: PluginContext;
  private config: WalletConfig;
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(context: PluginContext, config: WalletConfig) {
    this.context = context;
    this.config = config;

    this.monitor = new TransactionMonitor(config.maxTransactions || 100);
    this.balanceCache = new BalanceCache(30000);
  }

  updateConfig(newConfig: WalletConfig): void {
    this.config = { ...this.config, ...newConfig };
  }

  addToHistory(event: TransactionEvent): void {
    this.monitor.addToHistory(event);
  }

  getRecentTransactions(limit: number = 10): TransactionEvent[] {
    return this.monitor.getRecentTransactions(limit);
  }

  startInterval(name: string, callback: () => Promise<void>, intervalMs: number): void {
    if (this.intervals.has(name)) {
      this.stopInterval(name);
    }

    const interval = setInterval(async () => {
      try {
        await callback();
      } catch (error) {
        this.context.logger.error(`Error in interval ${name}:`, error);
      }
    }, intervalMs);

    this.intervals.set(name, interval);
  }

  stopInterval(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  stopAllIntervals(): void {
    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  cleanup(): void {
    this.stopAllIntervals();
    this.monitor.clearHistory();
    this.balanceCache.clear();
  }
}
