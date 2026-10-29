import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'packages.json')));
const preferences = JSON.parse(readFileSync(path.join(root, 'preferences.json')));
const source = entry => typeof entry === 'string' ? entry : entry.source;

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'pi-config-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agent = path.join(home, '.pi', 'agent');
  const bin = path.join(home, 'bin');
  mkdirSync(agent, { recursive: true });
  mkdirSync(bin);
  const calls = path.join(home, 'calls.jsonl');
  const stub = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const home = process.env.HOME;
fs.appendFileSync(process.env.CALLS, JSON.stringify([path.basename(process.argv[1]), ...args]) + '\\n');
if (process.env.FAIL_PI && path.basename(process.argv[1]) === 'pi') process.exit(7);
if (path.basename(process.argv[1]) === 'pi') {
  const file = path.join(home, '.pi/agent/settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  settings.packages = [...(settings.packages || []), args[1]];
  fs.writeFileSync(file, JSON.stringify(settings));
} else {
  const dir = path.join(home, '.pi/agent/skills/impeccable');
  fs.mkdirSync(path.join(dir, 'scripts'), {recursive:true});
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\\nname: impeccable\\nversion: ' + (process.env.BAD_SKILL_VERSION || '${manifest.impeccable.version}') + '\\n---\\n');
  if (!process.env.MISSING_SKILL_SCRIPT) fs.writeFileSync(path.join(dir, 'scripts/impeccable'), '#!/bin/sh\\n');
  if (process.env.COLLIDE_TEMP) fs.writeFileSync(path.join(home, '.pi/agent/settings.json.tmp-' + process.ppid), 'pre-existing-file');
}
`;
  // Extensionless scripts run as CommonJS unless their containing directory is ESM.
  writeFileSync(path.join(bin, 'package.json'), '{"type":"module"}');
  for (const name of ['pi', 'npx']) writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
  const settings = path.join(agent, 'settings.json');
  const run = (args = [], extraEnv = {}) => spawnSync(process.execPath, [path.join(root, 'scripts/install.mjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, PATH: bin + path.delimiter + process.env.PATH, CALLS: calls, ...extraEnv },
  });
  const installed = () => JSON.parse(readFileSync(settings));
  const commands = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { home, agent, settings, run, installed, commands };
}

test('dry run plans the install without creating settings or invoking installers', t => {
  const f = fixture(t);
  const result = f.run(['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /impeccable/i);
  assert.match(result.stdout, /optional.*clef-router/i);
  assert.equal(existsSync(f.settings), false);
  assert.deepEqual(f.commands(), []);
});

test('settings symlinks, including dangling links, are left untouched', t => {
  const f = fixture(t);
  const target = path.join(f.home, 'not-created.json');
  symlinkSync(target, f.settings);
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(target), false);
  assert.deepEqual(f.commands(), []);
});

test('a different existing Impeccable version is not overwritten', t => {
  const f = fixture(t);
  const folder = path.join(f.agent, 'skills/impeccable');
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'SKILL.md');
  writeFileSync(file, 'version: 0.0.1');
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(file, 'utf8'), 'version: 0.0.1');
  assert.deepEqual(f.commands(), []);
});

test('fresh install applies all remote packages, filters, preferences and global Impeccable', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const installed = f.installed();
  assert.deepEqual(installed.packages, manifest.packages);
  for (const [key, value] of Object.entries(preferences)) assert.deepEqual(installed[key], value);
  assert.equal(f.commands().filter(c => c[0] === 'pi').length, manifest.packages.length);
  const impeccable = f.commands().find(c => c[0] === 'npx');
  assert.deepEqual(impeccable, ['npx', '--yes', `impeccable@${manifest.impeccable.version}`, 'install', '--providers=pi', '--scope=global', '--yes', '--no-hooks']);
});

test('merges private machine settings, retains local plugins, backs up privately and is idempotent', t => {
  const f = fixture(t);
  const askSource = Object.keys(manifest.localOverrides)[0];
  const askPath = path.join(f.home, 'pi-ask-user');
  const clef = path.join(f.home, 'dotfiles/pi/clef-router');
  for (const dir of [askPath, clef]) { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'package.json'), '{}'); }
  const existing = { packages: ['npm:unrelated-plugin', askPath, clef], extensions: ['./custom-extension.ts'], machinePrivate: 'private-fixture-value', customNested: { keep: true } };
  const original = JSON.stringify(existing, null, 2);
  writeFileSync(f.settings, original);
  const auth = path.join(f.agent, 'auth.json');
  writeFileSync(auth, 'untouched-fixture');
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.installed().machinePrivate, existing.machinePrivate);
  assert.deepEqual(f.installed().customNested, existing.customNested);
  assert.ok(f.installed().extensions.includes('./custom-extension.ts'));
  assert.ok(f.installed().packages.includes(askPath));
  assert.ok(!f.installed().packages.some(p => source(p) === askSource));
  assert.ok(!f.commands().some(c => c.includes(askSource)));
  assert.equal(readFileSync(auth, 'utf8'), 'untouched-fixture');
  assert.ok(!result.stdout.includes(existing.machinePrivate));
  const backups = readdirSync(f.agent).filter(n => n.startsWith('settings.json.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(f.agent, backups[0]), 'utf8'), original);
  assert.equal(statSync(path.join(f.agent, backups[0])).mode & 0o777, 0o600);
  const first = readFileSync(f.settings, 'utf8');
  const callCount = f.commands().length;
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.commands().length, callCount);
  assert.equal(readFileSync(f.settings, 'utf8'), first);
  assert.equal(readdirSync(f.agent).filter(n => n.startsWith('settings.json.backup-')).length, 1);
});

test('installer failure stops without overwriting preferences and retains the original backup', t => {
  const f = fixture(t);
  const original = '{"defaultThinkingLevel":"low","machinePrivate":"keep"}';
  writeFileSync(f.settings, original);
  const result = f.run([], { FAIL_PI: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.settings, 'utf8'), original);
  const backups = readdirSync(f.agent).filter(n => n.startsWith('settings.json.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(f.agent, backups[0]), 'utf8'), original);
  assert.equal(f.commands().length, 1);
});

test('a wrong or incomplete new Impeccable install does not apply preferences', t => {
  for (const env of [{ BAD_SKILL_VERSION: `${manifest.impeccable.version}-unexpected` }, { MISSING_SKILL_SCRIPT: '1' }]) {
    const f = fixture(t);
    const original = JSON.stringify({ packages: manifest.packages, defaultThinkingLevel: 'low' });
    writeFileSync(f.settings, original);
    const result = f.run([], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected skill version and launcher/);
    assert.equal(readFileSync(f.settings, 'utf8'), original);
    assert.equal(f.commands().length, 1);
  }
});

test('a pre-existing temporary file is neither overwritten nor removed', t => {
  const f = fixture(t);
  const original = JSON.stringify({ packages: manifest.packages, defaultThinkingLevel: 'low' });
  writeFileSync(f.settings, original);
  assert.notEqual(f.run([], { COLLIDE_TEMP: '1' }).status, 0);
  assert.equal(readFileSync(f.settings, 'utf8'), original);
  const temps = readdirSync(f.agent).filter(n => n.startsWith('settings.json.tmp-'));
  assert.equal(temps.length, 1);
  assert.equal(readFileSync(path.join(f.agent, temps[0]), 'utf8'), 'pre-existing-file');
});

test('invalid existing JSON is not overwritten', t => {
  const f = fixture(t);
  writeFileSync(f.settings, '{broken');
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(f.settings, 'utf8'), '{broken');
  assert.deepEqual(f.commands(), []);
});
