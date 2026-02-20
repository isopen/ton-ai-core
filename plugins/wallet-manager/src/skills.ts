import { PluginContext } from '@ton-ai/core';
import { MCPClient } from '@ton-ai/core';
import { WalletComponents } from './components';
import { 
  WalletBalance,
  TransactionResult,
  SendTONResponse,
  SendJettonResponse,
  SendNFTResponse,
  BalanceResponse,
  SwapResult,
  JettonWithBalance,
  KnownJetton,
  NFT,
  ResolveDNSResponse,
  BackResolveDNSResponse,
  SwapQuoteResponse
} from './types';

export class WalletSkills {
  private context: PluginContext;
  private mcp: MCPClient;
  private components: WalletComponents;

  constructor(context: PluginContext, mcp: MCPClient, components: WalletComponents) {
    this.context = context;
    this.mcp = mcp;
    this.components = components;
  }

  isReady(): boolean {
    return (this.mcp as any).isReady;
  }

  async waitForReady(timeout: number = 10000): Promise<void> {
    if (this.isReady()) return;

    this.context.logger.info('Waiting for wallet to be ready...');
    await this.mcp.waitForReady(timeout);
    this.context.logger.info('Wallet is ready');
  }

  getWalletAddress(): string | undefined {
    return this.mcp.getWalletAddress();
  }

  async getBalance(useCache: boolean = true): Promise<WalletBalance> {
    this.context.logger.info('Getting wallet balance...');

    if (useCache) {
      const cached = this.components.balanceCache.get();
      if (cached) {
        this.context.logger.debug('Using cached balance');
        return {
          ton: cached.ton,
          nano: cached.nano,
          formatted: `${cached.ton} TON`
        };
      }
    }

    try {
      const balance = await this.mcp.getBalance();

      this.components.balanceCache.set(balance);

      this.context.logger.info(`Balance: ${balance.ton} TON`);

      return {
        ton: balance.ton,
        nano: balance.nano,
        formatted: `${balance.ton} TON`
      };
    } catch (error) {
      this.context.logger.error('Failed to get balance:', error);
      throw error;
    }
  }

  async getTransactions(limit: number = 20): Promise<any[]> {
    this.context.logger.info(`Getting last ${limit} transactions...`);

    try {
      const transactions = await this.mcp.getTransactions(limit);

      this.context.logger.info(`Found ${transactions.length} transactions`);

      return transactions.map(tx => ({
        hash: tx.hash,
        time: new Date(tx.time).toLocaleString(),
        events: tx.events,
        lt: tx.lt
      }));
    } catch (error) {
      this.context.logger.error('Failed to get transactions:', error);
      throw error;
    }
  }

  async sendTON(to: string, amount: string, comment?: string): Promise<TransactionResult> {
    this.context.logger.info(`Sending ${amount} TON to ${to}${comment ? ` (${comment})` : ''}...`);

    try {
      const result = await this.mcp.sendTON(to, amount, comment) as SendTONResponse;

      this.context.logger.info(`Transaction sent! Hash: ${result.hash}`);

      this.components.balanceCache.clear();

      return {
        hash: result.hash,
        success: true
      };
    } catch (error) {
      this.context.logger.error('Failed to send TON:', error);
      throw error;
    }
  }

  async sendJetton(to: string, jettonAddress: string, amount: string, comment?: string): Promise<TransactionResult> {
    this.context.logger.info(`Sending ${amount} Jetton (${jettonAddress}) to ${to}...`);

    try {
      const result = await this.mcp.sendJetton(to, jettonAddress, amount, comment) as SendJettonResponse;

      this.context.logger.info(`Jetton sent! Hash: ${result.hash}`);

      return {
        hash: result.hash,
        success: true
      };
    } catch (error) {
      this.context.logger.error('Failed to send Jetton:', error);
      throw error;
    }
  }

  async getJettons(): Promise<JettonWithBalance[]> {
    this.context.logger.info('Getting jetton balances...');

    try {
      const jettons = await this.mcp.getJettons();

      this.context.logger.info(`Found ${jettons.length} jettons`);

      return jettons;
    } catch (error) {
      this.context.logger.error('Failed to get jettons:', error);
      throw error;
    }
  }

  async getKnownJettons(): Promise<KnownJetton[]> {
    this.context.logger.info('Getting known jettons...');

    try {
      const jettons = await this.mcp.getKnownJettons();

      this.context.logger.info(`Found ${jettons.length} known jettons`);

      return jettons;
    } catch (error) {
      this.context.logger.error('Failed to get known jettons:', error);
      throw error;
    }
  }

  async getSwapQuote(fromToken: string, toToken: string, amount: string, slippageBps: number = 100): Promise<SwapQuoteResponse> {
    this.context.logger.info(`Getting swap quote: ${amount} ${fromToken} -> ${toToken}`);

    try {
      const quote = await this.mcp.getSwapQuote(fromToken, toToken, amount, slippageBps);

      this.context.logger.info(`Quote received: ${quote.fromAmount} -> ${quote.toAmount}`);

      return quote;
    } catch (error) {
      this.context.logger.error('Failed to get swap quote:', error);
      throw error;
    }
  }

  async swapTokens(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<SwapResult> {
    this.context.logger.info(`Swapping ${amount} ${fromToken} -> ${toToken}...`);

    try {
      const result = await this.mcp.swapTokens(fromToken, toToken, amount, slippageBps);

      this.context.logger.info(`Swap executed! Hash: ${result.hash}`);

      return {
        hash: result.hash,
        quote: result.quote,
        success: result.success
      };
    } catch (error) {
      this.context.logger.error('Failed to swap tokens:', error);
      throw error;
    }
  }

  async getNFTs(limit: number = 20, offset: number = 0): Promise<NFT[]> {
    this.context.logger.info(`Getting NFTs (limit: ${limit}, offset: ${offset})...`);

    try {
      const nfts = await this.mcp.getNFTs(limit, offset);

      this.context.logger.info(`Found ${nfts.length} NFTs`);

      return nfts;
    } catch (error) {
      this.context.logger.error('Failed to get NFTs:', error);
      throw error;
    }
  }

  async getNFT(nftAddress: string): Promise<NFT> {
    this.context.logger.info(`Getting NFT: ${nftAddress}...`);

    try {
      const nft = await this.mcp.getNFT(nftAddress);

      this.context.logger.info(`NFT found: ${nft.metadata?.name || 'Unnamed'}`);

      return nft;
    } catch (error) {
      this.context.logger.error('Failed to get NFT:', error);
      throw error;
    }
  }

  async sendNFT(nftAddress: string, to: string, comment?: string): Promise<TransactionResult> {
    this.context.logger.info(`Sending NFT ${nftAddress} to ${to}...`);

    try {
      const result = await this.mcp.sendNFT(nftAddress, to, comment) as SendNFTResponse;

      this.context.logger.info(`NFT sent! Hash: ${result.hash}`);

      return {
        hash: result.hash,
        success: true
      };
    } catch (error) {
      this.context.logger.error('Failed to send NFT:', error);
      throw error;
    }
  }

  async resolveDNS(domain: string): Promise<ResolveDNSResponse> {
    this.context.logger.info(`Resolving DNS: ${domain}...`);

    try {
      const result = await this.mcp.resolveDNS(domain);

      this.context.logger.info(`Resolved to: ${result.address}`);

      return result;
    } catch (error) {
      this.context.logger.error('Failed to resolve DNS:', error);
      throw error;
    }
  }

  async backResolveDNS(address: string): Promise<BackResolveDNSResponse> {
    this.context.logger.info(`Back resolving address: ${address}...`);

    try {
      const result = await this.mcp.backResolveDNS(address);

      this.context.logger.info(`Resolved to domain: ${result.domain}`);

      return result;
    } catch (error) {
      this.context.logger.error('Failed to back resolve DNS:', error);
      throw error;
    }
  }

  async processIncomingTransaction(transaction: any): Promise<void> {
    this.context.logger.info(`Incoming transaction: ${transaction.hash}`);

    this.context.events.emit('wallet:transaction:received', {
      hash: transaction.hash,
      value: transaction.value,
      from: transaction.from
    });
  }

  async checkBalanceAlerts(balanceData: BalanceResponse): Promise<void> {
    const balance = parseFloat(balanceData.ton);

    if (balance < 1) {
      this.context.events.emit('wallet:balance:low', {
        balance: balanceData.ton,
        message: 'Low balance warning'
      });
    }
  }
}
