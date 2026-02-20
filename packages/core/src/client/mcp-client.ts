import { EventEmitter } from 'events';
import axios from 'axios';
import * as https from 'https';
import { fromNano, toNano } from '@ton/core';
import { createTonWalletMCP } from '@ton/mcp';
import { 
  Signer, 
  WalletV5R1Adapter, 
  TonWalletKit, 
  Network, 
  MemoryStorageAdapter
} from '@ton/walletkit';
import {
  MCPConfig,
  BalanceResponse,
  JettonBalanceResponse,
  JettonWithBalance,
  Transaction,
  SendTONResponse,
  SendJettonResponse,
  SendRawTransactionParams,
  SendRawTransactionResponse,
  SwapQuoteParams,
  SwapQuoteResponse,
  NFT,
  SendNFTResponse,
  ResolveDNSResponse,
  BackResolveDNSResponse,
  KnownJetton,
  Message
} from '../types/mcp.types';

export class MCPClient extends EventEmitter {
  private httpEndpoint?: string;
  private mode: 'stdio' | 'http' | 'https';
  private config: MCPConfig;
  private isReady: boolean = false;
  private walletAddress?: string;
  private server: any;
  private kit: any;
  private wallet: any;

  constructor(config: MCPConfig = {}) {
    super();
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
      console.log('Initializing MCP stdio mode with programmatic API...');

      const network = this.config.network === 'testnet' 
        ? Network.testnet() 
        : Network.mainnet();

      this.kit = new TonWalletKit({
        networks: { [network.chainId]: {} },
        storage: new MemoryStorageAdapter(),
      });

      await this.kit.waitForReady();
      console.log('TonWalletKit initialized');

      if (!this.config.mnemonic) {
        throw new Error('Mnemonic is required for stdio mode');
      }

      const signer = await Signer.fromMnemonic(this.config.mnemonic, { type: 'ton' });
      console.log('Signer created from mnemonic');

      const walletAdapter = await WalletV5R1Adapter.create(signer, {
        client: this.kit.getApiClient(network),
        network: network,
      });
      console.log('Wallet adapter created');

      this.wallet = await this.kit.addWallet(walletAdapter);
      console.log('Wallet added to kit');

      if (this.wallet) {
        if (this.wallet.address) {
          if (typeof this.wallet.address === 'object') {
            if (this.wallet.address.toString) {
              this.walletAddress = this.wallet.address.toString();
            } else {
              this.walletAddress = String(this.wallet.address);
            }
          } else {
            this.walletAddress = String(this.wallet.address);
          }
        } else if (this.wallet.getAddress) {
          const addr = await this.wallet.getAddress();
          this.walletAddress = addr.toString();
        } else {
          console.log('Wallet structure:', Object.keys(this.wallet));
          this.walletAddress = 'unknown (see debug)';
        }
      } else {
        this.walletAddress = 'no wallet';
      }

      this.server = await createTonWalletMCP({ wallet: this.wallet });
      console.log('MCP server created');

      console.log(`Wallet address: ${this.walletAddress}`);
      console.log(`Network: ${this.config.network}`);

      this.isReady = true;
      this.emit('ready');

    } catch (error) {
      console.error('Failed to initialize stdio mode:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private initHttpMode(): void {
    const protocol = this.mode === 'https' ? 'https' : 'http';
    this.httpEndpoint = `${protocol}://${this.config.host}:${this.config.port}/mcp`;
    console.log(`MCP ${protocol.toUpperCase()} endpoint: ${this.httpEndpoint}`);
    this.isReady = true;
    this.emit('ready');
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

      const httpsAgent = this.mode === 'https' 
        ? new https.Agent({ rejectUnauthorized: false }) 
        : undefined;

      const response = await axios.post(this.httpEndpoint!, {
        jsonrpc: '2.0',
        method,
        params,
        id
      }, { 
        headers, 
        timeout: 30000,
        httpsAgent 
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`MCP server not running at ${this.httpEndpoint}`);
      }
      throw error;
    }
  }

  private async stdioRequest(method: string, params: any): Promise<any> {
    if (!this.server) {
      throw new Error('MCP server not initialized');
    }

    const tool = this.server._registeredTools[method];
    if (!tool) {
      console.error(`Method ${method} not found. Available methods:`, Object.keys(this.server._registeredTools));
      throw new Error(`Method ${method} not found in registered tools`);
    }

    try {
      console.log(`Calling method: ${method} with params:`, params);

      const result = await tool.handler(params);

      console.log(`Response for ${method}:`, result);

      if (result && result.content && Array.isArray(result.content)) {
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
    } catch (error) {
      console.error(`Error calling method ${method}:`, error);
      throw error;
    }
  }

  async get_balance(): Promise<BalanceResponse> {
    try {
      const result = await this.request('get_balance', {});

      return {
        ton: fromNano(result?.balanceNano || '0'),
        nano: result?.balanceNano || '0'
      };
    } catch (error) {
      console.error('Error getting balance:', error);
      return { ton: '0', nano: '0' };
    }
  }

  async get_jetton_balance(jettonAddress: string): Promise<JettonBalanceResponse> {
    return this.request('get_jetton_balance', { jettonAddress });
  }

  async get_jettons(): Promise<JettonWithBalance[]> {
    const result = await this.request('get_jettons');
    return Array.isArray(result) ? result : [];
  }

  async get_transactions(limit: number = 20): Promise<Transaction[]> {
    const result = await this.request('get_transactions', { limit });
    return Array.isArray(result) ? result : [];
  }

  async get_known_jettons(): Promise<KnownJetton[]> {
    const result = await this.request('get_known_jettons');
    return Array.isArray(result) ? result : [];
  }

  async send_ton(toAddress: string, amount: string, comment?: string): Promise<SendTONResponse> {
    return this.request('send_ton', { toAddress, amount, comment });
  }

  async send_jetton(toAddress: string, jettonAddress: string, amount: string, comment?: string): Promise<SendJettonResponse> {
    return this.request('send_jetton', { toAddress, jettonAddress, amount, comment });
  }

  async send_raw_transaction(messages: Message[], validUntil?: number, fromAddress?: string): Promise<SendRawTransactionResponse> {
    return this.request('send_raw_transaction', { messages, validUntil, fromAddress });
  }

  async get_nfts(limit: number = 20, offset: number = 0): Promise<NFT[]> {
    const result = await this.request('get_nfts', { limit, offset });
    return Array.isArray(result) ? result : [];
  }

  async get_nft(nftAddress: string): Promise<NFT> {
    return this.request('get_nft', { nftAddress });
  }

  async send_nft(nftAddress: string, toAddress: string, comment?: string): Promise<SendNFTResponse> {
    return this.request('send_nft', { nftAddress, toAddress, comment });
  }

  async resolve_dns(domain: string): Promise<ResolveDNSResponse> {
    return this.request('resolve_dns', { domain });
  }

  async back_resolve_dns(address: string): Promise<BackResolveDNSResponse> {
    return this.request('back_resolve_dns', { address });
  }

  async get_swap_quote(fromToken: string, toToken: string, amount: string, slippageBps: number = 100): Promise<SwapQuoteResponse> {
    return this.request('get_swap_quote', { fromToken, toToken, amount, slippageBps });
  }

  async execute_swap(quote: any): Promise<{ hash: string; success: boolean }> {
    return this.request('execute_swap', { quote });
  }

  async swap_tokens(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<{ hash: string; quote: any; success: boolean }> {
    return this.request('swap_tokens', { fromToken, toToken, amount, slippageBps });
  }

  async getBalance(): Promise<BalanceResponse> {
    return this.get_balance();
  }

  async getJettonBalance(jettonAddress: string): Promise<JettonBalanceResponse> {
    return this.get_jetton_balance(jettonAddress);
  }

  async getJettons(): Promise<JettonWithBalance[]> {
    return this.get_jettons();
  }

  async getTransactions(limit?: number): Promise<Transaction[]> {
    return this.get_transactions(limit);
  }

  async getKnownJettons(): Promise<KnownJetton[]> {
    return this.get_known_jettons();
  }

  async sendTON(toAddress: string, amount: string, comment?: string): Promise<SendTONResponse> {
    return this.send_ton(toAddress, amount, comment);
  }

  async sendJetton(toAddress: string, jettonAddress: string, amount: string, comment?: string): Promise<SendJettonResponse> {
    return this.send_jetton(toAddress, jettonAddress, amount, comment);
  }

  async sendRawTransaction(messages: Message[], validUntil?: number, fromAddress?: string): Promise<SendRawTransactionResponse> {
    return this.send_raw_transaction(messages, validUntil, fromAddress);
  }

  async getNFTs(limit?: number, offset?: number): Promise<NFT[]> {
    return this.get_nfts(limit, offset);
  }

  async getNFT(nftAddress: string): Promise<NFT> {
    return this.get_nft(nftAddress);
  }

  async sendNFT(nftAddress: string, toAddress: string, comment?: string): Promise<SendNFTResponse> {
    return this.send_nft(nftAddress, toAddress, comment);
  }

  async resolveDNS(domain: string): Promise<ResolveDNSResponse> {
    return this.resolve_dns(domain);
  }

  async backResolveDNS(address: string): Promise<BackResolveDNSResponse> {
    return this.back_resolve_dns(address);
  }

  async getSwapQuote(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<SwapQuoteResponse> {
    return this.get_swap_quote(fromToken, toToken, amount, slippageBps);
  }

  async executeSwap(quote: any): Promise<{ hash: string; success: boolean }> {
    return this.execute_swap(quote);
  }

  async swapTokens(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<{ hash: string; quote: any; success: boolean }> {
    return this.swap_tokens(fromToken, toToken, amount, slippageBps);
  }

  async close(): Promise<void> {
    this.removeAllListeners();
  }

  async waitForReady(timeout: number = 10000): Promise<void> {
    if (this.isReady) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for MCP to be ready'));
      }, timeout);

      this.once('ready', () => {
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
