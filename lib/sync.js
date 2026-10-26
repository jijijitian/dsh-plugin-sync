import { createGitHubClient, resolveToken } from './github.js'
import { desiredBundles, localHostEntry, mergeHost, summarizeManifest } from './manifest.js'
import { readState, resolveStatePath, writeState } from './state.js'

export const SELF_NAME = 'dsh-plugin-sync'
const MAX_PREVIEW_BUNDLES = 200

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorInfo(error) {
  if (error === null || typeof error !== 'object') {
    return { message: String(error) }
  }
  return {
    message: typeof error.message === 'string' ? error.message : String(error),
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.status === 'number' ? { status: error.status } : {}),
    ...(error.retryable === true ? { retryable: true } : {}),
  }
}

function bundleKey(bundle) {
  return [
    bundle.name,
    bundle.spec,
    bundle.version ?? '',
    bundle.enabled === false ? '0' : '1',
  ].join('\u0000')
}

function sameBundles(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (bundleKey(left[index]) !== bundleKey(right[index])) return false
  }
  return true
}

function changeError(change) {
  if (change === null || typeof change !== 'object' || change.error === undefined) return null
  const error = change.error
  return {
    message: typeof error?.diagnostic === 'string'
      ? error.diagnostic
      : typeof error?.message === 'string'
        ? error.message
        : String(error),
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  }
}

function summarizeInstallChange(name, spec, change) {
  const base = { name, spec }
  if (change === null || typeof change !== 'object') {
    return { ...base, status: 'failed', error: 'plugin manager returned no result' }
  }
  const failure = changeError(change)
  if (failure !== null) return { ...base, status: 'failed', error: failure.message, ...(failure.code ? { code: failure.code } : {}) }
  if (change.application === 'failed' || change.application === 'cancelled') {
    return { ...base, status: 'failed', application: change.application }
  }
  return {
    ...base,
    status: change.changed === false ? 'unchanged' : 'installed',
    ...(typeof change.application === 'string' ? { application: change.application } : {}),
    ...(typeof change.version === 'string' ? { version: change.version } : {}),
    ...(change.application === 'restart-required' ? { restartRequired: true } : {}),
    ...(Array.isArray(change.warnings) && change.warnings.length > 0
      ? { warnings: change.warnings.slice(0, 10) }
      : {}),
    ...(Array.isArray(change.pendingBuilds) && change.pendingBuilds.length > 0
      ? { pendingBuilds: change.pendingBuilds.slice(0, 10) }
      : {}),
  }
}

export function createSyncRuntime({
  config,
  pluginManager,
  logger = console,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  statePath = resolveStatePath(config),
  env = process.env,
}) {
  const tokenInfo = resolveToken({
    token: config.token,
    tokenEnv: config.tokenEnv,
    tokenFile: config.tokenFile,
    env,
  })
  const tokenConfigured = tokenInfo.token !== ''
  let client = null
  let clientError = null
  if (config.repo !== '') {
    try {
      client = createGitHubClient({
        repo: config.repo,
        branch: config.branch,
        path: config.path,
        apiBaseUrl: config.apiBaseUrl,
        token: tokenInfo.token,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      })
    } catch (error) {
      clientError = error
    }
  }

  let stateCache = null
  let stateLoading = null
  let running = null

  function log(level, message) {
    const write = logger?.[level]
    if (typeof write !== 'function') return
    try {
      write.call(logger, `plugin-sync: ${message}`)
    } catch {
      // logging must never break the sync
    }
  }

  async function getState() {
    if (stateCache !== null) return stateCache
    if (stateLoading === null) {
      stateLoading = readState(statePath, config.hostId).then((state) => {
        stateCache = state
        return state
      })
    }
    return stateLoading
  }

  function publicConfig() {
    return {
      repo: config.repo,
      branch: config.branch,
      path: config.path,
      apiBaseUrl: config.apiBaseUrl,
      hostId: config.hostId,
      autoSyncOnStart: config.autoSyncOnStart,
      syncIntervalMinutes: config.syncIntervalMinutes,
      syncOnPluginChange: config.syncOnPluginChange,
      autoInstall: config.autoInstall,
      dryRun: config.dryRun,
      maxInstallsPerRun: config.maxInstallsPerRun,
      includeDisabledBundles: config.includeDisabledBundles,
      enableExistingBundles: config.enableExistingBundles,
      excludeBundles: config.excludeBundles,
    }
  }

  async function collectLocal() {
    const bundles = await pluginManager.listBundles()
    const entry = localHostEntry(bundles, {
      hostId: config.hostId,
      profile: config.profile,
      platform: process.platform,
      now: now().toISOString(),
      exclude: config.excludeBundles,
    })
    return { bundles, entry }
  }

  function localSummary(bundles, entry) {
    return {
      profileBundles: bundles.filter((bundle) => bundle?.availability === 'profile' && bundle.installed === true).length,
      portableBundles: entry.bundles.length,
      ...(entry.dshVersion === undefined ? {} : { dshVersion: entry.dshVersion }),
      ...(entry.profile === undefined ? {} : { profile: entry.profile }),
      bundles: entry.bundles.slice(0, MAX_PREVIEW_BUNDLES),
    }
  }

  async function pushWithRetry(hostEntry, signal) {
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw new Error('sync was aborted')
      const remote = await client.readManifest({ extraSignal: signal })
      const existing = remote.manifest.hosts[config.hostId]
      if (existing !== undefined && sameBundles(existing.bundles, hostEntry.bundles)) {
        return {
          status: 'unchanged',
          attempts: attempt,
          previousSha: remote.sha,
          sha: remote.sha,
          commit: null,
          htmlUrl: remote.htmlUrl,
          manifest: remote.manifest,
        }
      }
      const merged = mergeHost(remote.manifest, config.hostId, hostEntry, now().toISOString())
      try {
        const written = await client.writeManifest(merged, {
          sha: remote.sha,
          message: `chore(plugin-sync): update manifest from ${config.hostId}`,
          extraSignal: signal,
        })
        return {
          status: 'pushed',
          attempts: attempt,
          previousSha: remote.sha,
          sha: written.sha,
          commit: written.commit,
          htmlUrl: written.htmlUrl,
          manifest: merged,
        }
      } catch (error) {
        lastError = error
        if (error?.code === 'conflict' && attempt < 3) {
          await sleep(150 * attempt)
          continue
        }
        throw error
      }
    }
    throw lastError ?? new Error('could not push the manifest')
  }

  async function installMissing(manifest, { dryRun = false, signal } = {}) {
    const bundles = await pluginManager.listBundles()
    const existing = new Map()
    for (const bundle of bundles) {
      if (bundle !== null && typeof bundle === 'object' && typeof bundle.name === 'string') {
        existing.set(bundle.name, bundle)
      }
    }
    const desired = desiredBundles(manifest, {
      includeDisabled: config.includeDisabledBundles,
      exclude: config.excludeBundles,
    })
    const planned = []
    const installed = []
    const failed = []
    const skipped = []
    const enabled = []
    let budget = config.maxInstallsPerRun

    for (const item of desired) {
      if (signal?.aborted) throw new Error('sync was aborted')
      if (item.name === SELF_NAME) {
        skipped.push({ name: item.name, reason: 'self' })
        continue
      }
      const current = existing.get(item.name)
      const isInstalled = current !== undefined && (current.installed === true || current.availability === 'profile')
      const providedByDsh = current !== undefined && current.availability === 'installation'
      if (isInstalled) {
        if (config.enableExistingBundles && item.enabled && current.enabled === false) {
          if (dryRun) {
            planned.push({ name: item.name, spec: item.spec, action: 'enable' })
            continue
          }
          try {
            const change = await pluginManager.setBundleEnabled(item.name, true)
            const summary = summarizeInstallChange(item.name, item.spec, change)
            if (summary.status === 'failed') {
              failed.push({ name: item.name, spec: item.spec, error: summary.error ?? 'could not enable bundle' })
            } else {
              enabled.push({ name: item.name, application: change?.application ?? 'applied' })
            }
          } catch (error) {
            failed.push({ name: item.name, spec: item.spec, ...errorInfo(error) })
          }
          continue
        }
        skipped.push({ name: item.name, reason: 'installed' })
        continue
      }
      if (providedByDsh) {
        skipped.push({ name: item.name, reason: 'provided-by-dsh' })
        continue
      }
      planned.push({ name: item.name, spec: item.spec, action: 'install' })
      if (dryRun) continue
      if (budget <= 0) {
        skipped.push({ name: item.name, reason: 'install-budget' })
        continue
      }
      budget -= 1
      try {
        const change = await pluginManager.installBundle(item.spec, { enabled: true })
        const summary = summarizeInstallChange(item.name, item.spec, change)
        if (summary.status === 'failed') {
          failed.push({ name: item.name, spec: item.spec, error: summary.error ?? summary.application ?? 'install failed' })
        } else {
          installed.push(summary)
          existing.set(item.name, { name: item.name, installed: true, availability: 'profile', enabled: true })
        }
      } catch (error) {
        failed.push({ name: item.name, spec: item.spec, ...errorInfo(error) })
      }
    }

    return {
      dryRun,
      desired: desired.length,
      planned: planned.slice(0, MAX_PREVIEW_BUNDLES),
      plannedTotal: planned.length,
      installed,
      enabled,
      failed,
      skipped,
      remaining: skipped.filter((item) => item.reason === 'install-budget').length,
    }
  }

  async function status() {
    let local = null
    let localError = null
    try {
      const snapshot = await collectLocal()
      local = localSummary(snapshot.bundles, snapshot.entry)
    } catch (error) {
      localError = errorInfo(error)
    }
    const state = await getState()
    return {
      ok: true,
      action: 'status',
      hostId: config.hostId,
      configured: config.repo !== '',
      ...(config.configError === undefined ? {} : { configError: config.configError }),
      config: publicConfig(),
      token: {
        configured: tokenConfigured,
        source: tokenInfo.source,
      },
      local,
      ...(localError === null ? {} : { localError }),
      state: {
        ...(state.lastSyncAt === null ? {} : { lastSyncAt: state.lastSyncAt }),
        ...(state.lastPushAt === null ? {} : { lastPushAt: state.lastPushAt }),
        ...(state.lastPullAt === null ? {} : { lastPullAt: state.lastPullAt }),
        ...(state.lastRun === undefined || state.lastRun === null ? {} : { lastRun: state.lastRun }),
        ...(state.remote === undefined || state.remote === null ? {} : { remote: state.remote }),
        lastResults: Array.isArray(state.lastResults) ? state.lastResults : [],
        ...(state.loadError === undefined ? {} : { loadError: state.loadError }),
      },
      statePath,
    }
  }

  async function persist(result) {
    try {
      const current = await getState()
      const next = {
        ...current,
        hostId: config.hostId,
        lastResults: (
          result.install !== undefined
            ? [
                ...(Array.isArray(result.install.installed) ? result.install.installed : []),
                ...(Array.isArray(result.install.failed) ? result.install.failed : []),
              ]
            : (Array.isArray(current.lastResults) ? current.lastResults : [])
        ).slice(0, 50),
        remote: result.remote ?? current.remote,
        history: [
          {
            at: result.finishedAt,
            action: result.action,
            ok: result.ok,
            dryRun: result.dryRun === true,
            ...(result.push?.status === undefined ? {} : { push: result.push.status }),
            ...(result.pull?.status === undefined ? {} : { pull: result.pull.status }),
            ...(result.remote?.hostCount === undefined ? {} : { remoteHosts: result.remote.hostCount }),
            ...(result.install === undefined
              ? {}
              : {
                  installed: Array.isArray(result.install.installed) ? result.install.installed.length : 0,
                  failed: Array.isArray(result.install.failed) ? result.install.failed.length : 0,
                }),
          },
          ...(Array.isArray(current.history) ? current.history : []),
        ].slice(0, 20),
      }
      if (result.push?.status === 'pushed') next.lastPushAt = result.finishedAt
      if (result.pull?.status === 'ok') next.lastPullAt = result.finishedAt
      if (result.action === 'sync' && result.ok) next.lastSyncAt = result.finishedAt
      if (next.history.length > 0) next.lastRun = { ...next.history[0] }
      stateCache = await writeState(statePath, next)
    } catch (error) {
      log('warn', `could not save state: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function execute(action, { dryRun = config.dryRun, signal } = {}) {
    const startedAt = now().toISOString()
    const result = {
      ok: true,
      action,
      hostId: config.hostId,
      dryRun: dryRun === true,
      startedAt,
      repo: { repo: config.repo, branch: config.branch, path: config.path },
    }
    if (action === 'status') return status()
    if (config.configError !== undefined) {
      result.ok = false
      result.error = config.configError
      result.finishedAt = now().toISOString()
      return result
    }
    if (config.repo === '') {
      result.ok = false
      result.error = 'config.repo is empty; set it to "owner/repository" in the plugin config.'
      result.finishedAt = now().toISOString()
      return result
    }
    if (client === null) {
      result.ok = false
      result.error = clientError instanceof Error ? clientError.message : 'GitHub client is unavailable'
      result.finishedAt = now().toISOString()
      return result
    }

    let manifest = null
    if (action === 'push' && result.dryRun) {
      result.ok = false
      result.error = 'dryRun is not supported for push'
      result.finishedAt = now().toISOString()
      return result
    }
    if (action === 'sync' && result.dryRun) {
      result.push = { status: 'skipped', reason: 'dryRun' }
    } else if (action === 'sync' || action === 'push') {
      try {
        const local = await collectLocal()
        result.local = localSummary(local.bundles, local.entry)
        result.push = await pushWithRetry(local.entry, signal)
        manifest = result.push.manifest
        delete result.push.manifest
      } catch (error) {
        result.push = { status: 'failed', error: errorInfo(error) }
        result.ok = false
        log('warn', `push failed: ${errorInfo(error).message}`)
      }
    }

    if (action === 'sync' || action === 'pull' || action === 'install') {
      if (manifest === null) {
        try {
          const remote = await client.readManifest({ extraSignal: signal })
          manifest = remote.manifest
          result.pull = {
            status: 'ok',
            exists: remote.exists,
            sha: remote.sha,
            htmlUrl: remote.htmlUrl,
          }
        } catch (error) {
          result.pull = { status: 'failed', error: errorInfo(error) }
          result.ok = false
          log('warn', `pull failed: ${errorInfo(error).message}`)
        }
      } else {
        result.pull = { status: 'merged', sha: result.push.sha, exists: true }
      }
    }

    if (manifest !== null) {
      result.remote = summarizeManifest(manifest)
      if (action === 'sync' || action === 'install') {
        if (action === 'sync' && !config.autoInstall) {
          result.install = { skipped: true, reason: 'autoInstall is disabled' }
        } else {
          try {
            result.install = await installMissing(manifest, { dryRun: result.dryRun, signal })
            if (result.install.failed.length > 0) result.ok = false
          } catch (error) {
            result.install = { error: errorInfo(error) }
            result.ok = false
            log('warn', `install failed: ${errorInfo(error).message}`)
          }
        }
      }
    }

    result.finishedAt = now().toISOString()
    await persist(result)
    return result
  }

  async function run(action, options = {}) {
    if (action === 'status') return status()
    if (running !== null) {
      return {
        ok: false,
        action,
        error: 'A plugin sync is already running on this host.',
        running: true,
      }
    }
    const job = execute(action, options)
    running = job
    try {
      return await job
    } catch (error) {
      return {
        ok: false,
        action,
        error: errorInfo(error).message,
        ...errorInfo(error),
      }
    } finally {
      if (running === job) running = null
    }
  }

  return {
    run,
    status,
    isRunning: () => running !== null,
    tokenConfigured,
    tokenSource: tokenInfo.source,
    statePath,
    publicConfig,
    log,
  }
}
