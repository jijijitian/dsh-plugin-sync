import { randomUUID } from 'node:crypto'
import { gistUrl, TOKEN_REF } from './config.js'
import { createGitHubClient, resolveToken } from './github.js'
import { createJobStore } from './jobs.js'
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
  credentials = null,
  credentialsProvider = null,
  logger = console,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  statePath = resolveStatePath(config),
  env = process.env,
}) {
  let stateCache = null
  let stateLoading = null
  let operation = null
  let previewCache = null
  const jobs = createJobStore({ now })

  function jobLog(job, level, message) {
    jobs.append(job.id, level, message)
    log(level, message)
  }

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

  async function resolveCredential() {
    const currentCredentials = typeof credentialsProvider === 'function'
      ? credentialsProvider()
      : credentials
    if (currentCredentials !== null && currentCredentials !== undefined && typeof currentCredentials.resolve === 'function') {
      try {
        const resolved = await currentCredentials.resolve(TOKEN_REF)
        if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') {
          return {
            token: resolved.value,
            source: typeof resolved.source === 'string' ? resolved.source : 'credentials',
            configured: true,
            writable: true,
          }
        }
      } catch {
        // Fall through to the legacy env/file sources.
      }
    }
    const fallback = resolveToken({
      token: config.token,
      tokenEnv: config.tokenEnv,
      tokenFile: config.tokenFile,
      env,
    })
    return {
      token: fallback.token,
      source: fallback.source,
      configured: fallback.token !== '',
      writable: false,
    }
  }

  async function getClient() {
    if (config.configError !== undefined) throw new Error(config.configError)
    const token = await resolveCredential()
    return createGitHubClient({
      apiBaseUrl: config.apiBaseUrl,
      token: token.token,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl,
    })
  }

  async function resolveGistId(github) {
    const state = await getState()
    if (
      typeof state.gistId === 'string' && state.gistId !== ''
      && (state.gistName === null || state.gistName === config.gistName)
    ) {
      return state.gistId
    }
    const gists = await github.listGists()
    const matches = gists
      .filter((gist) => typeof gist.description === 'string' && gist.description.trim() === config.gistName)
      .sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime())
    if (matches.length === 0) return ''
    const match = matches[0]
    await persist({
      gistName: config.gistName,
      gistId: match.gistId,
      gistUrl: match.htmlUrl,
    })
    return match.gistId
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

  async function pushWithRetry(github, gistId, hostEntry, signal) {
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw new Error('operation was aborted')
      const remote = await github.readGist(gistId, config.fileName, { extraSignal: signal })
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
        const updated = await github.updateGist(gistId, {
          description: config.gistName,
          fileName: config.fileName,
          manifest: merged,
          expectedVersion: remote.version,
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
    const gistName = config.gistName
    const stateMatchesGist = state.gistName === gistName || (state.gistName === null && typeof state.gistId === 'string')
    const gistId = stateMatchesGist && typeof state.gistId === 'string' ? state.gistId : ''
    const effectiveGistUrl = stateMatchesGist
      ? (state.gistUrl ?? (gistId === '' ? null : gistUrl(gistId)))
      : null
    const token = await resolveCredential()
    return {
      ok: true,
      configured: gistId !== '',
      gistName,
      gistId,
      gistUrl: effectiveGistUrl,
      ...(config.configError === undefined ? {} : { configError: config.configError }),
      config: {
        gistName,
        fileName: config.fileName,
        description: config.description,
        hostId: config.hostId,
        maxInstallsPerRun: config.maxInstallsPerRun,
      },
      token: {
        configured: token.configured,
        source: token.source,
        writable: token.writable,
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
      const job = jobs.start('preview')
      jobs.progress(job.id, 0, 3)
      jobLog(job, 'info', `reading Gist "${config.gistName}"`)
      try {
        const github = await getClient()
        jobs.progress(job.id, 1, 3)
        const gistId = await resolveGistId(github)
        if (gistId === '') {
          throw new Error(`No Gist named "${config.gistName}" was found. Push the local inventory to create it.`)
        }
        const remote = await github.readGist(gistId, config.fileName, { extraSignal: signal })
        jobLog(job, 'info', `Gist ${gistId} read (${remote.exists ? 'manifest found' : 'no manifest file yet'})`)
        jobs.progress(job.id, 2, 3)
        const { bundles, entry } = await collectLocal()
        const previewData = buildPreview({
          manifest: remote.manifest,
          localBundles: bundles,
          hostId: config.hostId,
          exclude: config.excludeBundles,
          now: now().toISOString(),
        })
        jobs.progress(job.id, 3, 3)
        jobLog(
          job,
          'info',
          `preview built: ${previewData.counts.actionable} actionable, ${previewData.counts.conflicts} conflicts, `
          + `${previewData.counts.localOnly} local-only`,
        )
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
          gistName: config.gistName,
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
        const result = {
          ok: true,
          previewId,
          jobId: job.id,
          gistName: config.gistName,
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
        jobs.finish(job.id, { result: { actionable: previewData.counts.actionable } })
        return result
      } catch (error) {
        const info = errorInfo(error)
        jobLog(job, 'error', `preview failed: ${info.message}`)
        jobs.finish(job.id, { error: info.message })
        throw error
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
      const job = jobs.start('apply', { previewId, total: allowed.length })
      jobs.progress(job.id, 0, allowed.length)
      jobLog(job, 'info', `apply started with ${allowed.length} selected change(s)`)

      const applied = []
      const failed = []
      const removed = []
      const fresh = await pluginManager.listBundles()
      const installed = new Map()
      for (const bundle of fresh) {
        if (bundle !== null && typeof bundle === 'object' && typeof bundle.name === 'string') {
          installed.set(bundle.name, bundle)
        }
      }

      let done = 0
      for (const { entry, choice } of allowed) {
        done += 1
        jobs.progress(job.id, done, allowed.length)
        if (signal?.aborted) {
          jobs.finish(job.id, { error: 'operation was aborted' })
          throw new Error('operation was aborted')
        }

        if (choice === 'remove') {
          const current = installed.get(entry.name)
          if (current === undefined) {
            skipped.push({ name: entry.name, reason: 'not-installed' })
            jobLog(job, 'info', `${entry.name}: already absent, skipped`)
            continue
          }
          if (current.removable === false) {
            failed.push({ name: entry.name, error: 'this bundle cannot be removed' })
            jobLog(job, 'warn', `${entry.name}: bundle is not removable`)
            continue
          }
          jobLog(job, 'info', `${entry.name}: removing local bundle`)
          try {
            const change = await pluginManager.removeBundle(entry.name)
            const summary = summarizeInstallChange(entry.name, entry.local?.spec ?? '', change)
            if (summary.status === 'failed') {
              failed.push({ name: entry.name, error: summary.error ?? 'remove failed' })
              jobLog(job, 'error', `${entry.name}: remove failed — ${summary.error ?? 'unknown error'}`)
            } else {
              removed.push({ ...summary, kind: 'remove' })
              installed.delete(entry.name)
              jobLog(job, 'info', `${entry.name}: removed`)
            }
          } catch (error) {
            const info = errorInfo(error)
            failed.push({ name: entry.name, ...info })
            jobLog(job, 'error', `${entry.name}: remove failed — ${info.message}`)
          }
          continue
        }

        if (entry.kind === 'current' || entry.kind === 'local-only' || entry.kind === 'remote-disabled') continue
        const current = installed.get(entry.name)
        if (entry.kind === 'install' && current !== undefined && (current.installed === true || current.availability === 'profile')) {
          skipped.push({ name: entry.name, reason: 'already-installed' })
          jobLog(job, 'info', `${entry.name}: already installed, skipped`)
          continue
        }
        try {
          if (entry.kind === 'enable') {
            if (current?.enabled === true) {
              skipped.push({ name: entry.name, reason: 'already-enabled' })
              jobLog(job, 'info', `${entry.name}: already enabled, skipped`)
              continue
            }
            jobLog(job, 'info', `${entry.name}: enabling bundle`)
            const change = await pluginManager.setBundleEnabled(entry.name, true)
            const summary = summarizeInstallChange(entry.name, entry.remote?.spec ?? '', change)
            if (summary.status === 'failed') {
              failed.push({ name: entry.name, error: summary.error ?? 'could not enable bundle' })
              jobLog(job, 'error', `${entry.name}: enable failed — ${summary.error ?? 'unknown error'}`)
            } else {
              applied.push({ ...summary, kind: 'enable' })
              jobLog(job, 'info', `${entry.name}: enabled`)
            }
            continue
          }
          const spec = entry.remote?.spec
          if (typeof spec !== 'string' || spec === '') {
            skipped.push({ name: entry.name, reason: 'no-install-spec' })
            jobLog(job, 'warn', `${entry.name}: no install spec, skipped`)
            continue
          }
          jobLog(job, 'info', `${entry.name}: installing ${spec}`)
          const change = await pluginManager.installBundle(spec, { enabled: true })
          const summary = summarizeInstallChange(entry.name, spec, change)
          if (summary.status === 'failed') {
            failed.push({ name: entry.name, spec, error: summary.error ?? 'install failed' })
            jobLog(job, 'error', `${entry.name}: install failed — ${summary.error ?? 'unknown error'}`)
          } else {
            applied.push({ ...summary, kind: entry.kind })
            installed.set(entry.name, {
              name: entry.name,
              installed: true,
              availability: 'profile',
              enabled: true,
            })
            jobLog(
              job,
              'info',
              `${entry.name}: ${summary.status === 'unchanged' ? 'already current' : 'installed'}`
              + `${summary.restartRequired === true ? ' (restart required)' : ''}`,
            )
          }
        } catch (error) {
          const info = errorInfo(error)
          failed.push({ name: entry.name, ...info })
          jobLog(job, 'error', `${entry.name}: ${info.message}`)
        }
      }

      previewCache = null
      const at = now().toISOString()
      const state = await getState()
      await persist({
        lastApplyAt: at,
        lastResults: [...applied, ...removed, ...failed].slice(0, 50),
        history: [
          {
            at,
            action: 'apply',
            ok: failed.length === 0,
            applied: applied.length,
            removed: removed.length,
            failed: failed.length,
            skipped: skipped.length,
          },
          ...(Array.isArray(state.history) ? state.history : []),
        ].slice(0, MAX_HISTORY),
      })
      const result = {
        ok: failed.length === 0,
        previewId,
        jobId: job.id,
        applied,
        failed,
        removed,
        skipped,
        totalSelected: chosen.length,
        totalApplied: applied.length,
        totalRemoved: removed.length,
      }
      jobLog(
        job,
        failed.length === 0 ? 'info' : 'warn',
        `apply finished: ${applied.length} installed/enabled, ${removed.length} removed, ${failed.length} failed, ${skipped.length} skipped`,
      )
      jobs.finish(job.id, {
        result: {
          applied: applied.length,
          removed: removed.length,
          failed: failed.length,
          skipped: skipped.length,
        },
      })
      return result
    })
  }

  async function push({ signal } = {}) {
    return runExclusive('push', async () => {
      const job = jobs.start('push')
      jobs.progress(job.id, 0, 2)
      try {
        const github = await getClient()
        jobLog(job, 'info', 'collecting local bundle inventory')
        const { bundles, entry } = await collectLocal()
        const local = localSummary(bundles, entry)
        jobLog(job, 'info', `${local.profileBundles} profile bundle(s), ${local.portableBundles} portable`)
        const gistId = await resolveGistId(github)
        jobs.progress(job.id, 1, 2)

        if (gistId === '') {
          jobLog(job, 'info', `creating secret Gist "${config.gistName}"`)
          const manifest = mergeHost(emptyManifest(now().toISOString()), config.hostId, entry, now().toISOString())
          const created = await github.createGist({
            description: config.gistName,
            fileName: config.fileName,
            manifest,
            extraSignal: signal,
          })
          const at = now().toISOString()
          const state = await getState()
          await persist({
            gistName: config.gistName,
            gistId: created.gistId,
            gistUrl: created.htmlUrl,
            lastPushAt: at,
            remote: summarizeManifest(manifest),
            history: [
              { at, action: 'push', ok: true, status: 'created', gistId: created.gistId },
              ...(Array.isArray(state.history) ? state.history : []),
            ].slice(0, MAX_HISTORY),
          })
          const result = {
            ok: true,
            created: true,
            status: 'created',
            jobId: job.id,
            gistName: config.gistName,
            gistId: created.gistId,
            gistUrl: created.htmlUrl,
            version: created.version,
            remote: summarizeManifest(manifest),
            local,
          }
          jobs.progress(job.id, 2, 2)
          jobLog(job, 'info', `secret Gist created (${created.gistId})`)
          jobs.finish(job.id, { result: { status: 'created', gistId: created.gistId } })
          return result
        }

        jobLog(job, 'info', `updating Gist ${gistId}`)
        const pushResult = await pushWithRetry(github, gistId, entry, signal)
        const summary = summarizeManifest(pushResult.manifest)
        const at = now().toISOString()
        const state = await getState()
        await persist({
          gistName: config.gistName,
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
        jobs.progress(job.id, 2, 2)
        jobLog(
          job,
          'info',
          pushResult.status === 'pushed'
            ? `pushed in ${pushResult.attempts} attempt(s)`
            : 'manifest already up to date',
        )
        jobs.finish(job.id, { result: { status: pushResult.status } })
        return {
          ok: true,
          created: false,
          status: pushResult.status,
          attempts: pushResult.attempts,
          jobId: job.id,
          gistName: config.gistName,
          gistId,
          gistUrl: pushResult.htmlUrl ?? gistUrl(gistId),
          version: pushResult.version,
          remote: summary,
          local,
        }
      } catch (error) {
        const info = errorInfo(error)
        jobLog(job, 'error', `push failed: ${info.message}`)
        jobs.finish(job.id, { error: info.message })
        throw error
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
    job: (jobId) => jobs.get(jobId),
    latestJob: (kind) => jobs.latest(kind),
    jobs: (kind) => jobs.list(kind),
    publicConfig: () => ({
      gistName: config.gistName,
    }),
    log,
  }
}
