.PHONY: use-wallet use-openrouter build-wallet build-openrouter use-gigachat build-gigachat run list-configs

CONFIGS_DIR := ./configs
PACKAGE_JSON := package.json
PACKAGE_JSON_BACKUP := package.json.backup

define use_config
	@echo "Switching to $(1)..."
	@if [ -f $(PACKAGE_JSON) ] && [ ! -L $(PACKAGE_JSON) ]; then \
		cp $(PACKAGE_JSON) $(PACKAGE_JSON_BACKUP); \
		echo "Original package.json backed up"; \
	fi
	@ln -sf $(CONFIGS_DIR)/$(1).json $(PACKAGE_JSON)
	@echo "Now using: $(1).json"
endef

define build_with_config
	$(call use_config,$(1))
	@npm run rebuild
	@rm $(PACKAGE_JSON)
	@if [ -f $(PACKAGE_JSON_BACKUP) ]; then \
		mv $(PACKAGE_JSON_BACKUP) $(PACKAGE_JSON); \
		echo "Previous package.json restored"; \
	else \
		echo "No backup found, creating empty package.json"; \
		echo "{}" > $(PACKAGE_JSON); \
	fi
	@echo "Build completed with $(1) configuration"
endef

use-wallet:
	$(call use_config,ton-ai-core)

use-wallet:
	$(call use_config,wallet)

use-wallet-manager:
	$(call use_config,wallet-manager)

use-pay-to-go:
	$(call use_config,pay-to-go)

use-telegram-bot:
	$(call build_with_config,telegram-bot)

use-gigachat:
	$(call build_with_config,gigachat)

use-gigaclaw:
	$(call build_with_config,gigaclaw)

use-content-checker:
	$(call build_with_config,content-checker)

use-logger:
	$(call build_with_config,logger)

use-deployer:
	$(call build_with_config,deployer)

build-ton-ai-core:
	$(call build_with_config,ton-ai-core)

build-wallet:
	$(call build_with_config,wallet)

build-wallet-manager:
	$(call build_with_config,wallet-manager)

build-pay-to-go:
	$(call build_with_config,pay-to-go)

build-telegram-bot:
	$(call build_with_config,telegram-bot)

build-gigachat:
	$(call build_with_config,gigachat)

build-gigaclaw:
	$(call build_with_config,gigaclaw)

build-content-checker:
	$(call build_with_config,content-checker)

build-logger:
	$(call build_with_config,logger)

build-deployer:
	$(call build_with_config,deployer)

list-configs:
	@echo "Available configurations:"
	@ls -1 $(CONFIGS_DIR)/*.json | sed 's/.*\///' | sed 's/\.json//'
