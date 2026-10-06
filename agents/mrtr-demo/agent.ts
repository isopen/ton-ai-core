import { createInterface } from 'node:readline';
import { BaseAgent, mcpContentText, type AgentConfig, type McpInputHandler } from '@ton-ai/core';

export type AskQuestion = (question: string) => Promise<string>;

export function stdinAsk(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function parseYesNo(answer: string): boolean | null {
  const normalized = answer.trim().toLowerCase();
  if (['y', 'yes', 'д', 'да'].includes(normalized)) return true;
  if (['n', 'no', 'н', 'нет'].includes(normalized)) return false;
  return null;
}

export class MrtrDemoAgent extends BaseAgent {
  private rounds = 0;

  constructor(private readonly ask: AskQuestion = stdinAsk, config: AgentConfig = {}) {
    super({ name: 'mrtr-demo', plugins: {}, ...config });
  }

  get inputRounds(): number {
    return this.rounds;
  }

  protected async onInitialize(): Promise<void> {}

  protected async onStart(): Promise<void> {}

  protected async onStop(): Promise<void> {}

  async deploy(): Promise<string> {
    const hub = this.getMcpHub();
    if (!hub) {
      throw new Error('MCP hub is not connected (mcpServers not configured)');
    }
    const result = await hub.callTool('demo', 'deploy_app', {}, { onInput: this.handleInput });
    const text = mcpContentText(result);
    console.log(`deploy finished: ${text}`);
    return text;
  }

  private readonly handleInput: McpInputHandler = async (server, method, inputRequests) => {
    this.rounds += 1;
    console.log(`server ${server} requested input for ${method} (round ${this.rounds})`);
    const responses: Record<string, unknown> = {};
    for (const [key, request] of Object.entries(inputRequests)) {
      if (request?.method !== 'elicitation/create') {
        console.log(`unsupported input request ${request?.method}, aborting`);
        return null;
      }
      const params = (request.params ?? {}) as { message?: string };
      const message = typeof params.message === 'string' ? params.message : 'Confirm? (yes/no)';
      const answer = await this.ask(message);
      const confirmed = parseYesNo(answer);
      if (confirmed === null) {
        console.log('unrecognized answer, aborting');
        return null;
      }
      responses[key] = { action: 'accept', content: { confirmed } };
    }
    return responses;
  }
}
