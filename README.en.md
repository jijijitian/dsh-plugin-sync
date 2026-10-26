# dsh-plugin-sync

Manual plugin-inventory sync for DeepSeek Harness (DSH) through a private **GitHub Gist**. Configure it inside the plugin page, pull the Gist, review changes and conflicts, then install only what you select.

> Version 2.2.0 uses a secret Gist instead of a GitHub repository. Version 2.4.0 looks up by **Gist name** (default `dsh-plugin-sync`) and creates it on first push when missing. Version 2.0.0 is manual only: no startup sync, interval sync, or plugin-change sync.

## DSH compatibility

Targets DSH `0.2.1-rc.3` and registers `plugins.bundle.config`, which places the form on the plugin bundle's own page. The Host half has no npm runtime dependencies.

> **Restart DSH once when upgrading from 1.x or enabling the page for the first time.** DSH's client-modules caches package metadata per Loader entry until the process restarts. After that, normal updates only need a page refresh.

## Install

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

## Use

1. **Token**: enter a classic GitHub token with the `gist` scope in the plugin page. It is stored in DSH's credential service, not in the plugin configuration. On the first fill, click **How to get a token** to see the required permission and steps, then open the prefilled GitHub token page. An existing `GITHUB_TOKEN` environment token is detected and can be left unchanged.
2. **First host**: keep the default **Gist name** `dsh-plugin-sync` and click **Create Gist and push local inventory**. The plugin creates a secret Gist, writes `dsh-plugins.json`, stores the name and ID locally.
3. **Other hosts**: use the same Gist name. The plugin searches the current account by name; no repository or new Gist is needed. If it does not exist, the first push creates it.
4. **Pull**: click **Pull Gist manifest**. This only reads the Gist and stores a 10-minute preview.
5. **Resolve conflicts** per row:
   - missing remote bundle → use remote or skip;
   - newer remote version → upgrade or keep local;
   - older remote version → keep local by default (no silent downgrade);
   - same version but different source → keep local by default;
   - installed but disabled locally → keep disabled or enable;
   - hosts disagree on version/source → use the highest version, keep local, or skip.
6. **Apply**: only rows set to **use remote** are installed or enabled. Nothing is removed or disabled.
7. **Push**: **Push local inventory** updates the Gist after a confirmation. Unchanged content creates no update. The client sends an ETag and retries a conflicting update by merging again.

## Configuration

The page only asks for two inputs:

| Field | Default | Meaning |
| --- | --- | --- |
| Gist name | `dsh-plugin-sync` | Default name; editable. Other hosts on the same account use the same name, and the first push creates it if missing |
| GitHub Token | — | Stored in DSH credentials; leave blank to keep the configured token |

The remaining values use fixed defaults: `dsh-plugins.json`, a fixed Gist description, the hostname as host id, 20 installs per apply, and `https://api.github.com`. Hidden values retained from older configurations are preserved but no longer shown.

## Migration from the 2.1 repository configuration

`repo`, `branch`, and `path` are no longer read and are removed when the configuration is saved. Update the plugin, restart DSH, then keep the default Gist name or enter an existing name.

## Security

The Gist is secret but still reachable by URL; do not publish its ID together with the token. The remote manifest is trusted input because it selects packages that run with your permissions. The plugin rejects local filesystem specs, stores the page token in DSH credentials rather than the plugin config, never returns the token to the browser, never writes it into the manifest/Gist, and never auto-removes or auto-downgrades plugins.

## Development

```bash
node --test
```

Tests cover Gist read/create/update, ETag conflicts, truncated content, manifest merging, conflict-aware preview, config read/write and token hiding, selective apply, push/unchanged behavior, invalid remote JSON, and tool rendering.

See [README.md](README.md) for the full Chinese documentation and conflict table.
