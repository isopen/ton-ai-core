import { BaseAgentCore, BaseAgentConfig } from './base-agent-core';
import { MCPClient } from '../client';
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

export interface AgentConfig extends MCPConfig, BaseAgentConfig {}

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

const MCP_FORWARD_EVENTS = [
  MCP_EVENTS.READY,
  MCP_EVENTS.ERROR,
  MCP_EVENTS.CLOSED,
  MCP_EVENTS.BALANCE_UPDATE,
  MCP_EVENTS.TRANSACTION,
  MCP_EVENTS.JETTON_UPDATE,
  MCP_EVENTS.NFT_UPDATE,
];

export abstract class BaseAgent extends BaseAgentCore<AgentConfig> {
  protected mcp: MCPClient;

  constructor(config: AgentConfig = {}) {
    super({ ...config, mcp: undefined });
    this.mcp = new MCPClient(config, config.logger || this.logger);
    this.plugins.setMCP(this.mcp);
    for (const event of MCP_FORWARD_EVENTS) {
      this.mcp.on(event, (...args: any[]) => this.emit(event, ...args));
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      if (this.config.mode === 'stdio') {
        await this.mcp.initialize();
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

  async stop(): Promise<void> {
    this.isRunning = false;
    this.initialized = false;
    await this.plugins.deactivateAll();
    await this.onStop();
    await this.mcp.close();
    this.emit(AGENT_EVENTS.STOPPED, { id: this.id, name: this.name });
    this.removeAllListeners();
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

  async executeSwap(quote: SwapQuoteResponse, amount?: string): Promise<{ hash: string; success: boolean }> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.executeSwap(quote, amount);
  }

  async swapTokens(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<{ hash: string; quote: SwapQuoteResponse; success: boolean }> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.swapTokens(fromToken, toToken, amount, slippageBps);
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

  getStatus() {
    const baseStatus = super.getStatus();
    const configCopy = { ...this.config };
    if (configCopy.mnemonic) configCopy.mnemonic = '***';
    if (configCopy.apiKey) configCopy.apiKey = '***';
    return {
      ...baseStatus,
      walletAddress: this.getWalletAddress(),
      mode: this.config.mode,
      network: this.config.network,
      config: configCopy
    };
  }
}
