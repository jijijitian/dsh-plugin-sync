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
      writes += 1
      if (state !== null && body.sha !== state.sha) {
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'sha does not match' }))
        return
      }
      state = {
        text: Buffer.from(body.content, 'base64').toString('utf8'),
        sha: `sha-${Date.now()}`,
      }
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
    hostId: 'host-b',
    stateFile: '',
    profile: 'desktop',
    dshHome: '',
    autoSyncOnStart: false,
    startupDelayMs: 0,
    syncIntervalMinutes: 0,
    syncOnPluginChange: false,
    changeDebounceMs: 1000,
    autoInstall: true,
    dryRun: false,
    maxInstallsPerRun: 8,
    includeDisabledBundles: false,
    enableExistingBundles: false,
    excludeBundles: [],
    allowInsecureHttp: true,
    requestTimeoutMs: 5000,
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
    const name = spec.includes('@') && !spec.startsWith('@') ? spec.slice(0, spec.lastIndexOf('@')) : spec.replace(/@[^@]*$/, '')
    this.bundles.push({
      name,
      spec,
      version: '0.74.0',
      availability: 'profile',
      installed: true,
      enabled: true,
      removable: true,
      source: spec,
    })
    return { changed: true, application: 'applied', version: '0.74.0', warnings: [] }
  }

  async setBundleEnabled(name, enabled) {
    this.enableCalls.push({ name, enabled })
    return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
  }
}

test('sync pushes the local host and installs missing remote bundles', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': {
        hostId: 'host-a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [
          { name: 'dsh-context', spec: 'dsh-context@0.74.0', version: '0.74.0', enabled: true },
        ],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-other', spec: 'dsh-other@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true, source: 'dsh-other@^1.0.0' },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const result = await runtime.run('sync', { dryRun: false })
  assert.equal(result.ok, true)
  assert.equal(result.push.status, 'pushed')
  assert.equal(result.install.installed.length, 1)
  assert.equal(manager.calls.length, 1)
  assert.equal(manager.calls[0].spec, 'dsh-context@0.74.0')
  const remote = mock.read()
  assert.deepEqual(Object.keys(remote.hosts).sort(), ['host-a', 'host-b'])
  assert.deepEqual(remote.hosts['host-b'].bundles.map((bundle) => bundle.name), ['dsh-other'])
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(typeof state.lastSyncAt, 'string')
  assert.equal(state.lastResults[0].name, 'dsh-context')
})

test('dry run plans installs without calling the plugin manager', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      a: { bundles: [{ name: 'missing', spec: 'missing@1.0.0', version: '1.0.0', enabled: true }] },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl, token: '' }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const result = await runtime.run('sync', { dryRun: true })
  assert.equal(result.install.dryRun, true)
  assert.equal(result.install.planned[0].name, 'missing')
  assert.equal(result.push.status, 'skipped')
  assert.equal(manager.calls.length, 0)
})

test('without a token sync still installs but reports the failed push', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      a: { bundles: [{ name: 'missing', spec: 'missing@1.0.0', version: '1.0.0', enabled: true }] },
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
  const result = await runtime.run('sync', { dryRun: false })
  assert.equal(result.ok, false)
  assert.equal(result.push.status, 'failed')
  assert.equal(result.push.error.code, 'no-token')
  assert.equal(result.install.installed.length, 1)
  assert.equal(manager.calls.length, 1)
})

test('an unchanged host entry skips the GitHub write', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-b': {
        hostId: 'host-b',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [
          { name: 'dsh-other', spec: 'dsh-other@1.0.0', version: '1.0.0', enabled: true },
        ],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-other', spec: 'dsh-other@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true, source: 'dsh-other@^1.0.0' },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const result = await runtime.run('sync', { dryRun: false })
  assert.equal(result.ok, true)
  assert.equal(result.push.status, 'unchanged')
  assert.equal(mock.writes(), 0)
  assert.equal(manager.calls.length, 0)
})

test('invalid remote JSON is not overwritten', async (t) => {
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
  const result = await runtime.run('sync', { dryRun: false })
  assert.equal(result.ok, false)
  assert.equal(result.push.status, 'failed')
  assert.equal(result.push.error.code, 'invalid-manifest')
  assert.equal(result.pull.status, 'failed')
  assert.equal(manager.calls.length, 0)
})
