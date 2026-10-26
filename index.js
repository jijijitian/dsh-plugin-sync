import { normalizeConfig } from './lib/config.js'
import { registerApiRoutes } from './lib/http.js'
import { createSyncRuntime } from './lib/sync.js'

export { normalizeConfig }

export const name = 'dsh-plugin-sync'
export const inject = ['tools', 'pluginManager']

const ACTIONS = new Set(['status', 'preview', 'apply', 'push'])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summarizeError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  return typeof error.message === 'string' ? error.message : JSON.stringify(error).slice(0, 500)
}

function shortSha(value) {
  return typeof value === 'string' && value.length > 12 ? value.slice(0, 12) : value ?? ''
}

function conflictLabel(type) {
  if (type === 'host-disagreement') return 'hosts disagree'
  if (type === 'downgrade') return 'remote is older'
  if (type === 'spec-change') return 'same version, different source'
  if (type === 'enable-state') return 'installed but disabled locally'
  return type
}

function renderPreview(preview, lines) {
  lines.push(
    `Preview: ${preview.counts.actionable} default action(s), ${preview.counts.conflicts} conflict(s), `
    + `${preview.counts.localOnly} local-only`,
  )
  const visible = preview.entries.filter((entry) => (
    entry.defaultChoice === 'remote'
    || entry.conflict !== null
    || ['install', 'upgrade', 'downgrade', 'spec-change', 'enable'].includes(entry.kind)
  ))
  for (const entry of visible.slice(0, 30)) {
    const localVersion = entry.local?.version ? `local ${entry.local.version}` : 'not installed'
    const remoteVersion = entry.remote?.version ? `remote ${entry.remote.version}` : 'remote none'
    const conflict = entry.conflict === null ? '' : ` [${conflictLabel(entry.conflict.type)}]`
    lines.push(`  ${entry.name}: ${entry.kind} (${localVersion} -> ${remoteVersion})${conflict}`)
  }
  if (visible.length > 30) lines.push(`  … ${visible.length - 30} more`)
}

export function renderToolResult(_args, value) {
  const lines = []
  if (!isRecord(value)) return [{ type: 'text', text: 'Plugin Sync returned an unexpected result.' }]
  const title = typeof value.action === 'string' ? value.action : 'status'
  lines.push(`Plugin Sync — ${title}`)
  lines.push(value.ok === false
    ? `FAILED: ${value.error === undefined ? 'one or more operations failed' : summarizeError(value.error)}`
    : 'OK')
  if (typeof value.hostId === 'string') lines.push(`Host: ${value.hostId}`)
  if (isRecord(value.config)) {
    lines.push(`Repo: ${value.config.repo || '(not configured)'} · ${value.config.branch}/${value.config.path}`)
  }
  if (isRecord(value.token)) {
    lines.push(`Token: ${value.token.configured === true ? `configured (${value.token.source})` : 'not configured'}`)
  }
  if (isRecord(value.local)) {
    lines.push(
      `Local: ${value.local.profileBundles ?? 0} profile bundles, ${value.local.portableBundles ?? 0} portable`,
    )
  }
  if (isRecord(value.state)) {
    if (value.state.lastPreviewAt !== undefined) lines.push(`Last preview: ${value.state.lastPreviewAt}`)
    if (value.state.lastApplyAt !== undefined) lines.push(`Last apply: ${value.state.lastApplyAt}`)
    if (value.state.lastPushAt !== undefined) lines.push(`Last push: ${value.state.lastPushAt}`)
  }
  if (typeof value.previewId === 'string' && isRecord(value.counts)) {
    renderPreview(value, lines)
    lines.push(`Preview ID: ${value.previewId}`)
  }
  if (Array.isArray(value.applied)) {
    lines.push(`Applied: ${value.applied.length}`)
    for (const item of value.applied.slice(0, 12)) {
      lines.push(`  + ${item.name}${item.restartRequired ? ' (restart required)' : ''}`)
    }
  }
  if (Array.isArray(value.failed) && value.failed.length > 0) {
    lines.push(`Failed: ${value.failed.length}`)
    for (const item of value.failed.slice(0, 12)) {
      lines.push(`  ! ${item.name}: ${item.error ?? item.message ?? summarizeError(item)}`)
    }
  }
  if (typeof value.status === 'string' && value.action === 'push') {
    lines.push(`Push: ${value.status}${value.commit ? ` (${shortSha(value.commit)})` : ''}`)
  }
  if (isRecord(value.remote) && value.remote.hostCount !== undefined) {
    lines.push(`Remote: ${value.remote.hostCount} host(s), ${value.remote.bundleCount} bundle record(s)`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const runtime = createSyncRuntime({
    config,
    pluginManager: ctx.pluginManager,
    logger: ctx.logger,
  })

  registerApiRoutes({ ctx, runtime, config })

  ctx.effect(() => ctx.tools.register({
    name: 'plugin_sync',
    description:
      'Preview and apply a GitHub-hosted DSH plugin manifest. Manual only: no background sync. '
      + '`preview` fetches the remote manifest and returns install/upgrade/downgrade/enable entries plus conflicts; '
      + '`apply` installs only the entries the caller selects from that preview; `push` uploads this host\'s portable inventory; '
      + '`status` reports config and last-run state. The same operations are available in the plugin page.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'status, preview, apply, or push.',
        },
        previewId: {
          type: 'string',
          description: 'Preview id returned by `preview`; required for `apply`.',
        },
        selections: {
          type: 'object',
          additionalProperties: { type: 'string', enum: ['remote', 'local', 'skip'] },
          description: 'Map of bundle name to choice; omitted entries use the preview default.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          hostId: { type: 'string' },
          error: { type: 'object' },
        },
      },
      render: renderToolResult,
    },
    timeoutMs: 15 * 60 * 1000,
    isConcurrencySafe: (args) => args?.action === 'status',
    execute: async (args, exec) => {
      const action = typeof args?.action === 'string' ? args.action : 'status'
      if (!ACTIONS.has(action)) return { ok: false, action, error: { code: 'invalid-action', message: `Unknown action: ${action}` } }
      try {
        if (action === 'status') return { ...(await runtime.status()), action: 'status' }
        if (action === 'preview') return { ...(await runtime.preview({ signal: exec?.signal })), action: 'preview' }
        if (action === 'push') return { ...(await runtime.push({ signal: exec?.signal })), action: 'push' }
        if (typeof args?.previewId !== 'string' || args.previewId === '') {
          return {
            ok: false,
            action,
            error: { code: 'missing-preview-id', message: 'previewId is required for apply' },
          }
        }
        const selections = isRecord(args?.selections) ? args.selections : {}
        return {
          ...(await runtime.apply(args.previewId, selections, { signal: exec?.signal })),
          action: 'apply',
        }
      } catch (error) {
        return {
          ok: false,
          action,
          error: {
            code: typeof error?.code === 'string' ? error.code : 'operation-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    },
  }), 'plugin-sync: tool')

  if (config.configError !== undefined) {
    runtime.log('warn', config.configError)
  } else if (config.repo === '') {
    runtime.log('info', 'config.repo is empty; configure it in the plugin page before syncing')
  } else if (!runtime.tokenConfigured) {
    runtime.log('info', 'no GitHub token configured; preview works for public repositories, push is unavailable')
  }
}
