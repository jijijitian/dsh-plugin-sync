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
        text: typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`,
        sha: 'sha-1',
      }
  let writes = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
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
      }))
      return
    }
    if (req.method === 'PUT' && url.pathname.endsWith('/contents/dsh-plugins.json')) {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      if (state !== null && body.sha !== state.sha) {
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'sha does not match' }))
        return
      }
      state = {
        text: Buffer.from(body.content, 'base64').toString('utf8'),
        sha: `sha-${Date.now()}`,
      }
      writes += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        content: { sha: state.sha },
        commit: { sha: 'commit-1' },
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
        read: () => (state === null ? null : JSON.parse(state.text)),
        writes: () => writes,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

function makeConfig(overrides = {}) {
  return {
    repo: 'o/r',
    branch: 'main',
    path: 'dsh-plugins.json',
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
    this.enableCalls = []
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
    this.enableCalls.push({ name, enabled })
    return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
  }
}

function findEntry(preview, name) {
  return preview.entries.find((entry) => entry.name === name)
}

test('preview returns conflicts and apply installs only selected entries', async (t) => {
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
  const preview = await runtime.preview()
  assert.equal(preview.ok, true)
  assert.equal(typeof preview.previewId, 'string')
  assert.equal(findEntry(preview, 'dsh-extra').kind, 'install')
  assert.equal(findEntry(preview, 'dsh-conflict').conflict.type, 'host-disagreement')
  assert.equal(findEntry(preview, 'dsh-local').kind, 'local-only')
  assert.equal(preview.counts.conflicts, 1)

  const result = await runtime.apply(preview.previewId, {
    'dsh-extra': 'remote',
    'dsh-conflict': 'skip',
    'dsh-local': 'local',
  })
  assert.equal(result.ok, true)
  assert.equal(manager.calls.length, 1)
  assert.equal(manager.calls[0].spec, 'dsh-extra@1.0.0')
  assert.equal(result.applied[0].name, 'dsh-extra')
  await assert.rejects(() => runtime.apply(preview.previewId, {}), /expired|no longer/)
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(typeof state.lastPreviewAt, 'string')
  assert.equal(typeof state.lastApplyAt, 'string')
})

test('apply can use default choices for every remote candidate', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      remote: {
        bundles: [
          { name: 'one', spec: 'one@1.0.0', version: '1.0.0', enabled: true },
          { name: 'two', spec: 'two@1.0.0', version: '1.0.0', enabled: true },
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
  const result = await runtime.apply(preview.previewId, {})
  assert.equal(result.ok, true)
  assert.equal(manager.calls.length, 2)
  assert.deepEqual(manager.calls.map((call) => call.spec).sort(), ['one@1.0.0', 'two@1.0.0'])
})

test('push publishes this host and skips an unchanged write', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': { hostId: 'host-a', bundles: [] },
    },
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
  assert.equal(mock.writes(), 1)
  assert.deepEqual(mock.read().hosts['host-local'].bundles.map((bundle) => bundle.name), ['dsh-local'])
  const second = await runtime.push()
  assert.equal(second.status, 'unchanged')
  assert.equal(mock.writes(), 1)
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

test('invalid remote JSON is rejected without a write', async (t) => {
  const mock = await startMock('{not json')
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
  await assert.rejects(() => runtime.preview(), /not valid JSON/)
  await assert.rejects(() => runtime.push(), /not valid JSON/)
  assert.equal(mock.writes(), 0)
})
