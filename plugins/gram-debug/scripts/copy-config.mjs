import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(dir, '../gram-debug.json');
const target = path.resolve(dir, '../dist/gram-debug.json');

if (!fs.existsSync(source)) {
    console.error(`[gram-debug] missing config: ${source}`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`[gram-debug] copied config -> ${path.relative(path.resolve(dir, '../..'), target)}`);
