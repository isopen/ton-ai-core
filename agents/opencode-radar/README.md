# opencode-radar

Radar agent: streams an opencode session (thinking summaries, tool calls, output, files, tokens) to Telegram and sends a final summary when the task goes idle.

Built on `@ton-ai/core` + `@ton-ai/opencode` 0.1.0 + `@ton-ai/telegram-bot-api` 0.2.0. Session metadata comes from the local opencode server API (`opencode serve`); message content falls back to the opencode SQLite database in read-only mode when the server has no projection for a session — no opencode modifications required.

## How it works

1. The `@ton-ai/opencode` plugin lists sessions via `GET /api/session` and reads content via `GET /api/session/{id}/message`, falling back to read-only `opencode.db` (`session` / `part` / `todo` tables) for sessions owned by another process.
2. Parts map to radar events: assistant `text`, `tool` calls with short argument summaries, `patch` file lists. Provider-encrypted `reasoning` parts carry no visible text and are skipped by design.
3. `agent.ts` keeps one Telegram status message per session, updated via `editMessageText` (throttled, resend fallback), exactly like a streaming reply.
4. After `idleSec` without new events (and at least one tool call), the agent sends a final summary: duration, tool count, tokens in/out, cost, changed files, last answer.

## Session separation

Each watched session gets its own Telegram status message (titled by session), its own event cursor, counters and idle timer — parallel sessions never mix. Selection per poll tick:

- `RADAR_SESSION_IDS` (or legacy `RADAR_SESSION_ID`) → exactly those sessions; a typo fails fast at startup;
- otherwise → up to `RADAR_MAX_SESSIONS` latest sessions in `RADAR_DIR`; new sessions attach automatically, finalized ones detach.

## Threads

With `RADAR_USE_THREADS=1` (default) every attached session gets its own forum topic (`📡 <title> · <id>`); status and summary messages go inside via `message_thread_id`. The session→topic mapping is persisted (`RADAR_STATE_PATH`), so restarts reuse the same topics instead of creating new ones — and editing of the same status message continues. If a topic was deleted manually, the next send recreates it automatically. Topics are never closed by the radar, so sending keeps working. Requires a forum supergroup and topic-management rights — otherwise the agent logs a warning once and falls back to plain messages for the whole run. Set `RADAR_USE_THREADS=0` to skip topics entirely.

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_API_TOKEN` | yes | — | Bot token |
| `RADAR_CHAT_ID` | yes | — | Integer chat id for status messages |
| `RADAR_DB_PATH` | no | `~/.local/share/opencode/opencode.db` | Local database fallback for message content |
| `OPENCODE_SERVER_URL` | no | `http://127.0.0.1:4096` | Local opencode server (auto-started, see Run) |
| `OPENCODE_AUTO_SERVE` | no | `1` | Start `opencode serve` when unreachable; `0` disables |
| `OPENCODE_BIN` | no | `opencode` | opencode binary for auto-start |
| `RADAR_DIR` | no | cwd | Project directory filter for session auto-pick |
| `RADAR_SESSION_ID` | no | latest updated | Explicit session id to watch |
| `RADAR_SESSION_IDS` | no | — | Comma-separated session ids to watch (overrides auto-pick) |
| `RADAR_MAX_SESSIONS` | no | `3` | How many latest sessions to watch in auto-pick mode |
| `RADAR_USE_THREADS` | no | `1` | One forum topic per session (status + summary inside); `0` disables |
| `RADAR_STATE_PATH` | no | `~/.local/share/opencode-radar/state.json` | Topic/message mapping persisted across restarts |
| `RADAR_POLL_MS` | no | `2000` | DB poll interval |
| `RADAR_IDLE_SEC` | no | `90` | Idle time before the final summary |

## Run

The opencode plugin starts `opencode serve --port 4096` by itself when the
configured server is unreachable (`OPENCODE_AUTO_SERVE=1`, binary from
`OPENCODE_BIN`), and stops its own server instance on shutdown. A server you
started manually is left alone. To manage the server yourself, set
`OPENCODE_AUTO_SERVE=0` and start it first:

```sh
opencode serve --port 4096
```

Then:

```sh
cd agents/opencode-radar
npm install
cp .env.example .env  # fill in TELEGRAM_BOT_API_TOKEN and RADAR_CHAT_ID
npx ts-node index.ts
```

`.env` in this directory is loaded automatically (real env vars take
precedence); or export the variables inline:

```sh
TELEGRAM_BOT_API_TOKEN=<token> RADAR_CHAT_ID=<chat_id> npx ts-node agents/opencode-radar/index.ts
```
