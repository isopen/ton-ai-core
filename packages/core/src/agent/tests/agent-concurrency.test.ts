import { strict as assert } from 'assert';
import { BaseAgent } from '../base-agent';
import type { McpHub, McpServerConfig } from '../../mcp';

const FAKE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0' || msg.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  if (msg.method === 'initialize') {
    reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-mcp', version: '1.0.0' } });
  } else {
    reply({});
  }
});
`;

function fakeServer(): McpServerConfig {
    return { transport: 'stdio', command: process.execPath, args: ['-e', FAKE_SERVER] };
}

class CountingAgent extends BaseAgent {
    initCount = 0;
    startCount = 0;

    protected async onInitialize(): Promise<void> {
        this.initCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    protected async onStart(): Promise<void> {
        this.startCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    protected async onStop(): Promise<void> {}
}

class GatedAgent extends BaseAgent {
    releaseStart: (() => void) | null = null;
    private readonly gate: Promise<void> = new Promise<void>((resolve) => {
        this.releaseStart = resolve;
    });

    protected async onInitialize(): Promise<void> {}

    protected async onStart(): Promise<void> {
        await this.gate;
    }

    protected async onStop(): Promise<void> {}
}

class FailingStartAgent extends BaseAgent {
    protected async onInitialize(): Promise<void> {}

    protected async onStart(): Promise<void> {
        throw new Error('start boom');
    }

    protected async onStop(): Promise<void> {}
}

class LeakProbeAgent extends BaseAgent {
    hubFromInit: McpHub | null = null;
    releaseHub: (() => void) | null = null;
    private readonly gate: Promise<void> = new Promise<void>((resolve) => {
        this.releaseHub = resolve;
    });

    protected async initMcpHub(): Promise<void> {
        await this.gate;
        await super.initMcpHub();
    }

    protected async onInitialize(): Promise<void> {
        this.hubFromInit = this.getMcpHub();
    }

    protected async onStart(): Promise<void> {}

    protected async onStop(): Promise<void> {}
}

class RaceProbeAgent extends BaseAgent {
    order: string[] = [];
    releaseHub: (() => void) | null = null;
    private readonly gate: Promise<void> = new Promise<void>((resolve) => {
        this.releaseHub = resolve;
    });

    protected async initMcpHub(): Promise<void> {
        await this.gate;
        await super.initMcpHub();
    }

    protected async onInitialize(): Promise<void> {}

    protected async onStart(): Promise<void> {
        this.order.push('onStart');
    }

    protected async onStop(): Promise<void> {
        this.order.push('onStop');
    }
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
}

describe('agent start concurrency', () => {
    it('runs initialize and start once for concurrent start calls', async () => {
        const agent = new CountingAgent();

        await Promise.all([agent.start(), agent.start(), agent.start()]);

        assert.equal(agent.initCount, 1);
        assert.equal(agent.startCount, 1);
        assert.equal(agent.getStatus().isRunning, true);
        await agent.stop();
    });

    it('serializes stop against an in-flight start so stopped follows started', async () => {
        const agent = new GatedAgent();
        const order: string[] = [];
        agent.on('agent:started', () => order.push('started'));
        agent.on('agent:stopped', () => order.push('stopped'));

        const startPromise = agent.start();
        await waitFor(() => agent.getStatus().isRunning, 'running flag');
        const stopPromise = agent.stop();
        agent.releaseStart?.();
        await startPromise;
        await stopPromise;

        assert.deepEqual(order, ['started', 'stopped']);
        assert.equal(agent.getStatus().isRunning, false);
    });

    it('resets isRunning when onStart fails', async () => {
        const agent = new FailingStartAgent();

        await assert.rejects(() => agent.start(), /start boom/);

        assert.equal(agent.getStatus().isRunning, false);
        await agent.stop();
    });

    it('keeps concurrent initialize calls single-flight', async () => {
        const agent = new CountingAgent();

        await Promise.all([agent.initialize(), agent.initialize(), agent.initialize()]);

        assert.equal(agent.initCount, 1);
        assert.equal(agent.getStatus().initialized, true);
        await agent.stop();
    });

    it('closes the hub when stop is called during initialize', async () => {
        const agent = new LeakProbeAgent({ name: 'leak-probe', plugins: {}, mcpServers: { fake: fakeServer() } });

        const startPromise = agent.start();
        const stopPromise = agent.stop();
        agent.releaseHub?.();
        await startPromise;
        await stopPromise;

        assert.ok(agent.hubFromInit);
        assert.equal(agent.hubFromInit!.status('fake'), 'closed');
        assert.equal(agent.getStatus().initialized, false);
    });

    it('keeps started before stopped when start is created during a stop waiting for initialize', async () => {
        const agent = new RaceProbeAgent({ name: 'race-probe', plugins: {}, mcpServers: { fake: fakeServer() } });
        const events: string[] = [];
        agent.on('agent:started', () => events.push('started'));
        agent.on('agent:stopped', () => events.push('stopped'));

        const initPromise = agent.initialize();
        const stopPromise = agent.stop();
        const startPromise = agent.start();
        agent.releaseHub?.();
        await Promise.all([initPromise, stopPromise, startPromise]);

        assert.deepEqual(events, ['started', 'stopped']);
        assert.deepEqual(agent.order, ['onStart', 'onStop']);
        assert.equal(agent.getStatus().isRunning, false);
    });
});
