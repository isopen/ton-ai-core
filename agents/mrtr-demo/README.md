# mrtr-demo agent

Demo agent showing MCP **multi round-trip requests** (spec revision `2026-07-28`): a modern-era MCP server refuses to run a destructive tool until the client gathers an explicit confirmation through `elicitation/create`, then retries with `inputResponses` and the echoed `requestState`.

## Layout

- `server.mjs` — demo MCP server (modern era): `server/discover`, `tools/list`, one tool `deploy_app`
- `agent.ts` — `MrtrDemoAgent`: connects through `@ton-ai/core` `McpHub`, answers elicitation from stdin (injectable for tests)
- `index.ts` — entry point, wires `mcpServers.demo` to the bundled server

## Run it

```bash
cd agents/mrtr-demo
npx ts-node index.ts
```

Type `yes` (or `no`) when asked.

Expected transcript for `yes`:

```
Requesting deployment...
server demo requested input for tools/call (round 1)
Deploy demo-app v1 to production? (yes/no) yes
deploy finished: deployed demo-app v1 to production
input rounds served: 1
```

Answering `no` ends with `deployment cancelled by user`; anything else aborts the round trip with an error.

## What it proves

1. The hub negotiates the modern era via `server/discover` (no `initialize` handshake).
2. Every request carries `_meta` with protocol version, client info and capabilities.
3. The first `tools/call` returns `input_required`; the agent gathers input and retries with `inputResponses` + `requestState` on a fresh request id.
4. The server completes the deployment only when the echoed `requestState` matches.

## Tests

```bash
npx jest agents/mrtr-demo
```

Three cases with canned answers: yes → deployed, no → cancelled, anything else → abort error.
