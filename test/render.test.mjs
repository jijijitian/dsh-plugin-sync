import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, renderToolResult } from '../index.js'

test('status rendering handles an empty last run', () => {
  const blocks = renderToolResult({ action: 'status' }, {
    ok: true,
    action: 'status',
    hostId: 'host-a',
    config: { gistId: '0123456789abcdef', fileName: 'dsh-plugins.json' },
    gistId: '0123456789abcdef',
    gistUrl: 'https://gist.github.com/0123456789abcdef',
    token: { configured: false, source: null },
    local: { profileBundles: 2, portableBundles: 1 },
    state: { lastPreviewAt: '2026-01-01T00:00:00.000Z', remote: null, lastResults: [] },
    statePath: 'C:/state.json',
  })
  assert.equal(blocks.length, 1)
  assert.match(blocks[0].text, /Plugin Sync — status/)
  assert.match(blocks[0].text, /Token: not configured/)
  assert.match(blocks[0].text, /Last preview: 2026-01-01/)
})

test('preview rendering includes conflicts and actions', () => {
  const blocks = renderToolResult({ action: 'preview' }, {
    ok: true,
    action: 'preview',
    previewId: 'preview-1',
    counts: { actionable: 1, conflicts: 1, localOnly: 0 },
    entries: [
      {
        id: 'pkg',
        name: 'pkg',
        kind: 'upgrade',
        local: { version: '1.0.0' },
        remote: { version: '2.0.0', hosts: ['host-a'] },
        conflict: { type: 'host-disagreement' },
        defaultChoice: 'remote',
      },
    ],
    remote: { hostCount: 1, bundleCount: 1 },
  })
  assert.match(blocks[0].text, /Preview: 1 default action\(s\), 1 conflict\(s\)/)
  assert.match(blocks[0].text, /pkg: upgrade/)
  assert.match(blocks[0].text, /hosts disagree/)
  assert.match(blocks[0].text, /Preview ID: preview-1/)
})

test('apply rendering lists installed and failed entries', () => {
  const blocks = renderToolResult({ action: 'apply' }, {
    ok: false,
    action: 'apply',
    applied: [{ name: 'one', status: 'installed' }],
    failed: [{ name: 'two', error: 'boom' }],
    skipped: [],
  })
  assert.match(blocks[0].text, /Applied: 1/)
  assert.match(blocks[0].text, /\+ one/)
  assert.match(blocks[0].text, /! two: boom/)
})

test('normalizeConfig derives a host id and rejects invalid Gist ids', () => {
  const valid = normalizeConfig({ gistId: '0123456789abcdef' })
  assert.equal(valid.gistId, '0123456789abcdef')
  assert.ok(valid.hostId.length > 0)
  const invalid = normalizeConfig({ gistId: 'not an id' })
  assert.equal(invalid.gistId, '')
  assert.match(invalid.configError, /Gist id/)
})

test('normalizeConfig rejects insecure non-loopback API URLs', () => {
  const config = normalizeConfig({ gistId: '0123456789abcdef', apiBaseUrl: 'http://example.com/api' })
  assert.equal(config.apiBaseUrl, 'https://api.github.com')
  assert.match(config.configError, /plain HTTP/)
  const loopback = normalizeConfig({ gistId: '0123456789abcdef', apiBaseUrl: 'http://127.0.0.1:1234' })
  assert.equal(loopback.apiBaseUrl, 'http://127.0.0.1:1234')
  assert.equal(loopback.configError, undefined)
})
