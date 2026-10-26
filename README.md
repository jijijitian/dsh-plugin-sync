# dsh-plugin-sync

通过 GitHub 上一个 JSON 清单，在不同主机之间同步 DeepSeek Harness（DSH）的插件清单：

- 在 DSH 的 **插件页** 直接修改本插件配置；
- 点击 **拉取线上清单**，预览要安装/升级/启用的插件；
- 检查冲突、逐项选择，再点击 **应用同步**；
- 需要上传本机清单时，手动点击 **推送本机清单**。

> 2.0.0 起只做手动同步，不再启动自动同步、定时同步或插件变化自动同步。

## 当前版本与 DSH 兼容性

本版本面向 DSH `0.2.1-rc.3` 的插件页配置槽位：

- `plugins.bundle.config` — 在插件包详情页内嵌本插件的配置和同步面板；
- `plugins.detail.*` 等新槽位只用于页面扩展，本插件使用 `plugins.bundle.config`。

插件本身没有 npm 运行时依赖；DSH 从 `0.2.1-rc.2` 升到 `0.2.1-rc.3` 后，旧版的 Host 工具和 GitHub 同步逻辑仍然可用，但旧版没有配置页面。2.0.0 补上了新页面的配置/预览/冲突处理，因此需要更新。

## 安装

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

本地开发也可以安装当前目录：

```text
plugin_manager action=install_bundle target=<本目录绝对路径>
```

安装后打开 **插件 → 已安装插件 → dsh-plugin-sync**，即可看到配置与手动同步面板。每台主机都需要先安装一次本插件；它不会自动安装自己。

> **从 1.x 升级或首次启用页面时请重启 DSH。** DSH 的 client-modules 会按 Loader 条目缓存包元数据直到进程重启；如果先安装过没有 `dsh.client` 的 1.0，再安装 2.1，页面不会立即出现配置面板，重启一次后才会扫描到新的客户端半。之后普通刷新页面即可。

## 页面使用

### 1. 配置 GitHub 清单

在插件详情页的 **GitHub 清单配置** 中填写：

| 字段 | 说明 |
| --- | --- |
| 仓库 | `owner/repository`，例如 `your-name/dsh-plugin-inventory` |
| 分支 | 默认 `main` |
| 清单路径 | 默认 `dsh-plugins.json` |
| 主机标识 | 默认使用主机名；留空使用默认值 |
| Token 环境变量 | 默认 `GITHUB_TOKEN` |
| Token 文件 | 也可以指向只包含 token 的文件，例如 `~/.dsh/github-token` |
| 单次最多安装 | 一次应用最多安装/启用多少个 bundle，默认 20 |

点击 **保存配置**。保存通过 DSH 的 `configEditor` 写入 profile 的 `cordis.patch.yml`，由 Loader 正常重载插件；不会直接改 package.json。

Token 不会出现在清单或页面返回值中。没有 token 时可以预览公开仓库，但不能推送。

### 2. 手动拉取与预览

点击 **拉取线上清单**。这个操作只读 GitHub，不会安装任何东西。返回结果包括：

- 线上主机数、插件记录数；
- 本机缺失、可升级、可启用、线上已停用的条目；
- 冲突数量与每个冲突的来源主机；
- 每个条目推荐的默认选择。

### 3. 冲突处理规则

同步默认遵循“只增不删、不自动降级”：

| 情况 | 默认处理 | 可选 |
| --- | --- | --- |
| 本机缺失，线上启用 | 安装线上版本 | 使用线上 / 跳过 |
| 本机版本较低 | 升级到线上版本 | 使用线上 / 保留本机 |
| 本机版本较高 | **保留本机**（不降级） | 保留本机 / 使用线上 / 跳过 |
| 版本相同但来源不同 | **保留本机**（避免来源突换） | 保留本机 / 使用线上 / 跳过 |
| 本机已安装但停用，线上启用 | **保持停用** | 启用 / 保持停用 |
| 多台线上主机版本或来源不一致 | 使用**最高版本** | 使用最高版本 / 保留本机 / 跳过 |
| 只有本机有 | 保留，不处理 | — |
| 线上已停用 | 不自动停用本机 | — |

冲突不会阻塞整个同步：用户在预览列表里逐项选择后，只有选择 `使用线上` 的条目会执行。`应用同步` 前不会再访问 GitHub，使用的是刚才拉取的预览快照；快照 10 分钟后失效，需要重新拉取。

### 4. 应用同步

点击 **应用同步** 后，Host 会：

- 对 `install` / `upgrade` / `spec-change` / `downgrade` 条目调用官方 `ctx.pluginManager.installBundle()`；
- 对 `enable` 条目调用 `ctx.pluginManager.setBundleEnabled()`；
- 不卸载、不自动禁用本机已有插件；
- 最多处理 `maxInstallsPerRun` 项，剩余项在结果中标记为跳过。

安装过程中可能出现 `restart-required`，按 DSH 提示重启宿主即可。

### 5. 推送本机清单

**云端清单** 区域提供 **推送本机清单**，需要二次确认。它会把本机可移植的 profile bundle 清单写入 `hosts.<hostId>`，供其他主机之后手动拉取。

- 只发布可移植的安装来源；本机路径、`file:`、`link:`、`workspace:` 不会发布。
- 同一主机重新推送会覆盖自己的记录，不会覆盖其他主机。
- 内容没有变化时不会创建新 commit。

## 清单格式

```json
{
  "schemaVersion": 1,
  "generatedBy": "dsh-plugin-sync",
  "updatedAt": "2026-10-26T00:00:00.000Z",
  "lastWriter": "work-pc",
  "hosts": {
    "work-pc": {
      "hostId": "work-pc",
      "updatedAt": "2026-10-26T00:00:00.000Z",
      "dshVersion": "0.2.1-rc.3",
      "profile": "desktop",
      "platform": "win32",
      "bundles": [
        {
          "name": "dsh-context",
          "spec": "dsh-context@0.74.0",
          "version": "0.74.0",
          "enabled": true
        }
      ]
    }
  }
}
```

## 安全边界

- 远端清单是可信输入：它决定安装哪些 npm/GitHub 包，等同于执行第三方代码。请使用 private 清单仓库并保护 token。
- 只接受可移植 spec，拒绝本机路径、`file:`、`link:`、`workspace:`、盘符路径和包含 `..` 的路径。
- Token 不写入清单、状态文件或页面返回值；日志不打印 token。
- 配置 API 只允许修改仓库、分支、路径、主机标识、token 来源和单次安装上限，不允许通过页面改 `apiBaseUrl`/token 本体。
- 只安装用户选择的条目；不自动卸载、禁用或降级本机已有插件。
- 不执行自动同步：没有启动同步、定时器或插件变化监听。

## 开发与验证

```bash
node --test
```

测试覆盖：

- 清单规范化、主机合并、版本选择、主机冲突变体；
- 安装/升级/降级/来源变更/启用/本机独有的预览分类；
- 配置读取、保存、token 隐藏和非法仓库拒绝；
- 预览后按选择安装、默认选择安装、无 token 只读同步；
- 推送、内容不变跳过、非法远端 JSON 不覆盖；
- 工具结果渲染和客户端语法检查。

## 已知边界

- 只同步 bundle 的安装清单，不迁移插件配置、模型或凭据。
- 只处理有 bundle patch 的插件；纯依赖不会成为清单条目。
- 预览快照只保存在 Host 内存中，插件重载或 10 分钟后失效。
- 安装依赖 DSH 的 pnpm 路径；缺失时结果会给出 `pnpm-missing`。
- 不做自动升级；已安装的同名 bundle 只会在用户选择线上版本时重新安装。
