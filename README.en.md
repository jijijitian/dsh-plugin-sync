# dsh-plugin-sync

Sync DSH bundle inventories across machines through one GitHub-hosted JSON manifest, then auto-install the bundles missing on each host.

## How it works

- Each Host publishes its portable profile bundles to `hosts.<hostId>` in the manifest.
- A sync merges the remote manifest, then installs every missing bundle that is enabled on at least one host.
- Bundles are installed through the official `ctx.pluginManager.installBundle()` path.
- Local paths, `file:`, `link:`, and `workspace:` specs are never published or installed from the manifest.
- Nothing is auto-removed or auto-disabled. Bundle configuration is not synced.

## Setup

Install the plugin from GitHub through the DSH plugin manager:

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

1. Create a GitHub repository (private recommended) for the manifest, for example `owner/dsh-plugin-inventory`.
2. Provide a token with Contents read/write through `GITHUB_TOKEN`, `config.tokenEnv`, `config.tokenFile`, or `config.token`.
3. Configure the plugin row in the profile patch:

```yaml
- id: dsh-plugin-sync
  name: dsh-plugin-sync
  config:
    repo: owner/dsh-plugin-inventory
    branch: main
    path: dsh-plugins.json
    hostId: work-pc
    syncIntervalMinutes: 30
    autoInstall: true
```

4. On every host, run `plugin_sync` with `action: "sync"`.

Every host must install this plugin once. It never publishes or auto-installs itself: a local `link:` source is not portable, and skipping self-installation also avoids reloading the running sync job mid-flight.

Without a token the plugin can still read a public repository and install missing bundles, but cannot push.

## Tool actions

| Action | Behavior |
| --- | --- |
| `status` | Local inventory, config, token state, last run. No network. |
| `pull` | Read and summarize the remote manifest. |
| `push` | Publish this host's inventory only. |
| `install` | Read the remote manifest and install missing bundles. |
| `sync` | Push, merge/read, and install. |

Pass `dryRun: true` to plan without changing the profile; a dry-run `sync` also skips the remote push.

## Security

The remote manifest is trusted input: it selects packages that are installed and executed. Use a private repository and protect the token. The plugin rejects local filesystem specs, never writes the token to disk, and only installs missing bundles.

See [README.md](README.md) for the full Chinese documentation, manifest format, and all configuration keys.
