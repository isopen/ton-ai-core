# tgs-gallary

Telegram Serverless Mini App gallery for animated TGS emoji. The page is an
[Atom](../../plugins/atom) UI running on the `@ton-ai/core` `BaseAgent`, and it
renders every emoji with the Rust/WASM renderer from the
[tgs plugin](../../plugins/tgs) — the same bit-exact build the benchmarks use.

`npm run deploy` uploads the page **and** the emoji shards + wasm together: it
runs the npm `predeploy` hook first, which regenerates everything under `app/`
(`scripts/sync.mjs`) and verifies it is isolate-clean.

## Layout

```text
agents/tgs-gallary/
  app/index.html           # Mini App shell
  app/app.js               # Atom UI + GalleryAgent (BaseAgent) + wasm playback
  app/gallery-core.js      # pure pagination helpers (unit-tested)
  app/styles.css
  app/vendor/ton-ai-core/  # GENERATED @ton-ai/core ESM (agent framework)
  app/vendor/atom/         # GENERATED @ton-ai/atom ESM + browser logger stub
  app/vendor/tgs/          # GENERATED tgs_wasm.js + tgs_wasm_bg.wasm
  app/fixtures/            # GENERATED manifest.js + data/shard-*.bin
  tgcloud/handlers/message.js       # /start: widget card or Open button
  tgcloud/endpoints/fixtureStats.js # skill: server-side fixture inventory
  tgcloud/lib/             # GENERATED isolate tree (core + fixtures.js)
  tgcloud/lib/widget.js    # hand-written, tracked widget HTML builder
  scripts/sync.mjs         # builds the generated trees under app/ and tgcloud/lib/
  scripts/check-clean.mjs  # fails on Node/npm imports in cloud modules
  tgcloud.jsonc            # static: app/, spa
```

Sources of truth:

- agent framework — `packages/core/src`
- UI framework — `plugins/atom/src`
- renderer — `plugins/tgs/src/rust/wasm/tgs_wasm.js` + `tgs_wasm_bg.wasm`
  (build it with `plugins/tgs/src/rust/build.sh` if the file is missing)
- emoji packs — `TGS_FIXTURES_DIR` (default `~/Documents/tgs_data`), one folder
  per pack with `.tgs` files; `manifest.jsonl` there is only read for sticker
  labels and is not copied

`sync` compiles core and Atom straight from their sources to ESM, pins every
generated file with source/dist hashes, copies the wasm pair, packs every emoji
(`.tgs` only) into ~2 MiB shards under `app/fixtures/data/`, and writes
`app/fixtures/manifest.js` (+ the isolate-side `tgcloud/lib/fixtures.js`). No
JSON is written under `app/fixtures/`. Nothing under `app/vendor/`,
`app/fixtures/` or `tgcloud/lib/` is committed.

Files whose paint colors are all fully transparent are rendered frame by frame
with the same wasm build; if every frame is empty they are skipped and listed in
`EMPTY` instead of shipping blank cells. The current corpus has 10 such stubs,
all byte-identical 421 B placeholders in `EmojiStatus`.

Shards exist because tgcloud allows at most **1000 files per static version**;
the raw corpus is ~16.6k `.tgs` files. Packing keeps the deployed tree at ~209
files while the browser still loads individual emoji by offset. `BUILD` hashes
both the corpus bytes and the shard layout, so a changed packing invalidates the
`?v=` cache.

## What the page does

- loads the generated `fixtures/manifest.js` and fetches the 1–3 shards a page
  needs, caching up to 16 of them in memory;
- pagination: any `1–500` per page (default **50**), first/prev/next/last and a
  page number input, range indicator;
- cell size is a free `32–320` px number input (default **64**), playback cap 15/30/60 fps (each
  emoji plays at its own `fr`);
- search across sticker, pack name and file id, with the match count in the
  header;
- “Group by pack” turns the grid into per-folder sections on the current page;
- each cell shows a unique name (sticker character when known, otherwise
  `Pack 01`, `Pack 02`, …) with live `load` and `render` timings stacked under
  it;
- click an emoji to pause/resume it, plus a “Pause all” button;
- emoji that render no visible pixels are filtered out at build time and counted
  as `empty skipped` in the header (the live “no visible layers” state remains
  for anything that slips through);
- calls the `fixtureStats` skill inside Telegram and shows the server-side
  inventory next to the local one (silently skipped outside Telegram).

## Telegram widget

In a private chat `/start` first tries a [Telegram widget](https://core.telegram.org/bots/widgets)
(Bot API 10.4 `sendWidget`): a card with the corpus stats, a few pack chips and
an **Open gallery** button. The widget is built in `tgcloud/lib/widget.js`; its
HTML is self-contained (inline CSS/JS, no network, well under the 32 KB / 4 KB
compressed limits), so it can only preview the gallery. The button calls
`TelegramWidget.openLink(APP_URL)` and opens the Mini App in the in-app browser.

Telegram disabled widgets for general bots in production on 2026-11-13, so
`sendWidget` currently fails with `INPUT_MEDIA_WIDGET_NOT_ALLOWED`
([telegram-bot-api#947](https://github.com/tdlib/telegram-bot-api/issues/947)).
The handler then sends the HTML teaser from `galleryTeaser()` with the same
numbers and an **Open gallery** button, and remembers the failure for the
lifetime of the isolate so it does not probe on every `/start`. When Telegram
restores access, the widget path starts working again without a code change.

Groups, and bots on an older Bot API, get the same teaser message with a URL
button. The widget path is guarded by `message.chat.type === 'private'` because
production widgets are only allowed in the bot's private chat.

## Local checks

```text
npm run sync -w @ton-ai/tgs-gallary     # regenerate app/vendor, app/fixtures, tgcloud/lib
npm run check -w @ton-ai/tgs-gallary    # isolate-clean scan
npx jest agents/tgs-gallary/tests/
```

If the emoji packs live somewhere else:

```text
TGS_FIXTURES_DIR=/path/to/tgs_data npm run sync -w @ton-ai/tgs-gallary
```

Local preview without deploying (static server, no cloud):

```text
cd agents/tgs-gallary
npx http-server app -p 8080     # or: python3 -m http.server 8080 -d app
```

## Deploy

```text
cd agents/tgs-gallary
npx tgcloud login        # once, token prompt
npm run deploy           # predeploy: sync + check, then tgcloud push app/ (emoji packs included)
```

`npm run deploy` is the supported path: plain `npx tgcloud push` skips the npm
lifecycle, so run `npm run sync` yourself first if you use it directly.

The first push prints the Mini App URL. Put it into `APP_URL` in
`tgcloud/handlers/message.js`, deploy again so `/start` carries the Open button,
and set the same URL as the Mini App URL in BotFather.

> One bot hosts one serverless app. Log in with a token for a bot that is not
> already serving another `tgcloud` project, otherwise this push replaces that
> project's modules and static site.

Emoji shards are part of the static `app/` tree, so every push re-uploads only
the files whose hashes changed. The deployed tree is ~209 files / ~296 MB across
170 shards — under the 1000-file limit — so the first push still takes a while;
adding a pack folder to the source and running `npm run sync` is enough to
publish it on the next push.
