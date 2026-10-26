import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig } from '../lib/config.js'
import { registerApiRoutes } from '../lib/http.js'

function createHarness(credentials = undefined) {
  const routes = new Map()
  const registrations = []
  const state = {
    current: {
      gistName: 'dsh-plugin-sync',
      fileName: 'dsh-plugins.json',
      description: 'DSH plugin inventory',
      hostId: 'host-a',
      tokenEnv: 'GITHUB_TOKEN',
      tokenFile: '',
      maxInstallsPerRun: 20,
    },
    written: null,
  }
  const editor = {
    configuration() {
      return [{
        entry: { options: { id: 'dsh-plugin-sync', config: state.current } },
        inherited: { gistName: '' },
        override: {},
      }]
    },
    async edit(entry, change) {
      state.written = change(state.current, {})
      state.current = state.written
      entry.options.config = state.written
    },
  }
  const ctx = {
    get: (name) => {
      if (name === 'configEditor') return editor
      if (name === 'credentials') return credentials
      return undefined
    },
    inject: (services, callback) => {
      assert.deepEqual(services, ['webServer'])
      callback({
        effect: (fn) => fn(),
        webServer: {
          register(route) {
            registrations.push(route)
            routes.set(route.path, route)
            return () => {}
          },
        },
      })
    },
  }
  const config = normalizeConfig(state.current)
  const runtime = {
    async status() {
      return { ok: true, configured: false, gistName: 'dsh-plugin-sync', gistId: '', config: { gistName: 'dsh-plugin-sync' }, token: { configured: false }, local: null, state: {} }
    },
  }
  registerApiRoutes({ ctx, runtime, config })
  return { routes, registrations, state, config }
}

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

function request({ method = 'GET', origin, body } = {}) {
  const headers = { host: '127.0.0.1:1234' }
  if (origin !== undefined) headers.origin = origin
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(JSON.stringify(body)))
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
}

test('status route returns config snapshot without the token', async () => {
  const { routes, registrations } = createHarness()
  assert.equal(registrations.length, 5)
  assert.equal(new Set(registrations.map((route) => route.path)).size, 5)
  const route = routes.get('/dsh-plugin-sync/api/v2/status')
  assert.ok(route)
  const response = fakeResponse()
  await route.handler(request(), response)
  assert.equal(response.status, 200)
  const data = JSON.parse(response.body)
  assert.equal(data.ok, true)
  assert.equal(data.configSnapshot.values.gistName, 'dsh-plugin-sync')
  assert.equal(JSON.stringify(data).includes('secret'), false)
})

test('config route saves allowed fields through configEditor', async () => {
  const { routes, state } = createHarness()
  const route = routes.get('/dsh-plugin-sync/api/v2/config')
  const response = fakeResponse()
  await route.handler(request({
    method: 'POST',
    body: { values: { gistName: 'team-sync' } },
  }), response)
  assert.equal(response.status, 200)
  const data = JSON.parse(response.body)
  assert.equal(data.ok, true)
  assert.equal(state.current.gistName, 'team-sync')
  assert.equal(state.current.fileName, undefined)
  assert.equal(state.current.maxInstallsPerRun, undefined)
})

test('config route stores a page-entered token in credentials', async () => {
  const store = { value: '' }
  const credentials = {
    async describe() {
      return { configured: store.value !== '', writable: true, source: store.value === '' ? undefined : 'file' }
    },
    async set(ref, value) {
      assert.equal(ref, 'GITHUB_TOKEN')
      store.value = value
    },
    async unset() {
      store.value = ''
    },
  }
  const { routes } = createHarness(credentials)
  const route = routes.get('/dsh-plugin-sync/api/v2/config')
  const response = fakeResponse()
  await route.handler(request({
    method: 'POST',
    body: { values: { gistName: 'team-sync' }, token: 'ghp_test' },
  }), response)
  assert.equal(response.status, 200)
  assert.equal(store.value, 'ghp_test')
  const data = JSON.parse(response.body)
  assert.equal(data.credential.configured, true)
})

test('config route accepts a custom Gist name and rejects cross-origin requests', async () => {
  const { routes } = createHarness()
  const route = routes.get('/dsh-plugin-sync/api/v2/config')
  const bad = fakeResponse()
  await route.handler(request({ method: 'POST', body: { values: { gistName: 'team-sync' } } }), bad)
  assert.equal(bad.status, 200)

  const crossed = fakeResponse()
  await route.handler(request({ method: 'GET', origin: 'https://evil.example' }), crossed)
  assert.equal(crossed.status, 403)
})

test('routes enforce their method', async () => {
  const { routes } = createHarness()
  const route = routes.get('/dsh-plugin-sync/api/v2/status')
  const response = fakeResponse()
  await route.handler(request({ method: 'POST', body: {} }), response)
  assert.equal(response.status, 405)
})
