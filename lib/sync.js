import { randomUUID } from 'node:crypto'
import { gistUrl } from './config.js'
import { createGitHubClient, resolveToken } from './github.js'
import { emptyManifest, localHostEntry, mergeHost, summarizeManifest } from './manifest.js'
import { buildPreview, selectPreviewEntries } from './preview.js'
import { readState, resolveStatePath, writeState } from './state.js'

const PREVIEW_TTL_MS = 10 * 60 * 1000
const MAX_HISTORY = 20

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
  try {
    client = createGitHubClient({
      apiBaseUrl: config.apiBaseUrl,
      token: tokenInfo.token,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl,
    })
  } catch (error) {
    clientError = error
  }

  let stateCache = null
  let stateLoading = null
  let operation = null
  let previewCache = null

  function log(level, message) {
    const write = logger?.[level]
    if (typeof write !== 'function') return
    try {
      write.call(logger, `plugin-sync: ${message}`)
    } catch {
      // logging must never break the operation
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

  async function resolveGistId() {
    if (config.gistId !== '') return config.gistId
    const state = await getState()
    return typeof state.gistId === 'string' && state.gistId !== '' ? state.gistId : ''
  }

  async function runExclusive(name, work) {
    if (operation !== null) {
      throw new Error(`Another plugin-sync operation is already running (${name}).`)
    }
    const job = work()
    operation = job
    try {
      return await job
    } finally {
      if (operation === job) operation = null
    }
  }

  function requireClient() {
    if (config.configError !== undefined) throw new Error(config.configError)
    if (client === null) {
      throw new Error(clientError instanceof Error ? clientError.message : 'GitHub client is unavailable')
    }
    return client
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
    }
  }

  async function pushWithRetry(gistId, hostEntry, signal) {
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw new Error('operation was aborted')
      const remote = await client.readGist(gistId, config.fileName, { extraSignal: signal })
      if (remote.exists && sameBundles(remote.manifest.hosts[config.hostId]?.bundles, hostEntry.bundles)) {
        return {
          status: 'unchanged',
          attempts: attempt,
          version: remote.version,
          htmlUrl: remote.htmlUrl,
          manifest: remote.manifest,
        }
      }
      const merged = mergeHost(remote.manifest, config.hostId, hostEntry, now().toISOString())
      try {
        const updated = await client.updateGist(gistId, {
          description: config.description,
          fileName: config.fileName,
          manifest: merged,
          ifMatch: remote.etag,
          extraSignal: signal,
        })
        return {
          status: 'pushed',
          attempts: attempt,
          version: updated.version,
          htmlUrl: updated.htmlUrl,
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
    throw lastError ?? new Error('could not update the Gist')
  }

  async function persist(patch) {
    try {
      const current = await getState()
      const history = Array.isArray(patch.history)
        ? patch.history.slice(0, MAX_HISTORY)
        : Array.isArray(current.history) ? current.history.slice(0, MAX_HISTORY) : []
      const next = {
        ...current,
        ...patch,
        hostId: config.hostId,
        history,
      }
      stateCache = await writeState(statePath, next)
    } catch (error) {
      log('warn', `could not save state: ${error instanceof Error ? error.message : String(error)}`)
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
    const gistId = config.gistId !== '' ? config.gistId : (state.gistId ?? '')
    const stateMatchesGist = state.gistId === gistId
    const effectiveGistUrl = (stateMatchesGist ? state.gistUrl : null) ?? (gistId === '' ? null : gistUrl(gistId))
    return {
      ok: true,
      configured: gistId !== '',
      gistId,
      gistUrl: effectiveGistUrl,
      ...(config.configError === undefined ? {} : { configError: config.configError }),
      config: {
        gistId: config.gistId,
        fileName: config.fileName,
        description: config.description,
        hostId: config.hostId,
        maxInstallsPerRun: config.maxInstallsPerRun,
      },
      token: {
        configured: tokenConfigured,
        source: tokenInfo.source,
      },
      local,
      ...(localError === null ? {} : { localError }),
      state: {
        ...(state.lastPreviewAt === null ? {} : { lastPreviewAt: state.lastPreviewAt }),
        ...(state.lastApplyAt === null ? {} : { lastApplyAt: state.lastApplyAt }),
        ...(state.lastPushAt === null ? {} : { lastPushAt: state.lastPushAt }),
        ...(state.remote === null || state.remote === undefined ? {} : { remote: state.remote }),
        lastResults: Array.isArray(state.lastResults) ? state.lastResults : [],
        ...(state.loadError === undefined ? {} : { loadError: state.loadError }),
      },
      previewAvailable: previewCache !== null,
      statePath,
    }
  }

  async function preview({ signal } = {}) {
    return runExclusive('preview', async () => {
      const github = requireClient()
      const gistId = await resolveGistId()
      if (gistId === '') {
        throw new Error('No Gist is configured. Push the local inventory to create one, or paste an existing Gist id.')
      }
      const remote = await github.readGist(gistId, config.fileName, { extraSignal: signal })
      const { bundles, entry } = await collectLocal()
      const previewData = buildPreview({
        manifest: remote.manifest,
        localBundles: bundles,
        hostId: config.hostId,
        exclude: config.excludeBundles,
        now: now().toISOString(),
      })
      const previewId = randomUUID()
      previewCache = {
        id: previewId,
        createdAt: Date.now(),
        expiresAt: Date.now() + PREVIEW_TTL_MS,
        gistId,
        version: remote.version,
        preview: previewData,
      }
      const state = await getState()
      await persist({
        gistId,
        gistUrl: remote.htmlUrl ?? gistUrl(gistId),
        lastPreviewAt: now().toISOString(),
        remote: summarizeManifest(remote.manifest),
        history: [
          {
            at: now().toISOString(),
            action: 'preview',
            ok: true,
            conflicts: previewData.conflicts.length,
            actionable: previewData.counts.actionable,
          },
          ...(Array.isArray(state.history) ? state.history : []),
        ].slice(0, MAX_HISTORY),
      })
      const local = localSummary(bundles, entry)
      return {
        ok: true,
        previewId,
        gistId,
        gistUrl: remote.htmlUrl ?? gistUrl(gistId),
        ...previewData,
        remote: {
          ...previewData.remote,
          version: remote.version,
          exists: remote.exists,
          htmlUrl: remote.htmlUrl,
        },
        local: {
          ...previewData.local,
          profileBundles: local.profileBundles,
          portableBundles: local.portableBundles,
          ...(local.dshVersion === undefined ? {} : { dshVersion: local.dshVersion }),
        },
        expiresAt: new Date(previewCache.expiresAt).toISOString(),
      }
    })
  }

  async function apply(previewId, selections = {}, { signal } = {}) {
    return runExclusive('apply', async () => {
      if (previewCache === null || previewCache.id !== previewId) {
        throw new Error('The preview expired or no longer belongs to this Host. Pull the manifest again.')
      }
      if (Date.now() > previewCache.expiresAt) {
        previewCache = null
        throw new Error('The preview expired. Pull the manifest again.')
      }
      const chosen = selectPreviewEntries(previewCache.preview, selections)
      const max = config.maxInstallsPerRun
      const allowed = chosen.slice(0, max)
      const skipped = chosen.slice(max).map(({ entry }) => ({
        name: entry.name,
        reason: 'max-installs-per-run',
      }))
      const applied = []
      const failed = []
      const fresh = await pluginManager.listBundles()
      const installed = new Map()
      for (const bundle of fresh) {
        if (bundle !== null && typeof bundle === 'object' && typeof bundle.name === 'string') {
          installed.set(bundle.name, bundle)
        }
      }

      for (const { entry } of allowed) {
        if (signal?.aborted) throw new Error('operation was aborted')
        if (entry.kind === 'current' || entry.kind === 'local-only' || entry.kind === 'remote-disabled') continue
        const current = installed.get(entry.name)
        if (entry.kind === 'install' && current !== undefined && (current.installed === true || current.availability === 'profile')) {
          skipped.push({ name: entry.name, reason: 'already-installed' })
          continue
        }
        try {
          if (entry.kind === 'enable') {
            if (current?.enabled === true) {
              skipped.push({ name: entry.name, reason: 'already-enabled' })
              continue
            }
            const change = await pluginManager.setBundleEnabled(entry.name, true)
            const summary = summarizeInstallChange(entry.name, entry.remote?.spec ?? '', change)
            if (summary.status === 'failed') {
              failed.push({ name: entry.name, error: summary.error ?? 'could not enable bundle' })
            } else {
              applied.push({ ...summary, kind: 'enable' })
            }
            continue
          }
          const spec = entry.remote?.spec
          if (typeof spec !== 'string' || spec === '') {
            skipped.push({ name: entry.name, reason: 'no-install-spec' })
            continue
          }
          const change = await pluginManager.installBundle(spec, { enabled: true })
          const summary = summarizeInstallChange(entry.name, spec, change)
          if (summary.status === 'failed') {
            failed.push({ name: entry.name, spec, error: summary.error ?? 'install failed' })
          } else {
            applied.push({ ...summary, kind: entry.kind })
            installed.set(entry.name, {
              name: entry.name,
              installed: true,
              availability: 'profile',
              enabled: true,
            })
          }
        } catch (error) {
          failed.push({ name: entry.name, ...errorInfo(error) })
        }
      }

      previewCache = null
      const at = now().toISOString()
      const state = await getState()
      await persist({
        lastApplyAt: at,
        lastResults: [...applied, ...failed].slice(0, 50),
        history: [
          {
            at,
            action: 'apply',
            ok: failed.length === 0,
            applied: applied.length,
            failed: failed.length,
            skipped: skipped.length,
          },
          ...(Array.isArray(state.history) ? state.history : []),
        ].slice(0, MAX_HISTORY),
      })
      return {
        ok: failed.length === 0,
        previewId,
        applied,
        failed,
        skipped,
        totalSelected: chosen.length,
        totalApplied: applied.length,
      }
    })
  }

  async function push({ signal } = {}) {
    return runExclusive('push', async () => {
      const github = requireClient()
      const { bundles, entry } = await collectLocal()
      const local = localSummary(bundles, entry)
      const gistId = await resolveGistId()

      if (gistId === '') {
        const manifest = mergeHost(emptyManifest(now().toISOString()), config.hostId, entry, now().toISOString())
        const created = await github.createGist({
          description: config.description,
          fileName: config.fileName,
          manifest,
          extraSignal: signal,
        })
        const at = now().toISOString()
        const state = await getState()
        await persist({
          gistId: created.gistId,
          gistUrl: created.htmlUrl,
          lastPushAt: at,
          remote: summarizeManifest(manifest),
          history: [
            { at, action: 'push', ok: true, status: 'created', gistId: created.gistId },
            ...(Array.isArray(state.history) ? state.history : []),
          ].slice(0, MAX_HISTORY),
        })
        return {
          ok: true,
          created: true,
          status: 'created',
          gistId: created.gistId,
          gistUrl: created.htmlUrl,
          version: created.version,
          remote: summarizeManifest(manifest),
          local,
        }
      }

      const pushResult = await pushWithRetry(gistId, entry, signal)
      const summary = summarizeManifest(pushResult.manifest)
      const at = now().toISOString()
      const state = await getState()
      await persist({
        gistId,
        gistUrl: pushResult.htmlUrl ?? state.gistUrl ?? gistUrl(gistId),
        lastPushAt: pushResult.status === 'pushed' ? at : state.lastPushAt,
        remote: summary,
        history: [
          {
            at,
            action: 'push',
            ok: true,
            status: pushResult.status,
            version: pushResult.version,
          },
          ...(Array.isArray(state.history) ? state.history : []),
        ].slice(0, MAX_HISTORY),
      })
      return {
        ok: true,
        created: false,
        status: pushResult.status,
        attempts: pushResult.attempts,
        gistId,
        gistUrl: pushResult.htmlUrl ?? gistUrl(gistId),
        version: pushResult.version,
        remote: summary,
        local,
      }
    })
  }

  return {
    config,
    status,
    preview,
    apply,
    push,
    isBusy: () => operation !== null,
    hasPreview: () => previewCache !== null,
    statePath,
    tokenConfigured,
    tokenSource: tokenInfo.source,
    publicConfig: () => ({
      gistId: config.gistId,
      fileName: config.fileName,
      hostId: config.hostId,
      maxInstallsPerRun: config.maxInstallsPerRun,
    }),
    log,
  }
}
