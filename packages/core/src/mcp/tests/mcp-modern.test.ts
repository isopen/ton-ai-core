import { strict as assert } from 'assert';
import { McpHub, McpError } from '../index';

const MODERN_SERVER = `
const readline = require('readline');
let listCalls = 0;
const cancelledIds = [];
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.method && msg.id === undefined) {
    if (msg.method === 'notifications/cancelled' && msg.params) cancelledIds.push(msg.params.requestId);
    return;
  }
  if (msg.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  const fail = (code, message, data) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message, data } }) + '\\n');
  const params = msg.params || {};
  if (msg.method === 'server/discover') {
    reply({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {} },
      serverInfo: { name: 'modern-fake', version: '2.0.0' },
      ttlMs: 60000,
      cacheScope: 'private',
    });
  } else if (msg.method === 'tools/list') {
    listCalls += 1;
    const tools = [
      { name: 'plain', description: 'plain tool', inputSchema: { type: 'object' } },
      { name: 'headed', description: 'header tool', inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' } }, required: ['region'] } },
      { name: 'broken', description: 'bad header tool', inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'not a token!!' } } } },
    ];
    if (listCalls > 1) tools.push({ name: 'late', description: 'appears late', inputSchema: { type: 'object' } });
    reply({ resultType: 'complete', tools, ttlMs: 60000, cacheScope: 'private' });
  } else if (msg.method === 'tools/call' && params.name === 'meta-probe') {
    reply({ resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(params._meta || null) }] });
  } else if (msg.method === 'tools/call' && params.name === 'need-input') {
    reply({ resultType: 'input_required', inputRequests: [{ id: 'q1' }] });
  } else if (msg.method === 'tools/call' && params.name === 'never') {
    return;
  } else if (msg.method === 'tools/call' && params.name === 'cancel-log') {
    reply({ resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(cancelledIds) }] });
  } else if (msg.method === 'tools/call') {
    reply({ resultType: 'complete', content: [{ type: 'text', text: '{"ok":true}' }] });
  } else {
    fail(-32601, 'Method not found');
  }
});
`;

const FUTURE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0' || msg.id === undefined) return;
  if (msg.method === 'server/discover') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', supportedVersions: ['2030-01-01'], capabilities: {} } }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }) + '\\n');
  }
});
`;

const VERSION_ERROR_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0' || msg.id === undefined) return;
  if (msg.method === 'server/discover') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: '1900-01-01' } } }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }) + '\\n');
  }
});
`;

function modernConfig(script: string = MODERN_SERVER) {
    return {
        transport: 'stdio' as const,
        command: process.execPath,
        args: ['-e', script],
    };
}

describe('mcp modern era (2026-07-28)', () => {
    test('discover selects the modern era and every request carries _meta', async () => {
        const hub = new McpHub({ modern: modernConfig() });
        await hub.connect('modern');
        const tools = await hub.listTools('modern');
        assert.deepEqual(
            tools.map((tool) => tool.name).sort(),
            ['headed', 'plain'],
        );
        const meta = await hub.callTool('modern', 'meta-probe', {});
        const parsed = JSON.parse(
            (meta.content[0] as { text?: string }).text ?? 'null',
        ) as Record<string, unknown>;
        assert.equal(parsed['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
        assert.deepEqual(parsed['io.modelcontextprotocol/clientInfo'], { name: '@ton-ai/core', version: '0.1.0' });
        assert.deepEqual(parsed['io.modelcontextprotocol/clientCapabilities'], {});
        await hub.close();
    });

    test('tools/list is cached for ttlMs', async () => {
        const hub = new McpHub({ modern: modernConfig() });
        await hub.connect('modern');
        assert.deepEqual((await hub.listTools('modern')).map((tool) => tool.name).sort(), ['headed', 'plain']);
        assert.deepEqual((await hub.listTools('modern')).map((tool) => tool.name).sort(), ['headed', 'plain']);
        await hub.close();
    });

    test('input_required results surface as McpError', async () => {
        const hub = new McpHub({ modern: modernConfig() });
        await hub.connect('modern');
        await assert.rejects(hub.callTool('modern', 'need-input', {}), (error: unknown) => {
            assert.ok(error instanceof McpError);
            assert.ok(String((error as Error).message).includes('additional input'));
            return true;
        });
        await hub.close();
    });

    test('a version error with a supported list still negotiates modern', async () => {
        const hub = new McpHub({ picky: modernConfig(VERSION_ERROR_SERVER) });
        await hub.connect('picky');
        await hub.close();
    });

    test('unknown-only versions fail the connect', async () => {
        const hub = new McpHub({ future: modernConfig(FUTURE_SERVER) });
        await assert.rejects(hub.connect('future'), /no known protocol version/);
        await hub.close();
    });

    test('a timed-out request sends notifications/cancelled', async () => {
        const hub = new McpHub({ modern: modernConfig() }, { requestTimeoutMs: 300 });
        await hub.connect('modern');
        let timedOutId = -1;
        try {
            await hub.callTool('modern', 'never', {});
        } catch (error) {
            assert.ok(error instanceof McpError);
            timedOutId = (hub as unknown as { nextRequestId: number }).nextRequestId - 1;
        }
        assert.ok(timedOutId > 0);
        const log = await hub.callTool('modern', 'cancel-log', {});
        const ids = JSON.parse((log.content[0] as { text?: string }).text ?? '[]') as unknown[];
        assert.ok(ids.includes(timedOutId), `expected cancelled ${timedOutId} in ${JSON.stringify(ids)}`);
        await hub.close();
    });
});
