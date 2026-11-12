# durevcode tune sidecar

A local harness-tuning loop for the Telegram-host durevcode agent. It implements the
Propose–Probe–Compose cycle (the same shape as google-research/harness2 runs on its
OpenCode substrate) natively on this repo's stack: opencode servers, worktrees, jest
checkers. No Python, no Vertex credentials, no external services.

Nothing is applied automatically. Every run produces diffs for manual review; you decide
what lands in `.opencode/`.

## How it works

1. **Snapshot** — reads `.opencode/opencode.json` (instructions) and `.opencode/skills/*/SKILL.md` into `snapshot.json` / `snapshot.md`.
2. **Baseline** (optional) — probes the current harness: for each selected task a dedicated git worktree + a dedicated opencode server (`serve` on a private port, random password) runs the task prompt as a real session. Questions raised by the session are auto-answered (prefers the option labeled "Recommended"). Timed-out sessions are interrupted.
3. **Propose** — a meta-session (own worktree + server) receives the task set, baseline evidence and past lessons, and returns candidate harness edits as strict JSON. Candidate validation enforces a whitelist: only `.opencode/opencode.json`, `.opencode/skills/**`, `.opencode/scripts/**`.
4. **Probe candidates** — each candidate is applied to a fresh worktree and probed on the same tasks. Deterministic checkers score results:
   - `jest` — a test suite must exit 0 in the worktree. Regression tasks can pull a hidden test file from a fix commit (`testFilesFrom`), run only the regression cases (`testNamePattern`), and require that the agent actually changed the target source (`requireChangesIn`) — so a pre-fix base fails and only a real fix passes;
   - `file-contains` — a new file in a directory must contain required keywords.
5. **Compose** — a second meta-session sees all candidate evidence and produces the single best composed candidate plus evidence-backed lessons. The composed candidate can itself be probed.
6. **Report** — `report.md` (stage × task table with pass/fail, time, tokens, files), `report.json`, per-stage `run-*.json`, `composed.md` (the diff to review), `candidate-*.md` (alternatives), `lessons.md`.

## Isolation

- Probes run on `git worktree add --detach <dir> <task.base>` of this repo. Code comes from the task base commit, but the harness surface (`.opencode/opencode.json`, `.opencode/skills`, `.opencode/mcp`, `.opencode/scripts`) is copied from the live working tree, so tuning always measures the harness you are editing right now.
- `node_modules` is symlinked from the main checkout, `.opencode/node_modules` likewise.
- `rag-memory` MCP is redirected: probe copies point `RAG_MEMORY_FILE` at a probe-local file, so real agent memory is never touched.
- Probe sessions are invisible to the durevcode Telegram agent: they run on separate opencode servers/ports, and durevcode only watches its own server. Each task gets its own port; stages are spaced by `tasks + 1` ports.
- Servers are killed and awaited, and worktrees removed at the end (unless `--keep-worktrees`).

## Requirements

- Node.js 20+ (ts-node runs this directly, same as the rest of the repo).
- `opencode` binary on `PATH` (or set `OPENCODE_BIN`).
- Free TCP ports: `--meta-port` (default 4196) and `--probe-port-base` + N (default 4210+).
- Shared opencode DB at `~/.local/share/opencode/opencode.db` (override with `OPENCODE_DB_PATH`) — used read-only to extract the final assistant text of probe sessions.
- A working model: by default the loop pins `opencode/big-pickle` on every probe/meta session (override with `TUNE_MODEL=provider/id`, variant with `TUNE_MODEL_VARIANT`). Free tiers can hit `provider.free-limit`; the run records the failed probe and continues, but switch models for a complete compose stage.

## Usage

```bash
# preview the plan without starting anything
npx ts-node agents/durevcode/harness/run.ts --dry-run

# full loop: baseline + 2 candidates + compose + composed probe, all tasks
npx ts-node agents/durevcode/harness/run.ts

# narrow and faster: one task, no baseline, don't probe the composed result
npx ts-node agents/durevcode/harness/run.ts --tasks crypton-plan --k 1 --no-baseline --no-probe-compose --timeout 600

# debug leftovers
npx ts-node agents/durevcode/harness/run.ts --keep-worktrees --meta-port 4300 --probe-port-base 4310
```

Options: `--k N` candidates, `--tasks a,b` (ids from the active task file or `all`), `--timeout SEC` per task probe (default 1200), `--no-baseline`, `--no-probe-compose`, `--meta-port`, `--probe-port-base`, `--out-root DIR`, `--keep-worktrees`.

Units of cost: one full loop ≈ `(#tasks) + k·(#tasks)` probe sessions + 2 meta sessions. With the default 7 tasks and `k=2` that is 7 + 2·7 + 2 = 23 real model sessions; expect several minutes per session on a free model tier. Narrow the run with `--tasks` while iterating.

## Task files

Task definitions are data; the loader, validator and selector live in `tasks.ts`. The files follow the `.env` pattern:

- `.tasks.json` — the only file loaded at runtime, ignored by git;
- `.tasks.example.json` — the committed example to copy from; the loop never imports it.

Create your task set from the example:

```bash
cp agents/durevcode/harness/.tasks.example.json agents/durevcode/harness/.tasks.json
```

If `.tasks.json` is missing, the loop loads an empty task list instead of failing; `--tasks` then has nothing to select from, so create the file before a real run.

Both files are dotfiles, like `.env` / `.env.example`. Dotfiles do not shadow the `tasks.ts` module, so the loader import keeps working.

`validateTasks` rejects unknown keys, duplicate ids and malformed checkers with the file path and a reason before any server starts.

## Tasks

Built-in tasks (`.tasks.example.json`) come from real incident history in this repo:

| id | scenario | checker |
|---|---|---|
| `question-radio` | two-question form sent an empty first answer; fix the tap handler | hidden tests from `55a2170`, `agent.ts` must change |
| `topic-name-pin` | manual topic rename gets stomped by session-title sync | hidden tests from `fb24f61`, `agent.ts` must change |
| `watch-slot-user` | an active user loses the watch slot during long thinking | hidden tests from `b398363`, `agent.ts` must change |
| `bound-window` | a watched bound session outside the fresh window is detached and reattached | hidden tests from `d4c0442`, `agent.ts` must change |
| `cmd-bubble` | handled command bubbles are deleted; subagent replies lose their quote | hidden tests from `617b3da`, `agent.ts` must change |
| `thought-doc-fallback` | a failed thought-document upload hides the reasoning text | hidden tests from `9237009`, `agent.ts` must change |
| `crypton-plan` | ambiguous "Crypton on C" ask; the agent must write an interpretation plan doc | new `.md` under `docs/plans/` mentioning Crypton/round/KAT |

Add scenario tasks to your `.tasks.json` (copied from `.tasks.example.json`): prompt in English, deterministic checker, `lessonsHint` describing the known-good behavior — it feeds the compose stage. For regression tasks prefer hidden tests: set `checker.testFilesFrom` to the fix commit, `checker.testNamePattern` to the regression test names, and `checker.requireChangesIn` to the source file that must be edited.

## Relation to google-research/harness2

The upstream framework (Python 3.12 + uv, Vertex utils, benchmark runners, judge, c1–c8 harness surface for OpenCode) was researched and is documented in the chat history. This sidecar keeps the same loop and output discipline (adopted-harness diffs + lessons journal) but runs it on the existing TypeScript stack so it works today without Google Cloud credentials. If Vertex access is added later, the same task set from the active task file can be exported to drive the upstream harness2 benches for comparison runs.

Past `lessons.md` files can be promoted to `agents/durevcode/harness/lessons.md` (in the repo) to seed future runs; the loop reads it when present.
