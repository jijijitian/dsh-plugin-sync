import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultHostId,
  normalizeConfig,
  publicConfig,
  readConfigSnapshot,
  serializeConfig,
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

test('normalizeConfig rejects invalid repository values and keeps defaults', () => {
  const valid = normalizeConfig({ repo: 'https://github.com/o/r.git', maxInstallsPerRun: 3 })
  assert.equal(valid.repo, 'o/r')
  assert.equal(valid.maxInstallsPerRun, 3)
  assert.equal(valid.hostId, defaultHostId())
  const invalid = normalizeConfig({ repo: 'not a repo' })
  assert.equal(invalid.repo, '')
  assert.match(invalid.configError, /owner\/repository/)
  assert.equal(publicConfig(valid).token, undefined)
})

test('readConfigSnapshot exposes editable values without the token', () => {
  const current = {
    repo: 'o/r',
    token: 'secret-token',
    tokenEnv: 'GITHUB_TOKEN',
    hostId: 'host-a',
    maxInstallsPerRun: 5,
  }
  const { ctx } = fakeContext(current, { repo: '' })
  const snapshot = readConfigSnapshot(ctx, normalizeConfig(current))
  assert.equal(snapshot.editable, true)
  assert.equal(snapshot.values.repo, 'o/r')
  assert.equal(snapshot.values.hostId, 'host-a')
  assert.equal(snapshot.values.token, undefined)
  assert.equal(JSON.stringify(snapshot).includes('secret-token'), false)
})

test('writeConfigValues updates allowed fields and preserves a hidden token', async () => {
  const current = { repo: '', token: 'secret-token', branch: 'main' }
  const { ctx, state } = fakeContext(current, { repo: '', branch: 'main' })
  const values = await writeConfigValues(ctx, {
    repo: 'owner/repo',
    branch: 'dev',
    path: 'manifests/plugins.json',
    hostId: 'work-pc',
    tokenEnv: 'MY_GH_TOKEN',
    tokenFile: '~/.dsh/gh-token',
    maxInstallsPerRun: 7,
  }, normalizeConfig(current))
  assert.equal(values.repo, 'owner/repo')
  assert.equal(values.branch, 'dev')
  assert.equal(state.written.repo, 'owner/repo')
  assert.equal(state.written.token, 'secret-token')
  assert.equal(state.written.maxInstallsPerRun, 7)
  assert.equal(state.written.autoSyncOnStart, undefined)
})

test('writeConfigValues rejects an invalid repository', async () => {
  const current = { repo: '' }
  const { ctx } = fakeContext(current, { repo: '' })
  await assert.rejects(
    () => writeConfigValues(ctx, { repo: 'not a repo' }, normalizeConfig(current)),
    (error) => error.code === 'invalid-config',
  )
})

test('serializeConfig only includes non-default transport fields', () => {
  const config = normalizeConfig({
    repo: 'o/r',
    token: 'abc',
    tokenEnv: 'GH',
    maxInstallsPerRun: 2,
  })
  const serialized = serializeConfig(config, {})
  assert.equal(serialized.repo, 'o/r')
  assert.equal(serialized.token, 'abc')
  assert.equal(serialized.maxInstallsPerRun, 2)
  assert.equal(serialized.apiBaseUrl, undefined)
  assert.equal(serialized.requestTimeoutMs, undefined)
})
