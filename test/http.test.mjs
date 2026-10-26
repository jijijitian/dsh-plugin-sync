import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig } from '../lib/config.js'
import { registerApiRoutes } from '../lib/http.js'

function createHarness() {
  const routes = new Map()
  const registrations = []
  const state = {
    current: {
      repo: '',
      branch: 'main',
      path: 'dsh-plugins.json',
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
        inherited: { repo: '' },
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
    get: (name) => (name === 'configEditor' ? editor : undefined),
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
      return { ok: true, configured: false, config: { repo: '' }, token: { configured: false }, local: null, state: {} }
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
  const route = routes.get('/dsh-plugin-sync/api/status')
  assert.ok(route)
  const response = fakeResponse()
  await route.handler(request(), response)
  assert.equal(response.status, 200)
  const data = JSON.parse(response.body)
  assert.equal(data.ok, true)
  assert.equal(data.configSnapshot.values.hostId, 'host-a')
  assert.equal(JSON.stringify(data).includes('secret'), false)
})

test('config route saves allowed fields through configEditor', async () => {
  const { routes, state } = createHarness()
  const route = routes.get('/dsh-plugin-sync/api/config')
  const response = fakeResponse()
  await route.handler(request({
    method: 'POST',
    body: { values: { repo: 'owner/repo', branch: 'dev', maxInstallsPerRun: 4 } },
  }), response)
  assert.equal(response.status, 200)
  const data = JSON.parse(response.body)
  assert.equal(data.ok, true)
  assert.equal(state.current.repo, 'owner/repo')
  assert.equal(state.current.branch, 'dev')
  assert.equal(state.current.maxInstallsPerRun, 4)
})

test('config route rejects an invalid repository and cross-origin requests', async () => {
  const { routes } = createHarness()
  const route = routes.get('/dsh-plugin-sync/api/config')
  const bad = fakeResponse()
  await route.handler(request({ method: 'POST', body: { values: { repo: 'not a repo' } } }), bad)
  assert.equal(bad.status, 400)
  assert.match(bad.body, /owner\/repository/)

  const crossed = fakeResponse()
  await route.handler(request({ method: 'GET', origin: 'https://evil.example' }), crossed)
  assert.equal(crossed.status, 403)
})

test('routes enforce their method', async () => {
  const { routes } = createHarness()
  const route = routes.get('/dsh-plugin-sync/api/status')
  const response = fakeResponse()
  await route.handler(request({ method: 'POST', body: {} }), response)
  assert.equal(response.status, 405)
})
