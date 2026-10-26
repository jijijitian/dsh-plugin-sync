import { homedir } from 'node:os'
import { isAbsolute, normalize, sep } from 'node:path'

const REJECTED_SCHEMES = /^(?:file|link|portal|workspace|catalog):/i
const PORTABLE_SCHEMES = /^(?:github:|git\+|https?:|npm:)/i
const SCP_LIKE = /^git@[^:\s]+:[^ \t]+$/

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function expandHome(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return normalize(`${homedir()}${sep}${trimmed.slice(2)}`)
  }
  return trimmed
}

export function normalizeRepo(value) {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (text === '') return ''
  text = text.replace(/^git\+/i, '')
  text = text.replace(/^https?:\/\/github\.com\//i, '')
  text = text.replace(/^git@github\.com:/i, '')
  text = text.replace(/\.git$/i, '')
  text = text.replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) return ''
  return text
}

export function normalizeBranch(value) {
  if (typeof value !== 'string') return 'main'
  const branch = value.trim()
  if (branch === '' || branch.length > 200) return 'main'
  if (branch.startsWith('-') || branch.includes('..') || /\s/.test(branch)) return 'main'
  return branch
}

export function normalizeManifestPath(value) {
  if (typeof value !== 'string') return 'dsh-plugins.json'
  const path = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (path === '' || path.length > 500) return 'dsh-plugins.json'
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'dsh-plugins.json'
  }
  return path
}

export function isLocalSpec(value) {
  if (typeof value !== 'string') return false
  const spec = value.trim()
  if (spec === '') return false
  if (REJECTED_SCHEMES.test(spec)) return true
  if (spec.startsWith('/') || spec.startsWith('\\') || spec.startsWith('~')) return true
  if (/^[A-Za-z]:[\\/]/.test(spec)) return true
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('.\\') || spec.startsWith('..\\')) {
    return true
  }
  if (spec.includes('\\')) return true
  if (spec.split('/').some((segment) => segment === '..')) return true
  return isAbsolute(spec)
}

export function isPortableSpec(value) {
  if (typeof value !== 'string') return false
  const spec = value.trim()
  if (spec === '' || spec.length > 2048) return false
  if (isLocalSpec(spec)) return false
  if (PORTABLE_SCHEMES.test(spec) || SCP_LIKE.test(spec)) return true
  if (/^@[^/\s]+\/[^/\s]+(?:\/[^/\s]+)?(@[^\s]+)?$/.test(spec)) return true
  if (/^[^/@\s][^/\s]*(?:@[^\s]+)?$/.test(spec)) return true
  return false
}

export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
  if (leftNumber !== null) return -1
  if (rightNumber !== null) return 1
  return left.localeCompare(right)
}

export function compareVersions(left, right) {
  const a = typeof left === 'object' && left !== null ? left : parseVersion(left)
  const b = typeof right === 'object' && right !== null ? right : parseVersion(right)
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (b.prerelease.length === 0 && a.prerelease.length > 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const compared = compareIdentifiers(leftPart, rightPart)
    if (compared !== 0) return compared
  }
  return 0
}

export function formatIso(value, fallback = new Date().toISOString()) {
  if (typeof value !== 'string') return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}
