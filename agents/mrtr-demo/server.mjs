#!/usr/bin/env node
'use strict';

import readline from 'node:readline';

const VERSION = '2026-07-28';
const STATE_TOKEN = 'demo-state-1';

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error }) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.method && msg.id === undefined) return;
  if (msg.id === undefined) return;
  const id = msg.id;
  const params = msg.params || {};

  if (msg.method === 'server/discover') {
    reply(id, {
      resultType: 'complete',
      supportedVersions: [VERSION],
      capabilities: { tools: {} },
      serverInfo: { name: 'mrtr-demo-server', version: '1.0.0' },
      ttlMs: 60000,
      cacheScope: 'private',
    });
    return;
  }

  if (msg.method === 'tools/list') {
    reply(id, {
      resultType: 'complete',
      tools: [
        {
          name: 'deploy_app',
          description: 'Deploy the demo app to production. Always asks for confirmation first.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      ttlMs: 60000,
      cacheScope: 'private',
    });
    return;
  }

  if (msg.method === 'tools/call' && params.name === 'deploy_app') {
    const responses = params.inputResponses;
    const confirmed =
      responses && responses.confirm && responses.confirm.action === 'accept'
        ? responses.confirm.content && responses.confirm.content.confirmed
        : undefined;
    if (confirmed === true && params.requestState === STATE_TOKEN) {
      reply(id, {
        resultType: 'complete',
        content: [{ type: 'text', text: 'deployed demo-app v1 to production' }],
      });
      return;
    }
    if (confirmed === false && params.requestState === STATE_TOKEN) {
      reply(id, {
        resultType: 'complete',
        content: [{ type: 'text', text: 'deployment cancelled by user' }],
      });
      return;
    }
    reply(id, {
      resultType: 'input_required',
      inputRequests: {
        confirm: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: 'Deploy demo-app v1 to production? (yes/no)',
            requestedSchema: {
              type: 'object',
              properties: { confirmed: { type: 'boolean' } },
              required: ['confirmed'],
            },
          },
        },
      },
      requestState: STATE_TOKEN,
    });
    return;
  }

  if (msg.method === 'tools/call') {
    fail(id, -32601, 'Method not found');
    return;
  }

  fail(id, -32601, 'Method not found');
});
