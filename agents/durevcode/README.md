# DurevCode

DurevCode agent: streams an opencode session (thinking summaries, tool calls, output, files, tokens) to Telegram and sends a final summary when the task goes idle.

Built on `@ton-ai/core` + `@ton-ai/opencode` 0.1.0 + `@ton-ai/telegram-bot-api` 0.2.0. Session metadata comes from the local opencode server API (`opencode serve`); message content falls back to the opencode SQLite database in read-only mode when the server has no projection for a session — no opencode modifications required.

## Run

1. Install OpenCode v2:

```sh
curl -fsSL https://opencode.ai/v2/install | bash
```

2. The opencode server does not need to be started manually — the bot starts it
   automatically (`opencode serve --port 4096` when the server is unreachable,
   `OPENCODE_AUTO_SERVE=1`) and stops its own server instance on shutdown. Set
   `OPENCODE_AUTO_SERVE=0` only if you manage the server yourself.

3. Build the project:

```sh
make rebuild-durevcode
```

4. Start the bot:

```sh
cd agents/durevcode
cp .env.example .env  # fill in TELEGRAM_BOT_API_TOKEN and DUREVCODE_CHAT_ID
npm start
```

`.env` in this directory is loaded automatically (real env vars take
precedence); or export the variables inline:

```sh
TELEGRAM_BOT_API_TOKEN=<token> DUREVCODE_CHAT_ID=<chat_id> npm start --prefix agents/durevcode
```

## How it works

1. The `@ton-ai/opencode` plugin lists sessions via `GET /api/session` and reads content via `GET /api/session/{id}/message`, falling back to read-only `opencode.db` (`session` / `part` / `todo` tables) for sessions owned by another process.
2. Parts map to agent events: assistant `text`, `tool` calls with short argument summaries, `patch` file lists. Provider-encrypted `reasoning` parts carry no visible text and are skipped by design.
3. `agent.ts` streams one Telegram message per batch of new events, mirroring the opencode console: plan checklist, tool calls with outputs, replies, files. After `idleSec` without new events (and at least one tool call), the agent sends a final summary: duration, tool count, tokens in/out, cost, changed files, last answer.
4. Each topic keeps a pinned Context message (`tokens used / limit (%)`, in/out/reasoning, cost), edited in place as tokens are spent. The context limit comes from `GET /api/model` and is cached for one hour.

## Session separation

Each watched session gets its own Telegram status message (titled by session), its own event cursor, counters and idle timer — parallel sessions never mix. Selection per poll tick:

- `DUREVCODE_SESSION_IDS` (or legacy `DUREVCODE_SESSION_ID`) → exactly those sessions; a typo fails fast at startup;
- otherwise → up to `DUREVCODE_MAX_SESSIONS` latest sessions in `DUREVCODE_DIR`; new sessions attach automatically. Finalized or stale-empty sessions detach when they leave the window (topic binding persists for rebind); active sessions are kept. A message in a known-but-unwatched topic rebinds the persisted session instead of spawning a new one; only truly unknown topics create sessions.

## Threads

With `DUREVCODE_USE_THREADS=1` (default) every attached session gets its own forum topic (`📡 <title> · <id>`); status and summary messages go inside via `message_thread_id`. The session→topic mapping is persisted (`DUREVCODE_STATE_PATH`), so restarts reuse the same topics instead of creating new ones — and editing of the same status message continues. If a topic was deleted manually, the session is considered deleted with it: the agent never recreates the topic, it unwatches the session, drops its persisted binding and deletes the session in opencode (`DELETE /api/session/{id}`). Telegram Bot API sends no event when a forum topic is deleted, so the agent probes every watched topic with an invisible `typing` chat action once per 5 minutes; the probe raises `message thread not found` and the session is dropped right away, without waiting for a restart. The deletion is only logged — the notice cannot be delivered anywhere, since posting into General is forbidden. A deleted id stays suppressed in auto-pick for 15 minutes even while the opencode server still lists it from its own cache, so the same session is never deleted twice. Persisted topic bindings of sessions that no longer exist in opencode are pruned so their titles can be reused. Write in a fresh topic to start a new session. Topics are never closed by the agent, so sending keeps working. Requires a forum supergroup with topic-management rights — otherwise the agent logs a warning once and falls back to plain messages for the whole run. The bot also needs the Pin Messages (`can_pin_messages`) admin right, otherwise the Context message is sent but never pinned on top (watch for `Durevcode context pin failed` in logs; the agent re-tries the pin on every restart). Set `DUREVCODE_USE_THREADS=0` to skip topics entirely.

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_API_TOKEN` | yes | — | Bot token |
| `DUREVCODE_CHAT_ID` | yes | — | Integer chat id for status messages |
| `DUREVCODE_DB_PATH` | no | `~/.local/share/opencode/opencode.db` | Local database fallback for message content |
| `OPENCODE_SERVER_URL` | no | `http://127.0.0.1:4096` | Local opencode server (auto-started, see Run) |
| `OPENCODE_AUTO_SERVE` | no | `1` | Start `opencode serve` when unreachable; `0` disables |
| `OPENCODE_BIN` | no | `opencode` | opencode binary for auto-start |
| `DUREVCODE_CLI_FIRST` | no | `0` | Run prompts via `opencode run` directly, skipping the server queue; server stays for status, sessions and permissions |
| `DUREVCODE_DIR` | no | cwd | Project directory filter for session auto-pick |
| `DUREVCODE_SESSION_ID` | no | latest updated | Explicit session id to watch |
| `DUREVCODE_SESSION_IDS` | no | — | Comma-separated session ids to watch (overrides auto-pick) |
| `DUREVCODE_MAX_SESSIONS` | no | `10` | How many latest sessions to watch in auto-pick mode |
| `DUREVCODE_USE_THREADS` | no | `1` | One forum topic per session (status + summary inside); `0` disables |
| `DUREVCODE_TYPING` | no | `1` | Send `typing` chat action into the session topic while opencode is working; `0` disables |
| `DUREVCODE_NEW_TOPICS` | no | `1` | Create a fresh opencode session when you write in a manually created forum topic; `0` keeps unknown topics ignored |
| `DUREVCODE_STATE_PATH` | no | `~/.local/share/durevcode/state.json` | Topic/message mapping persisted across restarts |
| `DUREVCODE_ALLOWED_USERS` | no | open to all | Comma-separated Telegram user ids allowed to drive sessions; empty allows everyone |
| `DUREVCODE_POLL_MS` | no | `1000` | DB poll interval |
| `DUREVCODE_POLL_FANOUT` | no | `3` | Sessions updated in parallel per tick. One tick awaits several Telegram calls per session sequentially, so a small fanout multiplies startup time by the number of batches |
| `TELEGRAM_REQUEST_TIMEOUT_MS` | no | `5000` | Per-request timeout for the Telegram API. A healthy call is well under a second, so a stalled gateway only costs this much |
| — (hardcoded) | — | `maxRetries: 0` | Telegram retries are off on purpose: a stalled call would otherwise burn `attempts x timeout` seconds inside one tick, while the agent already retries on the next poll and never loses queued events |
| `DUREVCODE_IDLE_SEC` | no | `90` | Idle time before the final summary |

## Forum control

Write in a session topic and opencode executes it: the message text becomes a session prompt (`POST /api/session/{id}/prompt`), progress streams back into the same topic. Create a new forum topic yourself and write the task there — the agent creates a fresh opencode session for it (`POST /api/session`), binds the topic to it and sends your text as the first prompt. Details:

- only topic messages are picked up (General is ignored), bot's own messages are skipped;
- `DUREVCODE_ALLOWED_USERS` restricts who can drive sessions (empty = everyone; denied users are ignored silently);
- a prompt sent while the session is busy is queued per session (max 5, oldest drops) and sent when the session frees up, with a `⏳` notice;
- permission requests raised by tools are posted into the topic; reply `/allow` or `/deny` to that message to decide (`once` / `reject`);
- the agent can close the task itself: an answer that ends with a standalone `/stop` line (optionally `/stop@bot`, on its own line) is split there — the answer is posted, then the command arrives as its own message, then the session goes through the same stop as the typed command and `Stopped, send the task again.` lands last. A `/stop` mentioned inside the prose is ordinary text.
- text documents are inlined into the prompt (up to 20000 chars, binaries declined); captions are prepended.
- photos, GIFs, videos and PDF/video documents are downloaded into `<DUREVCODE_DIR>/tmp/.agent-inbox/` (max 20 MB, filename sanitized, inbox capped at 200 files) and passed to opencode as a `[file name] saved to <path>` reference for the read tool; captions are prepended.
- voice, video notes, audio and stickers can't be parsed yet — the bot replies with a notice suggesting photo/document/text instead.
