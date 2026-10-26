import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, renderToolResult } from '../index.js'

test('status rendering handles an empty lastRun', () => {
  const blocks = renderToolResult({ action: 'status' }, {
    ok: true,
    action: 'status',
    hostId: 'host-a',
    config: { repo: 'o/r', branch: 'main', path: 'dsh-plugins.json' },
    token: { configured: false, source: null },
    local: { profileBundles: 2, portableBundles: 1 },
    state: { lastRun: null, remote: null, lastResults: [] },
    statePath: 'C:/state.json',
  })
  assert.equal(blocks.length, 1)
  assert.match(blocks[0].text, /Plugin Sync — status/)
  assert.match(blocks[0].text, /Token: not configured/)
  assert.doesNotMatch(blocks[0].text, /Last run:/)
})

test('sync rendering includes install outcomes', () => {
  const blocks = renderToolResult({ action: 'sync' }, {
    ok: true,
    action: 'sync',
    hostId: 'host-a',
    push: { status: 'pushed', commit: 'abcdef1234567890', attempts: 1 },
    pull: { status: 'merged', sha: 'abcdef1234567890' },
    remote: { hostCount: 1, bundleCount: 1, hosts: [{ hostId: 'a', bundles: 1, updatedAt: '2026-01-01T00:00:00.000Z' }] },
    install: {
      dryRun: false,
      plannedTotal: 1,
      installed: [{ name: 'pkg', status: 'installed', application: 'applied' }],
      failed: [],
      skipped: [],
    },
  })
  assert.match(blocks[0].text, /pushed abcdef123456/)
  assert.match(blocks[0].text, /\+ pkg/)
})

test('normalizeConfig derives a host id and rejects invalid repos', () => {
  const valid = normalizeConfig({ repo: 'https://github.com/o/r.git', autoInstall: false })
  assert.equal(valid.repo, 'o/r')
  assert.equal(valid.autoInstall, false)
  assert.ok(valid.hostId.length > 0)
  const invalid = normalizeConfig({ repo: 'not a repo' })
  assert.equal(invalid.repo, '')
  assert.match(invalid.configError, /owner\/repository/)
})

test('normalizeConfig rejects insecure non-loopback API URLs', () => {
  const config = normalizeConfig({ repo: 'o/r', apiBaseUrl: 'http://example.com/api' })
  assert.equal(config.apiBaseUrl, 'https://api.github.com')
  assert.match(config.configError, /plain HTTP/)
  const loopback = normalizeConfig({ repo: 'o/r', apiBaseUrl: 'http://127.0.0.1:1234' })
  assert.equal(loopback.apiBaseUrl, 'http://127.0.0.1:1234')
  assert.equal(loopback.configError, undefined)
})
