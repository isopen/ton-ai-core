import { BaseAgent } from '@ton-ai/core';
import { tonServer, TonMcpClient } from '@ton-ai/mcp-ton';

class WalletAgent extends BaseAgent {
  private ton: TonMcpClient | null = null;

  private requireTon(): TonMcpClient {
    if (!this.ton) {
      throw new Error('TON MCP client is not initialized');
    }
    return this.ton;
  }
  protected async onInitialize() {
    console.log('Initializing WalletAgent...');
    this.ton = new TonMcpClient(this.getMcpHub());
  }

  protected async onStart() {
    console.log('WalletAgent started');
    console.log('Wallet:', await this.requireTon().fetchWalletAddress());
    console.log('Balance:', await this.requireTon().getBalance());
  }

  protected async onStop() {
    console.log('WalletAgent stop');
  }
}

async function main() {
  const aliceAgent = new WalletAgent({
    name: 'alice',
    mcpServers: { ton: tonServer({ network: 'testnet', mnemonic: process.env.MNEMONIC }) },
  });

  await aliceAgent.start();

  const bobAgent = new WalletAgent({
    name: 'bob',
    mcpServers: { ton: tonServer({ network: 'testnet', mnemonic: process.env.MNEMONIC_1 }) },
  });

  await bobAgent.start();

  process.on('SIGINT', async () => {
    try {
      await aliceAgent.stop();
      await bobAgent.stop();
      process.exit(0);
    } catch (error) {
      console.error('Agent shutdown failed:', error);
      process.exit(1);
    }
  });
}

main().catch(console.error);
