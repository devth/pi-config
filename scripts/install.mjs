#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const home = process.env.HOME || os.homedir();
const agent = path.join(home, '.pi', 'agent');
const settingsFile = path.join(agent, 'settings.json');
const dryRun = process.argv.includes('--dry-run');
const source = entry => typeof entry === 'string' ? entry : entry.source;
const expand = value => value.startsWith('~/') ? path.join(home, value.slice(2)) : value;

function readSettings() {
  let stat;
  try { stat = fs.lstatSync(settingsFile); } catch (error) {
    if (error.code === 'ENOENT') return { raw: null, value: {} };
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error('settings.json is a symlink; merge the preferences manually rather than replacing your link.');
  const raw = fs.readFileSync(settingsFile, 'utf8');
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('settings.json must contain an object.');
  if (value.packages && !Array.isArray(value.packages)) throw new Error('settings.json packages must be an array.');
  return { raw, value };
}

function mergePreferences(current, preferred) {
  const next = { ...current };
  for (const [key, value] of Object.entries(preferred)) {
    if (Array.isArray(value)) next[key] = [...new Set([...(current[key] || []), ...value])];
    else if (value && typeof value === 'object') next[key] = mergePreferences(current[key] || {}, value);
    else next[key] = value;
  }
  return next;
}

function mergeSettings(current, packages, preferences) {
  const next = mergePreferences(current, preferences);
  next.packages = [...(current.packages || [])];
  for (const entry of packages) {
    const index = next.packages.findIndex(p => source(p) === source(entry));
    if (index < 0) next.packages.push(entry);
    else if (typeof entry !== 'string') {
      const previous = next.packages[index];
      next.packages[index] = { ...(typeof previous === 'string' ? {} : previous), ...entry };
    }
  }
  return next;
}

function skillReady(skill, version) {
  const file = path.join(skill, 'SKILL.md');
  return fs.existsSync(file)
    && fs.readFileSync(file, 'utf8').match(/^version:\s*["']?([^\s"']+)/m)?.[1] === version
    && fs.existsSync(path.join(skill, 'scripts', 'impeccable'));
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, DO_NOT_TRACK: '1' } });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.error?.code || result.status}); stopped. Installed packages may remain; fix the error and rerun, or restore your settings backup.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/install.mjs [--dry-run]\nInstalls Pi packages and global Impeccable, then merges portable preferences. Requires Pi and Node 22+.');
    return;
  }
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Unknown option; use --help.');
  if (process.env.PI_CODING_AGENT_DIR && path.resolve(process.env.PI_CODING_AGENT_DIR) !== agent) {
    throw new Error('This bootstrap supports the default ~/.pi/agent directory only; unset PI_CODING_AGENT_DIR or configure the custom directory manually.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages.json'), 'utf8'));
  const preferences = JSON.parse(fs.readFileSync(path.join(root, 'preferences.json'), 'utf8'));
  const initial = readSettings();
  const packages = manifest.packages.map(entry => {
    const local = manifest.localOverrides?.[source(entry)];
    if (!local || !fs.existsSync(path.join(expand(local), 'package.json'))) return entry;
    return typeof entry === 'string' ? expand(local) : { ...entry, source: expand(local) };
  });
  for (const local of manifest.optionalLocalPackages || []) {
    if (fs.existsSync(path.join(expand(local), 'package.json'))) packages.push(expand(local));
    else console.log(`Skip optional local package: ${local} (checkout not present)`);
  }
  const missing = packages.filter(entry => !(initial.value.packages || []).some(p => source(p) === source(entry)));
  const skill = path.join(agent, 'skills', 'impeccable');
  const installSkill = !fs.lstatSync(skill, { throwIfNoEntry: false });
  if (!installSkill && !skillReady(skill, manifest.impeccable.version)) {
    throw new Error(`Existing Impeccable differs from ${manifest.impeccable.version}; review it and use the official update command before rerunning. No files changed.`);
  }
  for (const entry of missing) console.log(`Install Pi package: ${source(entry)}`);
  console.log(`${installSkill ? 'Install' : 'Already installed'} global Impeccable ${manifest.impeccable.version}`);
  const proposed = mergeSettings(initial.value, packages, preferences);
  const settingsChange = JSON.stringify(proposed) !== JSON.stringify(initial.value);
  if (dryRun) {
    console.log(`Dry run: ${missing.length} package installs; portable preferences ${settingsChange ? 'will be merged' : 'already match'}. No files changed.`);
    return;
  }
  if (missing.length || installSkill || settingsChange) {
    fs.mkdirSync(agent, { recursive: true, mode: 0o700 });
    if (initial.raw !== null) {
      const backup = `${settingsFile}.backup-${Date.now()}-${process.pid}`;
      fs.writeFileSync(backup, initial.raw, { flag: 'wx', mode: 0o600 });
      console.log(`Settings backup: ${backup}`);
    }
  }
  for (const entry of missing) run(process.platform === 'win32' ? 'pi.cmd' : 'pi', ['install', source(entry)]);
  if (installSkill) {
    run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', `impeccable@${manifest.impeccable.version}`, 'install', '--providers=pi', '--scope=global', '--yes', '--no-hooks']);
    if (!skillReady(skill, manifest.impeccable.version)) throw new Error('Impeccable did not install the expected skill version and launcher; portable preferences were not written.');
  }
  // Pi's own installer updates settings. Re-read so its changes and unrelated keys survive.
  const current = readSettings();
  const next = mergeSettings(current.value, packages, preferences);
  if (JSON.stringify(next) !== JSON.stringify(current.value)) {
    const temp = `${settingsFile}.tmp-${process.pid}`;
    let createdTemp = false;
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      createdTemp = true;
      if (readSettings().raw !== current.raw) throw new Error('Settings changed concurrently; refusing to overwrite. Rerun when the other writer is finished.');
      fs.renameSync(temp, settingsFile);
    } finally {
      if (createdTemp && fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  console.log('Pi setup ready. Run /reload in existing Pi sessions. Provider logins and private MCP configuration remain machine-local.');
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
