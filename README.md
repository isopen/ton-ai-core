# TON AI Framework

Imagine a framework that not only simplifies blockchain development but also unleashes the full potential of AI agents on the TON ecosystem! We've created a lightweight, modular, and intuitive framework that becomes your trusted companion in building the next generation of decentralized intelligent applications. This powerful toolkit lets developers customize its functionality to their specific needs, scaling seamlessly from simple scripts to complex autonomous agents.

Whether you're building a DeFi trading bot, an NFT management assistant, or a blockchain analytics tool, TON AI is ready to be your reliable foundation for any task. It handles the complexities of TON blockchain integration with flawless precision, leaving you with one crucial task - bringing your most ambitious ideas to life!

Join us on this exciting journey and explore new horizons in TON development! Your ideas deserve the best realization - give them wings with TON AI and watch them soar across The Open Network!

Create what you believe!

## Get started

```bash
1. git clone https://github.com/isopen/ton-ai-core.git
2. cd ton-ai-core
3. make build-ton-ai-core
4. npm install -g ./packages/core/ton-ai-core-*.tgz
5. cd ../ && mkdir my-ton-agent && cd my-ton-agent
6. npm init -y && npm install --save-dev typescript ts-node @types/node && npm link @ton-ai/core
7. cat > tsconfig.json << EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "exclude": ["node_modules", "dist"]
}
EOF
8. cat > index.ts << EOF
import { MCPClient } from '@ton-ai/core';

console.log('@ton-ai/core loaded!');

const client = new MCPClient({
  network: 'testnet'
});

console.log(client);
EOF
9. npx ts-node index.ts
```

## Examples

```bash
make build-wallet
cd agents/wallet
vim README.md
npx ts-node index.ts
```

```bash
make build-wallet-manager
cd agents/wallet-manager
vim README.md
npx ts-node index.ts
```

```bash
make build-pay-to-go
cd agents/pay-to-go
vim README.md
npx ts-node index.ts
```
