import { ConfigError, readConfigSnapshot, writeConfigValues } from './config.js'

const API_PREFIX = '/dsh-plugin-sync/api'
const MAX_BODY_BYTES = 64 * 1024

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function sendError(response, status, code, message) {
  sendJson(response, status, { ok: false, error: { code, message } })
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

async function readJson(request) {
  const length = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large')
    error.status = 413
    throw error
  }
  let total = 0
  const chunks = []
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (total === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object')
    }
    return parsed
  } catch (error) {
    const failure = new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`)
    failure.status = 400
    throw failure
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function methodGuard(request, response, allowed) {
  if (allowed.includes(request.method)) return true
  response.writeHead(405, { allow: allowed.join(', ') })
  response.end()
  return false
}

export function registerApiRoutes({ ctx, runtime, config }) {
  const routes = [
    {
      name: 'status',
      method: 'GET',
      path: `${API_PREFIX}/status`,
      handle: async (_request, response) => {
        const status = await runtime.status()
        const configSnapshot = readConfigSnapshot(ctx, config)
        let clientEntry
        try {
          const graph = ctx.get('clientModules')?.graph?.()
          clientEntry = graph?.entries?.find((entry) => entry.id === 'dsh-plugin-sync')
        } catch {
          clientEntry = undefined
        }
        sendJson(response, 200, {
          ...status,
          configSnapshot,
          ...(clientEntry === undefined ? {} : { clientEntry }),
        })
      },
    },
    {
      name: 'config',
      method: 'GET',
      path: `${API_PREFIX}/config`,
      handle: async (_request, response) => {
        sendJson(response, 200, {
          ok: true,
          config: readConfigSnapshot(ctx, config),
        })
      },
    },
    {
      name: 'config-save',
      method: 'POST',
      path: `${API_PREFIX}/config`,
      handle: async (request, response) => {
        const body = await readJson(request)
        if (!isRecord(body.values)) {
          sendError(response, 400, 'invalid-request', 'values must be an object')
          return
        }
        const values = await writeConfigValues(ctx, body.values, config)
        sendJson(response, 200, { ok: true, values })
      },
    },
    {
      name: 'preview',
      method: 'POST',
      path: `${API_PREFIX}/preview`,
      handle: async (_request, response) => {
        const preview = await runtime.preview()
        sendJson(response, 200, preview)
      },
    },
    {
      name: 'apply',
      method: 'POST',
      path: `${API_PREFIX}/apply`,
      handle: async (request, response) => {
        const body = await readJson(request)
        if (typeof body.previewId !== 'string' || body.previewId === '') {
          sendError(response, 400, 'invalid-request', 'previewId is required')
          return
        }
        if (!isRecord(body.selections)) {
          sendError(response, 400, 'invalid-request', 'selections must be an object')
          return
        }
        const result = await runtime.apply(body.previewId, body.selections)
        sendJson(response, 200, result)
      },
    },
    {
      name: 'push',
      method: 'POST',
      path: `${API_PREFIX}/push`,
      handle: async (request, response) => {
        const body = await readJson(request)
        if (body.confirm !== true) {
          sendError(response, 400, 'confirm-required', 'Set confirm=true to update the remote manifest')
          return
        }
        const result = await runtime.push()
        sendJson(response, 200, result)
      },
    },
  ]

  const mount = (hostCtx) => {
    hostCtx.effect(() => {
      const disposers = []
      for (const route of routes) {
        disposers.push(hostCtx.webServer.register({
          kind: 'exact',
          path: route.path,
          handler: async (request, response) => {
            if (!sameOrigin(request)) {
              sendError(response, 403, 'cross-origin', 'Cross-origin requests are not allowed')
              return
            }
            if (!methodGuard(request, response, [route.method])) return
            try {
              await route.handle(request, response)
            } catch (error) {
              if (error instanceof ConfigError) {
                sendError(response, 400, error.code, error.message)
                return
              }
              const status = typeof error?.status === 'number' ? error.status : 500
              const code = typeof error?.code === 'string' ? error.code : 'operation-failed'
              const message = error instanceof Error ? error.message : String(error)
              sendError(response, status, code, message)
            }
          },
        }))
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'plugin-sync: API routes')
  }

  const existing = ctx.get('webServer')
  if (existing !== undefined && existing !== null) {
    mount({ webServer: existing, effect: ctx.effect.bind(ctx) })
  } else {
    ctx.inject(['webServer'], mount)
  }
}
