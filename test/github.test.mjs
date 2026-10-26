import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createGitHubClient, GitHubError, resolveToken } from '../lib/github.js'

function manifest(hostId = 'host-a') {
  return {
    schemaVersion: 1,
    hosts: {
      [hostId]: {
        hostId,
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }],
      },
    },
  }
}

function startMock({ initial = null, token = '', conflictOnce = false, truncated = false } = {}) {
  let state = initial === null
    ? null
    : {
        id: '0123456789abcdef',
        text: `${JSON.stringify(initial, null, 2)}\n`,
        version: 'version-1',
      }
  let conflict = conflictOnce
  let reads = 0
  let writes = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (token !== '' && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'Bad credentials' }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/gists') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(state === null ? [] : [{
        id: state.id,
        description: 'dsh-plugin-sync',
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-02T00:00:00.000Z',
        history: [{ version: state.version }],
      }]))
      return
    }
    if (req.method === 'GET' && url.pathname === '/gists/0123456789abcdef') {
      reads += 1
      if (state === null) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Not Found' }))
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        etag: `"${state.version}"`,
      })
      res.end(JSON.stringify({
        id: state.id,
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-01T00:00:00.000Z',
        history: [{ version: state.version }],
        files: {
          'dsh-plugins.json': truncated
            ? { filename: 'dsh-plugins.json', content: '', truncated: true, raw_url: `http://${req.headers.host}/raw/0123456789abcdef` }
            : { filename: 'dsh-plugins.json', content: state.text, truncated: false },
        },
      }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/raw/0123456789abcdef') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(state.text)
      return
    }
    if (req.method === 'POST' && url.pathname === '/gists') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      state = {
        id: '0123456789abcdef',
        text: body.files['dsh-plugins.json'].content,
        version: 'version-1',
      }
      writes += 1
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: state.id,
        public: body.public,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-01T00:00:00.000Z',
        history: [{ version: state.version }],
      }))
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/gists/0123456789abcdef') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      if (conflict) {
        conflict = false
        state = { ...state, version: 'version-remote' }
        res.writeHead(412, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'etag does not match' }))
        return
      }
      if (req.headers['if-match'] !== undefined && req.headers['if-match'] !== `"${state.version}"`) {
        res.writeHead(412, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'etag does not match' }))
        return
      }
      state = {
        ...state,
        text: body.files['dsh-plugins.json'].content,
        version: `version-${writes + 1}`,
      }
      writes += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: state.id,
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-02T00:00:00.000Z',
        history: [{ version: state.version }],
      }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'Not Found' }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        readState: () => state,
        reads: () => reads,
        writes: () => writes,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test('reads a Gist manifest and returns its version', async (t) => {
  const mock = await startMock({ initial: manifest() })
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const remote = await client.readGist('0123456789abcdef', 'dsh-plugins.json')
  assert.equal(remote.exists, true)
  assert.equal(remote.version, 'version-1')
  assert.equal(remote.manifest.hosts['host-a'].bundles[0].name, 'pkg')
})

test('lists Gists with descriptions for name lookup', async (t) => {
  const mock = await startMock({ initial: manifest() })
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const gists = await client.listGists()
  assert.equal(gists.length, 1)
  assert.equal(gists[0].gistId, '0123456789abcdef')
  assert.equal(gists[0].description, 'dsh-plugin-sync')
})

test('a missing Gist file reads as an empty manifest', async (t) => {
  const mock = await startMock({ initial: manifest() })
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const remote = await client.readGist('0123456789abcdef', 'other.json')
  assert.equal(remote.exists, false)
  assert.deepEqual(remote.manifest.hosts, {})
})

test('a missing Gist is an error rather than an empty manifest', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  await assert.rejects(
    () => client.readGist('0123456789abcdef', 'dsh-plugins.json'),
    (error) => error instanceof GitHubError && error.code === 'not-found',
  )
})

test('creates and updates a Gist', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const created = await client.createGist({ manifest: manifest(), fileName: 'dsh-plugins.json' })
  assert.equal(created.gistId, '0123456789abcdef')
  assert.equal(mock.writes(), 1)
  const updated = await client.updateGist('0123456789abcdef', {
    manifest: { schemaVersion: 1, hosts: {} },
    fileName: 'dsh-plugins.json',
    ifMatch: '"version-1"',
  })
  assert.equal(updated.version, 'version-2')
  assert.equal(mock.writes(), 2)
})

test('requires a token for create and update', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl })
  await assert.rejects(
    () => client.createGist({ manifest: manifest() }),
    (error) => error instanceof GitHubError && error.code === 'no-token',
  )
  await assert.rejects(
    () => client.updateGist('0123456789abcdef', { manifest: manifest() }),
    (error) => error instanceof GitHubError && error.code === 'no-token',
  )
})

test('surfaces an ETag conflict for the caller to retry', async (t) => {
  const mock = await startMock({ initial: manifest(), conflictOnce: true })
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const remote = await client.readGist('0123456789abcdef', 'dsh-plugins.json')
  await assert.rejects(
    () => client.updateGist('0123456789abcdef', {
      manifest: { schemaVersion: 1, hosts: {} },
      ifMatch: remote.etag,
    }),
    (error) => error instanceof GitHubError && error.code === 'conflict',
  )
})

test('fetches truncated Gist content from its raw URL', async (t) => {
  const mock = await startMock({ initial: manifest(), truncated: true })
  t.after(() => mock.close())
  const client = createGitHubClient({ apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const remote = await client.readGist('0123456789abcdef', 'dsh-plugins.json')
  assert.equal(remote.exists, true)
  assert.equal(remote.manifest.hosts['host-a'].bundles[0].name, 'pkg')
})

test('resolveToken prefers config, then env, then file', () => {
  assert.deepEqual(resolveToken({ token: 'direct', env: {} }), { token: 'direct', source: 'config' })
  assert.deepEqual(
    resolveToken({ tokenEnv: 'GH', env: { GH: 'from-env' } }),
    { token: 'from-env', source: 'env:GH' },
  )
  assert.deepEqual(resolveToken({ tokenEnv: 'MISSING', env: {} }), { token: '', source: null })
})
