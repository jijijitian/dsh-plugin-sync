import { hostname } from 'node:os'
import { expandHome, normalizeBranch, normalizeManifestPath, normalizeRepo } from './spec.js'

export const DEFAULT_CONFIG = Object.freeze({
  repo: '',
  branch: 'main',
  path: 'dsh-plugins.json',
  apiBaseUrl: 'https://api.github.com',
  token: '',
  tokenEnv: 'GITHUB_TOKEN',
  tokenFile: '',
  hostId: '',
  stateFile: '',
  maxInstallsPerRun: 20,
  requestTimeoutMs: 30000,
  allowInsecureHttp: false,
  excludeBundles: [],
})

const UI_FIELDS = ['repo', 'branch', 'path', 'hostId', 'tokenEnv', 'tokenFile', 'maxInstallsPerRun']
const LEGACY_AUTO_FIELDS = [
  'autoSyncOnStart',
  'startupDelayMs',
  'syncIntervalMinutes',
  'syncOnPluginChange',
  'changeDebounceMs',
  'autoInstall',
  'dryRun',
  'includeDisabledBundles',
  'enableExistingBundles',
]

export class ConfigError extends Error {
  constructor(message, code = 'invalid-config') {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asInteger(value, fallback, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)))
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

export function defaultHostId() {
  const raw = hostname().trim().toLowerCase()
  const normalized = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
  return normalized === '' ? 'dsh-host' : normalized
}

function normalizeHostId(value) {
  const raw = asString(value)
  if (raw === '') return defaultHostId()
  const normalized = raw.replace(/[\u0000-\u001f\u007f]+/g, '-').replace(/\s+/g, '-').slice(0, 100)
  if (['__proto__', 'constructor', 'prototype'].includes(normalized)) return defaultHostId()
  return normalized
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function normalizeApiBaseUrl(value, allowInsecureHttp) {
  const fallback = DEFAULT_CONFIG.apiBaseUrl
  if (typeof value !== 'string' || value.trim() === '') return { value: fallback, error: null }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return { value: fallback, error: 'config.apiBaseUrl is not a valid URL; using api.github.com' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { value: fallback, error: 'config.apiBaseUrl must use http or https' }
  }
  if (url.protocol === 'http:' && !allowInsecureHttp && !isLoopbackHost(url.hostname)) {
    return {
      value: fallback,
      error: 'config.apiBaseUrl uses plain HTTP; set allowInsecureHttp only for a trusted local mock',
    }
  }
  url.search = ''
  url.hash = ''
  return { value: url.toString().replace(/\/+$/, ''), error: null }
}

function normalizeExclude(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim()
    if (name === '') continue
    seen.add(name)
  }
  return [...seen].slice(0, 500)
}

export function normalizeConfig(raw) {
  const input = isRecord(raw) ? raw : {}
  const allowInsecureHttp = asBoolean(input.allowInsecureHttp, DEFAULT_CONFIG.allowInsecureHttp)
  const apiBase = normalizeApiBaseUrl(input.apiBaseUrl, allowInsecureHttp)
  const repoText = asString(input.repo)
  const repo = normalizeRepo(repoText)
  const config = {
    repo,
    branch: normalizeBranch(asString(input.branch, DEFAULT_CONFIG.branch)),
    path: normalizeManifestPath(asString(input.path, DEFAULT_CONFIG.path)),
    apiBaseUrl: apiBase.value,
    token: asString(input.token),
    tokenEnv: asString(input.tokenEnv, DEFAULT_CONFIG.tokenEnv),
    tokenFile: expandHome(asString(input.tokenFile)),
    hostId: normalizeHostId(input.hostId),
    stateFile: expandHome(asString(input.stateFile)),
    profile: process.env.DSH_PROFILE || '',
    dshHome: process.env.DSH_HOME || '',
    maxInstallsPerRun: asInteger(input.maxInstallsPerRun, DEFAULT_CONFIG.maxInstallsPerRun, 1, 50),
    requestTimeoutMs: asInteger(input.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, 1_000, 120_000),
    allowInsecureHttp,
    excludeBundles: normalizeExclude(input.excludeBundles),
    configError: undefined,
  }
  if (repoText !== '' && repo === '') {
    config.configError = 'config.repo must be "owner/repository" (a GitHub URL is also accepted)'
  }
  if (apiBase.error !== null) {
    config.configError = config.configError === undefined ? apiBase.error : `${config.configError}; ${apiBase.error}`
  }
  return config
}

export function publicConfig(config) {
  return {
    repo: config.repo,
    branch: config.branch,
    path: config.path,
    hostId: config.hostId,
    hostIdDefault: defaultHostId(),
    tokenEnv: config.tokenEnv,
    tokenFile: config.tokenFile,
    maxInstallsPerRun: config.maxInstallsPerRun,
  }
}

export function serializeConfig(config, currentRaw = {}) {
  const raw = isRecord(currentRaw) ? currentRaw : {}
  const token = config.token || asString(raw.token)
  return {
    repo: config.repo,
    branch: config.branch,
    path: config.path,
    hostId: config.hostId,
    tokenEnv: config.tokenEnv,
    tokenFile: config.tokenFile,
    maxInstallsPerRun: config.maxInstallsPerRun,
    ...(token === '' ? {} : { token }),
    ...(config.apiBaseUrl === DEFAULT_CONFIG.apiBaseUrl ? {} : { apiBaseUrl: config.apiBaseUrl }),
    ...(config.requestTimeoutMs === DEFAULT_CONFIG.requestTimeoutMs
      ? {}
      : { requestTimeoutMs: config.requestTimeoutMs }),
    ...(config.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    ...(config.excludeBundles.length === 0 ? {} : { excludeBundles: config.excludeBundles }),
    ...(config.stateFile === '' ? {} : { stateFile: config.stateFile }),
  }
}

function findConfigEntry(editor) {
  const entries = editor.configuration()
  if (!Array.isArray(entries)) return null
  return entries.find((item) => item?.entry?.options?.id === 'dsh-plugin-sync') ?? null
}

export function readConfigSnapshot(ctx, fallbackConfig) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.configuration !== 'function') {
    return {
      editable: false,
      reason: 'config-editor-unavailable',
      values: publicConfig(fallbackConfig),
    }
  }
  let item
  try {
    item = findConfigEntry(editor)
  } catch (error) {
    return {
      editable: false,
      reason: 'config-read-failed',
      message: error instanceof Error ? error.message : String(error),
      values: publicConfig(fallbackConfig),
    }
  }
  if (item === null) {
    return {
      editable: false,
      reason: 'entry-not-found',
      values: publicConfig(fallbackConfig),
    }
  }
  const effective = normalizeConfig(item.entry?.options?.config ?? item.inherited ?? {})
  const inherited = normalizeConfig(item.inherited ?? {})
  return {
    editable: true,
    entryId: item.entry.options.id,
    values: publicConfig(effective),
    inherited: publicConfig(inherited),
    overridden: isRecord(item.override) && Object.keys(item.override).length > 0,
  }
}

export function sanitizeConfigPatch(values) {
  const input = isRecord(values) ? values : {}
  const patch = {}
  for (const key of UI_FIELDS) {
    if (!Object.hasOwn(input, key)) continue
    if (key === 'maxInstallsPerRun') {
      patch[key] = asInteger(input[key], DEFAULT_CONFIG.maxInstallsPerRun, 1, 50)
    } else {
      patch[key] = asString(input[key])
    }
  }
  return patch
}

export async function writeConfigValues(ctx, values, fallbackConfig) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.edit !== 'function') {
    throw new ConfigError('Configuration editing is unavailable on this Host', 'config-editor-unavailable')
  }
  const item = findConfigEntry(editor)
  if (item === null) throw new ConfigError('The plugin row cannot be located in the active profile', 'entry-not-found')
  const currentRaw = isRecord(item.entry?.options?.config) ? item.entry.options.config : {}
  const patch = sanitizeConfigPatch(values)
  const nextRaw = { ...currentRaw, ...patch }
  for (const key of LEGACY_AUTO_FIELDS) Reflect.deleteProperty(nextRaw, key)
  const normalized = normalizeConfig(nextRaw)
  if (normalized.configError !== undefined) {
    throw new ConfigError(normalized.configError, 'invalid-config')
  }
  const serialized = serializeConfig(normalized, currentRaw)
  await editor.edit(item.entry, () => serialized)
  return publicConfig(normalized)
}
