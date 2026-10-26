window.__ModuleLoader__.load({
  id: 'dsh-plugin-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-plugin-sync'

    const zh = {
      summary: '配置 GitHub 清单，手动拉取并应用插件变更。',
      configTitle: 'GitHub 清单配置',
      configHint: '保存后会重新加载插件。仓库建议使用 private 仓库。',
      fieldRepo: '仓库',
      fieldRepoHint: 'owner/repository，例如 jijijitian/dsh-plugin-inventory',
      fieldBranch: '分支',
      fieldPath: '清单路径',
      fieldHostId: '主机标识',
      fieldHostIdHint: '默认使用主机名；留空则使用默认值。',
      fieldTokenEnv: 'Token 环境变量',
      fieldTokenEnvHint: '从该环境变量读取 GitHub token。',
      fieldTokenFile: 'Token 文件',
      fieldTokenFileHint: '也可以指向只包含 token 的文件，例如 ~/.dsh/github-token。',
      fieldMaxInstalls: '单次最多安装',
      save: '保存配置',
      saving: '保存中…',
      saved: '已保存，插件正在重新加载。',
      configUnavailable: '当前 Host 没有可用的配置编辑器，无法保存配置。',
      tokenConfigured: 'Token 已配置（{source}）',
      tokenMissing: '未配置 Token：可预览公开仓库，但不能推送。',
      repoMissing: '请先填写仓库并保存。',
      localInfo: '本机 {profile} 个插件，其中 {portable} 个可移植。',
      manualTitle: '手动同步',
      manualHint: '点击“拉取线上清单”后，先预览变更和冲突；只有点击“应用同步”才会安装。不会自动同步。',
      pull: '拉取线上清单',
      pulling: '正在拉取…',
      refresh: '重新拉取',
      apply: '应用同步',
      applying: '正在应用…',
      discard: '放弃预览',
      noChanges: '没有需要应用的变更。',
      conflictCount: '{count} 个冲突',
      actionableCount: '{count} 项可执行',
      previewSummary: '线上 {hosts} 台主机 / {bundles} 条插件记录；{actionable} 项可执行，{conflicts} 个冲突。',
      conflictRules: '冲突处理：只增不删；线上版本更高时默认升级；线上更低或同版本不同来源时默认保留本机；主机之间版本冲突时默认采用最高版本，可逐项修改。',
      kindInstall: '缺失',
      kindUpgrade: '升级',
      kindDowngrade: '降级',
      kindSpec: '来源变更',
      kindEnable: '启用',
      kindCurrent: '已一致',
      kindLocalOnly: '本机独有',
      kindRemoteOff: '线上停用',
      conflictHosts: '不同主机的版本或来源不一致',
      conflictDowngrade: '线上版本低于本机',
      conflictSpec: '版本相同但来源不同',
      conflictEnable: '本机已安装但停用',
      choiceRemote: '使用线上版本',
      choiceRemoteHighest: '使用线上最高版本',
      choiceEnable: '启用',
      choiceLocal: '保留本机',
      choiceKeepDisabled: '保持停用',
      choiceSkip: '跳过',
      localVersion: '本机 {version}',
      remoteVersion: '线上 {version}',
      notInstalled: '未安装',
      sourceHosts: '来源主机：{hosts}',
      sameVersion: '同一版本',
      applyOk: '同步完成：安装/启用 {applied} 项，失败 {failed} 项。',
      applyPartial: '同步完成，但有 {failed} 项失败。',
      appliedTitle: '已应用',
      failedTitle: '失败',
      skippedTitle: '跳过',
      restartRequired: '需要重启生效',
      pushTitle: '云端清单',
      pushHint: '把本机可移植的插件清单推送到 GitHub，供其他主机手动拉取。',
      push: '推送本机清单',
      pushConfirm: '推送会更新远程清单文件，确认推送？',
      pushConfirmButton: '确认推送',
      pushCancel: '取消',
      pushing: '正在推送…',
      pushPushed: '已推送（{commit}）',
      pushUnchanged: '云端清单已是最新。',
      lastPreview: '上次拉取：{time}',
      lastApply: '上次应用：{time}',
      lastPush: '上次推送：{time}',
      never: '从未',
      loadFailed: '读取插件状态失败：{message}',
      actionFailed: '操作失败：{message}',
      loading: '正在读取…',
      close: '关闭',
      dismiss: '知道了',
      notConfigured: '未配置',
      configured: '已配置',
    }

    const en = {
      summary: 'Configure the GitHub manifest and pull/apply plugin changes manually.',
      configTitle: 'GitHub manifest',
      configHint: 'Saving reloads the plugin. A private repository is recommended.',
      fieldRepo: 'Repository',
      fieldRepoHint: 'owner/repository, for example jijijitian/dsh-plugin-inventory',
      fieldBranch: 'Branch',
      fieldPath: 'Manifest path',
      fieldHostId: 'Host id',
      fieldHostIdHint: 'Defaults to the hostname; leave blank to use the default.',
      fieldTokenEnv: 'Token env var',
      fieldTokenEnvHint: 'Read the GitHub token from this environment variable.',
      fieldTokenFile: 'Token file',
      fieldTokenFileHint: 'Or point to a file containing only the token, for example ~/.dsh/github-token.',
      fieldMaxInstalls: 'Max installs per apply',
      save: 'Save configuration',
      saving: 'Saving…',
      saved: 'Saved. The plugin is reloading.',
      configUnavailable: 'This Host has no configuration editor, so the configuration cannot be saved.',
      tokenConfigured: 'Token configured ({source})',
      tokenMissing: 'No token: public repositories can be previewed, but push is unavailable.',
      repoMissing: 'Set a repository and save first.',
      localInfo: '{profile} local bundles, {portable} portable.',
      manualTitle: 'Manual sync',
      manualHint: 'Pull the remote manifest, review changes and conflicts, then click Apply. Nothing installs until you apply. There is no automatic sync.',
      pull: 'Pull remote manifest',
      pulling: 'Pulling…',
      refresh: 'Pull again',
      apply: 'Apply sync',
      applying: 'Applying…',
      discard: 'Discard preview',
      noChanges: 'There are no changes to apply.',
      conflictCount: '{count} conflict(s)',
      actionableCount: '{count} actionable',
      previewSummary: 'Remote: {hosts} host(s) / {bundles} bundle record(s); {actionable} actionable, {conflicts} conflict(s).',
      conflictRules: 'Conflict policy: only add or upgrade; a newer remote version is selected by default; an older remote version or a same-version/different-source entry keeps the local copy; host disagreements default to the highest version. Each row can be changed.',
      kindInstall: 'Missing',
      kindUpgrade: 'Upgrade',
      kindDowngrade: 'Downgrade',
      kindSpec: 'Source change',
      kindEnable: 'Enable',
      kindCurrent: 'Current',
      kindLocalOnly: 'Local only',
      kindRemoteOff: 'Remote off',
      conflictHosts: 'Hosts disagree on version or source',
      conflictDowngrade: 'Remote version is older',
      conflictSpec: 'Same version, different source',
      conflictEnable: 'Installed but disabled locally',
      choiceRemote: 'Use remote version',
      choiceRemoteHighest: 'Use highest remote version',
      choiceEnable: 'Enable',
      choiceLocal: 'Keep local',
      choiceKeepDisabled: 'Keep disabled',
      choiceSkip: 'Skip',
      localVersion: 'local {version}',
      remoteVersion: 'remote {version}',
      notInstalled: 'not installed',
      sourceHosts: 'Source hosts: {hosts}',
      sameVersion: 'same version',
      applyOk: 'Sync finished: {applied} installed/enabled, {failed} failed.',
      applyPartial: 'Sync finished with {failed} failure(s).',
      appliedTitle: 'Applied',
      failedTitle: 'Failed',
      skippedTitle: 'Skipped',
      restartRequired: 'Restart required',
      pushTitle: 'Remote manifest',
      pushHint: 'Publish this host\'s portable inventory to GitHub so other hosts can pull it.',
      push: 'Push local inventory',
      pushConfirm: 'This updates the remote manifest. Push now?',
      pushConfirmButton: 'Confirm push',
      pushCancel: 'Cancel',
      pushing: 'Pushing…',
      pushPushed: 'Pushed ({commit})',
      pushUnchanged: 'The remote manifest is already up to date.',
      lastPreview: 'Last pull: {time}',
      lastApply: 'Last apply: {time}',
      lastPush: 'Last push: {time}',
      never: 'never',
      loadFailed: 'Could not read plugin status: {message}',
      actionFailed: 'Action failed: {message}',
      loading: 'Loading…',
      close: 'Close',
      dismiss: 'Dismiss',
      notConfigured: 'not configured',
      configured: 'configured',
    }

    const CSS = `
.dsh-ps{box-sizing:border-box;width:100%;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}
.dsh-ps *{box-sizing:border-box}
.dsh-ps-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px;display:flex;flex-direction:column;gap:12px}
.dsh-ps-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dsh-ps-title{margin:0;font-size:15px;line-height:22px;font-weight:600}
.dsh-ps-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dsh-ps-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-ps-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-input{height:32px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:13px}
.dsh-ps-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ps-input:disabled{opacity:.55}
.dsh-ps-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-ps-btn{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.dsh-ps-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-ps-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ps-btn:disabled{opacity:.45;cursor:default}
.dsh-ps-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-ps-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ps-summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-ps-badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}
.dsh-ps-badge.ok{color:var(--dsw-alias-state-success-primary)}
.dsh-ps-badge.warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-ps-badge.error{color:var(--dsw-alias-state-error-primary)}
.dsh-ps-alert{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:13px;line-height:20px}
.dsh-ps-alert.error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ps-ok{color:var(--dsw-alias-state-success-primary);font-size:13px;line-height:20px}
.dsh-ps-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
.dsh-ps-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ps-entry{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-ps-entry-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.dsh-ps-name{font-size:13px;line-height:20px;font-weight:500;overflow-wrap:anywhere}
.dsh-ps-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-ps-conflict{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}
.dsh-ps-variants{display:flex;flex-wrap:wrap;gap:6px}
.dsh-ps-variant{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 6px;overflow-wrap:anywhere}
.dsh-ps-select{height:30px;min-width:132px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px}
.dsh-ps-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ps-confirm{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2)}
.dsh-ps-result{display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:20px}
.dsh-ps-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
@media(max-width:640px){.dsh-ps-grid{grid-template-columns:minmax(0,1fr)}.dsh-ps-entry-head{flex-direction:column;align-items:stretch}.dsh-ps-select{width:100%}}
`

    const FIELDS = [
      { key: 'repo', label: 'fieldRepo', hint: 'fieldRepoHint', placeholder: 'owner/dsh-plugin-inventory' },
      { key: 'branch', label: 'fieldBranch', hint: null, placeholder: 'main' },
      { key: 'path', label: 'fieldPath', hint: null, placeholder: 'dsh-plugins.json' },
      { key: 'hostId', label: 'fieldHostId', hint: 'fieldHostIdHint', placeholder: '' },
      { key: 'tokenEnv', label: 'fieldTokenEnv', hint: 'fieldTokenEnvHint', placeholder: 'GITHUB_TOKEN' },
      { key: 'tokenFile', label: 'fieldTokenFile', hint: 'fieldTokenFileHint', placeholder: '~/.dsh/github-token' },
    ]

    function endpoint(name) {
      return new URL(`dsh-plugin-sync/api/${name}`, document.baseURI).pathname
    }

    async function call(name, { method = 'GET', body } = {}) {
      const response = await fetch(endpoint(name), {
        method,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        const message = typeof data?.error?.message === 'string'
          ? data.error.message
          : typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`
        const error = new Error(message)
        error.code = data?.error?.code
        throw error
      }
      return data
    }

    function kindLabel(kind, t) {
      if (kind === 'install') return t('kindInstall')
      if (kind === 'upgrade') return t('kindUpgrade')
      if (kind === 'downgrade') return t('kindDowngrade')
      if (kind === 'spec-change') return t('kindSpec')
      if (kind === 'enable') return t('kindEnable')
      if (kind === 'current') return t('kindCurrent')
      if (kind === 'local-only') return t('kindLocalOnly')
      if (kind === 'remote-disabled') return t('kindRemoteOff')
      return kind
    }

    function choiceLabel(entry, choice, t) {
      if (choice === 'remote') {
        if (entry.kind === 'enable') return t('choiceEnable')
        if (entry.conflict?.type === 'host-disagreement') return t('choiceRemoteHighest')
        return t('choiceRemote')
      }
      if (choice === 'local') return entry.kind === 'enable' ? t('choiceKeepDisabled') : t('choiceLocal')
      return t('choiceSkip')
    }

    function conflictLabel(conflict, t) {
      if (conflict.type === 'host-disagreement') return t('conflictHosts')
      if (conflict.type === 'downgrade') return t('conflictDowngrade')
      if (conflict.type === 'spec-change') return t('conflictSpec')
      if (conflict.type === 'enable-state') return t('conflictEnable')
      return conflict.type
    }

    function versionLine(entry, t) {
      const local = entry.local?.version ? t('localVersion', { version: entry.local.version }) : t('notInstalled')
      const remote = entry.remote?.version ? t('remoteVersion', { version: entry.remote.version }) : ''
      return remote === '' ? local : `${local} · ${remote}`
    }

    function ConfigField({ field, value, onChange, t, disabled, hintOverride }) {
      const hint = hintOverride ?? (field.hint === null ? null : t(field.hint))
      return h('label', { className: 'dsh-ps-field' },
        h('span', { className: 'dsh-ps-label' }, t(field.label)),
        h('input', {
          className: 'dsh-ps-input',
          type: field.key === 'maxInstallsPerRun' ? 'number' : 'text',
          min: field.key === 'maxInstallsPerRun' ? 1 : undefined,
          max: field.key === 'maxInstallsPerRun' ? 50 : undefined,
          value: value ?? '',
          placeholder: field.placeholder,
          disabled,
          onChange: (event) => onChange(field.key, event.target.value),
        }),
        hint === null ? null : h('span', { className: 'dsh-ps-hint' }, hint),
      )
    }

    function ConfigPage({ t, view }) {
      const [status, setStatus] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [selections, setSelections] = React.useState({})
      const [previewing, setPreviewing] = React.useState(false)
      const [applying, setApplying] = React.useState(false)
      const [applyResult, setApplyResult] = React.useState(null)
      const [confirmPush, setConfirmPush] = React.useState(false)
      const [pushing, setPushing] = React.useState(false)
      const [pushResult, setPushResult] = React.useState(null)

      const loadStatus = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const data = await call('status')
          setStatus(data)
          setDraft(data.configSnapshot?.values ?? {})
        } catch (failure) {
          setError(t('loadFailed', { message: failure.message }))
        } finally {
          setLoading(false)
        }
      }, [t])

      React.useEffect(() => {
        void loadStatus()
      }, [loadStatus])

      if (view === 'summary') return h('span', { className: 'dsh-ps-muted' }, t('summary'))

      const configSnapshot = status?.configSnapshot
      const values = draft ?? configSnapshot?.values ?? {}
      const editable = configSnapshot?.editable === true
      const repo = typeof values.repo === 'string' ? values.repo : ''
      const token = status?.token
      const state = status?.state
      const lastPreview = state?.lastPreviewAt
      const lastApply = state?.lastApplyAt
      const lastPush = state?.lastPushAt

      const updateField = (key, value) => {
        setDraft((current) => ({ ...(current ?? values), [key]: value }))
      }

      const saveConfig = async () => {
        if (!editable) return
        setSaving(true)
        setError(null)
        setMessage(null)
        try {
          await call('config', { method: 'POST', body: { values: draft ?? values } })
          setMessage(t('saved'))
          setTimeout(() => { void loadStatus() }, 1200)
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setSaving(false)
        }
      }

      const pullPreview = async () => {
        setPreviewing(true)
        setError(null)
        setMessage(null)
        setApplyResult(null)
        try {
          const data = await call('preview', { method: 'POST', body: {} })
          const next = {}
          for (const entry of data.entries) next[entry.id] = entry.defaultChoice
          setPreview(data)
          setSelections(next)
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setPreviewing(false)
        }
      }

      const applyPreview = async () => {
        if (preview === null) return
        setApplying(true)
        setError(null)
        setMessage(null)
        try {
          const data = await call('apply', {
            method: 'POST',
            body: { previewId: preview.previewId, selections },
          })
          setApplyResult(data)
          setPreview(null)
          setMessage(data.ok ? t('applyOk', { applied: data.totalApplied, failed: 0 }) : t('applyPartial', { failed: data.failed.length }))
          void loadStatus()
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setApplying(false)
        }
      }

      const pushNow = async () => {
        setPushing(true)
        setError(null)
        setMessage(null)
        try {
          const data = await call('push', { method: 'POST', body: { confirm: true } })
          setPushResult(data)
          setMessage(data.status === 'pushed' ? t('pushPushed', { commit: (data.commit ?? '').slice(0, 12) }) : t('pushUnchanged'))
          setConfirmPush(false)
          void loadStatus()
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setPushing(false)
        }
      }

      const visibleEntries = preview === null ? [] : preview.entries.filter((entry) => (
        entry.defaultChoice === 'remote'
        || entry.conflict !== null
        || ['install', 'upgrade', 'downgrade', 'spec-change', 'enable'].includes(entry.kind)
      ))
      const selectedCount = visibleEntries.filter((entry) => selections[entry.id] === 'remote').length

      if (loading && status === null) {
        return h('div', { className: 'dsh-ps' },
          h('style', null, CSS),
          h('div', { className: 'dsh-ps-card' }, h('p', { className: 'dsh-ps-desc' }, t('loading'))),
        )
      }

      return h('div', { className: 'dsh-ps' },
        h('style', null, CSS),

        h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('configTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('configHint')),
            ),
            h('span', { className: `dsh-ps-badge ${token?.configured ? 'ok' : 'warn'}` },
              token?.configured ? t('tokenConfigured', { source: token.source ?? '' }) : t('tokenMissing')),
          ),
          error === null ? null : h('div', { className: 'dsh-ps-alert error' }, error),
          message === null ? null : h('div', { className: 'dsh-ps-ok' }, message),
          configSnapshot?.editable === false
            ? h('div', { className: 'dsh-ps-alert' }, t('configUnavailable'))
            : null,
          h('div', { className: 'dsh-ps-grid' },
            FIELDS.map((field) => h(ConfigField, {
              key: field.key,
              field,
              t,
              value: values[field.key],
              disabled: !editable || saving,
              hintOverride: field.key === 'hostId' && values.hostIdDefault
                ? `${t('fieldHostIdHint')} (${values.hostIdDefault})`
                : undefined,
              onChange: updateField,
            })),
            h(ConfigField, {
              key: 'maxInstallsPerRun',
              field: { key: 'maxInstallsPerRun', label: 'fieldMaxInstalls', hint: null, placeholder: '20' },
              t,
              value: values.maxInstallsPerRun,
              disabled: !editable || saving,
              onChange: updateField,
            }),
          ),
          h('div', { className: 'dsh-ps-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn primary',
              disabled: !editable || saving,
              onClick: () => { void saveConfig() },
            }, saving ? t('saving') : t('save')),
            status?.local === null || status?.local === undefined
              ? null
              : h('span', { className: 'dsh-ps-muted' }, t('localInfo', {
                  profile: status.local.profileBundles ?? 0,
                  portable: status.local.portableBundles ?? 0,
                })),
          ),
        ),

        h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('manualTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('manualHint')),
            ),
          ),
          h('div', { className: 'dsh-ps-summary' },
            h('span', { className: `dsh-ps-badge ${repo === '' ? 'warn' : 'ok'}` },
              repo === '' ? t('notConfigured') : repo),
            h('span', { className: 'dsh-ps-muted' }, t('lastPreview', { time: lastPreview ?? t('never') })),
            h('span', { className: 'dsh-ps-muted' }, t('lastApply', { time: lastApply ?? t('never') })),
          ),
          h('div', { className: 'dsh-ps-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn primary',
              disabled: previewing || repo === '',
              onClick: () => { void pullPreview() },
            }, previewing ? t('pulling') : (preview === null ? t('pull') : t('refresh'))),
            preview === null ? null : h('button', {
              type: 'button',
              className: 'dsh-ps-btn',
              disabled: previewing || applying,
              onClick: () => { setPreview(null); setApplyResult(null) },
            }, t('discard')),
          ),
          repo === '' ? h('div', { className: 'dsh-ps-alert' }, t('repoMissing')) : null,
          preview === null ? null : h(React.Fragment, null,
            h('div', { className: 'dsh-ps-summary' },
              h('span', { className: 'dsh-ps-badge' }, t('previewSummary', {
                hosts: preview.remote?.hostCount ?? 0,
                bundles: preview.remote?.bundleCount ?? 0,
                actionable: preview.counts?.actionable ?? 0,
                conflicts: preview.counts?.conflicts ?? 0,
              })),
              h('span', { className: `dsh-ps-badge ${preview.counts?.conflicts ? 'warn' : 'ok'}` },
                t('conflictCount', { count: preview.counts?.conflicts ?? 0 })),
              h('span', { className: 'dsh-ps-badge' },
                t('actionableCount', { count: selectedCount })),
            ),
            h('p', { className: 'dsh-ps-hint' }, t('conflictRules')),
            visibleEntries.length === 0
              ? h('p', { className: 'dsh-ps-desc' }, t('noChanges'))
              : h('div', { className: 'dsh-ps-list' },
                  visibleEntries.map((entry) => h('div', { className: 'dsh-ps-entry', key: entry.id },
                    h('div', { className: 'dsh-ps-entry-head' },
                      h('div', null,
                        h('div', { className: 'dsh-ps-name' }, entry.name),
                        h('div', { className: 'dsh-ps-meta' }, versionLine(entry, t)),
                        entry.remote?.hosts?.length
                          ? h('div', { className: 'dsh-ps-meta' }, t('sourceHosts', { hosts: entry.remote.hosts.join(', ') }))
                          : null,
                      ),
                      h('select', {
                        className: 'dsh-ps-select',
                        value: selections[entry.id] ?? entry.defaultChoice,
                        disabled: applying,
                        onChange: (event) => {
                          const value = event.target.value
                          setSelections((current) => ({ ...current, [entry.id]: value }))
                        },
                      }, entry.choices.map((choice) => h('option', { key: choice, value: choice }, choiceLabel(entry, choice, t)))),
                    ),
                    entry.conflict === null ? null : h('div', { className: 'dsh-ps-conflict' }, conflictLabel(entry.conflict, t)),
                    entry.conflict?.type === 'host-disagreement' && entry.remote?.variants?.length
                      ? h('div', { className: 'dsh-ps-variants' },
                          entry.remote.variants.map((variant) => h('span', {
                            className: 'dsh-ps-variant',
                            key: `${variant.hostId}:${variant.spec}`,
                          }, `${variant.hostId}: ${variant.version || variant.spec}`)))
                      : null,
                  )),
                ),
            h('div', { className: 'dsh-ps-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-ps-btn primary',
                disabled: applying || selectedCount === 0,
                onClick: () => { void applyPreview() },
              }, applying ? t('applying') : t('apply')),
              h('span', { className: 'dsh-ps-muted' }, `${selectedCount} / ${visibleEntries.length}`),
            ),
          ),
          applyResult === null ? null : h('div', { className: 'dsh-ps-result' },
            h('div', { className: applyResult.ok ? 'dsh-ps-ok' : 'dsh-ps-error' },
              applyResult.ok
                ? t('applyOk', { applied: applyResult.totalApplied, failed: 0 })
                : t('applyPartial', { failed: applyResult.failed.length })),
            applyResult.applied.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('appliedTitle')),
                  applyResult.applied.map((item) => h('div', { className: 'dsh-ps-meta', key: `a-${item.name}` },
                    `${item.name}${item.restartRequired ? ` — ${t('restartRequired')}` : ''}`)),
                )
              : null,
            applyResult.failed.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('failedTitle')),
                  applyResult.failed.map((item) => h('div', { className: 'dsh-ps-error', key: `f-${item.name}` },
                    `${item.name}: ${item.error ?? item.message ?? ''}`)),
                )
              : null,
            applyResult.skipped.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('skippedTitle')),
                  applyResult.skipped.map((item) => h('div', { className: 'dsh-ps-meta', key: `s-${item.name}` },
                    `${item.name}: ${item.reason}`)),
                )
              : null,
          ),
        ),

        h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('pushTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('pushHint')),
            ),
            h('span', { className: 'dsh-ps-muted' }, t('lastPush', { time: lastPush ?? t('never') })),
          ),
          pushResult === null ? null : h('div', { className: 'dsh-ps-ok' },
            pushResult.status === 'pushed'
              ? t('pushPushed', { commit: (pushResult.commit ?? '').slice(0, 12) })
              : t('pushUnchanged')),
          confirmPush
            ? h('div', { className: 'dsh-ps-confirm' },
                h('span', { className: 'dsh-ps-desc' }, t('pushConfirm')),
                h('div', { className: 'dsh-ps-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-ps-btn danger',
                    disabled: pushing,
                    onClick: () => { void pushNow() },
                  }, pushing ? t('pushing') : t('pushConfirmButton')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-ps-btn',
                    disabled: pushing,
                    onClick: () => { setConfirmPush(false) },
                  }, t('pushCancel')),
                ),
              )
            : h('div', { className: 'dsh-ps-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-ps-btn',
                  disabled: pushing || repo === '' || token?.configured !== true,
                  onClick: () => { setConfirmPush(true) },
                }, pushing ? t('pushing') : t('push')),
              ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-sync: dictionaries')
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-plugin-sync',
          locale: NS,
          inject: () => ({ t }),
        }, ConfigPage))
      },
    }
  },
})
