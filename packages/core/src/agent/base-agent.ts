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
  on(event: typeof MCP_EVENTS.JECTON_UPDATE, listener: (data: { address: string; balance: string; symbol: string }) => void): this;
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
    if (!this.isRunning && !this.initialized) return;
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

  async getTransactions(limit?: number, offset?: number): Promise<Transaction[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getTransactions(limit, offset);
  }

  async sendTON(to: string, amount: string, message?: string): Promise<SendTONResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendTON(to, amount, message);
  }

  async sendJetton(jettonAddress: string, to: string, amount: string, message?: string): Promise<SendJettonResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendJetton(jettonAddress, to, amount, message);
  }

  async sendRawTransaction(boc: string): Promise<SendRawTransactionResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendRawTransaction(boc);
  }

  async getSwapQuote(fromJetton: string, toJetton: string, amount: string): Promise<SwapQuoteResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getSwapQuote(fromJetton, toJetton, amount);
  }

  async executeSwap(fromJetton: string, toJetton: string, amount: string, slippage?: number): Promise<SendRawTransactionResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.executeSwap(fromJetton, toJetton, amount, slippage);
  }

  async getNFTs(owner?: string): Promise<NFT[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getNFTs(owner);
  }

  async sendNFT(nftAddress: string, to: string, message?: string): Promise<SendNFTResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendNFT(nftAddress, to, message);
  }

  async resolveDNS(domain: string): Promise<ResolveDNSResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.resolveDNS(domain);
  }

  async backResolveDNS(address: string): Promise<BackResolveDNSResponse> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.backResolveDNS(address);
  }

  async getKnownJettons(): Promise<KnownJetton[]> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.getKnownJettons();
  }

  async sendMessage(message: string): Promise<Message> {
    if (!this.initialized) throw new Error('Agent not initialized');
    return this.mcp.sendMessage(message);
  }
}
