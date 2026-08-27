.PHONY: build build-core build-plugins build-agents clean build-% clean-gram-browser build-gram-browser

build: build-core build-plugins

build-core:
	npm run build -w @ton-ai/core

build-plugins:
	@for pkg in plugins/*/package.json; do \
		name=$$(node -p "require('./$$pkg').name"); \
		node -e "const p=require('./$$pkg'); if(p.scripts?.build) process.exit(0); else process.exit(1)" && \
		echo "Building $$name..." && npm run build -w "$$name" || true; \
	done

build-agents:
	@echo "Agents use ts-node, no build step needed. Run: npx ts-node agents/<name>/index.ts"

clean-gram-browser:
	@echo "Cleaning gram-browser deps (gram-browser, gram-db, gram-ui, ton-ai/core, tl-language, telegram, tgs, atom, gram-media, gram-debug, crypton/rust wasm, tmd)..."
	@rm -rf agents/gram-browser/dist 2>/dev/null || true
	@rm -rf plugins/gram-db/dist 2>/dev/null || true
	@rm -rf plugins/gram-ui/dist 2>/dev/null || true
	@rm -rf packages/core/dist 2>/dev/null || true
	@rm -rf plugins/tl-language/dist 2>/dev/null || true
	@rm -rf plugins/telegram/dist 2>/dev/null || true
	@rm -rf plugins/tgs/dist 2>/dev/null || true
	@rm -rf plugins/atom/dist 2>/dev/null || true
	@rm -rf plugins/gram-media/dist 2>/dev/null || true
	@rm -rf plugins/gram-debug/dist 2>/dev/null || true
	@rm -rf plugins/tmd/dist 2>/dev/null || true
	@rm -rf packages/core/src/crypton/rust/target 2>/dev/null || true
	@rm -rf packages/core/dist/crypton/wasm 2>/dev/null || true
	@echo "Clean done"

build-gram-browser: clean-gram-browser
	@echo "Building gram-browser deps via make (ton-ai/core, crypton wasm, gram-debug, atom, tl-language, telegram, tgs, tmd, gram-media, gram-db, gram-ui)..."
	@npm run build -w @ton-ai/core
	@npm run build -w @ton-ai/gram-debug
	@npm run build -w @ton-ai/atom
	@npm run build -w @ton-ai/tl-language
	@npm run build -w @ton-ai/telegram 2>/dev/null || (echo "telegram: build fallback" && npx tsc -p plugins/telegram/tsconfig.json || true)
	@npm run build -w @ton-ai/tgs 2>/dev/null || (rm -rf plugins/tgs/dist && npx tsc -p plugins/tgs/tsconfig.json || true)
	@npm run build -w @ton-ai/tmd 2>/dev/null || (rm -rf plugins/tmd/dist && npx tsc -p plugins/tmd/tsconfig.json || true)
	@npm run build -w @ton-ai/gram-media 2>/dev/null || (rm -rf plugins/gram-media/dist && npx tsc -p plugins/gram-media/tsconfig.json || true)
	@npm run build -w @ton-ai/gram-db
	@npm run build -w @ton-ai/gram-ui
	@echo "Building @ton-ai/gram-browser (webpack)..."
	@npm run build -w @ton-ai/gram-browser

build-%:
	@npm run build -w "@ton-ai/$*" 2>/dev/null || \
	 (for pkg in plugins/*/package.json agents/*/package.json; do \
		[ -f "$$pkg" ] && node -e "const p=require('./$$pkg');if(p.name==='@ton-ai/$*'&&p.scripts?.build)process.exit(0);else process.exit(1)" && \
		echo "Building @ton-ai/$*..." && npm run build -w "@ton-ai/$*" && break; \
	 done)

clean:
	npm run clean -ws --if-present

list-workspaces:
	npm ls --depth=0
