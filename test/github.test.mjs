import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createGitHubClient, GitHubError, resolveToken } from '../lib/github.js'

function startMock({ initial = null, conflictOnce = false, token = '' } = {}) {
  let state = initial === null
    ? null
    : {
        text: typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`,
        sha: 'sha-1',
      }
  let conflict = conflictOnce
  let puts = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (token !== '' && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'Bad credentials' }))
      return
    }
    if (req.method === 'GET' && url.pathname.endsWith('/contents/dsh-plugins.json')) {
      if (state === null) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Not Found' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        content: Buffer.from(state.text, 'utf8').toString('base64'),
        encoding: 'base64',
        sha: state.sha,
        html_url: 'https://github.com/o/r/blob/main/dsh-plugins.json',
      }))
      return
    }
    if (req.method === 'PUT' && url.pathname.endsWith('/contents/dsh-plugins.json')) {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      puts += 1
      if (state !== null && body.sha !== state.sha) {
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'sha does not match' }))
        return
      }
      if (conflict) {
        conflict = false
        state = { text: state === null ? '{}\n' : state.text, sha: 'sha-remote' }
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'sha does not match' }))
        return
      }
      state = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 'sha-2' }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        content: { sha: 'sha-2', html_url: 'https://github.com/o/r/blob/main/dsh-plugins.json' },
        commit: { sha: 'commit-2' },
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
        close: () => new Promise((done) => server.close(done)),
        puts: () => puts,
      })
    })
  })
}

test('reads an existing manifest and reports its sha', async (t) => {
  const mock = await startMock({ initial: { schemaVersion: 1, hosts: { a: { bundles: [] } } } })
  t.after(() => mock.close())
  const client = createGitHubClient({
    repo: 'o/r',
    apiBaseUrl: mock.apiBaseUrl,
    token: 'x',
  })
  const remote = await client.readManifest()
  assert.equal(remote.exists, true)
  assert.equal(remote.sha, 'sha-1')
  assert.deepEqual(Object.keys(remote.manifest.hosts), ['a'])
})

test('treats a 404 as an empty manifest', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const client = createGitHubClient({ repo: 'o/r', apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const remote = await client.readManifest()
  assert.equal(remote.exists, false)
  assert.equal(remote.sha, null)
  assert.deepEqual(remote.manifest.hosts, {})
})

test('writes a manifest with and without a previous sha', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const client = createGitHubClient({ repo: 'o/r', apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const created = await client.writeManifest({ schemaVersion: 1, hosts: {} })
  assert.equal(created.sha, 'sha-2')
  assert.equal(created.commit, 'commit-2')
  assert.equal(mock.puts(), 1)
})

test('requires a token for writes', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const client = createGitHubClient({ repo: 'o/r', apiBaseUrl: mock.apiBaseUrl })
  await assert.rejects(
    () => client.writeManifest({ schemaVersion: 1, hosts: {} }),
    (error) => error instanceof GitHubError && error.code === 'no-token',
  )
})

test('surfaces a sha conflict so the caller can retry', async (t) => {
  const mock = await startMock({ initial: { schemaVersion: 1, hosts: {} }, conflictOnce: true })
  t.after(() => mock.close())
  const client = createGitHubClient({ repo: 'o/r', apiBaseUrl: mock.apiBaseUrl, token: 'x' })
  const remote = await client.readManifest()
  await assert.rejects(
    () => client.writeManifest({ schemaVersion: 1, hosts: {} }, { sha: remote.sha }),
    (error) => error instanceof GitHubError && error.code === 'conflict',
  )
})

test('resolveToken prefers config, then env, then file', async (t) => {
  assert.deepEqual(resolveToken({ token: 'direct', env: {} }), { token: 'direct', source: 'config' })
  assert.deepEqual(
    resolveToken({ tokenEnv: 'GH', env: { GH: 'from-env' } }),
    { token: 'from-env', source: 'env:GH' },
  )
  assert.deepEqual(resolveToken({ tokenEnv: 'MISSING', env: {} }), { token: '', source: null })
})
