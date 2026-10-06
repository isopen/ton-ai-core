import { fromNano, mcpCallJson, type McpHub } from '@ton-ai/core';

export class TonMcpClient {
  private cachedAddress: string | undefined;

  constructor(
    private readonly hub: McpHub | null | undefined,
    private readonly server: string = 'ton',
  ) {}

  private get readyHub(): McpHub {
    if (!this.hub) {
      throw new Error('TON MCP server is not connected (hub is missing)');
    }
    return this.hub;
  }

  isReady(): boolean {
    return !!this.hub && this.hub.status(this.server) === 'ready';
  }

  async waitForReady(): Promise<void> {
    if (this.isReady()) return;
    throw new Error(`TON MCP server "${this.server}" is not connected`);
  }

  async fetchWalletAddress(): Promise<string> {
    const parsed = await mcpCallJson<{ address?: string }>(this.readyHub, this.server, 'get_wallet');
    if (!parsed || typeof parsed.address !== 'string' || parsed.address.length === 0) {
      throw new Error('TON MCP server returned no wallet address');
    }
    this.cachedAddress = parsed.address;
    return parsed.address;
  }

  getWalletAddress(): string | undefined {
    return this.cachedAddress;
  }

  async getBalance(): Promise<{ ton: string; nano: string }> {
    const parsed = await mcpCallJson<{ balanceNano?: string }>(this.readyHub, this.server, 'get_balance');
    const nano = typeof parsed?.balanceNano === 'string' ? parsed.balanceNano : '0';
    return { ton: fromNano(nano), nano };
  }

  async getTransactions(limit: number = 20): Promise<any[]> {
    const parsed = await mcpCallJson<{ transactions?: any[] } | any[]>(
      this.readyHub,
      this.server,
      'get_transactions',
      { limit },
    );
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.transactions)) return parsed.transactions;
    return [];
  }

  async sendTON(toAddress: string, amount: string, comment?: string): Promise<{ hash: string }> {
    const parsed = await mcpCallJson<{ hash?: string; normalizedHash?: string }>(
      this.readyHub,
      this.server,
      'send_ton',
      { toAddress, amount, comment },
    );
    return { hash: parsed.normalizedHash || parsed.hash || '' };
  }

  async sendJetton(
    toAddress: string,
    jettonAddress: string,
    amount: string,
    comment?: string,
  ): Promise<{ hash: string }> {
    const parsed = await mcpCallJson<{ hash?: string; normalizedHash?: string }>(
      this.readyHub,
      this.server,
      'send_jetton',
      { toAddress, jettonAddress, amount, comment },
    );
    return { hash: parsed.normalizedHash || parsed.hash || '' };
  }

  async getJettons(): Promise<any[]> {
    const parsed = await mcpCallJson<{ jettons?: any[] } | any[]>(this.readyHub, this.server, 'get_jettons');
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.jettons)) return parsed.jettons;
    return [];
  }

  async getKnownJettons(): Promise<any[]> {
    const parsed = await mcpCallJson<{ jettons?: any[] } | any[]>(
      this.readyHub,
      this.server,
      'get_known_jettons',
    );
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.jettons)) return parsed.jettons;
    return [];
  }

  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string,
    slippageBps: number = 100,
  ): Promise<any> {
    return mcpCallJson(this.readyHub, this.server, 'get_swap_quote', { fromToken, toToken, amount, slippageBps });
  }

  async getNFTs(limit: number = 20, offset: number = 0): Promise<any[]> {
    const parsed = await mcpCallJson<{ nfts?: any[] } | any[]>(
      this.readyHub,
      this.server,
      'get_nfts',
      { limit, offset },
    );
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.nfts)) return parsed.nfts;
    return [];
  }

  async getNFT(nftAddress: string): Promise<any> {
    return mcpCallJson(this.readyHub, this.server, 'get_nft', { nftAddress });
  }

  async sendNFT(nftAddress: string, toAddress: string, comment?: string): Promise<{ hash: string }> {
    const parsed = await mcpCallJson<{ hash?: string; normalizedHash?: string }>(
      this.readyHub,
      this.server,
      'send_nft',
      { nftAddress, toAddress, comment },
    );
    return { hash: parsed.normalizedHash || parsed.hash || '' };
  }

  async resolveDNS(domain: string): Promise<any> {
    return mcpCallJson(this.readyHub, this.server, 'resolve_dns', { domain });
  }

  async backResolveDNS(address: string): Promise<any> {
    return mcpCallJson(this.readyHub, this.server, 'back_resolve_dns', { address });
  }
}
