import { readFileSync } from 'node:fs'
import { emptyManifest, normalizeManifest } from './manifest.js'
import { expandHome } from './spec.js'

const USER_AGENT = 'dsh-plugin-sync/1.0.0'
const MAX_MANIFEST_BYTES = 1_000_000

export class GitHubError extends Error {
  constructor(message, { code = 'github-error', status = undefined, retryable = false, body = undefined } = {}) {
    super(message)
    this.name = 'GitHubError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.body = body
  }
}

export function resolveToken({ token = '', tokenEnv = 'GITHUB_TOKEN', tokenFile = '', env = process.env } = {}) {
  if (typeof token === 'string' && token.trim() !== '') {
    return { token: token.trim(), source: 'config' }
  }
  if (typeof tokenEnv === 'string' && tokenEnv.trim() !== '') {
    const value = env[tokenEnv.trim()]
    if (typeof value === 'string' && value.trim() !== '') {
      return { token: value.trim(), source: `env:${tokenEnv.trim()}` }
    }
  }
  const file = expandHome(tokenFile)
  if (file !== '') {
    try {
      const value = readFileSync(file, 'utf8').trim()
      if (value !== '') return { token: value, source: 'file' }
    } catch {
      return { token: '', source: null }
    }
  }
  return { token: '', source: null }
}

function encodePath(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function parseApiBase(value) {
  const fallback = 'https://api.github.com'
  if (typeof value !== 'string' || value.trim() === '') return fallback
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return fallback
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function errorMessageFromBody(body, status) {
  if (typeof body === 'string' && body.trim() !== '') return body.trim().slice(0, 500)
  if (body !== null && typeof body === 'object' && typeof body.message === 'string') return body.message
  return `GitHub API request failed with status ${status}`
}

function isConflictBody(body) {
  if (body === null || typeof body !== 'object') return false
  if (body.status === '409') return true
  const text = `${body.message ?? ''} ${JSON.stringify(body.errors ?? '')}`
  return /sha|does not match|conflict|already exists/i.test(text)
}

export function createGitHubClient({
  repo,
  branch = 'main',
  path = 'dsh-plugins.json',
  apiBaseUrl = 'https://api.github.com',
  token = '',
  timeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new GitHubError('fetch is unavailable in this Host', { code: 'no-fetch' })
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GitHubError('config.repo must be "owner/repository"', { code: 'invalid-repo' })
  }
  if (
    typeof path !== 'string'
    || path.trim() === ''
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new GitHubError('config.path must be a repository-relative file path', { code: 'invalid-path' })
  }
  const base = parseApiBase(apiBaseUrl)

  async function request(urlPath, { method = 'GET', body, allow404 = false, extraSignal } = {}) {
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
    }
    if (token !== '') headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    const signals = [AbortSignal.timeout(timeoutMs)]
    for (const candidate of [signal, extraSignal]) {
      if (candidate !== undefined) signals.push(candidate)
    }
    const combined = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    let response
    try {
      response = await fetchImpl(`${base}${urlPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (combined.aborted) {
        throw new GitHubError('GitHub request was aborted or timed out', { code: 'timeout', retryable: true })
      }
      throw new GitHubError(`GitHub request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: 'network',
        retryable: true,
      })
    }
    const raw = await response.text()
    let parsed = null
    if (raw.trim() !== '') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }
    if (response.ok) return { status: response.status, body: parsed, headers: response.headers }
    if (response.status === 404 && allow404) return null
    if (response.status === 409 || (response.status === 422 && isConflictBody(parsed))) {
      throw new GitHubError(errorMessageFromBody(parsed, response.status), {
        code: 'conflict',
        status: response.status,
        retryable: true,
        body: parsed,
      })
    }
    const retryable = response.status === 429 || response.status >= 500
    const code = response.status === 401 || response.status === 403
      ? 'auth'
      : response.status === 404
        ? 'not-found'
        : retryable
          ? 'server'
          : 'github-error'
    throw new GitHubError(errorMessageFromBody(parsed, response.status), {
      code,
      status: response.status,
      retryable,
      body: parsed,
    })
  }

  async function readManifest({ extraSignal } = {}) {
    const url = `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`
    const response = await request(url, { allow404: true, extraSignal })
    if (response === null) {
      return { manifest: emptyManifest(), sha: null, htmlUrl: null, exists: false }
    }
    const file = response.body
    if (file === null || typeof file !== 'object' || typeof file.content !== 'string') {
      throw new GitHubError('GitHub did not return file content (the file may be larger than 1 MB)', {
        code: 'invalid-response',
      })
    }
    if (file.encoding !== 'base64') {
      throw new GitHubError(`Unsupported GitHub file encoding: ${String(file.encoding)}`, { code: 'invalid-response' })
    }
    const bytes = Buffer.from(file.content.replace(/\s+/g, ''), 'base64')
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      throw new GitHubError('Remote plugin manifest is larger than 1 MB', { code: 'manifest-too-large' })
    }
    const text = bytes.toString('utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new GitHubError(`Remote plugin manifest is not valid JSON (${path})`, { code: 'invalid-manifest' })
    }
    const manifest = normalizeManifest(parsed, { source: `${repo}/${path}`, requireShape: true })
    return {
      manifest,
      sha: typeof file.sha === 'string' ? file.sha : null,
      htmlUrl: typeof file.html_url === 'string' ? file.html_url : null,
      exists: true,
    }
  }

  async function writeManifest(manifest, { sha = null, message = 'chore(plugin-sync): update manifest', extraSignal } = {}) {
    if (token === '') {
      throw new GitHubError(
        'A GitHub token is required to push the manifest. Set config.token, config.tokenEnv, or config.tokenFile.',
        { code: 'no-token' },
      )
    }
    const text = `${JSON.stringify(manifest, null, 2)}\n`
    const body = {
      message,
      content: Buffer.from(text, 'utf8').toString('base64'),
      branch,
      ...(sha === null || sha === '' ? {} : { sha }),
    }
    const response = await request(`/repos/${repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body,
      extraSignal,
    })
    const result = response.body
    return {
      sha: typeof result?.content?.sha === 'string' ? result.content.sha : null,
      commit: typeof result?.commit?.sha === 'string' ? result.commit.sha : null,
      htmlUrl: typeof result?.content?.html_url === 'string' ? result.content.html_url : null,
    }
  }

  return {
    repo,
    branch,
    path,
    apiBaseUrl: base,
    readManifest,
    writeManifest,
  }
}
