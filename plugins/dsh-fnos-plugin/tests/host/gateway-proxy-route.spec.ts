import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGatewayProxyRoutes } from '../../src/host/gateway-proxy-routes.ts'
import { FNOS_GATEWAY_PROXY_PATHS_ROUTE } from '../../src/contracts/gateway-proxy-contract.ts'
import { volatileValue } from '../../src/contracts/theme-contract.ts'
import { FnosSettingsSchema } from '../../src/contracts/theme-schema.ts'
import * as plugin from '../../src/index.ts'

/**
 * The gateway proxy-path route end to end against its real handler.
 *
 * This file exists because the route could not save for a reason no contract
 * test noticed: the Host plugin exported only a TypeScript `Config` **type**
 * for the `dsh-fnos` settings entry, so DSH's settings service could not find
 * a runtime schema and `settings.update()` rejected with `No configurable
 * plugin entry "dsh-fnos"`. The DSH webserver converts an escaping handler
 * rejection into an empty-body `400`, which is what the browser reported.
 *
 * The two regressions are therefore pinned separately:
 *
 * 1. the module must export a runtime `Config` schema that exposes both fields
 *    as volatile, which is what makes the namespace configurable at all; and
 * 2. the handler must answer a diagnosable JSON status instead of letting a
 *    rejection escape into that empty 400.
 */

interface CapturedRoute {
  kind: string
  path: string
  handler: (req: unknown, res: FakeResponse) => void | Promise<void>
}

interface FakeResponse {
  statusCode?: number
  headers?: Record<string, string> | undefined
  body?: unknown
  headersSent: boolean
  writableEnded: boolean
  destroyed: boolean
  writeHead: (status: number, headers?: Record<string, string>) => void
  end: (value?: unknown) => void
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers
      res.headersSent = true
    },
    end(value) {
      res.body = value
      res.writableEnded = true
    },
  }
  return res
}

function fakeRequest(method: string, payload?: unknown, headers: Record<string, string> = {}) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]
  return {
    method,
    headers: { host: 'nas.local:5666', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

let directory: string
let captured: CapturedRoute | undefined
let update: ReturnType<typeof vi.fn>
let describe_: ReturnType<typeof vi.fn>

function register(settings: unknown): void {
  captured = undefined
  const ctx = {
    effect: (factory: () => unknown) => { factory() },
    on: () => () => undefined,
    webServer: { register: (value: CapturedRoute) => { captured = value; return () => undefined } },
    settings,
  }
  registerGatewayProxyRoutes(ctx as never, 'dsh-fnos')
  if (captured === undefined) throw new Error('gateway proxy route was not registered')
}

async function invoke(method: string, payload?: unknown): Promise<FakeResponse> {
  const res = fakeResponse()
  await captured?.handler(fakeRequest(method, payload), res)
  return res
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-fnos-gateway-proxy-'))
  process.env.TRIM_PKGVAR = directory
  update = vi.fn(async () => undefined)
  describe_ = vi.fn(() => [{ ns: 'dsh-fnos', value: {} }])
})

afterEach(async () => {
  delete process.env.TRIM_PKGVAR
  // Registration triggers a fire-and-forget mirror write. Retry the removal so
  // a write landing mid-cleanup reports as ENOTEMPTY rather than as a failure
  // of the test that just ran.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

describe('fnOS gateway proxy path route', () => {
  it('answers a saved path snapshot with the normalized document', async () => {
    register({ describe: describe_, update })
    const res = await invoke('PUT', { version: 1, paths: ['/store/api/', ' /alpha '] })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(String(res.body))).toEqual({ version: 1, paths: ['/alpha', '/store/api'] })
  })

  it('persists the accepted snapshot into the gateway allowlist file', async () => {
    register({ describe: describe_, update })
    await invoke('PUT', { version: 1, paths: ['/store/api'] })
    const file = join(directory, 'gateway', 'path-allowlist.json')
    await expect(readFile(file, 'utf8')).resolves.toContain('"/store/api"')
  })

  it('still rejects an invalid snapshot with the explicit 400 code', async () => {
    register({ describe: describe_, update })
    const res = await invoke('PUT', { version: 1, paths: ['not-absolute'] })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'invalid-gateway-proxy-paths' })
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a diagnosable JSON error instead of an empty 400 when the settings write rejects', async () => {
    // Reproduces the shipped failure: the settings namespace has no runtime
    // Config schema, so update() rejects. The handler must not let that
    // rejection reach the webserver, which would answer a bare 400.
    register({
      describe: () => [],
      update: vi.fn(async () => { throw new Error('No configurable plugin entry "dsh-fnos"') }),
    })
    const res = await invoke('PUT', { version: 1, paths: ['/store/api'] })

    expect(res.statusCode).toBe(500)
    expect(res.headers?.['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(String(res.body))).toEqual({ error: 'fnos-gateway-proxy-paths-unavailable' })
  })

  it('restores the previous allowlist file when the settings write rejects', async () => {
    const file = join(directory, 'gateway', 'path-allowlist.json')
    await mkdir(join(directory, 'gateway'), { recursive: true })
    await writeFile(file, `${JSON.stringify({ version: 1, paths: ['/previous'] }, null, 2)}\n`)
    register({
      describe: () => [],
      update: vi.fn(async () => { throw new Error('settings unavailable') }),
    })
    await invoke('PUT', { version: 1, paths: ['/store/api'] })
    await expect(readFile(file, 'utf8')).resolves.toContain('"/previous"')
  })

  it('reads the current snapshot for GET', async () => {
    register({ describe: () => [{ ns: 'dsh-fnos', value: { gatewayProxyPaths: ['/store/api'] } }], update })
    const res = await invoke('GET')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(String(res.body))).toEqual({ version: 1, paths: ['/store/api'] })
  })

  it('answers 405 for an unsupported method', async () => {
    register({ describe: describe_, update })
    const res = await invoke('DELETE')
    expect(res.statusCode).toBe(405)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'method-not-allowed' })
  })

  it('keeps concurrent writes from losing the newest snapshot (shared temp name regression)', async () => {
    // The settings mirror fires on initialization and on every
    // `settings/document-updated` event without awaiting, so a PUT can overlap
    // a mirror write. A process-wide `.tmp` atomic rename would make one of
    // them fail with ENOENT and silently drop those paths.
    register({ describe: describe_, update })
    const write = captured

    const first = fakeResponse()
    const second = fakeResponse()
    await Promise.all([
      write?.handler(fakeRequest('PUT', { version: 1, paths: ['/first'] }), first),
      write?.handler(fakeRequest('PUT', { version: 1, paths: ['/second'] }), second),
    ])

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)

    const file = join(directory, 'gateway', 'path-allowlist.json')
    const written = JSON.parse(await readFile(file, 'utf8')) as { paths: string[] }
    // Whichever write lands last must be intact, not truncated or missing.
    expect(['["/first"]', '["/second"]']).toContain(JSON.stringify(written.paths))
    // No temporary file may be left behind next to the allowlist.
    const leftovers = (await readdir(join(directory, 'gateway'))).filter(name => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('registers on the exact route the browser calls', () => {
    register({ describe: describe_, update })
    expect(captured?.kind).toBe('exact')
    expect(captured?.path).toBe(FNOS_GATEWAY_PROXY_PATHS_ROUTE)
    expect(FNOS_GATEWAY_PROXY_PATHS_ROUTE).toBe('/plugins/dsh-fnos/gateway/proxy-paths')
  })
})

/** Narrow the schema's serialized reference table for assertions. */
interface SerializedSchemaNode { dict?: Record<string, number>, meta?: { volatile?: boolean } }
interface SerializedSchema { uid: number, refs: Record<number, SerializedSchemaNode> }

/** Validate one section and return the standard-schema issue list. */
function issuesOf(value: unknown): readonly unknown[] | undefined {
  const result = FnosSettingsSchema['~standard'].validate(value)
  if (result instanceof Promise) throw new Error('config validation unexpectedly became async')
  return result.issues
}

/** Validate one section, asserting it was accepted, and return its value. */
function acceptedValue(value: unknown): unknown {
  const result = FnosSettingsSchema['~standard'].validate(value)
  if (result instanceof Promise) throw new Error('config validation unexpectedly became async')
  if (result.issues !== undefined) throw new Error(`expected acceptance, got ${JSON.stringify(result.issues)}`)
  return (result as { value: unknown }).value
}

describe('dsh-fnos settings entry contract', () => {
  it('exports a runtime Config schema, which is what makes the namespace writable', () => {
    // A type-only `interface Config` erases at build time and leaves
    // settings.update() with no schema to validate against. The settings
    // service detects a usable schema by its `toJSON` method.
    expect(plugin.Config).toBe(FnosSettingsSchema)
    expect(typeof plugin.Config?.toJSON).toBe('function')
    expect(typeof plugin.Config?.['~standard']?.validate).toBe('function')
  })

  it('declares both settings fields as editable volatile fields', () => {
    // Volatile is what lets a live edit reach the running plugin without
    // remounting it, and what the settings forms accept as writable.
    const json = FnosSettingsSchema.toJSON() as unknown as SerializedSchema
    const root = json.refs[json.uid] as SerializedSchemaNode
    const dict = root.dict ?? {}
    expect(Object.keys(dict).sort()).toEqual(['gatewayProxyPaths', 'systemTheme'])
    expect(json.refs[dict.systemTheme as number]?.meta?.volatile).toBe(true)
    expect(json.refs[dict.gatewayProxyPaths as number]?.meta?.volatile).toBe(true)
  })

  it('accepts an empty, a theme-only and a path-only section', () => {
    for (const value of [{}, { systemTheme: 'dark' }, { gatewayProxyPaths: ['/store/api'] }]) {
      expect(issuesOf(value)).toBeUndefined()
    }
  })

  it('rejects a theme value outside the fnOS set', () => {
    expect(issuesOf({ systemTheme: 'blue' })).toBeDefined()
  })

  it('reads volatile references and plain values through one helper', () => {
    const resolved = acceptedValue({ systemTheme: 'dark', gatewayProxyPaths: ['/store'] }) as Record<string, unknown>
    expect(volatileValue(resolved.systemTheme as never)).toBe('dark')
    expect(volatileValue(resolved.gatewayProxyPaths as never)).toEqual(['/store'])
    // Plain config stays readable so direct apply() calls and tests keep working.
    expect(volatileValue('dark' as never)).toBe('dark')
    expect(volatileValue<string[] | undefined>(undefined)).toBeUndefined()
  })
})
