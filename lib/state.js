import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { expandHome, formatIso, isRecord } from './spec.js'

export const STATE_VERSION = 1
const MAX_HISTORY = 20
const MAX_RESULTS = 50

export function resolveStatePath(config = {}) {
  if (typeof config.stateFile === 'string' && config.stateFile.trim() !== '') {
    return expandHome(config.stateFile)
  }
  const home = typeof config.dshHome === 'string' && config.dshHome.trim() !== ''
    ? expandHome(config.dshHome)
    : process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'plugin-sync', 'state.json')
}

export function emptyState(hostId = '') {
  return {
    version: STATE_VERSION,
    hostId,
    gistName: null,
    gistId: null,
    gistUrl: null,
    lastPreviewAt: null,
    lastApplyAt: null,
    lastPushAt: null,
    lastSyncAt: null,
    lastPullAt: null,
    lastRun: null,
    remote: null,
    lastResults: [],
    history: [],
    pendingUpgrades: [],
    manualUpdates: [],
    updatedAt: null,
  }
}

function normalizeResult(value) {
  if (!isRecord(value) || typeof value.name !== 'string') return null
  return {
    name: value.name,
    ...(typeof value.spec === 'string' ? { spec: value.spec } : {}),
    status: typeof value.status === 'string' ? value.status : 'unknown',
    ...(typeof value.application === 'string' ? { application: value.application } : {}),
    ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
    ...(value.restartRequired === true ? { restartRequired: true } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}

export function normalizeState(value, hostId = '') {
  if (!isRecord(value)) return emptyState(hostId)
  const state = emptyState(hostId)
  state.hostId = typeof value.hostId === 'string' && value.hostId !== '' ? value.hostId : hostId
  if (typeof value.gistName === 'string' && value.gistName !== '') state.gistName = value.gistName
  if (typeof value.gistId === 'string' && value.gistId !== '') state.gistId = value.gistId
  if (typeof value.gistUrl === 'string' && value.gistUrl !== '') state.gistUrl = value.gistUrl
  for (const key of ['lastPreviewAt', 'lastApplyAt', 'lastPushAt', 'lastSyncAt', 'lastPullAt']) {
    if (typeof value[key] === 'string') state[key] = formatIso(value[key])
  }
  if (isRecord(value.lastRun)) state.lastRun = value.lastRun
  if (isRecord(value.remote)) state.remote = value.remote
  if (Array.isArray(value.pendingUpgrades)) {
    state.pendingUpgrades = value.pendingUpgrades
      .filter((item) => isRecord(item) && typeof item.name === 'string')
      .slice(0, 20)
  }
  if (Array.isArray(value.manualUpdates)) {
    state.manualUpdates = value.manualUpdates
      .filter((item) => isRecord(item) && typeof item.name === 'string')
      .slice(0, 20)
  }
  if (Array.isArray(value.lastResults)) {
    state.lastResults = value.lastResults.map(normalizeResult).filter((item) => item !== null).slice(0, MAX_RESULTS)
  }
  if (Array.isArray(value.history)) {
    state.history = value.history.filter((item) => isRecord(item)).slice(0, MAX_HISTORY)
  }
  if (typeof value.updatedAt === 'string') state.updatedAt = formatIso(value.updatedAt)
  return state
}

export async function readState(path, hostId = '') {
  try {
    const text = await readFile(path, 'utf8')
    return normalizeState(JSON.parse(text), hostId)
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return emptyState(hostId)
    return {
      ...emptyState(hostId),
      loadError: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function writeState(path, state) {
  const normalized = normalizeState({
    ...state,
    updatedAt: new Date().toISOString(),
    lastResults: Array.isArray(state.lastResults) ? state.lastResults.slice(0, MAX_RESULTS) : [],
    history: Array.isArray(state.history) ? state.history.slice(0, MAX_HISTORY) : [],
  }, state.hostId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}
