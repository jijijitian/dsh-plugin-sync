import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSyncRuntime } from '../lib/sync.js'

function startMock(initial) {
  let state = initial === null
    ? null
    : {
        id: '0123456789abcdef',
        text: typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`,
        version: 'version-1',
      }
  let versionCounter = 1
  let writes = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
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
      if (state === null) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Not Found' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', etag: `"${state.version}"` })
      res.end(JSON.stringify({
        id: state.id,
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-01T00:00:00.000Z',
        history: [{ version: state.version }],
        files: {
          'dsh-plugins.json': { filename: 'dsh-plugins.json', content: state.text, truncated: false },
        },
      }))
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
      if (req.headers['if-match'] !== undefined && req.headers['if-match'] !== `"${state.version}"`) {
        res.writeHead(412, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'etag does not match' }))
        return
      }
      versionCounter += 1
      state = {
        ...state,
        text: body.files['dsh-plugins.json'].content,
        version: `version-${versionCounter}`,
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
        readState: () => (state === null ? null : { ...state, parsed: JSON.parse(state.text) }),
        writes: () => writes,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

function makeConfig(overrides = {}) {
  return {
    gistName: 'dsh-plugin-sync',
    fileName: 'dsh-plugins.json',
    description: 'DSH plugin inventory',
    apiBaseUrl: 'http://127.0.0.1:1',
    token: 'x',
    tokenEnv: 'GITHUB_TOKEN',
    tokenFile: '',
    hostId: 'host-local',
    stateFile: '',
    profile: 'desktop',
    dshHome: '',
    maxInstallsPerRun: 20,
    requestTimeoutMs: 5000,
    allowInsecureHttp: true,
    excludeBundles: [],
    configError: undefined,
    ...overrides,
  }
}

class FakeManager {
  constructor(bundles) {
    this.bundles = bundles
    this.calls = []
  }

  async listBundles() {
    return this.bundles.map((bundle) => ({ ...bundle }))
  }

  async installBundle(spec, options) {
    this.calls.push({ spec, options })
    const at = spec.lastIndexOf('@')
    const name = spec.startsWith('@') && at === 0 ? spec : at > 0 ? spec.slice(0, at) : spec
    this.bundles.push({
      name,
      spec,
      version: '9.9.9',
      availability: 'profile',
      installed: true,
      enabled: true,
      removable: true,
      source: spec,
    })
    return { changed: true, application: 'applied', version: '9.9.9', warnings: [] }
  }

  async setBundleEnabled(name, enabled) {
    return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
  }
}

function findEntry(preview, name) {
  return preview.entries.find((entry) => entry.name === name)
}

test('preview reads a Gist and applies only selected entries', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': {
        hostId: 'host-a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [
          { name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', enabled: true },
          { name: 'dsh-conflict', spec: 'dsh-conflict@1.0.0', version: '1.0.0', enabled: true },
        ],
      },
      'host-b': {
        hostId: 'host-b',
        updatedAt: '2026-01-02T00:00:00.000Z',
        bundles: [
          { name: 'dsh-conflict', spec: 'dsh-conflict@2.0.0', version: '2.0.0', enabled: true },
        ],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  assert.equal(preview.ok, true)
  assert.equal(typeof preview.previewId, 'string')
  assert.equal(preview.gistId, '0123456789abcdef')
  assert.equal(findEntry(preview, 'dsh-conflict').conflict.type, 'host-disagreement')
  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote', 'dsh-conflict': 'skip' })
  assert.equal(result.ok, true)
  assert.equal(manager.calls.length, 1)
  assert.equal(manager.calls[0].spec, 'dsh-extra@1.0.0')
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(state.gistId, '0123456789abcdef')
  assert.equal(typeof state.lastPreviewAt, 'string')
})

test('push updates an existing Gist and skips unchanged content', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { 'host-a': { hostId: 'host-a', bundles: [] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-local', spec: 'dsh-local@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true, source: 'dsh-local@1.0.0' },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const first = await runtime.push()
  assert.equal(first.status, 'pushed')
  assert.equal(first.created, false)
  assert.equal(mock.writes(), 1)
  assert.deepEqual(mock.readState().parsed.hosts['host-local'].bundles.map((bundle) => bundle.name), ['dsh-local'])
  const second = await runtime.push()
  assert.equal(second.status, 'unchanged')
  assert.equal(mock.writes(), 1)
})

test('push with no Gist id creates a secret Gist and remembers it', async (t) => {
  const mock = await startMock(null)
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const result = await runtime.push()
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
  assert.equal(result.gistId, '0123456789abcdef')
  assert.equal(mock.readState().parsed.schemaVersion, 1)
  assert.equal(mock.writes(), 1)
  const status = await runtime.status()
  assert.equal(status.gistId, '0123456789abcdef')
  assert.equal(status.gistUrl, 'https://gist.github.com/0123456789abcdef')
})

test('preview without a Gist id asks for one', async (t) => {
  const mock = await startMock(null)
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  await assert.rejects(() => runtime.preview(), /No Gist named/)
})

test('without a token preview and apply still work but push fails', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', enabled: true }] },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl, token: '', tokenEnv: 'NOT_SET' }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote' })
  assert.equal(result.ok, true)
  assert.equal(manager.calls.length, 1)
  await assert.rejects(() => runtime.push(), (error) => error.code === 'no-token')
})

test('invalid Gist JSON is rejected without a write', async (t) => {
  const mock = await startMock('{not json')
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  await assert.rejects(() => runtime.preview(), /not valid JSON/)
  await assert.rejects(() => runtime.push(), /not valid JSON/)
  assert.equal(mock.writes(), 0)
})
