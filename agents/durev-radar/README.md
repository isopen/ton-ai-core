# durev-radar

Telegram agent driving durev-core sessions, analogous to opencode-radar.

Plain prompts go to a free model and the answer lands in chat. `/exec` runs tools through the permission gate. Questions render as numbered options. No Done spam, no Already resolved spam.

## Launch

Build the engine and the plugin first:

```text
cargo build --release --manifest-path plugins/durevcode/rust/Cargo.toml
npm run build -w @ton-ai/durevcode
```

Then start the agent from the repo root:

```text
cd agents/durev-radar && npx ts-node index.ts
```

Wait for `Radar lock acquired` and `Agent started`, then write to the bot in Telegram. Stop with Ctrl+C, locks release automatically.

## Environment

Only two variables are required: `TELEGRAM_BOT_API_TOKEN` and `DUREV_CHAT_ID`. The rest have defaults. Copy `.env`, fill the token and chat id, the loader picks up both `.env` and `.env`:

```text
TELEGRAM_BOT_API_TOKEN=
DUREV_CHAT_ID=
# DUREV_DIR=/path/to/repo          (default: cwd)
# DUREV_ROOT=/path/to/repo         (default: cwd, tool sandbox)
# DUREV_MODEL=mimo-v2.5-free
# DUREV_STORE_PATH=~/.local/share/durev-radar/durev.db
# DUREV_BIN=/path/to/durev         (default: auto-resolve)
# OPENCODE_ZEN_API_KEY=            (needed for chat answers)
# OPENROUTER_API_KEY=              (needed for :free models)
# DUREV_ALLOWED_USERS=             (empty means everyone)
# DUREV_POLL_MS=1000
# DUREV_MAX_SESSIONS=10
```

Chat answers need `OPENCODE_ZEN_API_KEY` for Zen models or `OPENROUTER_API_KEY` for `:free` models.

## Chat commands

```text
<plain text>              ask the model
/exec read <path>         request a gated tool run
/exec write <path> <text> request a gated tool run
/exec bash <cmd>          request a gated tool run
/allow                    reply to a permission notice to run once
/deny                     reply to a permission notice to refuse
/stop                     drop the thread session
```

Permission notices and questions arrive as messages. Reply `/allow` or `/deny` to a permission notice to run the tool exactly once or refuse it. Answer questions with a number or text as a reply. A late answer to a resolved card starts a new prompt instead of warning.

## Single instance

Only one instance per chat: a second start exits with `already running` because of the lock file. This is intentional, do not delete the lock while the agent runs.
