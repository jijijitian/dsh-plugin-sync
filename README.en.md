# dsh-plugin-sync

Manual GitHub plugin-inventory sync for DeepSeek Harness (DSH). Configure it inside the plugin page, pull the remote manifest, review changes and conflicts, then install only what you select.

> Version 2.0.0 is manual only: no startup sync, interval sync, or plugin-change sync.

## DSH compatibility

This version targets DSH `0.2.1-rc.3` and registers `plugins.bundle.config`, which places the form on the plugin bundle's own page. The Host half has no npm runtime dependencies. Upgrading from the 1.0.0 Host-only version is required to get the new configuration page.

## Install

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

Open **Plugins → Installed plugins → dsh-plugin-sync** after installation. Every host must install this plugin once; it does not install itself.

> **Restart DSH once when upgrading from 1.x or enabling the page for the first time.** DSH's client-modules caches package metadata per Loader entry until the process restarts. If the 1.0 Host-only version was installed first, the 2.1 client half is not discovered until that restart; after that, normal updates only need a page refresh.

## Use

1. **Configure**: repository (`owner/repo`), branch, manifest path, host id, token env var or token file, and the per-apply install limit. Save through the page; DSH writes the profile patch through `configEditor` and reloads the plugin.
2. **Pull**: click **Pull remote manifest**. This only reads GitHub and stores a preview. Nothing is installed.
3. **Resolve conflicts**: each row has a choice:
   - missing remote bundle → use remote or skip;
   - newer remote version → upgrade or keep local;
   - older remote version → keep local by default (never downgrade silently);
   - same version but different source → keep local by default;
   - installed but disabled locally → keep disabled or enable;
   - hosts disagree on version/source → use the highest version, keep local, or skip.
4. **Apply**: only rows set to **use remote** are installed or enabled. The Host calls `pluginManager.installBundle()` / `setBundleEnabled()`. Nothing is removed or disabled. The preview is valid for 10 minutes.
5. **Push**: **Push local inventory** publishes this host's portable profile bundles under `hosts.<hostId>`, after a confirmation. Local paths and `file:`/`link:`/`workspace:` specs are excluded; unchanged content creates no commit.

## Configuration keys

| Key | Default | Meaning |
| --- | --- | --- |
| `repo` | `''` | GitHub `owner/repository` |
| `branch` | `main` | Manifest branch |
| `path` | `dsh-plugins.json` | Manifest path in the repository |
| `hostId` | hostname | Host key in the manifest |
| `tokenEnv` | `GITHUB_TOKEN` | Environment variable holding the token |
| `tokenFile` | `''` | File holding the token, supports `~` |
| `maxInstallsPerRun` | `20` | Maximum installs/enables per apply |
| `token` | `''` | Legacy direct token; preserved but not exposed or editable in the page |
| `apiBaseUrl` | `https://api.github.com` | API endpoint; not editable in the page |

A token is required to push. Preview works against public repositories without one.

## Security

The remote manifest is trusted input because it selects packages that run with your permissions. Use a private manifest repository and protect the token. The plugin rejects local filesystem specs, never returns the token to the browser, never writes it into the manifest or state file, and never auto-removes or auto-downgrades plugins.

## Development

```bash
node --test
```

Tests cover manifest merging, conflict-aware preview classification, config read/write and token hiding, selective apply, push/unchanged behavior, invalid remote JSON, and tool rendering.

See [README.md](README.md) for the full Chinese documentation and conflict table.
