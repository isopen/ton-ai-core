# tgcloud-hello

Demo labels plugin for the tgcloud Mini App agent. The skill core (`src/labels.ts`)
is intentionally runtime-free — zero imports — so it can be vendored into the
Telegram Serverless isolate, which allows only `sdk` plus relative `.js` modules.

The plugin class (`src/index.ts`) additionally exposes the static bootstrap
`TgcloudHelloPlugin.armed(context?)` — it initializes the plugin once per runtime
with a silent event bus and a console logger, so runtimes without the Node
framework (the tgcloud isolate) can run the very same plugin class.

## Skills

- `getLabels()` — `['Hello, world!', "Let's do IT", 'Ready to GO!']`
- `nextLabel(current)` — next slide, unknown input falls back to the first slide
- `labelAt(index)` — slide by index, wraps around both directions

## Build and test

```text
npm run build -w @ton-ai/tgcloud-hello
npx jest plugins/tgcloud-hello/tests/
node plugins/tgcloud-hello/scripts/check-pure.mjs
```

`check:pure` fails the moment `src/labels.ts` gains a Node or npm dependency.
`agents/tgcloud-agent` compiles `src/` straight to isolate-ready ESM on every
`sync` — there is no intermediate build inside this package.
