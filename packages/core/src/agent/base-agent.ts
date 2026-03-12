import { EventEmitter } from 'events';
import { MCPClient } from '../client';
import { PluginManager } from '../plugin';
import { Plugin } from '../plugin/plugin-interface';
import { AGENT_EVENTS, PLUGIN_EVENTS, MCP_EVENTS } from '../events';
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

export type AgentEventType = typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];

export interface AgentConfig extends MCPConfig {
  id?: string;
  name?: string;
  plugins?: Record<string, any>;
}

export interface BaseAgent {
  on(event: typeof AGENT_EVENTS.INITIALIZED, listener: (data: { id: string; name: string; startTime: Date; walletAddress?: string }) => void): this;
  on(event: typeof AGENT_EVENTS.STARTED, listener: (data: { id: string; name: string }) => void): this;
  on(event: typeof AGENT_EVENTS.STOPPED, listener: (data: { id: string; name: string }) => void): this;
  on(event: typeof AGENT_EVENTS.ERROR, listener: (error: Error) => void): this;
  on(event: typeof PLUGIN_EVENTS.REGISTERED, listener: (data: { name: string }) => void): this;
  on(event: typeof PLUGIN_EVENTS.UNREGISTERED, listener: (data: { name: string }) => void): this;
  on(event: typeof PLUGIN_EVENTS.ACTIVATED, listener: (data: { name: string }) => void): this;
  on(event: typeof PLUGIN_EVENTS.DEACTIVATED, listener: (data: { name: string }) => void): this;
  on(event: typeof MCP_EVENTS.READY, listener: () => void): this;
  on(event: typeof MCP_EVENTS.ERROR, listener: (error: Error) => void): this;
  on(event: typeof MCP_EVENTS.CLOSED, listener: (code: number | null) => void): this;
  on(event: typeof MCP_EVENTS.BALANCE_UPDATE, listener: (data: { ton: string; jettons?: Array<{ address: string; balance: string; symbol: string }> }) => void): this;
  on(event: typeof MCP_EVENTS.TRANSACTION, listener: (data: { hash: string; amount: string; type: string; from?: string; to?: string }) => void): this;
  on(event: typeof MCP_EVENTS.JETTON_UPDATE, listener: (data: { address: string; balance: string; symbol: string }) => void): this;
  on(event: typeof MCP_EVENTS.NFT_UPDATE, listener: (data: { address: string; owner: string; collection?: string }) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
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

    this.mcp.on(MCP_EVENTS.READY, () => {
      this.emit(MCP_EVENTS.READY);
    });

    this.mcp.on(MCP_EVENTS.ERROR, (error) => {
      this.emit(MCP_EVENTS.ERROR, error);
    });

    this.mcp.on(MCP_EVENTS.CLOSED, (code) => {
      this.emit(MCP_EVENTS.CLOSED, code);
    });

    this.mcp.on(MCP_EVENTS.BALANCE_UPDATE, (data) => {
      this.emit(MCP_EVENTS.BALANCE_UPDATE, data);
    });

    this.mcp.on(MCP_EVENTS.TRANSACTION, (data) => {
      this.emit(MCP_EVENTS.TRANSACTION, data);
    });

    this.mcp.on(MCP_EVENTS.JETTON_UPDATE, (data) => {
      this.emit(MCP_EVENTS.JETTON_UPDATE, data);
    });

    this.mcp.on(MCP_EVENTS.NFT_UPDATE, (data) => {
      this.emit(MCP_EVENTS.NFT_UPDATE, data);
    });
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

      this.emit(AGENT_EVENTS.INITIALIZED, {
        id: this.id,
        name: this.name,
        startTime: this.startTime,
        walletAddress: this.mcp.getWalletAddress()
      });
    } catch (error) {
      this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
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
      this.emit(AGENT_EVENTS.STARTED, { id: this.id, name: this.name });
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.initialized = false;

    await this.plugins.deactivateAll();
    await this.onStop();
    await this.mcp.close();

    this.emit(AGENT_EVENTS.STOPPED, { id: this.id, name: this.name });
    this.removeAllListeners();
  }

  async registerPlugin(plugin: Plugin, config?: Record<string, any>): Promise<void> {
    await this.plugins.registerPlugin(plugin);
    this.emit(PLUGIN_EVENTS.REGISTERED, { name: plugin.metadata.name });

    if (config) {
      await this.plugins.activatePlugin(plugin.metadata.name, config);
      this.emit(PLUGIN_EVENTS.ACTIVATED, { name: plugin.metadata.name });
    }
  }

  async unregisterPlugin(pluginName: string): Promise<void> {
    if (this.plugins.isActive(pluginName)) {
      await this.plugins.deactivatePlugin(pluginName);
      this.emit(PLUGIN_EVENTS.DEACTIVATED, { name: pluginName });
    }

    await this.plugins.unregisterPlugin(pluginName);
    this.emit(PLUGIN_EVENTS.UNREGISTERED, { name: pluginName });
  }

  async activatePlugin(pluginName: string, config?: Record<string, any>): Promise<void> {
    await this.plugins.activatePlugin(pluginName, config);
    this.emit(PLUGIN_EVENTS.ACTIVATED, { name: pluginName });
  }

  async deactivatePlugin(pluginName: string): Promise<void> {
    await this.plugins.deactivatePlugin(pluginName);
    this.emit(PLUGIN_EVENTS.DEACTIVATED, { name: pluginName });
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
