import { EventEmitter } from 'events';
import { MCPClient } from '../client';
import { PluginManager } from '../plugin';
import { Plugin } from '../plugin/plugin-interface';
import {
  MCPConfig,
  BalanceResponse,
  JettonBalanceResponse,
  JettonWithBalance,
  Transaction,
  SendTONResponse,
  SendJettonResponse,
  SendRawTransactionResponse,
  SwapQuoteResponse,
  NFT,
  SendNFTResponse,
  ResolveDNSResponse,
  BackResolveDNSResponse,
  KnownJetton,
  Message
} from '../types';

export interface AgentConfig extends MCPConfig {
  id?: string;
  name?: string;
  plugins?: Record<string, any>;
}

export abstract class BaseAgent extends EventEmitter {
  public readonly id: string;
  public readonly name: string;
  protected mcp: MCPClient;
  protected plugins: PluginManager;
  protected config: AgentConfig;
  protected isRunning: boolean = false;
  protected startTime?: Date;
  private initialized: boolean = false;

  constructor(config: AgentConfig = {}) {
    super();
    this.id = config.id || `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.name = config.name || this.id;
    this.config = config;

    this.mcp = new MCPClient(config);
    this.plugins = new PluginManager(this.mcp, config.plugins);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (this.config.mode === 'stdio') {
        await (this.mcp as any).initialize();
      }

      await this.mcp.waitForReady();
      await this.onInitialize();

      this.startTime = new Date();
      this.initialized = true;

      this.emit('initialized', { 
        id: this.id, 
        name: this.name,
        startTime: this.startTime,
        walletAddress: this.mcp.getWalletAddress()
      });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.isRunning) {
      this.isRunning = true;
      await this.onStart();
      this.emit('started', { id: this.id, name: this.name });
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.initialized = false;

    await this.plugins.deactivateAll();
    await this.onStop();
    await this.mcp.close();

    this.emit('stopped', { id: this.id, name: this.name });
    this.removeAllListeners();
  }

  async registerPlugin(plugin: Plugin, config?: Record<string, any>): Promise<void> {
    await this.plugins.registerPlugin(plugin);
    if (config) {
      await this.plugins.activatePlugin(plugin.metadata.name, config);
    }
    this.emit('plugin:registered', { name: plugin.metadata.name });
  }

  async unregisterPlugin(pluginName: string): Promise<void> {
    await this.plugins.unregisterPlugin(pluginName);
    this.emit('plugin:unregistered', { name: pluginName });
  }

  async activatePlugin(pluginName: string, config?: Record<string, any>): Promise<void> {
    await this.plugins.activatePlugin(pluginName, config);
  }

  async deactivatePlugin(pluginName: string): Promise<void> {
    await this.plugins.deactivatePlugin(pluginName);
  }

  getPlugin<T extends Plugin>(name: string): T | undefined {
    return this.plugins.getPlugin(name) as T;
  }

  isPluginActive(name: string): boolean {
    return this.plugins.isActive(name);
  }

  listPlugins() {
    return this.plugins.listPlugins();
  }

  listActivePlugins() {
    return this.plugins.listActivePlugins();
  }

  async getBalance(): Promise<BalanceResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getBalance();
  }

  async getJettonBalance(jettonAddress: string): Promise<JettonBalanceResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getJettonBalance(jettonAddress);
  }

  async getJettons(): Promise<JettonWithBalance[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getJettons();
  }

  async getTransactions(limit?: number): Promise<Transaction[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getTransactions(limit);
  }

  async getKnownJettons(): Promise<KnownJetton[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getKnownJettons();
  }

  async sendTON(toAddress: string, amount: string, comment?: string): Promise<SendTONResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendTON(toAddress, amount, comment);
  }

  async sendJetton(toAddress: string, jettonAddress: string, amount: string, comment?: string): Promise<SendJettonResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendJetton(toAddress, jettonAddress, amount, comment);
  }

  async sendRawTransaction(messages: Message[], validUntil?: number, fromAddress?: string): Promise<SendRawTransactionResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendRawTransaction(messages, validUntil, fromAddress);
  }

  async getSwapQuote(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<SwapQuoteResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getSwapQuote(fromToken, toToken, amount, slippageBps);
  }

  async getNFTs(limit?: number, offset?: number): Promise<NFT[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getNFTs(limit, offset);
  }

  async getNFT(nftAddress: string): Promise<NFT> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getNFT(nftAddress);
  }

  async sendNFT(nftAddress: string, toAddress: string, comment?: string): Promise<SendNFTResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendNFT(nftAddress, toAddress, comment);
  }

  async resolveDNS(domain: string): Promise<ResolveDNSResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.resolveDNS(domain);
  }

  async backResolveDNS(address: string): Promise<BackResolveDNSResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.backResolveDNS(address);
  }

  getWalletAddress(): string | undefined {
    return this.mcp.getWalletAddress();
  }

  protected abstract onInitialize(): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      isRunning: this.isRunning,
      initialized: this.initialized,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      walletAddress: this.getWalletAddress(),
      activePlugins: this.listActivePlugins(),
      mode: this.config.mode,
      network: this.config.network,
      config: { ...this.config, mnemonic: this.config.mnemonic ? '***' : undefined }
    };
  }
}
