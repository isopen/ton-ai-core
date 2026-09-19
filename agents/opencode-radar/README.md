# opencode-radar

Radar agent: streams an opencode session (thinking summaries, tool calls, output, files, tokens) to Telegram and sends a final summary when the task goes idle.

Built on `@ton-ai/core` + `@ton-ai/telegram-bot-api` 0.2.0. Reads the opencode SQLite database in read-only mode — no opencode modifications required.

## How it works

1. `watcher.ts` polls `opencode.db` (`session` / `part` / `todo` tables) for the selected session.
2. Parts map to radar events: assistant `text`, `tool` calls with short argument summaries, `patch` file lists. Provider-encrypted `reasoning` parts carry no visible text and are skipped by design.
3. `agent.ts` keeps one Telegram status message per session, updated via `editMessageText` (throttled, resend fallback), exactly like a streaming reply.
4. After `idleSec` without new events (and at least one tool call), the agent sends a final summary: duration, tool count, tokens in/out, cost, changed files, last answer.

## Session separation

Each watched session gets its own Telegram status message (titled by session), its own event cursor, counters and idle timer — parallel sessions never mix. Selection per poll tick:

- `RADAR_SESSION_IDS` (or legacy `RADAR_SESSION_ID`) → exactly those sessions; a typo fails fast at startup;
- otherwise → up to `RADAR_MAX_SESSIONS` latest sessions in `RADAR_DIR`; new sessions attach automatically, finalized ones detach.

## Threads

With `RADAR_USE_THREADS=1` (default) every attached session gets its own forum topic (`📡 <title> · <id>`); status and summary messages go inside via `message_thread_id`. The topic closes on finalize and reopens if the session resumes. Requires a forum supergroup and topic-management rights — otherwise the agent logs a warning once and falls back to plain messages for the whole run. Set `RADAR_USE_THREADS=0` to skip topics entirely.

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_API_TOKEN` | yes | — | Bot token |
| `RADAR_CHAT_ID` | yes | — | Integer chat id for status messages |
| `RADAR_DB_PATH` | no | `~/.local/share/opencode/opencode.db` | opencode database |
| `RADAR_DIR` | no | cwd | Project directory filter for session auto-pick |
| `RADAR_SESSION_ID` | no | latest updated | Explicit session id to watch |
| `RADAR_SESSION_IDS` | no | — | Comma-separated session ids to watch (overrides auto-pick) |
| `RADAR_MAX_SESSIONS` | no | `3` | How many latest sessions to watch in auto-pick mode |
| `RADAR_USE_THREADS` | no | `1` | One forum topic per session (status + summary inside); `0` disables |
| `RADAR_POLL_MS` | no | `2000` | DB poll interval |
| `RADAR_IDLE_SEC` | no | `90` | Idle time before the final summary |

## Run

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
