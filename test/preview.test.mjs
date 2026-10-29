import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPreview, selectPreviewEntries } from '../lib/preview.js'
import { normalizeManifest } from '../lib/manifest.js'

function bundle(name, version, spec, enabled = true) {
  return {
    name,
    version,
    source: spec,
    availability: 'profile',
    installed: true,
    removable: true,
    enabled,
  }
}

function manifestWith(hosts) {
  return normalizeManifest({
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    hosts,
  })
}

test('preview classifies installs, upgrades, conflicts, enables, and local-only bundles', () => {
  const manifest = manifestWith({
    'remote-a': {
      hostId: 'remote-a',
      updatedAt: '2026-01-01T00:00:00.000Z',
      bundles: [
        { name: 'missing', spec: 'missing@1.0.0', version: '1.0.0', enabled: true },
        { name: 'upgrade-me', spec: 'upgrade-me@2.0.0', version: '2.0.0', enabled: true },
        { name: 'downgrade-me', spec: 'downgrade-me@1.0.0', version: '1.0.0', enabled: true },
        { name: 'spec-me', spec: 'github:o/r#abc', version: '1.0.0', enabled: true },
        { name: 'enable-me', spec: 'enable-me@1.0.0', version: '1.0.0', enabled: true },
        { name: 'remote-off', spec: 'remote-off@1.0.0', version: '1.0.0', enabled: false },
      ],
    },
    'remote-b': {
      hostId: 'remote-b',
      updatedAt: '2026-01-02T00:00:00.000Z',
      bundles: [
        { name: 'host-clash', spec: 'host-clash@1.0.0', version: '1.0.0', enabled: true },
        { name: 'host-clash-local', spec: 'host-clash-local@1.0.0', version: '1.0.0', enabled: true },
      ],
    },
    'remote-c': {
      hostId: 'remote-c',
      updatedAt: '2026-01-03T00:00:00.000Z',
      bundles: [
        { name: 'host-clash', spec: 'host-clash@2.0.0', version: '2.0.0', enabled: true },
        { name: 'host-clash-local', spec: 'host-clash-local@2.0.0', version: '2.0.0', enabled: true },
      ],
    },
    'self-host': {
      hostId: 'self-host',
      updatedAt: '2026-01-04T00:00:00.000Z',
      bundles: [{ name: 'self-only', spec: 'self-only@1.0.0', version: '1.0.0', enabled: true }],
    },
  })
  const local = [
    bundle('upgrade-me', '1.0.0', 'upgrade-me@1.0.0'),
    bundle('downgrade-me', '2.0.0', 'downgrade-me@2.0.0'),
    bundle('spec-me', '1.0.0', 'spec-me@1.0.0'),
    bundle('enable-me', '1.0.0', 'enable-me@1.0.0', false),
    bundle('local-only', '1.0.0', 'local-only@1.0.0'),
    bundle('host-clash-local', '1.5.0', 'host-clash-local@1.5.0'),
  ]
  const preview = buildPreview({ manifest, localBundles: local, hostId: 'self-host' })
  const byName = new Map(preview.entries.map((entry) => [entry.name, entry]))

  assert.equal(byName.has('self-only'), false)
  assert.equal(byName.get('missing').kind, 'install')
  assert.equal(byName.get('missing').defaultChoice, 'remote')
  assert.equal(byName.get('upgrade-me').kind, 'upgrade')
  assert.equal(byName.get('upgrade-me').defaultChoice, 'remote')
  assert.equal(byName.get('downgrade-me').kind, 'downgrade')
  assert.equal(byName.get('downgrade-me').conflict.type, 'downgrade')
  assert.equal(byName.get('downgrade-me').defaultChoice, 'local')
  assert.equal(byName.get('spec-me').kind, 'spec-change')
  assert.equal(byName.get('spec-me').conflict.type, 'spec-change')
  assert.equal(byName.get('enable-me').kind, 'enable')
  assert.equal(byName.get('enable-me').conflict.type, 'enable-state')
  assert.equal(byName.get('enable-me').defaultChoice, 'local')
  assert.equal(byName.get('local-only').kind, 'local-only')
  assert.equal(byName.get('local-only').defaultChoice, 'local')
  assert.deepEqual(byName.get('local-only').choices, ['local', 'remove'])
  assert.equal(byName.get('remote-off').kind, 'remote-disabled')
  assert.equal(byName.get('remote-off').defaultChoice, 'skip')

  assert.equal(byName.get('host-clash').kind, 'install')
  assert.equal(byName.get('host-clash').conflict.type, 'host-disagreement')
  assert.equal(byName.get('host-clash').defaultChoice, 'remote')
  assert.equal(byName.get('host-clash').remote.variants.length, 2)
  assert.equal(byName.get('host-clash-local').kind, 'upgrade')
  assert.equal(byName.get('host-clash-local').conflict.type, 'host-disagreement')
  assert.equal(byName.get('host-clash-local').defaultChoice, 'remote')

  assert.equal(preview.counts.install, 2)
  assert.equal(preview.counts.upgrade, 2)
  assert.equal(preview.counts.downgrade, 1)
  assert.equal(preview.counts.specChange, 1)
  assert.equal(preview.counts.enable, 1)
  assert.equal(preview.counts.localOnly, 1)
  assert.equal(preview.counts.removable, 1)
  assert.equal(preview.counts.conflicts, 5)
})

test('a local-only bundle keeps only the keep choice when it cannot be removed', () => {
  const manifest = manifestWith({ remote: { hostId: 'remote', bundles: [] } })
  const local = [{ ...bundle('built-in', '1.0.0', 'built-in@1.0.0'), removable: false }]
  const preview = buildPreview({ manifest, localBundles: local, hostId: 'self' })
  const entry = preview.entries.find((item) => item.name === 'built-in')
  assert.equal(entry.kind, 'local-only')
  assert.deepEqual(entry.choices, ['local'])
  assert.equal(entry.defaultChoice, 'local')
  assert.equal(preview.counts.removable, 0)
})

test('selectPreviewEntries keeps remote and remove choices only', () => {
  const preview = {
    entries: [
      { id: 'a', choices: ['local', 'remove'], defaultChoice: 'local' },
      { id: 'b', choices: ['remote', 'local'], defaultChoice: 'remote' },
      { id: 'c', choices: ['local'], defaultChoice: 'local' },
    ],
  }
  const chosen = selectPreviewEntries(preview, { a: 'remove', b: 'remote' })
  assert.deepEqual(chosen.map((item) => [item.entry.id, item.choice]), [['a', 'remove'], ['b', 'remote']])
})

test('preview keeps a local-only bundle disabled from remote as local', () => {
  const manifest = manifestWith({
    remote: {
      hostId: 'remote',
      bundles: [{ name: 'already', spec: 'already@1.0.0', version: '1.0.0', enabled: false }],
    },
  })
  const local = [bundle('already', '1.0.0', 'already@1.0.0', true)]
  const preview = buildPreview({ manifest, localBundles: local, hostId: 'self' })
  assert.equal(preview.entries[0].kind, 'remote-disabled')
  assert.equal(preview.entries[0].defaultChoice, 'local')
  assert.equal(preview.entries[0].choices.includes('remote'), false)
})
