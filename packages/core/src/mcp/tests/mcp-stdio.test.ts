import { strict as assert } from 'assert';
import { McpHub, McpError, mcpContentText } from '../index';

const FAKE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0' || msg.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  const fail = (code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }) + '\\n');
  const params = msg.params || {};
  if (msg.method === 'initialize') {
    reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-mcp', version: '1.0.0' } });
  } else if (msg.method === 'tools/list') {
    if (!params.cursor) {
      reply({ tools: [{ name: 'add', description: 'add numbers', inputSchema: { type: 'object' } }], nextCursor: 'page2' });
    } else {
      reply({ tools: [{ name: 'echo', description: 'echo text', inputSchema: { type: 'object' } }] });
    }
  } else if (msg.method === 'tools/call') {
    const args = params.arguments || {};
    if (params.name === 'add') {
      reply({ content: [{ type: 'text', text: String((args.a || 0) + (args.b || 0)) }] });
    } else if (params.name === 'echo') {
      reply({ content: [{ type: 'text', text: String(args.text || '') }] });
    } else if (params.name === 'boom') {
      reply({ content: [{ type: 'text', text: 'it broke' }], isError: true });
    } else {
      fail(-32601, 'Method not found');
    }
  } else {
    fail(-32601, 'Method not found');
  }
});
`;

const SILENT_SERVER = `process.stdin.resume();`;

function stdioConfig(script: string = FAKE_SERVER) {
    return {
        transport: 'stdio' as const,
        command: process.execPath,
        args: ['-e', script],
    };
}

describe('mcp stdio transport and hub', () => {
    test('handshake marks the server ready', async () => {
        const hub = new McpHub({ fake: stdioConfig() });
        assert.equal(hub.status('fake'), 'closed');
        await hub.connect('fake');
        assert.equal(hub.status('fake'), 'ready');
        await hub.close();
        assert.equal(hub.status('fake'), 'closed');
    });

    test('tools/list follows the cursor over both pages', async () => {
        const hub = new McpHub({ fake: stdioConfig() });
        await hub.connect();
        const tools = await hub.listTools('fake');
        assert.deepEqual(
            tools.map((tool) => tool.name),
            ['add', 'echo'],
        );
        assert.equal(tools[0].server, 'fake');
        await hub.close();
    });

    test('tools/call returns the result and its text', async () => {
        const hub = new McpHub({ fake: stdioConfig() }, { requestTimeoutMs: 5000 });
        await hub.connect();
        const result = await hub.callTool('fake', 'add', { a: 1, b: 2 });
        assert.equal(result.isError, undefined);
        assert.equal(mcpContentText(result), '3');
        await hub.close();
    });

    test('a tool-level failure is returned faithfully, not thrown', async () => {
        const hub = new McpHub({ fake: stdioConfig() });
        await hub.connect();
        const result = await hub.callTool('fake', 'boom', {});
        assert.equal(result.isError, true);
        assert.equal(mcpContentText(result), 'it broke');
        await hub.close();
    });

    test('a protocol error becomes an McpError', async () => {
        const hub = new McpHub({ fake: stdioConfig() });
        await hub.connect();
        await assert.rejects(hub.callTool('fake', 'missing', {}), (error: unknown) => {
            assert.ok(error instanceof McpError);
            assert.equal((error as McpError).server, 'fake');
            return true;
        });
        await hub.close();
    });

    test('unknown server names fail with McpError', async () => {
        const hub = new McpHub({ fake: stdioConfig() });
        await assert.rejects(hub.connect('ghost'), /Unknown MCP server: ghost/);
        await assert.rejects(hub.callTool('ghost', 'add', {}), /not connected/);
        await assert.rejects(hub.listTools('ghost'), /not connected/);
        await hub.close();
    });

    test('a dead command fails the connect', async () => {
        const hub = new McpHub({
            fake: { transport: 'stdio', command: '/definitely/not/here-mcp-server' },
        });
        await assert.rejects(hub.connect(), (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.ok(/ENOENT|spawn/.test(message), `expected a spawn failure, got: ${message.slice(0, 120)}`);
            return true;
        });
        assert.equal(hub.status('fake'), 'closed');
        await hub.close();
    });

    test('a silent server trips the request timeout', async () => {
        const hub = new McpHub({ fake: stdioConfig(SILENT_SERVER) }, { requestTimeoutMs: 300 });
        await assert.rejects(hub.connect(), /timed out/);
        assert.equal(hub.status('fake'), 'closed');
        await hub.close();
    });

    test('close is safe to call twice and requests fail after it', async () => {
        const hub = new McpHub({ fake: stdioConfig() });
        await hub.connect();
        await hub.close();
        await hub.close();
        await assert.rejects(hub.callTool('fake', 'add', {}), /not connected/);
    });

    test('two servers stay independent', async () => {
        const hub = new McpHub({ one: stdioConfig(), two: stdioConfig() });
        await hub.connect();
        const tools = await hub.listTools();
        assert.equal(tools.length, 4);
        assert.deepEqual(
            tools.map((tool) => tool.server).sort(),
            ['one', 'one', 'two', 'two'],
        );
        await hub.disconnect('one');
        assert.equal(hub.status('one'), 'closed');
        assert.equal(hub.status('two'), 'ready');
        assert.equal(mcpContentText(await hub.callTool('two', 'echo', { text: 'hi' })), 'hi');
        await assert.rejects(hub.callTool('one', 'echo', { text: 'hi' }), /not connected/);
        await hub.close();
    });
});

describe('mcpCallJson helper', () => {
    test('returns parsed JSON without wrapper methods', async () => {
        const { mcpCallJson } = await import('../index');
        const hub = new McpHub({ fake: stdioConfig() });
        await hub.connect();
        const parsed = await mcpCallJson<{ ok: boolean }>(hub, 'fake', 'echo', { text: '{"ok":true}' });
        assert.deepEqual(parsed, { ok: true });
        await hub.close();
    });

    test('missing hub and non-JSON payloads fail loudly', async () => {
        const { mcpCallJson, McpError } = await import('../index');
        await assert.rejects(mcpCallJson(null, 'fake', 'add', {}), /not connected/);
        const hub = new McpHub({ fake: stdioConfig() });
        await hub.connect();
        await assert.rejects(mcpCallJson(hub, 'ghost', 'add', {}), (error: unknown) => {
            assert.ok(error instanceof McpError);
            return true;
        });
        await hub.close();
    });
});
