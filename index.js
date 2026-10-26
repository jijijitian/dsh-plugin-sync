import { hostname } from 'node:os'
import { createSyncRuntime } from './lib/sync.js'
import { expandHome, normalizeBranch, normalizeManifestPath, normalizeRepo } from './lib/spec.js'

export const name = 'dsh-plugin-sync'
export const inject = ['tools', 'pluginManager']

const ACTIONS = new Set(['status', 'pull', 'push', 'install', 'sync'])
const DEFAULT_CONFIG = {
  repo: '',
  branch: 'main',
  path: 'dsh-plugins.json',
  apiBaseUrl: 'https://api.github.com',
  token: '',
  tokenEnv: 'GITHUB_TOKEN',
  tokenFile: '',
  hostId: '',
  stateFile: '',
  autoSyncOnStart: true,
  startupDelayMs: 8000,
  syncIntervalMinutes: 0,
  syncOnPluginChange: true,
  changeDebounceMs: 15000,
  autoInstall: true,
  dryRun: false,
  maxInstallsPerRun: 8,
  includeDisabledBundles: false,
  enableExistingBundles: false,
  excludeBundles: [],
  allowInsecureHttp: false,
  requestTimeoutMs: 30000,
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asInteger(value, fallback, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)))
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function defaultHostId() {
  const raw = hostname().trim().toLowerCase()
  const normalized = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
  return normalized === '' ? 'dsh-host' : normalized
}

function normalizeHostId(value) {
  const raw = asString(value)
  if (raw === '') return defaultHostId()
  const normalized = raw.replace(/[\u0000-\u001f\u007f]+/g, '-').replace(/\s+/g, '-').slice(0, 100)
  if (['__proto__', 'constructor', 'prototype'].includes(normalized)) return defaultHostId()
  return normalized
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function normalizeApiBaseUrl(value, allowInsecureHttp) {
  const fallback = DEFAULT_CONFIG.apiBaseUrl
  if (typeof value !== 'string' || value.trim() === '') return { value: fallback, error: null }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return { value: fallback, error: 'config.apiBaseUrl is not a valid URL; using api.github.com' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { value: fallback, error: 'config.apiBaseUrl must use http or https' }
  }
  if (url.protocol === 'http:' && !allowInsecureHttp && !isLoopbackHost(url.hostname)) {
    return {
      value: fallback,
      error: 'config.apiBaseUrl uses plain HTTP; set allowInsecureHttp only for a trusted local mock',
    }
  }
  url.search = ''
  url.hash = ''
  return { value: url.toString().replace(/\/+$/, ''), error: null }
}

function normalizeExclude(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim()
    if (name === '') continue
    seen.add(name)
  }
  return [...seen].slice(0, 500)
}

export function normalizeConfig(raw) {
  const input = isRecord(raw) ? raw : {}
  const allowInsecureHttp = asBoolean(input.allowInsecureHttp, DEFAULT_CONFIG.allowInsecureHttp)
  const apiBase = normalizeApiBaseUrl(input.apiBaseUrl, allowInsecureHttp)
  const repoText = asString(input.repo)
  const repo = normalizeRepo(repoText)
  const config = {
    repo,
    branch: normalizeBranch(asString(input.branch, DEFAULT_CONFIG.branch)),
    path: normalizeManifestPath(asString(input.path, DEFAULT_CONFIG.path)),
    apiBaseUrl: apiBase.value,
    token: asString(input.token),
    tokenEnv: asString(input.tokenEnv, DEFAULT_CONFIG.tokenEnv),
    tokenFile: expandHome(asString(input.tokenFile)),
    hostId: normalizeHostId(input.hostId),
    stateFile: expandHome(asString(input.stateFile)),
    profile: process.env.DSH_PROFILE || '',
    dshHome: process.env.DSH_HOME || '',
    autoSyncOnStart: asBoolean(input.autoSyncOnStart, DEFAULT_CONFIG.autoSyncOnStart),
    startupDelayMs: asInteger(input.startupDelayMs, DEFAULT_CONFIG.startupDelayMs, 0, 600_000),
    syncIntervalMinutes: asInteger(input.syncIntervalMinutes, DEFAULT_CONFIG.syncIntervalMinutes, 0, 1440),
    syncOnPluginChange: asBoolean(input.syncOnPluginChange, DEFAULT_CONFIG.syncOnPluginChange),
    changeDebounceMs: asInteger(input.changeDebounceMs, DEFAULT_CONFIG.changeDebounceMs, 1_000, 600_000),
    autoInstall: asBoolean(input.autoInstall, DEFAULT_CONFIG.autoInstall),
    dryRun: asBoolean(input.dryRun, DEFAULT_CONFIG.dryRun),
    maxInstallsPerRun: asInteger(input.maxInstallsPerRun, DEFAULT_CONFIG.maxInstallsPerRun, 0, 50),
    includeDisabledBundles: asBoolean(input.includeDisabledBundles, DEFAULT_CONFIG.includeDisabledBundles),
    enableExistingBundles: asBoolean(input.enableExistingBundles, DEFAULT_CONFIG.enableExistingBundles),
    excludeBundles: normalizeExclude(input.excludeBundles),
    allowInsecureHttp,
    requestTimeoutMs: asInteger(input.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, 1_000, 120_000),
    configError: undefined,
  }
  if (repoText !== '' && repo === '') {
    config.configError = 'config.repo must be "owner/repository" (a GitHub URL is also accepted)'
  }
  if (apiBase.error !== null) {
    config.configError = config.configError === undefined ? apiBase.error : `${config.configError}; ${apiBase.error}`
  }
  return config
}

function shortSha(value) {
  return typeof value === 'string' && value.length > 12 ? value.slice(0, 12) : value ?? ''
}

function summarizeError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  return typeof error.message === 'string' ? error.message : JSON.stringify(error).slice(0, 500)
}

function renderInstall(value, lines) {
  if (value?.skipped === true) {
    lines.push(`Install skipped: ${value.reason ?? 'disabled'}`)
    return
  }
  if (value === undefined) return
  if (value.error !== undefined) {
    lines.push(`Install error: ${summarizeError(value.error)}`)
    return
  }
  const mode = value.dryRun === true ? 'dry run' : 'applied'
  lines.push(
    `Install (${mode}): ${value.installed?.length ?? 0} installed, ${value.failed?.length ?? 0} failed, `
    + `${value.plannedTotal ?? value.planned?.length ?? 0} missing`,
  )
  for (const item of (value.planned ?? []).slice(0, 12)) {
    lines.push(`  plan: ${item.name} (${item.action})`)
  }
  for (const item of (value.installed ?? []).slice(0, 12)) {
    const suffix = item.restartRequired === true ? ' — restart required' : ''
    lines.push(`  ${item.status === 'unchanged' ? '=' : '+'} ${item.name}${suffix}`)
  }
  for (const item of (value.enabled ?? []).slice(0, 12)) {
    lines.push(`  + enabled ${item.name}`)
  }
  for (const item of (value.failed ?? []).slice(0, 12)) {
    lines.push(`  ! ${item.name}: ${item.error ?? item.message ?? summarizeError(item)}`)
  }
  if ((value.skipped?.length ?? 0) > 0) {
    const reasons = new Map()
    for (const item of value.skipped) {
      reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1)
    }
    lines.push(`  skipped: ${[...reasons].map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }
}

export function renderToolResult(_args, value) {
  const lines = []
  if (!isRecord(value)) {
    return [{ type: 'text', text: 'Plugin Sync returned an unexpected result.' }]
  }
  const title = typeof value.action === 'string' ? value.action : 'status'
  lines.push(`Plugin Sync — ${title}${value.dryRun === true ? ' (dry run)' : ''}`)
  if (value.ok === false) {
    lines.push(`FAILED: ${value.error === undefined ? 'unknown error' : summarizeError(value.error)}`)
  } else {
    lines.push('OK')
  }
  if (typeof value.hostId === 'string') lines.push(`Host: ${value.hostId}`)
  if (typeof value.configError === 'string' && value.configError !== '') {
    lines.push(`Config error: ${value.configError}`)
  }
  if (isRecord(value.localError)) lines.push(`Local inventory error: ${summarizeError(value.localError)}`)
  if (isRecord(value.config)) {
    lines.push(`Repo: ${value.config.repo || '(not configured)'} · branch ${value.config.branch} · ${value.config.path}`)
    lines.push(
      `Token: ${value.token?.configured === true ? `configured (${value.token.source})` : 'not configured (read-only)'}`,
    )
  }
  if (isRecord(value.local)) {
    lines.push(
      `Local: ${value.local.profileBundles ?? 0} profile bundles, ${value.local.portableBundles ?? 0} portable`
      + (value.local.dshVersion === undefined ? '' : ` · DSH ${value.local.dshVersion}`),
    )
  }
  if (isRecord(value.push)) {
    if (value.push.status === 'pushed') {
      lines.push(`Push: pushed ${shortSha(value.push.commit)} in ${value.push.attempts ?? 1} attempt(s)`)
    } else if (value.push.status === 'unchanged') {
      lines.push('Push: manifest already up to date')
    } else if (value.push.status === 'skipped') {
      lines.push(`Push: skipped (${value.push.reason ?? 'dry run'})`)
    } else if (value.push.status === 'failed') {
      lines.push(`Push: failed — ${summarizeError(value.push.error)}`)
    }
  }
  if (isRecord(value.pull)) {
    if (value.pull.status === 'ok') {
      lines.push(`Pull: ${value.pull.exists === false ? 'manifest not found (will be created)' : `manifest ${shortSha(value.pull.sha)}`}`)
    } else if (value.pull.status === 'merged') {
      lines.push(`Pull: using merged manifest ${shortSha(value.pull.sha)}`)
    } else if (value.pull.status === 'failed') {
      lines.push(`Pull: failed — ${summarizeError(value.pull.error)}`)
    }
  }
  if (isRecord(value.remote)) {
    lines.push(`Remote: ${value.remote.hostCount} host(s), ${value.remote.bundleCount} bundle record(s)`)
    for (const host of (value.remote.hosts ?? []).slice(0, 8)) {
      lines.push(`  ${host.hostId}: ${host.bundles} bundle(s), updated ${host.updatedAt}`)
    }
  }
  if (isRecord(value.install)) renderInstall(value.install, lines)
  if (isRecord(value.state)) {
    if (value.state.lastSyncAt !== undefined) lines.push(`Last successful sync: ${value.state.lastSyncAt}`)
    if (isRecord(value.state.lastRun)) {
      lines.push(`Last run: ${value.state.lastRun.action} at ${value.state.lastRun.at} (${value.state.lastRun.ok ? 'ok' : 'failed'})`)
    }
  }
  if (typeof value.statePath === 'string' && value.statePath !== '') lines.push(`State: ${value.statePath}`)
  if (typeof value.error === 'string' && value.ok !== false) lines.push(`Note: ${value.error}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const runtime = createSyncRuntime({
    config,
    pluginManager: ctx.pluginManager,
    logger: ctx.logger,
  })

  ctx.effect(() => ctx.tools.register({
    name: 'plugin_sync',
    description:
      'Sync this Host\'s DSH bundle inventory through a GitHub-hosted manifest and auto-install missing bundles. '
      + '`sync` pushes this host\'s portable bundle list, merges the remote manifest, then installs missing enabled bundles; '
      + '`push` only uploads; `pull` only reads; `install` reads and installs; `status` reports local and last-run state. '
      + 'Local path/file specs are never published. A GitHub token is required for writes; reads work for public repositories. '
      + 'Set config.repo (owner/repository), optional branch/path, and tokenEnv or tokenFile in the plugin row config.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'status, pull, push, install, or sync.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Plan installs without changing the profile. Defaults to config.dryRun.',
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
          error: { type: 'string' },
          dryRun: { type: 'boolean' },
        },
      },
      render: renderToolResult,
    },
    timeoutMs: 15 * 60 * 1000,
    isConcurrencySafe: (args) => args?.action === 'status',
    execute: async (args, exec) => {
      const action = typeof args?.action === 'string' ? args.action : 'status'
      if (!ACTIONS.has(action)) {
        return { ok: false, action, error: `Unknown action: ${action}` }
      }
      const dryRun = args?.dryRun === undefined ? config.dryRun : args.dryRun === true
      try {
        return await runtime.run(action, { dryRun, signal: exec?.signal })
      } catch (error) {
        return { ok: false, action, error: summarizeError(error) }
      }
    },
  }), 'plugin-sync: tool')

  if (config.configError !== undefined) {
    runtime.log('warn', config.configError)
  }
  if (config.repo === '') {
    runtime.log('warn', 'config.repo is empty; plugin sync is idle until a GitHub repository is configured')
  } else if (!runtime.tokenConfigured) {
    runtime.log('info', 'no GitHub token configured; sync will read and install but cannot push')
  }

  const runAuto = (reason) => {
    if (config.repo === '' || config.configError !== undefined) return
    if (runtime.isRunning()) return
    runtime.run('sync', { dryRun: false }).then((result) => {
      if (result.ok) {
        const installed = result.install?.installed?.length ?? 0
        runtime.log('info', `${reason}: ok, installed ${installed} bundle(s)`)
      } else {
        runtime.log('warn', `${reason}: ${summarizeError(result.error ?? result.push?.error ?? result.pull?.error ?? 'failed')}`)
      }
    }).catch((error) => {
      runtime.log('warn', `${reason}: ${summarizeError(error)}`)
    })
  }

  if (config.autoSyncOnStart && config.repo !== '' && config.configError === undefined) {
    ctx.effect(() => {
      const timer = setTimeout(() => runAuto('startup sync'), config.startupDelayMs)
      timer.unref?.()
      return () => clearTimeout(timer)
    }, 'plugin-sync: startup sync')
  }

  if (config.syncIntervalMinutes > 0 && config.repo !== '' && config.configError === undefined) {
    ctx.effect(() => {
      const timer = setInterval(() => runAuto('scheduled sync'), config.syncIntervalMinutes * 60_000)
      timer.unref?.()
      return () => clearInterval(timer)
    }, 'plugin-sync: interval sync')
  }

  if (config.syncOnPluginChange && config.repo !== '' && config.configError === undefined) {
    ctx.effect(() => {
      let timer = null
      const onChange = () => {
        if (runtime.isRunning()) return
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          runAuto('plugin-change sync')
        }, config.changeDebounceMs)
        timer.unref?.()
      }
      const off = ctx.on('plugin-manager/changed', onChange)
      return () => {
        off()
        if (timer !== null) clearTimeout(timer)
      }
    }, 'plugin-sync: plugin change sync')
  }
}
