import { EventEmitter } from 'events';
import { fromNano } from '@ton/core';
import { createTonWalletMCP } from '@ton/mcp';
import {
  Signer,
  WalletV5R1Adapter,
  TonWalletKit,
  Network,
  MemoryStorageAdapter
} from '@ton/walletkit';
import { MCP_EVENTS } from '../events';
import {
  MCPConfig,
  JsonRpcResponse,
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
} from '../types/mcp.types';

export interface Logger {
  info(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

const DEFAULT_LOGGER: Logger = {
  info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
  debug: (message, ...args) => console.log(`[DEBUG] ${message}`, ...args),
};

function extractWalletAddress(wallet: any): string {
  if (!wallet) return 'no wallet';
  try {
    if (wallet.address) {
      if (typeof wallet.address === 'object' && wallet.address.toString) {
        return wallet.address.toString();
      }
      return String(wallet.address);
    }
    if (typeof wallet.getAddress === 'function') {
      return wallet.getAddress().toString();
    }
    return 'unknown (see debug)';
  } catch (e) {
    return 'unknown (error extracting)';
  }
}

export class MCPClient extends EventEmitter {
  private httpEndpoint?: string;
  private mode: 'stdio' | 'http' | 'https';
  private config: MCPConfig;
  private isReady: boolean = false;
  private walletAddress?: string;
  private server: any;
  private kit: any;
  private wallet: any;
  private abortController: AbortController | null = null;
  private logger: Logger;

  constructor(config: MCPConfig = {}, logger?: Logger) {
    super();
    this.logger = logger || DEFAULT_LOGGER;

    if (config.debug === false) {
      this.logger.debug = () => {};
    }

    this.config = {
      mode: 'stdio',
      network: 'testnet',
      walletVersion: 'v5r1',
      host: '127.0.0.1',
      port: 3000,
      protocol: 'http',
      ...config
    };

    this.mode = this.config.mode!;

    if (this.mode !== 'stdio') {
      this.initHttpMode();
    }
  }

  async initialize(): Promise<void> {
    if (this.mode === 'stdio') {
      await this.initStdioMode();
    }
  }

  private async initStdioMode(): Promise<void> {
    try {
      this.logger.info('Initializing MCP stdio mode with programmatic API...');

      const network = this.config.network === 'testnet'
        ? Network.testnet()
        : Network.mainnet();

      this.kit = new TonWalletKit({
        networks: { [network.chainId]: {} },
        storage: new MemoryStorageAdapter(),
      });

      await this.kit.waitForReady();
      this.logger.debug('TonWalletKit initialized');

      if (!this.config.mnemonic) {
        throw new Error('Mnemonic is required for stdio mode');
      }

      const signer = await Signer.fromMnemonic(this.config.mnemonic, { type: 'ton' });
      this.logger.debug('Signer created from mnemonic');

      const walletAdapter = await WalletV5R1Adapter.create(signer, {
        client: this.kit.getApiClient(network),
        network: network,
      });
      this.logger.debug('Wallet adapter created');

      this.wallet = await this.kit.addWallet(walletAdapter);
      this.logger.debug('Wallet added to kit');

      this.walletAddress = extractWalletAddress(this.wallet);

      this.server = await createTonWalletMCP({ wallet: this.wallet });
      this.logger.debug('MCP server created');

      this.logger.info(`Wallet address: ${this.walletAddress}`);
      this.logger.info(`Network: ${this.config.network}`);

      this.isReady = true;
      this.emit(MCP_EVENTS.READY);

    } catch (error) {
      this.logger.error('Failed to initialize stdio mode:', error);
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private initHttpMode(): void {
    const protocol = this.mode === 'https' ? 'https' : 'http';
    this.httpEndpoint = `${protocol}://${this.config.host}:${this.config.port}/mcp`;
    this.logger.info(`MCP ${protocol.toUpperCase()} endpoint: ${this.httpEndpoint}`);
    this.isReady = true;
    this.emit(MCP_EVENTS.READY);
  }

  private async request(method: string, params: any = {}): Promise<any> {
    if (!this.isReady) {
      throw new Error('MCP client not ready. Call initialize() first.');
    }

    if (this.mode === 'stdio') {
      return this.stdioRequest(method, params);
    } else {
      return this.httpRequest(method, params);
    }
  }

  private async httpRequest(method: string, params: any): Promise<any> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (this.config.mnemonic) {
        headers['MNEMONIC'] = this.config.mnemonic;
      }
      if (this.config.network) {
        headers['NETWORK'] = this.config.network;
      }
      if (this.config.apiKey) {
        headers['TONCENTER_KEY'] = this.config.apiKey;
      }

      const id = Date.now();
      const requestBody = {
        jsonrpc: '2.0',
        method,
        params,
        id
      };

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          this.abortController?.abort();
          reject(new Error('Request timeout'));
        }, 30000);
      });

      const fetchPromise = fetch(this.httpEndpoint!, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as JsonRpcResponse;

      if (data.error) {
        throw new Error(data.error.message);
      }

      return data.result;

    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request aborted');
        }
        if (error.message.includes('Failed to fetch')) {
          throw new Error(`MCP server not running at ${this.httpEndpoint}`);
        }
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  private async callTool(method: string, params: any): Promise<any> {
    if (!this.server) {
      throw new Error('MCP server not initialized');
    }

    if (typeof this.server.callTool === 'function') {
      return this.server.callTool(method, params);
    }

    const tool = this.server._registeredTools?.[method];
    if (!tool) {
      const available = Object.keys(this.server._registeredTools || {});
      this.logger.error(`Method ${method} not found. Available: ${available.join(', ')}`);
      throw new Error(`Method ${method} not found in registered tools`);
    }

    const result = await tool.handler(params);
    this.logger.debug(`Response for ${method}:`, result);

    if (result?.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text' && item.text) {
          try {
            return JSON.parse(item.text);
          } catch {
            return item.text;
          }
        }
      }
    }

    return result;
  }

  private async stdioRequest(method: string, params: any): Promise<any> {
    try {
      this.logger.debug(`Calling method: ${method} with params:`, params);
      return await this.callTool(method, params);
    } catch (error) {
      this.logger.error(`Error calling method ${method}:`, error);
      throw error;
    }
  }

  async getBalance(): Promise<BalanceResponse> {
    try {
      const result = await this.request('get_balance', {});
      return {
        ton: fromNano(result?.balanceNano || '0'),
        nano: result?.balanceNano || '0'
      };
    } catch (error) {
      this.logger.error('Error getting balance:', error);
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      return { ton: '0', nano: '0' };
    }
  }

  async getJettonBalance(jettonAddress: string): Promise<JettonBalanceResponse> {
    return this.request('get_jetton_balance', { jettonAddress });
  }

  async getJettons(): Promise<JettonWithBalance[]> {
    const result = await this.request('get_jettons');
    return Array.isArray(result) ? result : [];
  }

  async getTransactions(limit: number = 20): Promise<Transaction[]> {
    const result = await this.request('get_transactions', { limit });
    return Array.isArray(result) ? result : [];
  }

  async getKnownJettons(): Promise<KnownJetton[]> {
    const result = await this.request('get_known_jettons');
    return Array.isArray(result) ? result : [];
  }

  async sendTON(toAddress: string, amount: string, comment?: string): Promise<SendTONResponse> {
    try {
      const result = await this.request('send_ton', { toAddress, amount, comment });
      this.emit(MCP_EVENTS.TRANSACTION, {
        hash: result.hash,
        amount,
        type: 'send_ton',
        from: this.walletAddress,
        to: toAddress
      });
      return result;
    } catch (error) {
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async sendJetton(toAddress: string, jettonAddress: string, amount: string, comment?: string): Promise<SendJettonResponse> {
    try {
      const result = await this.request('send_jetton', { toAddress, jettonAddress, amount, comment });
      this.emit(MCP_EVENTS.TRANSACTION, {
        hash: result.hash,
        amount,
        type: 'send_jetton',
        from: this.walletAddress,
        to: toAddress
      });
      return result;
    } catch (error) {
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async sendRawTransaction(messages: Message[], validUntil?: number, fromAddress?: string): Promise<SendRawTransactionResponse> {
    try {
      const result = await this.request('send_raw_transaction', { messages, validUntil, fromAddress });
      this.emit(MCP_EVENTS.TRANSACTION, {
        hash: result.hash,
        amount: '0',
        type: 'send_raw',
        from: fromAddress || this.walletAddress,
        to: 'multiple'
      });
      return result;
    } catch (error) {
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async getNFTs(limit: number = 20, offset: number = 0): Promise<NFT[]> {
    const result = await this.request('get_nfts', { limit, offset });
    return Array.isArray(result) ? result : [];
  }

  async getNFT(nftAddress: string): Promise<NFT> {
    return this.request('get_nft', { nftAddress });
  }

  async sendNFT(nftAddress: string, toAddress: string, comment?: string): Promise<SendNFTResponse> {
    try {
      const result = await this.request('send_nft', { nftAddress, toAddress, comment });
      this.emit(MCP_EVENTS.TRANSACTION, {
        hash: result.hash,
        type: 'send_nft',
        from: this.walletAddress,
        to: toAddress
      });
      this.emit(MCP_EVENTS.NFT_UPDATE, {
        address: nftAddress,
        owner: toAddress
      });
      return result;
    } catch (error) {
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async resolveDNS(domain: string): Promise<ResolveDNSResponse> {
    return this.request('resolve_dns', { domain });
  }

  async backResolveDNS(address: string): Promise<BackResolveDNSResponse> {
    return this.request('back_resolve_dns', { address });
  }

  async getSwapQuote(fromToken: string, toToken: string, amount: string, slippageBps: number = 100): Promise<SwapQuoteResponse> {
    return this.request('get_swap_quote', { fromToken, toToken, amount, slippageBps });
  }

  async executeSwap(quote: SwapQuoteResponse, amount?: string): Promise<{ hash: string; success: boolean }> {
    try {
      const { messages, validUntil } = quote.transactionParams;
      const result = await this.sendRawTransaction(messages, validUntil);

      this.emit(MCP_EVENTS.TRANSACTION, {
        hash: result.hash,
        amount: amount || quote.fromAmount,
        type: 'swap',
        from: this.walletAddress,
        to: 'dex'
      });
      return { hash: result.hash, success: true };
    } catch (error) {
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async swapTokens(fromToken: string, toToken: string, amount: string, slippageBps: number = 100): Promise<{ hash: string; quote: SwapQuoteResponse; success: boolean }> {
    try {
      const quote = await this.getSwapQuote(fromToken, toToken, amount, slippageBps);
      const { hash, success } = await this.executeSwap(quote, amount);
      return { hash, quote, success };
    } catch (error) {
      this.emit(MCP_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.emit(MCP_EVENTS.CLOSED, 0);
    this.removeAllListeners();
  }

  async waitForReady(timeout: number = 10000): Promise<void> {
    if (this.isReady) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for MCP to be ready'));
      }, timeout);

      this.once(MCP_EVENTS.READY, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  getWalletAddress(): string | undefined {
    return this.walletAddress;
  }

  getConfig(): MCPConfig {
    return { ...this.config };
  }
}
