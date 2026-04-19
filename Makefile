CONFIGS_DIR := ./configs
PACKAGE_JSON := package.json
PACKAGE_JSON_BACKUP := package.json.backup

define check_config_exists
	@if [ ! -f $(CONFIGS_DIR)/$(1).json ]; then \
		echo "Error: Configuration '$(1)' does not exist in $(CONFIGS_DIR)"; \
		echo "Available configs:"; \
		ls -1 $(CONFIGS_DIR)/*.json | sed 's/.*\///' | sed 's/\.json//'; \
		exit 1; \
	fi
endef

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

build-%:
	$(call check_config_exists,$*)
	$(call build_with_config,$*)

list-configs:
	@echo "Available configurations:"
	@ls -1 $(CONFIGS_DIR)/*.json | sed 's/.*\///' | sed 's/\.json//'
