import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { FNOS_GATEWAY_PROXY_PATHS_FILE, FNOS_GATEWAY_PROXY_PATHS_ROUTE, normalizeGatewayProxyPaths, validateGatewayProxyPaths, type GatewayProxyPathsDocument } from '../contracts/gateway-proxy-contract.ts'
import type { FnosSettings } from '../contracts/theme-contract.ts'

function send(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
async function body(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined } }
function trusted(req: IncomingMessage): boolean { const origin = req.headers.origin; if (origin === undefined) return true; const host = req.headers['x-forwarded-host'] ?? req.headers.host; try { return new URL(origin).host === host } catch { return false } }

export function gatewayProxyPathsFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = env.TRIM_PKGVAR?.trim()
  return root ? join(root, FNOS_GATEWAY_PROXY_PATHS_FILE) : undefined
}

async function readDocument(file: string): Promise<GatewayProxyPathsDocument> {
  try { const value: unknown = JSON.parse(await readFile(file, 'utf8')); return { version: 1, paths: normalizeGatewayProxyPaths(value) ?? [] } }
  catch { return { version: 1, paths: [] } }
}

/**
 * Serialize writes per allowlist file.
 *
 * Two writers reach this file concurrently in normal operation: the settings
 * mirror runs on plugin initialization and on every `settings/document-updated`
 * event (both fire-and-forget), while a PUT is handled inline. Without a queue
 * the atomic rename pattern fails outright — a shared temporary name is moved
 * away by whichever write finishes first, so the other reports `ENOENT` and its
 * paths never land. Serializing also keeps the newest snapshot last, so an
 * earlier write cannot resurrect stale paths.
 */
const writeQueues = new Map<string, Promise<void>>()

/** Unique per write: a process-wide counter keeps concurrent writers apart. */
let temporaryCounter = 0

async function writeDocument(file: string, document: GatewayProxyPathsDocument): Promise<void> {
  const previous = writeQueues.get(file) ?? Promise.resolve()
  // `catch` keeps one failed write from poisoning every later write to the file.
  const queued = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(file), { recursive: true })
    temporaryCounter += 1
    const temporary = `${file}.${process.pid}.${temporaryCounter}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  })
  writeQueues.set(file, queued)
  try {
    await queued
  } finally {
    if (writeQueues.get(file) === queued) writeQueues.delete(file)
  }
}

export function registerGatewayProxyRoutes(ctx: Context, settingsNamespace: string): void {
  const settings = ctx.settings
  const readSettings = (): FnosSettings => {
    const descriptor = settings.describe().find(row => row.ns === settingsNamespace)
    return descriptor?.value as FnosSettings ?? {}
  }
  const file = gatewayProxyPathsFile()
  if (file !== undefined) {
    const sync = (value: FnosSettings): Promise<void> => writeDocument(file, { version: 1, paths: normalizeGatewayProxyPaths(value.gatewayProxyPaths ?? []) ?? [] })
    ctx.effect(() => {
      void sync(readSettings()).catch(error => { console.error('[dsh-fnos] unable to initialize gateway proxy paths', error) })
      return ctx.on('settings/document-updated', namespace => {
        if (namespace === settingsNamespace) void sync(readSettings()).catch(error => { console.error('[dsh-fnos] unable to mirror gateway proxy paths', error) })
      })
    }, 'dsh-fnos: gateway proxy path settings mirror')
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_GATEWAY_PROXY_PATHS_ROUTE,
    handler: async (req, res) => {
      try {
        if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
        const file = gatewayProxyPathsFile()
        if (file === undefined) return send(res, 503, { error: 'fnos-gateway-config-unavailable' })
        if (req.method === 'GET') return send(res, 200, { version: 1, paths: normalizeGatewayProxyPaths(readSettings().gatewayProxyPaths ?? []) ?? [] })
        if (req.method !== 'PUT') return send(res, 405, { error: 'method-not-allowed' })
        const paths = validateGatewayProxyPaths(await body(req))
        if (paths === undefined) return send(res, 400, { error: 'invalid-gateway-proxy-paths' })
        const document: GatewayProxyPathsDocument = { version: 1, paths }
        const previous = await readDocument(file)
        await writeDocument(file, document)
        try {
          await settings.update(settingsNamespace, { gatewayProxyPaths: paths })
        } catch (error) {
          await writeDocument(file, previous)
          throw error
        }
        send(res, 200, document)
      } catch (error: unknown) {
        // An escaping rejection becomes an empty-body 400 from the DSH
        // webserver, which hides the real cause from the browser and from the
        // NAS log. Answer a diagnosable JSON error instead; the process log
        // keeps the stack for the reader who needs it.
        console.error('[dsh-fnos] gateway proxy path update failed', error)
        if (res.headersSent || res.writableEnded || res.destroyed) return
        send(res, 500, { error: 'fnos-gateway-proxy-paths-unavailable' })
      }
    },
  }), 'dsh-fnos: gateway API proxy paths')
}
