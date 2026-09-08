const { execSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const manifest = require(path.join(ROOT, 'configs/gram-browser.json'));
function topSplit(body) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth === 0 && body.startsWith('&&', i)) { parts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function leaves(name, out) {
  const body = manifest.scripts[name];
  if (!body) throw new Error('unknown script ' + name);
  const parts = topSplit(body);
  const refOf = (p) => {
    const m = /^npm run ([A-Za-z0-9:_-]+)$/.exec(p.trim());
    return m && manifest.scripts[m[1]] ? m[1] : null;
  };
  let i = 0;
  while (i < parts.length && refOf(parts[i])) { leaves(refOf(parts[i]), out); i++; }
  if (i === 0) out.push({ name, body });
  else if (i < parts.length) out.push({ name: name + '#tail', body: parts.slice(i).join(' && ') });
  return out;
}
const target = process.argv[2] || 'rebuild:quick';
const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
let list = leaves(target, []);
if (from) list = list.slice(list.findIndex((l) => l.name === from));
if (process.argv.includes('--print')) { for (const l of list) console.log('### ' + l.name + '\n' + l.body + '\n'); process.exit(0); }
for (const l of list) {
  console.log('>>> RUN ' + l.name);
  execSync(l.body, { cwd: ROOT, stdio: 'inherit', shell: '/bin/bash', maxBuffer: 64 * 1024 * 1024 });
}
console.log('DONE ' + target);
