import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const target = process.argv[2];
const name = process.argv[3];
const version = process.argv[4] || (target && !target.includes(':') && name && /^\d/.test(name) ? name : null);
const fullTarget = target && name && !/^\d/.test(name) ? `${target}:${name}` : target;

if (!fullTarget || !version) {
  console.log('Usage: node scripts/set-version.mjs <target> [<name>] <version>');
  console.log('');
  console.log('Targets:');
  console.log('  core              - packages/core + root + configs');
  console.log('  plugins           - all plugins/* + configs');
  console.log('  plugin <name>     - single plugin (e.g. plugin vercel)');
  console.log('  agents            - all agents/* + configs');
  console.log('  agent <name>      - single agent  (e.g. agent wallet)');
  console.log('  all               - core + plugins + agents');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/set-version.mjs core 1.0.0');
  console.log('  node scripts/set-version.mjs plugin vercel 0.2.0');
  console.log('  node scripts/set-version.mjs agent wallet 0.3.0');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version: ${version}`);
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const configsDir = path.join(root, 'configs');

function setJsonVersion(filePath, key, value) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const old = data[key];
  data[key] = value;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  return { file: path.relative(root, filePath), old, new: value };
}

function replaceTgzInConfigs(tgzBase, newVersion) {
  for (const cfg of getConfigFiles()) {
    let content = fs.readFileSync(cfg, 'utf8');
    const regex = new RegExp(`${tgzBase}-(\\d+\\.\\d+\\.\\d+)\\.tgz`, 'g');
    const matches = [...content.matchAll(regex)];
    if (matches.length === 0) continue;

    const oldVer = matches[0][1];
    content = content.replace(regex, `${tgzBase}-${newVersion}.tgz`);
    fs.writeFileSync(cfg, content);
    results.push({ file: path.relative(root, cfg), old: oldVer, new: newVersion });
  }
}

function getConfigFiles() {
  return fs.readdirSync(configsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(configsDir, f));
}

function setAllConfigVersions(ver) {
  for (const cfg of getConfigFiles()) {
    const r = setJsonVersion(cfg, 'version', ver);
    if (r) results.push(r);
  }
}

function getDirs(dir) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .filter(d => fs.existsSync(path.join(base, d, 'package.json')))
    .map(d => ({ name: d, path: path.join(base, d) }));
}

function findPkg(name, dirs) {
  return dirs.find(d => d.name === name);
}

const results = [];
const allPlugins = getDirs('plugins');
const allAgents = getDirs('agents');

if (fullTarget === 'core' || fullTarget === 'all') {
  results.push(setJsonVersion(path.join(root, 'packages/core/package.json'), 'version', version));
  results.push(setJsonVersion(path.join(root, 'package.json'), 'version', version));
  results.push(setJsonVersion(path.join(configsDir, 'ton-ai-core.json'), 'version', version));
  replaceTgzInConfigs('ton-ai-core', version);
}

if (fullTarget === 'plugins' || fullTarget === 'all') {
  for (const plugin of allPlugins) {
    const pkgPath = path.join(plugin.path, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const tgzBase = pkg.name.replace(/^@/, '').replace(/\//g, '-');

    results.push(setJsonVersion(pkgPath, 'version', version));
    replaceTgzInConfigs(tgzBase, version);
  }
}

if (fullTarget.startsWith('plugin:')) {
  const pluginName = fullTarget.slice(7);
  const plugin = findPkg(pluginName, allPlugins);
  if (!plugin) {
    console.error(`Plugin "${pluginName}" not found. Available: ${allPlugins.map(d => d.name).join(', ')}`);
    process.exit(1);
  }
  const pkgPath = path.join(plugin.path, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const tgzBase = pkg.name.replace(/^@/, '').replace(/\//g, '-');

  results.push(setJsonVersion(pkgPath, 'version', version));
  replaceTgzInConfigs(tgzBase, version);
}

if (fullTarget === 'agents' || fullTarget === 'all') {
  for (const agent of allAgents) {
    const pkgPath = path.join(agent.path, 'package.json');
    results.push(setJsonVersion(pkgPath, 'version', version));

    const cfgPath = path.join(configsDir, `${agent.name}.json`);
    results.push(setJsonVersion(cfgPath, 'version', version));
  }
}

if (fullTarget.startsWith('agent:')) {
  const agentName = fullTarget.slice(6);
  const agent = findPkg(agentName, allAgents);
  if (!agent) {
    console.error(`Agent "${agentName}" not found. Available: ${allAgents.map(d => d.name).join(', ')}`);
    process.exit(1);
  }
  const pkgPath = path.join(agent.path, 'package.json');
  results.push(setJsonVersion(pkgPath, 'version', version));

  const cfgPath = path.join(configsDir, `${agent.name}.json`);
  results.push(setJsonVersion(cfgPath, 'version', version));
}

const filtered = results.filter(Boolean);
const seen = new Set();
for (const r of filtered) {
  const key = r.file || r.name;
  if (seen.has(key)) continue;
  seen.add(key);
  if (r.file) {
    console.log(`  ${r.file}: ${r.old} → ${r.new}`);
  } else if (r.name) {
    console.log(`  ${r.name}: ${r.old} → ${r.new}`);
  }
}
console.log(`\n${filtered.length} entries updated to ${version}`);
