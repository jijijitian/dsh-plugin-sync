# dsh-plugin-sync

通过 GitHub 上一个 JSON 清单，在不同主机之间同步 DeepSeek Harness（DSH）的插件（bundle）清单，并根据同步结果自动安装本机缺失的插件。

它解决的是多台机器上的重复安装问题：每台机器把自己**可移植**的插件清单推到同一个 GitHub 文件，再拉取所有主机的并集，安装自己还没装、且至少在一台主机上启用的 bundle。

## 它做什么

- **推送本机清单**：从 `ctx.pluginManager.listBundles()` 读取本机已安装的 profile bundle，只保留可移植的安装来源，写入 GitHub 仓库中的清单文件。
- **拉取并合并**：清单以主机为键保存；同一主机重新推送会覆盖自己的记录，不会覆盖其他主机。
- **自动补装**：合并后找出本机缺失、且至少在一台主机上启用的 bundle，通过 DSH 官方 `ctx.pluginManager.installBundle()` 逐个安装。
- **不自动卸载**：只增不删。某台主机禁用或移除插件，不会导致其他主机被卸载。
- **只同步安装清单，不同步配置**：模型、API key、插件私有配置等仍留在各自主机的 `cordis.patch.yml` 中。
- **自动运行**：默认启动后延迟同步一次，也可配置周期同步；插件管理器发生变化后会去抖同步。
- **工具入口**：注册 `plugin_sync` 工具，支持 `status` / `pull` / `push` / `install` / `sync`。

## 安装

在这个仓库目录中，由 DSH 的插件管理器安装：

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

也可以使用本目录的绝对路径安装，便于本地开发。远程安装后再修改 `config.repo` 指向你自己的清单仓库即可。

安装后，插件管理器里会出现 **插件同步 / Plugin Sync**，工具列表中会出现 `plugin_sync`。

> 每台主机都要先各自安装一次本插件。它不会把 **自己** 写进清单，也不会自动安装/升级自己：本地 `link:` 来源本来就不是可移植 spec，跳过自身也能避免安装过程中重载正在运行的同步任务。

## 配置

推荐在 profile 的 `cordis.patch.yml` 中覆盖该行的 `config`。注意 Loader 的覆盖是**整段替换**，不是深合并，所以要把需要的字段一起写上：

```yaml
- id: dsh-plugin-sync
  name: dsh-plugin-sync
  config:
    repo: your-name/dsh-plugin-inventory
    branch: main
    path: dsh-plugins.json
    hostId: work-pc
    autoSyncOnStart: true
    syncIntervalMinutes: 30
    autoInstall: true
```

最少只需要 `repo`。`hostId` 默认取主机名，同一个主机名下的多个 DSH profile 会共用一条记录；同一台机器跑多个 profile 又想分开时，显式设置 `hostId`。

### GitHub 仓库与令牌

1. 建一个仓库（建议 **private**），用来放清单文件。例如 `your-name/dsh-plugin-inventory`。
2. 生成有该仓库 **Contents: Read and write** 权限的 fine-grained token，或经典 token 的 `repo` 权限。
3. 任选一种方式提供 token：
   - 环境变量 `GITHUB_TOKEN`（默认读取这个名字）；
   - `config.tokenEnv` 指定另一个环境变量名；
   - `config.tokenFile` 指向一个只包含 token 的文件，例如 `~/.dsh/github-token`；
   - 直接写 `config.token`（会以 secret 形式出现在配置中，但仍是明文，不推荐）。

没有 token 时插件仍可读取 **public** 仓库并安装，但不能推送。启动日志和 `plugin_sync status` 会显示读/写状态。token 不会写入清单、状态文件或工具输出。

## 使用

### 第一台主机

```text
plugin_sync action=sync
```

它会创建/更新 GitHub 上的清单文件，并把本机可移植 bundle 记录到自己的 `hostId` 下。

### 其他主机

用同样的 `repo` 和目标文件配置插件，调用：

```text
plugin_sync action=sync
```

第二台主机会先推送自己的记录，再拉取合并后的清单，安装本机缺失且启用的 bundle。安装由 pnpm 完成，可能需要数分钟；部分插件安装后显示 `restart-required`，重启宿主后生效。

### 常用动作

| action | 行为 |
| --- | --- |
| `status` | 本地清单、配置、token 状态、上次同步记录；不访问网络 |
| `pull` | 只读远端清单并返回摘要 |
| `push` | 只推送本机清单 |
| `install` | 拉取远端清单并安装缺失项，不推送 |
| `sync` | 推送 + 拉取/合并 + 安装（完整流程） |

`dryRun: true` 可以只看安装计划，不修改 profile；对 `sync` 也不会推送远端清单。

## 清单格式

```json
{
  "schemaVersion": 1,
  "generatedBy": "dsh-plugin-sync",
  "updatedAt": "2026-10-25T00:00:00.000Z",
  "lastWriter": "work-pc",
  "hosts": {
    "work-pc": {
      "hostId": "work-pc",
      "updatedAt": "2026-10-25T00:00:00.000Z",
      "dshVersion": "0.2.1-rc.2",
      "profile": "desktop",
      "platform": "win32",
      "bundles": [
        {
          "name": "dsh-context",
          "spec": "dsh-context@0.74.0",
          "version": "0.74.0",
          "enabled": true
        },
        {
          "name": "dsh-prompt-enhancer",
          "spec": "github:Fishsb/dsh-prompt-enhancer#<commit>",
          "version": "3.4.2",
          "enabled": true
        }
      ]
    }
  }
}
```

合并规则：

- 每个 `hostId` 一条记录，推送时整条替换。
- 同名 bundle 出现在多台主机时，按版本号取最高版本作为安装 spec；版本相同则取较新的主机记录。
- 只要至少一台主机上 `enabled: true`，就视为期望安装。
- 同一名字的 spec 只在本地缺失时使用；不会自动升级已安装的同名 bundle。
- 规范化后会忽略远端清单里无法安全安装的条目（本机路径、`file:`、`link:` 等）。

## 安全边界

- **远端清单是可信输入**：它会触发 npm/GitHub 包安装，等同于执行第三方代码。请使用 private 仓库，并保护好 token。
- 只接受可移植 spec；`file:`、绝对路径、盘符路径、`link:`、`workspace:`、包含 `..` 的路径都会被拒绝，避免把某台机器的本地路径当成安装源。
- 不会把 token 写进清单或状态文件；日志不会打印 token。
- 只安装本机缺失项，不自动卸载或禁用已有插件。
- 自动安装数量受 `maxInstallsPerRun` 限制（默认 8）。

## 配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `repo` | `''` | `owner/repository`；也接受 GitHub URL |
| `branch` | `main` | 清单所在分支 |
| `path` | `dsh-plugins.json` | 清单在仓库中的相对路径 |
| `apiBaseUrl` | `https://api.github.com` | GitHub API 地址，兼容 GitHub Enterprise / 本地 mock |
| `token` | `''` | 直接提供 token，不推荐 |
| `tokenEnv` | `GITHUB_TOKEN` | 从环境变量读取 token |
| `tokenFile` | `''` | 从文件读取 token，支持 `~` |
| `hostId` | 主机名 | 清单中的主机键 |
| `stateFile` | `$DSH_HOME/plugin-sync/state.json` | 本地运行状态文件 |
| `autoSyncOnStart` | `true` | 启动后自动同步 |
| `startupDelayMs` | `8000` | 启动延迟，等待 Host 完成组装 |
| `syncIntervalMinutes` | `0` | 周期同步，0 为关闭 |
| `syncOnPluginChange` | `true` | 插件管理器变化后去抖同步 |
| `changeDebounceMs` | `15000` | 变化去抖窗口 |
| `autoInstall` | `true` | `sync` 时是否安装 |
| `dryRun` | `false` | 默认只计划、不安装 |
| `maxInstallsPerRun` | `8` | 单轮最多安装数量，0 表示只计划 |
| `includeDisabledBundles` | `false` | 是否也安装所有主机都禁用的 bundle |
| `enableExistingBundles` | `false` | 已安装但本机禁用、且远端启用的 bundle 是否自动启用 |
| `excludeBundles` | `[]` | 永远不同步/安装的包名 |
| `allowInsecureHttp` | `false` | 只用于本地 mock：允许非回环地址的 http API |
| `requestTimeoutMs` | `30000` | GitHub API 超时 |

## 开发与验证

```bash
node --test
```

测试覆盖：

- 清单规范化、主机合并、期望安装选择、版本比较；
- 本机路径 spec 的拒绝；
- GitHub Contents API 的读取、创建、sha 更新、冲突重试；
- 使用假 `pluginManager` 的完整 `sync` 流程。

## 已知边界

- 只同步 bundle 的**安装清单**，不迁移插件配置、模型、凭据。
- 只处理有 bundle patch 的插件；纯依赖不会成为清单条目。
- 清单通过 GitHub Contents API 更新，单文件限制 1 MB；正常插件清单远小于该限制。
- 自动安装依赖 DSH 的 pnpm 路径；如果宿主缺少 pnpm，会在结果中看到 `pnpm-missing`。
- 清单是跨机器共享的，冲突时最多重试 3 次；极端并发下最后一次写入者覆盖同一文件的旧版本，但每次都会先合并远端最新内容。
