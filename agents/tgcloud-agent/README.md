# tgcloud-agent

Telegram Serverless Mini App agent. The bot answers `/start`, the Mini App shows
one centered label and cycles `Hello, world! → Let's do IT → Ready to GO!`
through the `tgcloud-hello` plugin skill — every tap calls the `nextLabel`
endpoint, which runs the vendored skill.

## Layout

```text
agents/tgcloud-agent/
  tgcloud/
    handlers/message.js    # /start + Hello world replies (runs in the isolate)
    endpoints/nextLabel.js # skill call (runs in the isolate)
    lib/tgcloud-hello/     # GENERATED from the plugin src (index, skills, labels, types), never committed
    lib/ton-ai-core/       # GENERATED framework tree (whole dist, ESM), never committed
  app/index.html           # centered Mini App screen (static hosting)
  app/app.js               # Mini App logic on BaseAgent (ES module, imports app/vendor)
  app/vendor/ton-ai-core/  # GENERATED agent framework for the browser, never committed
  scripts/sync.mjs  # plugin src + core dist compiled to ESM -> tgcloud/lib/tgcloud-hello/ + app/vendor/ton-ai-core/
  scripts/check-clean.mjs  # fails on Node/npm imports inside tgcloud/
  tests/labels-sync.test.ts
  tgcloud.jsonc
```

`@ton-ai/*` packages never deploy: only `.js` files under `tgcloud/` (plus the
`app/` build folder) go to the cloud. The skill source of truth lives in
`plugins/tgcloud-hello/src/`; on every deploy (`predeploy` runs `sync`) the
plugin sources compile straight to isolate-ready ESM and land in
`tgcloud/lib/tgcloud-hello/` — pinned by src hashes in the file header and
re-tested on every run. The framework `BasePlugin` carries no isolate build by
design, so `sync` compiles the whole `@ton-ai/core` package to ESM itself
(it is dependency-free) and pins it by source hash. Nothing is ever
hand-prepared in `lib/` or `app/vendor/` — `sync` writes the same tree bytes to both.

## How the plugin is wired

There is no separate agent runtime: the agent *is* the cloud modules driving
the plugin class. Both `tgcloud/handlers/message.js` and
`tgcloud/endpoints/nextLabel.js` arm `TgcloudHelloPlugin` with
`await TgcloudHelloPlugin.armed()` and call its methods (`getLabels`,
`labelAt`, `nextLabel`) — never hand-written logic. The jest suite asserts
these imports and the delegation, so bypassing the plugin fails the tests.

The cloud isolate cannot run the Node framework, so `tgcloud/lib/tgcloud-hello/index.js`
carries the same plugin class (`TgcloudHelloPlugin`) compiled out of
`plugins/tgcloud-hello/src/`, with the core `BasePlugin` vendored next to it as
`tgcloud/lib/ton-ai-core/` tree — every file pinned by dist+src hash and re-tested on every
run. One source of truth, two runtimes.

## Local checks

```text
npm run build -w @ton-ai/tgcloud-hello
npm run sync -w @ton-ai/tgcloud-agent   # regenerates tgcloud/lib/* + app/vendor/* (tests read them)
npm run check -w @ton-ai/tgcloud-agent
npx jest plugins/tgcloud-hello/tests/ agents/tgcloud-agent/tests/
```

## Deploy

```text
cd agents/tgcloud-agent
npx tgcloud login     # CLI уже в devDependencies, токен спросит интерактивно
npx tgcloud push        # prints https://app<id>.tgcloud.ai/
```

Then put the printed URL into `APP_URL` in `tgcloud/handlers/message.js`, `push`
again so `/start` carries the Open button, and set the same URL as the Mini
App URL in BotFather. Try a tap without deploying first:

```text
npx tgcloud run endpoints/nextLabel '{ "current": "Hello, world!" }'
```
