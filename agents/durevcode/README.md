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
- otherwise → up to `DUREVCODE_MAX_SESSIONS` latest sessions in `DUREVCODE_DIR`; new sessions attach automatically.

`DUREVCODE_MAX_SESSIONS` is a hard limit on the watched set, not just the pick window: every tick trims the watched set back to the limit (finalized sessions unload first, then stale-empty ones, then the least recently active; sessions that wait on the user — queued prompt, permission, question — or are mid-tick are never torn down). The session the user is actually interacting with is protected too: a recently landed prompt (5 minutes) or a just-finalized turn (2 minutes) keeps its watch slot even through long thinking silences and even outside the auto-pick window, so a conversation cannot fall silent mid-run just because other sessions bubbled up. A message in a known-but-unwatched topic rebinds the persisted session instead of spawning a new one, displacing nothing until the trim finds room; only truly unknown topics create sessions. A used-again topic rebinds its persisted session, and the trim evicts the least active watched session to restore the limit.

## Threads

With `DUREVCODE_USE_THREADS=1` (default) every attached session gets its own forum topic (`📡 <title> · <id>`); status and summary messages go inside via `message_thread_id`. The session→topic mapping is persisted (`DUREVCODE_STATE_PATH`), so restarts reuse the same topics instead of creating new ones — and editing of the same status message continues. The mapping file is written atomically (temp file + rename), so a kill or a crash during a save can never truncate it and lose the bindings. If a topic was deleted manually, the session is considered deleted with it: the agent never recreates the topic, it unwatches the session, drops its persisted binding and deletes the session in opencode (`DELETE /api/session/{id}`). A merely **closed** topic is treated differently: `TOPIC_CLOSED` errors never delete the session or the binding — delivery retries until the topic is reopened (one warning per topic per half hour, and the probe/typing failures are logged quietly). Telegram Bot API sends no event when a forum topic is deleted, so the agent probes every watched topic with an invisible `typing` chat action once per 5 minutes; the probe raises `message thread not found` and the session is dropped right away, without waiting for a restart. The deletion is only logged — the notice cannot be delivered anywhere, since posting into General is forbidden. Deleted ids stay suppressed in auto-pick across restarts too, because the tombstone list is persisted in the state file: while opencode still lists a deleted session from its own server cache, the agent never re-attaches it and never creates a duplicate topic for the same session. A session deleted in opencode itself is skipped quietly after three empty reads (log only, no Telegram notice), and its persisted binding is dropped so the topic can be reused. Persisted topic bindings of sessions that no longer exist in opencode are pruned (after two consecutive missed reads, so a transiently inconsistent server cannot wipe bindings) so their titles can be reused. Write in a fresh topic to start a new session. Topics are never closed by the agent, so sending keeps working. Requires a forum supergroup with topic-management rights — otherwise the agent logs a warning once and falls back to plain messages for the whole run. The bot also needs the Pin Messages (`can_pin_messages`) admin right, otherwise the Context message is sent but never pinned on top (watch for `Durevcode context pin failed` in logs; the agent re-tries the pin on every restart). Set `DUREVCODE_USE_THREADS=0` to skip topics entirely.

The stop control (`Running · tap Stop`) is persisted, so a restart keeps editing the same control message instead of posting a duplicate one. Typing indicators and topic probes share one rolling per-minute chat budget (`14` actions), so a burst of active sessions can no longer trip Telegram flood control — chat actions are dropped first, real content always has room, and a probe skipped for lack of budget is not marked as done and simply re-runs on a later tick. Inbound messages are processed one at a time, so the update backlog replayed after a restart no longer opens a herd of concurrent prompt pumps.

Duplicate topics are impossible for a session that is already in the forum: beside the session→topic binding, the state file keeps a surviving tag map (`topics`) — the short session-id tag embedded in every topic name (`… · <tag>`) mapped to its topic id. If a binding is lost (state reset, transient API failure), the agent reuses the existing topic from the tag map on attach and rebinding instead of creating a second one. A message written into a topic with no binding revives the session remembered for that topic (opencode lookup by id) rather than starting a new one; a new session is created only when the topic never belonged to a live session. Tombstoned (deleted-with-topic) sessions are never resurrected through the tag map. The map is rebuilt on load from the persisted bindings (old-format state files too), so a restart immediately knows every bound session's existing topic. A topic is declared deleted — and the session behind it dropped — only after two consecutive topic-gone signals (probe, delivery or typing); anything successful in between resets the counter. If opencode's `deleteSession` fails (for example the session is busy), the binding and the surviving topic link are restored, so the next attach reuses the same topic instead of creating a duplicate one.

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
| `DUREVCODE_MAX_SESSIONS` | no | `5` | Hard limit on watched sessions (auto-pick keeps the latest ones; leftover slots take any idle-but-worked persisted bindings regardless of age; empty sessions never attach; extras are unloaded per tick) |
| `DUREVCODE_USE_THREADS` | no | `1` | One forum topic per session (status + summary inside); `0` disables |
| `DUREVCODE_TYPING` | no | `1` | Send `typing` chat action into the session topic while opencode is working; `0` disables |
| `DUREVCODE_NEW_TOPICS` | no | `1` | Create a fresh opencode session when you write in a manually created forum topic; `0` keeps unknown topics ignored |
| `DUREVCODE_STATE_PATH` | no | `~/.local/share/durevcode/state.json` | Topic/message mapping persisted across restarts |
| `DUREVCODE_ALLOWED_USERS` | no | open to all | Comma-separated Telegram user ids allowed to drive sessions; empty allows everyone |
| `DUREVCODE_POLL_MS` | no | `1000` | DB poll interval |
| `DUREVCODE_POLL_FANOUT` | no | `3` | Sessions updated in parallel per tick. One tick awaits several Telegram calls per session sequentially, so a small fanout multiplies startup time by the number of batches |
| `TELEGRAM_REQUEST_TIMEOUT_MS` | no | `30000` | Per-request timeout for the Telegram API. A healthy call is well under a second, so a stalled gateway only costs this much |
| — (hardcoded) | — | `maxRetries: 0` | Telegram retries are off on purpose: a stalled call would otherwise burn `attempts x timeout` seconds inside one tick, while the agent already retries on the next poll and never loses queued events |
| `DUREVCODE_IDLE_SEC` | no | `90` | Idle time before the final summary |
| `DUREVCODE_AUTO_CONTINUE_SEC` | no | `60` | Quiet stretch (seconds) after which the agent nudges the session to continue a stalled-looking turn; `0` disables the auto-continue |

Numeric env vars are clamped to sane ranges (`DUREVCODE_MAX_SESSIONS` 0–128, poll 100–3600000 ms, fanout 1–64, idle/auto-continue 0–86400 s, auto-continue nudges 0–64, API timeouts 1000–300000 ms, opencode retries 0–10), so a typo cannot freeze the agent with a year-long timer.

## Forum control

Write in a session topic and opencode executes it: the message text becomes a session prompt (`POST /api/session/{id}/prompt`), progress streams back into the same topic. Create a new forum topic yourself and write the task there — the agent creates a fresh opencode session for it (`POST /api/session`), binds the topic to it and sends your text as the first prompt. Details:

- only topic messages are picked up (General is ignored), bot's own messages are skipped;
- `DUREVCODE_ALLOWED_USERS` restricts who can drive sessions (empty = everyone; denied users are ignored silently);
- a prompt sent while the session is busy is queued per session (max 5, oldest drops) and sent when the session frees up, with a `⏳` notice;
- answers quote the question and leave the author's face to the quote: the agent's content messages (answer text and the final summary) are sent as Telegram replies to the message of the prompt author they close, with no name stamped into the answer body — Telegram already renders that author's name in the quote header — attribution is bound by event time (each event carries the attribution of the last prompt sent before the event was created, and that attribution only activates once the prompt's own part lands in the store — a prompt posted mid-turn stays pending and cannot steal a running turn's events onto a later author), so queued prompts from different people and interleaved turns keep their own author, making it visible whose task each message closes in a multi-user history (service cards — Stop control, permission/question cards, status edits — stay neutral); prompts that reach the session from outside Telegram (typed into a local opencode TUI or CLI against the same store) produce a neutral answer without a reply target; every bot message is delivered silently (`disable_notification` on every send — answers, service cards, error notices and the WHIP nudge alike), so the quote arrives without triggering a Telegram push sound; `DUREVCODE_LEAD_MENTION=1` shines the name back into the answer as a colored protocol mention (`tg://user?id=` link) — off by default because an @mention nudges even muted chats;
- permission requests raised by tools are posted into the topic; reply `/allow` or `/deny` to that message to decide (`once` / `reject`);
- the agent can close the task itself: an answer that ends with a standalone `/stop` line (optionally `/stop@bot`, on its own line) is split there — the answer is posted, then the command arrives as its own message, then the session goes through the same stop as the typed command and `Stopped, send the task again.` lands last. A `/stop` mentioned inside the prose is ordinary text.
- text documents are inlined into the prompt (up to 20000 chars, binaries declined); captions are prepended.
- photos, GIFs, videos and PDF/video documents are downloaded into `<DUREVCODE_DIR>/tmp/.agent-inbox/` (max 20 MB, filename sanitized, inbox capped at 200 files) and passed to opencode as a `[file name] saved to <path>` reference for the read tool; captions are prepended.
- voice, video notes, audio and stickers can't be parsed yet — the bot replies with a notice suggesting photo/document/text instead.
