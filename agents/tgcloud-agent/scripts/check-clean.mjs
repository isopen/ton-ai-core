import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const FORBIDDEN = [
  [/node:/, 'node: import (no Node builtins in the isolate)'],
  [/require\s*\(/, 'require() (ESM only)'],
  [/\bprocess\./, 'process (no Node globals in the isolate)'],
  [/\bBuffer\b/, 'Buffer (no Node globals in the isolate)'],
  [/__dirname/, '__dirname (no filesystem paths)'],
  [/__filename/, '__filename (no filesystem paths)'],
  [/from\s+['"]@/, 'npm import (only sdk and relative .js)'],
  [/from\s+['"]node/, 'node import (no Node builtins in the isolate)'],
  [/from\s+['"](?!sdk(\/|['"])|\.{1,2}\/)/, 'bare import (only sdk and relative .js)'],
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

let failed = false;
for (const target of [join(root, '..', 'tgcloud'), join(root, '..', 'app')]) {
  for (const file of walk(target)) {
    const text = readFileSync(file, 'utf8');
    for (const [pattern, why] of FORBIDDEN) {
      if (pattern.test(text)) {
        console.error(`${file}: forbidden ${why}: ${pattern}`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log('tgcloud modules are isolate-clean');
