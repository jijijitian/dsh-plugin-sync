# dsh-plugin-sync

通过一个私有 **GitHub Gist** 在不同主机之间同步 DeepSeek Harness（DSH）的插件清单：

- 在 DSH 的 **插件页** 直接修改本插件配置；
- 第一次点击 **创建 Gist 并推送**，插件自动创建私有 Gist；
- 其他主机只需填写同一个 **Gist 名称**，不需要再建仓库；
- 点击 **拉取线上清单**，预览冲突和变更，再由你选择是否应用；
- 需要上传本机清单时，手动点击 **推送本机清单**。

> 2.0.0 起只做手动同步，不再启动自动同步、定时同步或插件变化自动同步。2.2.0 起清单存储从 GitHub 仓库改为私有 Gist。2.4.0 起按 **Gist 名称** 查找，默认名称 `dsh-plugin-sync`，不存在时首次推送自动创建。

## 当前版本与 DSH 兼容性

本版本面向 DSH `0.2.1-rc.3` 的插件页配置槽位：

- `plugins.bundle.config` — 在插件包详情页内嵌本插件的配置和同步面板。

插件本身没有 npm 运行时依赖。DSH 从 `0.2.1-rc.2` 升到 `0.2.1-rc.3` 后，旧版的 Host 工具和同步逻辑仍然可用，但旧版没有配置页面；2.x 补上了新页面的配置/预览/冲突处理。

## 安装

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

安装后打开 **插件 → 已安装插件 → dsh-plugin-sync**，即可看到配置与手动同步面板。每台主机都需要先安装一次本插件；它不会自动安装自己。

> **从 1.x 升级或首次启用页面时请重启 DSH。** DSH 的 client-modules 会按 Loader 条目缓存包元数据直到进程重启；如果先安装过没有 `dsh.client` 的 1.0，再安装 2.x，页面不会立即出现配置面板，重启一次后才会扫描到新的客户端半。之后普通刷新页面即可。

## GitHub Token

Gist 需要 GitHub token：

- 经典 token 需要 **`gist`** scope；
- 当前 fine-grained token 对 Gist 的支持有限，建议使用 classic token；
- 在插件页的 **GitHub Token** 输入框填写即可，token 会保存到 DSH 的凭据服务，不写入插件配置文件；
- 首次填写时点击 **如何获取 Token**，会先显示所需权限和操作步骤，再提供 **打开 GitHub Token 页面** 的链接；链接已预填描述和 `gist` 权限；
- 如果已有环境变量 `GITHUB_TOKEN`，页面会显示“已配置”，可以留空不修改。

没有 token 时可以读取可访问的 Gist 并预览，但不能创建或推送。

## 使用

### 1. 第一台主机：创建 Gist

在插件页填写 **GitHub Token**，保持 **Gist 名称** 为默认的 `dsh-plugin-sync`，点击 **创建 Gist 并推送本机清单**。

插件会：

1. 创建一个 **secret Gist**（不是 public gist）；
2. 写入默认文件名 `dsh-plugins.json`；
3. 把本机可移植的 profile bundle 清单写入 `hosts.<hostId>`；
4. 把 Gist 名称和 ID 写入本机状态；
5. 在页面上显示 Gist 名称、ID 和 URL。

把 Gist 名称告诉其他主机即可（同一 GitHub 账号下会按名称查找）。

### 2. 其他主机：填写 Gist 名称

在 **Gist 名称** 中填写同一个名称（默认 `dsh-plugin-sync`），保存配置，然后点击 **拉取线上清单**。插件会用当前 token 搜索该账号下同名 Gist；找不到时，首次推送会自动创建。

不需要创建仓库，也不需要创建新的 Gist。

### 3. 预览、冲突与确认

点击 **拉取线上清单** 只读取 Gist，不安装任何东西。页面会显示：

- 线上主机数、插件记录数；
- 缺失、升级、降级、来源变更、启用、本机独有；
- 冲突数量、来源主机和每个条目的推荐选择。

默认冲突规则：

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

只有选择 **使用线上** 的条目会在点击 **应用同步** 时执行。预览快照保留 10 分钟，过期后重新拉取。

### 4. 应用同步

点击 **应用同步** 后，Host 会：

- 对安装/升级/来源变更条目调用官方 `ctx.pluginManager.installBundle()`；
- 对启用条目调用 `ctx.pluginManager.setBundleEnabled()`；
- 不卸载、不自动禁用本机已有插件；
- 最多处理 `maxInstallsPerRun` 项。

可能出现 `restart-required`，按 DSH 提示重启宿主。

### 5. 推送本机清单

已有 Gist 时，点击 **推送本机清单** 会更新 Gist 中的清单文件；需要二次确认。

- 同一主机重新推送会覆盖自己的 `hosts.<hostId>` 记录，不覆盖其他主机。
- 内容没有变化时不会更新 Gist。
- 使用 Gist 的版本号做并发检查：先读远端版本，写入前再比较，不同则重新合并重试，最多 3 次。GitHub 的 Gist 更新接口不接受 `If-Match` 等条件请求头，发送它会返回 `400 Bad Request`，因此不能用 ETag 做条件请求。

## 配置项

插件页只保留两个输入：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `Gist 名称` | `dsh-plugin-sync` | 默认读取该名称；可自行修改。首次推送找不到时自动创建。同一 GitHub 账号的其他主机填写相同名称 |
| `GitHub Token` | — | 仅写入 DSH 凭据服务；已配置时可留空 |

其余参数使用固定默认值，不再要求填写：

- 文件名：`dsh-plugins.json`
- 描述：`DSH plugin inventory`
- 主机标识：主机名
- 单次最多安装：20
- GitHub API：`https://api.github.com`

如果从旧版本保留了隐藏字段（文件名、主机标识等），保存配置时会继续保留；页面不再展示。

## 清单格式

仍然是原来的主机清单，只是存储在 Gist 文件里：

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

## 从 2.1 的仓库配置迁移

2.2.0 不再读取 `repo` / `branch` / `path`。已有配置里的这些字段在保存配置时会被移除，界面改为 Gist。迁移步骤：

1. 更新插件并重启 DSH；
2. 在插件页填写 token 来源；
3. 保持默认名称 `dsh-plugin-sync`，或填写已有 Gist 的名称，点击 **创建 Gist 并推送**；
4. 其他主机填写同一个 Gist 名称。

## 安全边界

- Gist 是 **secret**，但仍然是通过 URL 可访问的；不要把 Gist URL 和 token 一起公开。
- 远端清单是可信输入：它决定安装哪些 npm/GitHub 包，等同于执行第三方代码。请保护 Gist 和 token。
- 只接受可移植 spec，拒绝本机路径、`file:`、`link:`、`workspace:`、盘符路径和包含 `..` 的路径。
- Token 不写入清单、Gist 或插件配置文件；页面输入会写入 DSH 凭据服务。
- 配置 API 只允许修改 Gist 名称，以及把 Token 写入凭据服务；不允许通过页面改 `apiBaseUrl`/token 本体。
- 只安装用户选择的条目；不自动卸载、禁用或降级本机已有插件。
- 不执行自动同步：没有启动同步、定时器或插件变化监听。

## 开发与验证

```bash
node --test
```

测试覆盖：

- Gist 读取、创建、更新、ETag 冲突、缺失 Gist、截断内容回退；
- 清单规范化、主机合并、版本选择、主机冲突变体；
- 安装/升级/降级/来源变更/启用/本机独有的预览分类；
- 配置读取、保存、token 隐藏、Gist 名称规范化；
- 预览后按选择安装、默认选择安装、无 token 只读同步；
- 推送、内容不变跳过、非法远端 JSON 不覆盖；
- 工具结果渲染和客户端注册。

## 已知边界

- 只同步 bundle 的安装清单，不迁移插件配置、模型或凭据。
- 只处理有 bundle patch 的插件；纯依赖不会成为清单条目。
- 预览快照只保存在 Host 内存中，插件重载或 10 分钟后失效。
- Gist API 没有仓库 Contents API 的强原子更新；本插件用 ETag/版本检查降低并发覆盖窗口，但仍建议各主机避免同时推送。
- 安装依赖 DSH 的 pnpm 路径；缺失时结果会给出 `pnpm-missing`。
