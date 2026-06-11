.PHONY: build build-core build-plugins build-agents clean build-%

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
