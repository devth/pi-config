# devth's Pi config

My Pi plugin inventory and portable preferences, with a merge-based bootstrap for other machines. This is **not a copy of `~/.pi`**: credentials, private MCP connections, model endpoints, sessions and caches stay on each machine.

## Set up another machine

On macOS or Linux, install your preferred Pi CLI, Node.js 22+ and Git first. Then:

```sh
git clone https://github.com/devth/pi-config.git ~/pi-config
cd ~/pi-config
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

Run `/reload` in existing Pi sessions afterward. Log in to model providers separately. The bootstrap only supports Pi's default `~/.pi/agent` directory; a nondefault `PI_CODING_AGENT_DIR` is rejected rather than accidentally installing Impeccable elsewhere.

Review the package sources before installing: Pi extensions execute code with your permissions. The setup script is dependency-free; you do not need `npm install` in this repo.

## What's managed

- **`packages.json`**: 27 remote Pi package declarations, retaining the original npm versions, Git refs and resource filters. Existing unpinned entries still resolve to current upstream versions; this is an inventory, not a complete dependency lockfile.
- **`preferences.json`**: high thinking effort, visible thinking, codemode enabled, and the MCP adapter arrangement. No model/provider selection is forced on machines with different accounts.
- **Impeccable 4.8.0**: installed globally using the official `impeccable` CLI, with only the Pi provider and no unsupported design hooks. The skill supplies its design commands and checksummed native engine.

The MCP adapter is retained and Pi's built-in MCP extension is disabled (`-builtin:mcp`) to avoid loading both. **MCP server definitions and credentials are not synchronized.** Configure those separately on each machine.

Package resource selections matter: `pi-system-one` keeps `extensions: []`, and `pi-antigravity` keeps only `src/index.ts`. When a package is already configured, existing filters are retained unless the inventory explicitly supplies a replacement for that filter.

### Local development plugins

If `~/pi-ask-user/package.json` exists, setup keeps that local checkout. Otherwise it installs public `edlsh/pi-ask-user` v0.16.0, pinned to the verified commit recorded in the inventory. The local checkout currently has an unpublished mobile-answering fix on top of that release; this repo neither publishes nor recreates that fix.

`~/dotfiles/pi/clef-router` is optional and is added only if its checkout already exists. It has no published source in this inventory, so this repo cannot recreate it on a clean machine; setup reports the skip. Copy or publish that separate project intentionally before enabling it elsewhere. Its source and machine-local routing policies are **not** copied into this public repo.

Standalone user skills and extensions (for example the local browser skills, `caff`, and response timestamps) remain separately managed. This repo reproduces the package inventory and selected preferences, not every file in the agent directory.

## Safe merging and backups

The installer:

1. Plans required installs without changing files when passed `--dry-run`.
2. Backs up an existing settings file **before the first change**, beside it as `~/.pi/agent/settings.json.backup-<time>-<pid>`, with mode `600`.
3. Uses `pi install` only for missing exact sources. Already-configured packages are not force-updated.
4. Installs Impeccable only if absent. It refuses to overwrite a different or incomplete existing skill installation; review that installation and use the official updater intentionally.
5. Re-reads Pi's settings after package installation, merges managed preferences and filters, retains unrelated keys/packages, and writes atomically. Arrays are additive; managed scalar preferences take precedence. Settings symlinks, including broken links, are refused rather than replaced.

The original settings file is never copied into this checkout. Authentication files are not read or modified. A repeat run with no changes makes no new backup and invokes no installers.

If an upstream installation fails, setup stops. Earlier package installations may remain; it does not pretend to roll them back. Fix the error and rerun, or restore the reported original settings backup after reviewing it. Restoring settings does not uninstall downloaded packages.

## Impeccable

After reloading Pi, use:

```text
/skill:impeccable init
/skill:impeccable critique the landing page
/skill:impeccable polish the settings form
```

Pi's `/skill:impeccable` is the explicit skill command. Impeccable's docs also use `/impeccable` as harness-specific shorthand. Initialization is per project and writes design context; bootstrap does not run it on your behalf.

Official sources: [Impeccable](https://github.com/pbakaus/impeccable), [Pi packages](https://pi.dev/packages).

## Update the inventory

Edit `packages.json` or the deliberately small `preferences.json`, inspect `npm run plan`, then run `npm run setup`. Keep package resource filters when changing sources. Existing entries with the same exact source are not re-downloaded; update those intentionally with Pi's package commands.

Impeccable's CLI version is pinned here, but upstream skill delivery is separate: setup verifies the resulting skill version and reports a mismatch rather than silently accepting another release. Update the version deliberately and review its release notes.

Never commit raw settings, auth/OAuth files, API keys, MCP headers, private model endpoints, session transcripts or caches—even if this repo's ignore rules would miss a new filename.

## Validation

```sh
npm run check
npm test
```

Tests run with isolated temporary homes and stubbed Pi/Impeccable installers. They cover clean setup, resource filters, local overrides, preserving private machine settings, backups, idempotency, dry runs, installation failures and refusing malformed/symlinked settings. They do not claim every third-party plugin was reinstalled or authenticated in CI.
