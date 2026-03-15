set -e
echo "Starting universal deployment for agent: ${AGENT_NAME}..."

echo "Installing build essentials..."
npm install -g typescript ts-node

echo "Current directory: $(pwd)"

echo "Cloning repository from ${REPO_URL}..."
git clone --depth 1 --branch ${BRANCH} ${REPO_URL} repo
cd repo

echo "Repository cloned. Building components..."

echo "Cleaning..."
cd packages/core && npm run clean && cd ../..
for plugin in ${PLUGINS_LIST}; do
    if [ -d "plugins/$plugin" ]; then
        cd plugins/$plugin && npm run clean && cd ../..
    fi
done
cd agents/${AGENT_NAME} && rm -rf dist node_modules package-lock.json && cd ../..

echo "Building core..."
cd packages/core
npm install
npm run build
npm pack
CORE_TGZ=$(ls ton-ai-core-*.tgz | head -1)
mv $CORE_TGZ ../../
cd ../..
echo "Core package built: $CORE_TGZ"

install_tgz() {
    local tgz_path=$1
    local target_dir=$2
    
    echo "Installing from $tgz_path to $target_dir"
    
    temp_dir=$(mktemp -d)
    tar -xzf "$tgz_path" -C "$temp_dir"
    PACKAGE_NAME=$(node -p "require('$temp_dir/package/package.json').name")
    
    mkdir -p "$target_dir/node_modules/$PACKAGE_NAME"
    cp -r "$temp_dir/package/"* "$target_dir/node_modules/$PACKAGE_NAME/"
    
    rm -rf "$temp_dir"
    echo "$PACKAGE_NAME installed"
}

for plugin in ${PLUGINS_LIST}; do
    if [ -d "plugins/$plugin" ]; then
        echo "Building plugin: $plugin"
        cd plugins/$plugin
        npm install
        install_tgz "../../$CORE_TGZ" "$(pwd)"
        npm run build
        npm pack
        PLUGIN_TGZ=$(ls ton-ai-$plugin-*.tgz | head -1)
        mv $PLUGIN_TGZ ../../
        cd ../..
        echo "Plugin $plugin built"
    fi
done

echo "Building agent: ${AGENT_NAME}..."
cd agents/${AGENT_NAME}

cp package.json package.json.original

echo "Creating fresh package.json..."
cat > package.json << EOF
{
  "name": "@ton-ai/${AGENT_NAME}",
  "version": "0.1.0",
  "description": "${AGENT_NAME} agent",
  "main": "index.js",
  "scripts": {
    "start": "ts-node index.ts"
  },
  "dependencies": {
    "@ton/core": "^0.63.0",
    "@ton/crypto": "^3.3.0",
    "@ton-ai/core": "file:./core.tgz",
${DEPENDENCIES_STR}
    "@types/node": "^25.2.3",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  },
  "author": "testertesterov",
  "license": "Boost Software License 1.0"
}
EOF

rm -rf node_modules package-lock.json

echo "Copying .tgz files to agent directory..."
cp ../../$CORE_TGZ ./core.tgz
for plugin in ${PLUGINS_LIST}; do
    cp ../../ton-ai-$plugin-*.tgz ./$plugin.tgz 2>/dev/null || true
done

echo "Installing all dependencies..."
npm install

echo "Starting agent ${agentName}..."
NODE_PATH=$(pwd)/node_modules npx ts-node index.ts
echo "Agent is ready."
