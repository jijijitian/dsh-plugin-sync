import { randomUUID } from 'node:crypto'

const MAX_JOBS = 10
const MAX_LINES = 400

function nowIso(now) {
  return now().toISOString()
}

function clampText(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

export function createJobStore({ now = () => new Date(), keep = MAX_JOBS } = {}) {
  const jobs = new Map()

  function trim() {
    while (jobs.size > keep) {
      const oldest = jobs.keys().next().value
      if (oldest === undefined) return
      jobs.delete(oldest)
    }
  }

  function start(kind, meta = {}) {
    const job = {
      id: randomUUID(),
      kind,
      status: 'running',
      startedAt: nowIso(now),
      finishedAt: null,
      progress: { done: 0, total: 0 },
      lines: [],
      result: null,
      error: null,
      ...meta,
    }
    jobs.set(job.id, job)
    trim()
    return job
  }

  function append(jobId, level, message) {
    const job = jobs.get(jobId)
    if (job === undefined) return
    job.lines.push({ at: nowIso(now), level, message: clampText(message) })
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
  }

  function progress(jobId, done, total) {
    const job = jobs.get(jobId)
    if (job === undefined) return
    job.progress = { done, total }
  }

  function finish(jobId, { result = null, error = null } = {}) {
    const job = jobs.get(jobId)
    if (job === undefined) return null
    job.status = error === null ? 'done' : 'failed'
    job.finishedAt = nowIso(now)
    job.result = result
    job.error = error === null ? null : clampText(error)
    if (job.progress.total > 0) job.progress = { ...job.progress, done: job.progress.total }
    return snapshot(job)
  }

  function snapshot(job) {
    if (job === undefined || job === null) return null
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: job.progress,
      lines: job.lines,
      result: job.result,
      error: job.error,
      ...(job.previewId === undefined ? {} : { previewId: job.previewId }),
    }
  }

  function get(jobId) {
    return snapshot(jobs.get(jobId))
  }

  function latest(kind) {
    let found = null
    for (const job of jobs.values()) {
      if (kind !== undefined && job.kind !== kind) continue
      found = job
    }
    return snapshot(found)
  }

  function list(kind) {
    const items = []
    for (const job of jobs.values()) {
      if (kind !== undefined && job.kind !== kind) continue
      items.push(snapshot(job))
    }
    return items.slice(-keep).reverse()
  }

  return { start, append, progress, finish, get, latest, list }
}
