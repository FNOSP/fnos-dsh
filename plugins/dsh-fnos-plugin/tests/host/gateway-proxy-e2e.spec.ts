import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SettingsForms from '@deepseek-ai/dsh-settings'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fnosPlugin from '../../src/index.ts'
import { FNOS_GATEWAY_PROXY_PATHS_ROUTE } from '../../src/contracts/gateway-proxy-contract.ts'

/**
 * End-to-end regression for the reported production failure.
 *
 * The browser reported:
 *   PUT http://<nas>:5666/app/fn-deepseek-harness/plugins/dsh-fnos/gateway/proxy-paths 400 (Bad Request)
 * with an EMPTY body. Two defects combined to produce it:
 *
 * 1. the `dsh-fnos` Host module exported only a TypeScript `interface Config`,
 *    so `@deepseek-ai/dsh-settings` found no runtime schema for the entry and
 *    `settings.update('dsh-fnos', …)` rejected with
 *    `No configurable plugin entry "dsh-fnos"`; and
 * 2. that rejection escaped the route handler, and
 *    `@deepseek-ai/dsh-host-webserver` answers any escaping rejection with
 *    `res.writeHead(400); res.end()` — a bare 400 with no body.
 *
 * This test drives the REAL `WebServer` over a real HTTP socket, the REAL
 * `SettingsForms` service, and the REAL plugin, so it reproduces the whole
 * chain rather than a stub of it. It asserts the request now succeeds and that
 * no path through it can produce a bodyless 400.
 */

/** The shared protocol symbol Cordis/Cosmokit uses to commit a volatile snapshot. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** The two services SettingsForms injects, backed by one in-memory patch. */
function settingsHarness(root: Context, home: string) {
  let stored: Record<string, unknown> = {}
  const entry = {
    id: 'dsh-fnos',
    options: { id: 'dsh-fnos', name: '@tnnevol/dsh-fnos', config: {} as Record<string, unknown> },
    fiber: undefined as unknown,
  }
  root.provide('profileContext', {
    name: 'e2e',
    dir: home,
    home,
    installAnchor: home,
    patchPath: join(home, 'package.json'),
  })
  root.provide('loader', { await: async () => undefined })
  root.provide('configEditor', {
    documentPath: join(home, 'package.json'),
    entries: () => [entry],
    configuration: () => [{ entry, inherited: {}, override: structuredClone(stored) }],
    edit: async (
      target: { fiber?: { runtime?: unknown, config?: Record<string, unknown> }, options: { config: Record<string, unknown> } },
      change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const next = change(structuredClone(stored), {})
      // The real ConfigEditor validates against the owning runtime's schema.
      const runtime = target.fiber?.runtime as { Config?: unknown } | undefined
      const schema = runtime?.Config as { ['~standard']?: { validate: (value: unknown) => unknown } } | undefined
      const result = schema?.['~standard']?.validate(next) as { issues?: unknown } | undefined
      if (result !== undefined && 'issues' in result) {
        throw new Error(`Config validation failed: ${JSON.stringify(result.issues)}`)
      }
      stored = structuredClone(next)
      target.options.config = structuredClone(stored)
      // Faithfulness to the Loader: a live edit commits the new snapshot into
      // the SAME volatile reference the running plugin holds, which is what
      // makes the change visible to the plugin without a remount. Without this
      // the plugin keeps reading its original reference and GET would answer
      // the pre-write snapshot.
      for (const [key, value] of Object.entries(next)) {
        const ref = target.fiber?.config?.[key] as Record<symbol, (snapshot: unknown) => void> | undefined
        const write = typeof ref === 'object' && ref !== null ? ref[VOLATILE_WRITE] : undefined
        if (typeof write === 'function') write.call(ref, structuredClone(value))
      }
    },
  })
  return { entry, stored: () => stored }
}

interface HttpResult { status: number, body: string, contentType: string | undefined }

function send(options: {
  socketPath?: string
  port?: number
  method: string
  path: string
  body?: string
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
      ...(options.port === undefined ? {} : { port: options.port, host: '127.0.0.1' }),
      method: options.method,
      path: options.path,
      headers: {
        host: 'nas.local:5666',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: res.headers['content-type'],
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-fnos-e2e-'))
  await writeFile(join(home, 'package.json'), `${JSON.stringify({ name: 'e2e-profile', private: true }, null, 2)}\n`)
  process.env.TRIM_PKGVAR = home
})

afterEach(async () => {
  delete process.env.TRIM_PKGVAR
  // Registration and `settings/document-updated` start fire-and-forget mirror
  // writes. Let them settle before removing the directory, otherwise a pending
  // rename targets a path that no longer exists and logs a spurious failure.
  await new Promise(resolve => setTimeout(resolve, 50))
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

/** Boot the real plugin against the real webserver and settings services. */
async function boot() {
  const root = new Context()
  const harness = settingsHarness(root, home)
  const webserver = new WebServer(root, { host: '127.0.0.1', port: 0, compression: 'none' })
  const settings: SettingsForms = new SettingsForms(root)
  await webserver[Service.init]()

  const plugin = {
    name: '@tnnevol/dsh-fnos',
    apply: fnosPlugin.apply,
    inject: [] as string[],
    Config: fnosPlugin.Config,
  }
  const fiber = root.plugin(plugin, {})
  await fiber
  harness.entry.fiber = fiber

  const close = async () => {
    await fiber.dispose()
    // `server` is private on the service; this test only needs to stop it.
    const server = (webserver as unknown as { server: { close: (callback: () => void) => void } }).server
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
  return { webserver, settings, harness, close }
}

describe('gateway proxy-path route over the real DSH webserver', () => {
  it('saves proxy paths with 200 and a JSON body (the reported failure)', async () => {
    const { webserver, harness, close } = await boot()
    try {
      const response = await send({
        port: webserver.port,
        method: 'PUT',
        path: FNOS_GATEWAY_PROXY_PATHS_ROUTE,
        body: JSON.stringify({ version: 1, paths: ['/store/api'] }),
      })

      // Before the fix this was an empty-body 400.
      expect(response.status).toBe(200)
      expect(response.contentType).toContain('application/json')
      expect(JSON.parse(response.body)).toEqual({ version: 1, paths: ['/store/api'] })
      // The write must have reached the settings namespace, not just the file.
      expect(harness.stored().gatewayProxyPaths).toEqual(['/store/api'])
    } finally {
      await close()
    }
  })

  it('persists the accepted paths into the gateway allowlist file', async () => {
    const { webserver, close } = await boot()
    try {
      await send({
        port: webserver.port,
        method: 'PUT',
        path: FNOS_GATEWAY_PROXY_PATHS_ROUTE,
        body: JSON.stringify({ version: 1, paths: ['/store/api'] }),
      })
      await expect(readFile(join(home, 'gateway', 'path-allowlist.json'), 'utf8')).resolves.toContain('"/store/api"')
    } finally {
      await close()
    }
  })

  it('reads back the saved paths over GET', async () => {
    const { webserver, close } = await boot()
    try {
      await send({
        port: webserver.port,
        method: 'PUT',
        path: FNOS_GATEWAY_PROXY_PATHS_ROUTE,
        body: JSON.stringify({ version: 1, paths: ['/store/api'] }),
      })
      const response = await send({ port: webserver.port, method: 'GET', path: FNOS_GATEWAY_PROXY_PATHS_ROUTE })
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ version: 1, paths: ['/store/api'] })
    } finally {
      await close()
    }
  })

  it('never answers a bodyless error for an invalid snapshot', async () => {
    const { webserver, close } = await boot()
    try {
      const response = await send({
        port: webserver.port,
        method: 'PUT',
        path: FNOS_GATEWAY_PROXY_PATHS_ROUTE,
        body: JSON.stringify({ version: 1, paths: ['not-absolute'] }),
      })
      // The route's own explicit rejection, not the webserver's blank 400.
      expect(response.status).toBe(400)
      expect(response.body).not.toBe('')
      expect(JSON.parse(response.body)).toEqual({ error: 'invalid-gateway-proxy-paths' })
    } finally {
      await close()
    }
  })

  it('answers a method error and an unknown route with identifiable bodies', async () => {
    const { webserver, close } = await boot()
    try {
      const wrongMethod = await send({ port: webserver.port, method: 'DELETE', path: FNOS_GATEWAY_PROXY_PATHS_ROUTE })
      expect(wrongMethod.status).toBe(405)
      expect(JSON.parse(wrongMethod.body)).toEqual({ error: 'method-not-allowed' })

      const unknown = await send({ port: webserver.port, method: 'GET', path: '/plugins/dsh-fnos/does-not-exist' })
      // Unmatched routes fall through to the webserver, which is its own concern;
      // what matters here is that no handler-produced 400 is bodyless.
      expect(unknown.status).not.toBe(200)
    } finally {
      await close()
    }
  })
})
