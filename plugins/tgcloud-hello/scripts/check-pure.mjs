import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const FORBIDDEN = [
    /node:/,
    /require\s*\(/,
    /\bprocess\./,
    /\bBuffer\b/,
    /__dirname/,
    /__filename/,
    /child_process/,
    /from\s+['"]@/,
    /from\s+['"]node/,
];

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name === 'labels.ts') out.push(full);
    }
    return out;
}

const files = walk(here);
if (files.length === 0) {
    console.error('tgcloud-hello pure core not found: src/labels.ts');
    process.exit(1);
}

let failed = false;
for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
            console.error(`forbidden pattern ${pattern} in ${file} (tgcloud core must stay runtime-free)`);
            failed = true;
        }
    }
}
if (failed) process.exit(1);
console.log('tgcloud-hello pure core is clean');
