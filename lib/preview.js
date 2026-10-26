import { desiredBundles, pickInstallSpec, summarizeManifest } from './manifest.js'
import { compareVersions } from './spec.js'

const KIND_ORDER = new Map([
  ['install', 0],
  ['upgrade', 1],
  ['downgrade', 2],
  ['spec-change', 3],
  ['enable', 4],
  ['remote-disabled', 5],
  ['current', 6],
  ['local-only', 7],
])

function localInstalled(bundle) {
  return bundle !== null
    && typeof bundle === 'object'
    && (bundle.installed === true || bundle.availability === 'profile')
}

function localView(bundle) {
  if (bundle === null) return null
  return {
    version: typeof bundle.version === 'string' ? bundle.version : '',
    spec: pickInstallSpec(bundle),
    enabled: bundle.enabled !== false,
    source: typeof bundle.source === 'string' ? bundle.source : '',
  }
}

function uniqueVariants(item) {
  const seen = new Set()
  const variants = []
  for (const variant of item.variants ?? []) {
    const key = `${variant.hostId}\u0000${variant.spec}\u0000${variant.version}`
    if (seen.has(key)) continue
    seen.add(key)
    variants.push({
      hostId: variant.hostId,
      spec: variant.spec,
      version: variant.version,
      enabled: variant.enabled !== false,
    })
    if (variants.length >= 20) break
  }
  return variants
}

function hostConflict(item) {
  return item.hostConflict === true
    ? {
        type: 'host-disagreement',
        variants: uniqueVariants(item),
      }
    : null
}

export function buildPreview({
  manifest,
  localBundles = [],
  hostId,
  exclude = [],
  now = new Date().toISOString(),
} = {}) {
  const remote = desiredBundles(manifest, {
    includeDisabled: true,
    exclude,
    excludeHosts: hostId === undefined ? [] : [hostId],
  })
  const local = new Map()
  for (const bundle of localBundles) {
    if (bundle !== null && typeof bundle === 'object' && typeof bundle.name === 'string' && localInstalled(bundle)) {
      local.set(bundle.name, bundle)
    }
  }
  const entries = []
  const seen = new Set()

  for (const item of remote) {
    seen.add(item.name)
    const current = local.get(item.name) ?? null
    const currentView = localView(current)
    const variants = uniqueVariants(item)
    const sourceHosts = variants.map((variant) => variant.hostId)
    const conflictFromHosts = hostConflict(item)
    let kind
    let choices
    let defaultChoice
    let conflict = null

    if (current === null) {
      kind = item.enabled ? 'install' : 'remote-disabled'
      choices = item.enabled ? ['remote', 'skip'] : ['skip']
      defaultChoice = item.enabled ? 'remote' : 'skip'
      if (item.enabled && conflictFromHosts !== null) conflict = conflictFromHosts
    } else if (!item.enabled) {
      kind = 'remote-disabled'
      choices = ['local']
      defaultChoice = 'local'
    } else {
      const sameSpec = currentView.spec !== '' && currentView.spec === item.spec
      const versionOrder = compareVersions(item.version, currentView.version)
      if (sameSpec) {
        if (currentView.enabled === false) {
          kind = 'enable'
          choices = ['remote', 'local']
          defaultChoice = 'local'
          conflict = { type: 'enable-state' }
        } else {
          kind = 'current'
          choices = ['local']
          defaultChoice = 'local'
        }
      } else if (item.hostConflict) {
        kind = versionOrder > 0 ? 'upgrade' : versionOrder < 0 ? 'downgrade' : 'spec-change'
        choices = ['remote', 'local', 'skip']
        defaultChoice = versionOrder > 0 ? 'remote' : 'local'
        conflict = conflictFromHosts
      } else if (versionOrder > 0) {
        kind = 'upgrade'
        choices = ['remote', 'local']
        defaultChoice = 'remote'
      } else if (versionOrder < 0) {
        kind = 'downgrade'
        choices = ['remote', 'local', 'skip']
        defaultChoice = 'local'
        conflict = { type: 'downgrade' }
      } else {
        kind = 'spec-change'
        choices = ['remote', 'local', 'skip']
        defaultChoice = 'local'
        conflict = { type: 'spec-change' }
      }
    }

    entries.push({
      id: item.name,
      name: item.name,
      kind,
      local: currentView,
      remote: {
        spec: item.spec,
        version: item.version,
        enabled: item.enabled,
        hosts: sourceHosts,
        variants,
      },
      conflict,
      choices,
      defaultChoice,
    })
  }

  for (const [name, bundle] of local) {
    if (seen.has(name)) continue
    entries.push({
      id: name,
      name,
      kind: 'local-only',
      local: localView(bundle),
      remote: null,
      conflict: null,
      choices: ['local'],
      defaultChoice: 'local',
    })
  }

  entries.sort((left, right) => {
    const kindOrder = (KIND_ORDER.get(left.kind) ?? 99) - (KIND_ORDER.get(right.kind) ?? 99)
    if (kindOrder !== 0) return kindOrder
    return left.name.localeCompare(right.name)
  })

  const conflicts = entries.filter((entry) => entry.conflict !== null)
  const counts = {
    entries: entries.length,
    conflicts: conflicts.length,
    install: entries.filter((entry) => entry.kind === 'install').length,
    upgrade: entries.filter((entry) => entry.kind === 'upgrade').length,
    downgrade: entries.filter((entry) => entry.kind === 'downgrade').length,
    specChange: entries.filter((entry) => entry.kind === 'spec-change').length,
    enable: entries.filter((entry) => entry.kind === 'enable').length,
    localOnly: entries.filter((entry) => entry.kind === 'local-only').length,
    actionable: entries.filter((entry) => entry.defaultChoice === 'remote').length,
  }
  const remoteSummary = summarizeManifest(manifest)
  return {
    generatedAt: now,
    remote: {
      updatedAt: remoteSummary.updatedAt,
      hostCount: remoteSummary.hostCount,
      bundleCount: remoteSummary.bundleCount,
      hosts: remoteSummary.hosts,
    },
    local: {
      profileBundles: [...local.values()].length,
    },
    entries,
    conflicts,
    counts,
  }
}

export function selectPreviewEntries(preview, selections = {}) {
  const chosen = []
  for (const entry of preview.entries) {
    const raw = selections[entry.id]
    const choice = entry.choices.includes(raw) ? raw : entry.defaultChoice
    if (choice !== 'remote') continue
    chosen.push({ entry, choice })
  }
  return chosen
}
