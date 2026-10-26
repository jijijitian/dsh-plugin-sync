import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearCredential,
  defaultHostId,
  describeCredential,
  normalizeConfig,
  normalizeGistId,
  publicConfig,
  readConfigSnapshot,
  serializeConfig,
  setCredential,
  writeConfigValues,
} from '../lib/config.js'

function fakeContext(currentRaw, inherited) {
  const state = { current: currentRaw, written: null }
  const editor = {
    configuration() {
      return [{
        entry: { options: { id: 'dsh-plugin-sync', config: state.current } },
        inherited,
        override: {},
      }]
    },
    async edit(entry, change) {
      state.written = change(state.current, inherited)
      state.current = state.written
      entry.options.config = state.written
    },
  }
  return {
    state,
    ctx: { get: (name) => (name === 'configEditor' ? editor : undefined) },
  }
}

test('normalizeGistId accepts ids and gist URLs', () => {
  assert.equal(normalizeGistId('0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef')
  assert.equal(normalizeGistId('https://gist.github.com/user/0123456789abcdef'), '0123456789abcdef')
  assert.equal(normalizeGistId('https://gist.github.com/0123456789abcdef#file-x'), '0123456789abcdef')
  assert.equal(normalizeGistId('not an id'), '')
})

test('normalizeConfig keeps Gist defaults and rejects invalid ids', () => {
  const valid = normalizeConfig({ gistId: '0123456789abcdef', maxInstallsPerRun: 3 })
  assert.equal(valid.gistId, '0123456789abcdef')
  assert.equal(valid.fileName, 'dsh-plugins.json')
  assert.equal(valid.maxInstallsPerRun, 3)
  assert.equal(valid.hostId, defaultHostId())
  const invalid = normalizeConfig({ gistId: 'not an id' })
  assert.equal(invalid.gistId, '')
  assert.match(invalid.configError, /Gist id/)
  assert.equal(publicConfig(valid).token, undefined)
})

test('readConfigSnapshot exposes only the Gist id', () => {
  const current = {
    gistId: '0123456789abcdef',
    token: 'secret-token',
    tokenEnv: 'GITHUB_TOKEN',
    hostId: 'host-a',
    maxInstallsPerRun: 5,
  }
  const { ctx } = fakeContext(current, { gistId: '' })
  const snapshot = readConfigSnapshot(ctx, normalizeConfig(current))
  assert.equal(snapshot.editable, true)
  assert.equal(snapshot.values.gistId, '0123456789abcdef')
  assert.equal(snapshot.values.hostId, undefined)
  assert.equal(snapshot.values.token, undefined)
  assert.equal(JSON.stringify(snapshot).includes('secret-token'), false)
})

test('writeConfigValues updates the Gist id and preserves hidden internal settings', async () => {
  const current = {
    gistId: '',
    token: 'secret-token',
    fileName: 'inventory.json',
    maxInstallsPerRun: 7,
    hostId: 'work-pc',
  }
  const { ctx, state } = fakeContext(current, { gistId: '' })
  const values = await writeConfigValues(ctx, {
    gistId: 'https://gist.github.com/user/0123456789abcdef',
  }, normalizeConfig(current))
  assert.equal(values.gistId, '0123456789abcdef')
  assert.equal(values.fileName, undefined)
  assert.equal(state.written.gistId, '0123456789abcdef')
  assert.equal(state.written.fileName, 'inventory.json')
  assert.equal(state.written.maxInstallsPerRun, 7)
  assert.equal(state.written.hostId, 'work-pc')
  assert.equal(state.written.token, undefined)
  assert.equal(state.written.repo, undefined)
})

test('writeConfigValues rejects an invalid Gist id', async () => {
  const current = { gistId: '' }
  const { ctx } = fakeContext(current, { gistId: '' })
  await assert.rejects(
    () => writeConfigValues(ctx, { gistId: 'not an id' }, normalizeConfig(current)),
    (error) => error.code === 'invalid-config',
  )
})

test('serializeConfig only includes non-default hidden settings', () => {
  const config = normalizeConfig({
    gistId: '0123456789abcdef',
    token: 'abc',
    tokenEnv: 'GH',
    maxInstallsPerRun: 2,
  })
  const serialized = serializeConfig(config, {})
  assert.equal(serialized.gistId, '0123456789abcdef')
  assert.equal(serialized.token, undefined)
  assert.equal(serialized.tokenEnv, 'GH')
  assert.equal(serialized.maxInstallsPerRun, 2)
  assert.equal(serialized.apiBaseUrl, undefined)
  assert.equal(serialized.requestTimeoutMs, undefined)
})

test('credential helpers use the DSH credential service', async () => {
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
    async resolve() {
      return store.value === '' ? undefined : { value: store.value, source: 'file' }
    },
  }
  const ctx = { get: (name) => (name === 'credentials' ? credentials : undefined) }
  assert.equal((await describeCredential(ctx)).configured, false)
  await setCredential(ctx, 'ghp_test')
  const described = await describeCredential(ctx)
  assert.equal(described.configured, true)
  assert.equal(described.source, 'file')
  await clearCredential(ctx)
  assert.equal((await describeCredential(ctx)).configured, false)
})
