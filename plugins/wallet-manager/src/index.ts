import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
import { WalletComponents } from './components';
import { WalletSkills } from './skills';
import { 
  WalletConfig, 
  WalletInfo, 
  TransactionResult,
  WalletBalance,
  SendTONParams,
  SendJettonParams,
  SwapQuoteParams,
  SwapResult,
  TransactionEvent,
  JettonWithBalance,
  KnownJetton,
  NFT,
  ResolveDNSResponse,
  BackResolveDNSResponse,
  SwapQuoteResponse
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class WalletManagerPlugin implements Plugin {
  public metadata: PluginMetadata = {
    name: 'wallet-manager',
    version: '0.1.0',
    description: 'TON wallet management plugin with transaction monitoring',
    author: 'TON AI Core Team',
    dependencies: []
  };

  private context!: PluginContext;
  private components!: WalletComponents;
  private skills!: WalletSkills;
  private config!: WalletConfig;
  private initialized: boolean = false;
  private monitorInterval?: NodeJS.Timeout;
  private lastTxHash: string = '';

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.config = context.config as WalletConfig;

    this.context.logger.info('Initializing WalletManager plugin...');

    this.config = {
      network: 'testnet',
      autoConnect: true,
      monitorInterval: 5000,
      maxTransactions: 20,
      ...this.config
    };

    this.components = new WalletComponents(this.context, this.config);
    this.skills = new WalletSkills(this.context, this.context.mcp, this.components);

    if (this.config.autoConnect) {
      await this.skills.waitForReady();
    }

    this.initialized = true;
    this.context.logger.info('WalletManager plugin initialized');
  }

  async onActivate(): Promise<void> {
    this.context.logger.info('WalletManager plugin activated');

    const address = this.skills.getWalletAddress();

    this.startTransactionMonitoring();

    this.context.events.emit('wallet:activated', { 
      address,
      network: this.config.network 
    });
  }

  async onDeactivate(): Promise<void> {
    this.context.logger.info('WalletManager plugin deactivated');

    this.stopTransactionMonitoring();

    this.context.events.emit('wallet:deactivated');
  }

  async shutdown(): Promise<void> {
    this.context.logger.info('WalletManager plugin shutting down...');

    this.stopTransactionMonitoring();
    this.components.cleanup();
    this.initialized = false;
  }

  async onConfigChange(newConfig: Record<string, any>): Promise<void> {
    this.config = { ...this.config, ...newConfig } as WalletConfig;
    this.context.logger.info('WalletManager config updated', this.config);

    this.components.updateConfig(this.config);

    if (newConfig.monitorInterval) {
      this.restartTransactionMonitoring();
    }

    this.context.events.emit('wallet:config:updated', this.config);
  }

  private startTransactionMonitoring(): void {
    if (!this.config.monitorInterval || this.config.monitorInterval <= 0) {
      this.context.logger.info('Transaction monitoring is disabled');
      return;
    }

    if (this.monitorInterval) return;

    this.monitorInterval = setInterval(
      async () => {
        await this.monitorTransactions();
      },
      this.config.monitorInterval
    );

    this.context.logger.info(`Transaction monitoring started (interval: ${this.config.monitorInterval}ms)`);
  }

  private stopTransactionMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
      this.context.logger.info('Transaction monitoring stopped');
    }
  }

  private restartTransactionMonitoring(): void {
    this.stopTransactionMonitoring();
    this.startTransactionMonitoring();
  }

  private async monitorTransactions(): Promise<void> {
    try {
      const transactions = await this.skills.getTransactions(5);

      for (const tx of transactions) {
        if (tx.hash !== this.lastTxHash && this.isIncomingTransaction(tx)) {
          this.lastTxHash = tx.hash;
          await this.processIncomingTransaction(tx);
        }
      }
    } catch (error) {
      this.context.logger.debug('Error monitoring transactions:', error);
    }
  }

  private isIncomingTransaction(tx: any): boolean {
    const myAddress = this.skills.getWalletAddress();
    if (!myAddress) return false;

    for (const event of tx.events || []) {
      if (event.to === myAddress) {
        return true;
      }
    }
    return false;
  }

  private async processIncomingTransaction(tx: any): Promise<void> {
    const myAddress = this.skills.getWalletAddress();
    const incomingEvent = tx.events.find((e: any) => e.to === myAddress);

    if (!incomingEvent) return;

    const event: TransactionEvent = {
      hash: tx.hash,
      from: incomingEvent.from,
      to: incomingEvent.to,
      amount: incomingEvent.amount,
      comment: incomingEvent.comment,
      timestamp: tx.time,
      lt: tx.lt
    };

    this.components.addToHistory(event);
    this.context.events.emit('wallet:transaction:received', event);
  }

  async waitForReady(timeout?: number): Promise<void> {
    this.checkInitialized();
    return this.skills.waitForReady(timeout);
  }

  getAddress(): string | undefined {
    this.checkInitialized();
    return this.skills.getWalletAddress();
  }

  async getBalance(useCache?: boolean): Promise<WalletBalance> {
    this.checkInitialized();
    return this.skills.getBalance(useCache);
  }

  async getTransactions(limit?: number): Promise<any[]> {
    this.checkInitialized();
    return this.skills.getTransactions(limit);
  }

  getIncomingTransactions(limit: number = 10): TransactionEvent[] {
    this.checkInitialized();
    return this.components.getRecentTransactions(limit);
  }

  async sendTON(params: SendTONParams): Promise<TransactionResult> {
    this.checkInitialized();

    const result = await this.skills.sendTON(
      params.to,
      params.amount,
      params.comment
    );

    this.context.events.emit('wallet:transaction:sent', {
      hash: result.hash,
      to: params.to,
      amount: params.amount,
      type: 'TON'
    });

    return result;
  }

  async sendJetton(params: SendJettonParams): Promise<TransactionResult> {
    this.checkInitialized();

    const result = await this.skills.sendJetton(
      params.to,
      params.jettonAddress,
      params.amount,
      params.comment
    );

    this.context.events.emit('wallet:transaction:sent', {
      hash: result.hash,
      to: params.to,
      amount: params.amount,
      jetton: params.jettonAddress,
      type: 'JETTON'
    });

    return result;
  }

  async getJettons(): Promise<JettonWithBalance[]> {
    this.checkInitialized();
    return this.skills.getJettons();
  }

  async getKnownJettons(): Promise<KnownJetton[]> {
    this.checkInitialized();
    return this.skills.getKnownJettons();
  }

  async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuoteResponse> {
    this.checkInitialized();
    return this.skills.getSwapQuote(
      params.fromToken,
      params.toToken,
      params.amount,
      params.slippageBps
    );
  }

  async swapTokens(params: SwapQuoteParams): Promise<SwapResult> {
    this.checkInitialized();

    const result = await this.skills.swapTokens(
      params.fromToken,
      params.toToken,
      params.amount,
      params.slippageBps
    );

    this.context.events.emit('wallet:swap:executed', {
      hash: result.hash,
      fromToken: params.fromToken,
      toToken: params.toToken,
      amount: params.amount
    });

    return result;
  }

  async getNFTs(limit?: number, offset?: number): Promise<NFT[]> {
    this.checkInitialized();
    return this.skills.getNFTs(limit, offset);
  }

  async getNFT(nftAddress: string): Promise<NFT> {
    this.checkInitialized();
    return this.skills.getNFT(nftAddress);
  }

  async sendNFT(params: {
    nftAddress: string;
    to: string;
    comment?: string;
  }): Promise<TransactionResult> {
    this.checkInitialized();

    const result = await this.skills.sendNFT(
      params.nftAddress,
      params.to,
      params.comment
    );

    this.context.events.emit('wallet:nft:sent', {
      hash: result.hash,
      nft: params.nftAddress,
      to: params.to
    });

    return result;
  }

  async resolveDNS(domain: string): Promise<ResolveDNSResponse> {
    this.checkInitialized();
    return this.skills.resolveDNS(domain);
  }

  async backResolveDNS(address: string): Promise<BackResolveDNSResponse> {
    this.checkInitialized();
    return this.skills.backResolveDNS(address);
  }

  getWalletInfo(): WalletInfo {
    this.checkInitialized();
    return {
      address: this.skills.getWalletAddress(),
      network: this.config.network,
      isReady: this.skills.isReady()
    };
  }

  isReady(): boolean {
    return this.skills.isReady();
  }

  onTransaction(callback: (event: TransactionEvent) => void): void {
    this.context.events.on('wallet:transaction:received', callback);
  }

  offTransaction(callback: (event: TransactionEvent) => void): void {
    this.context.events.off('wallet:transaction:received', callback);
  }

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('Plugin not initialized. Call initialize() first.');
    }
  }
}
