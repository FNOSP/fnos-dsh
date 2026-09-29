import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/server/gateway-server.ts'

/**
 * The gateway's own suite exercised GET throughout: the first-hop token
 * exchange, the allowlist SSE stream, and the recovery page. The reported
 * failure, however, was a **PUT with a JSON body** — and a proxy can forward a
 * GET correctly while still breaking a body-carrying request (a stale
 * `content-length`, a consumed stream, or a header rewrite that drops
 * `content-type`).
 *
 * These cases pin the gateway half of the chain so a future change there cannot
 * silently reintroduce the failure the plugin-side fix addressed. They assert
 * what the upstream DSH process actually receives, not just the status the
 * browser sees.
 */

const GATEWAY_PREFIX = '/app/fn-deepseek-harness'
const ROUTE = '/plugins/dsh-fnos/gateway/proxy-paths'

interface UpstreamRequest {
  method: string | undefined
  url: string | undefined
  body: string
  contentType: string | undefined
  contentLength: string | undefined
}

function captureUpstream(status = 200): { server: Server, requests: UpstreamRequest[] } {
  const requests: UpstreamRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
      })
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: status < 400 }))
    })
  })
  return { server, requests }
}

describe('gateway proxy request forwarding', () => {
  const cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanup.length > 0) await cleanup.pop()?.()
  })

  /** Start a gateway in front of the capturing upstream and return a sender. */
  async function connected(upstreamStatus = 200) {
    const { server: upstream, requests } = captureUpstream(upstreamStatus)
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanup.push(async () => new Promise<void>(resolve => upstream.close(() => resolve())))
    const address = upstream.address()
    if (address === null || typeof address === 'string') throw new Error('upstream did not bind')

    const directory = await mkdtemp(join(tmpdir(), 'fnos-gateway-forward-'))
    cleanup.push(async () => rm(directory, { recursive: true, force: true }))
    const socketPath = join(directory, 'gateway.sock')
    const gateway = createGateway({
      socketPath,
      gatewayPrefix: GATEWAY_PREFIX,
      upstreamHost: '127.0.0.1',
      upstreamPort: address.port,
    })
    await once(gateway.server, 'listening')
    cleanup.push(async () => gateway.close())

    const send = (options: {
      method: string
      path: string
      body?: string
      headers?: Record<string, string>
    }) => new Promise<{ status: number | undefined, body: string }>((resolve, reject) => {
      const payload = options.body
      const request = httpRequest({
        socketPath,
        method: options.method,
        path: options.path,
        headers: {
          host: 'nas.local:5666',
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }),
          ...options.headers,
        },
      }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      request.on('error', reject)
      if (payload !== undefined) request.write(payload)
      request.end()
    })

    return { send, requests }
  }

  it('forwards a PUT body byte-for-byte with the app prefix stripped', async () => {
    const { send, requests } = await connected()
    const payload = JSON.stringify({ version: 1, paths: ['/store/api'] })

    const response = await send({ method: 'PUT', path: `${GATEWAY_PREFIX}${ROUTE}`, body: payload })

    expect(response.status).toBe(200)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('PUT')
    // The gateway rewrite is what makes the route reachable on DSH.
    expect(requests[0]?.url).toBe(ROUTE)
    expect(requests[0]?.body).toBe(payload)
    expect(requests[0]?.contentType).toBe('application/json')
    expect(requests[0]?.contentLength).toBe(String(Buffer.byteLength(payload)))
  })

  it('forwards an empty-but-present PUT body without inventing content', async () => {
    const { send, requests } = await connected()
    const response = await send({ method: 'PUT', path: `${GATEWAY_PREFIX}${ROUTE}` })

    expect(response.status).toBe(200)
    expect(requests[0]?.method).toBe('PUT')
    expect(requests[0]?.body).toBe('')
  })

  it('keeps the query string while stripping the prefix', async () => {
    const { send, requests } = await connected()
    await send({ method: 'GET', path: `${GATEWAY_PREFIX}${ROUTE}?revision=7` })
    expect(requests[0]?.url).toBe(`${ROUTE}?revision=7`)
  })

  it('serves a same-prefix path that is not one of its own control routes', async () => {
    // The proxy is a catch-all; only the control routes are intercepted locally.
    // This is what lets a user-registered custom API path reach DSH at all.
    const { send, requests } = await connected()
    await send({ method: 'POST', path: `${GATEWAY_PREFIX}/dsh-market/api/items`, body: '{}' })
    expect(requests[0]?.url).toBe('/dsh-market/api/items')
    expect(requests[0]?.method).toBe('POST')
  })

  it('answers its own control routes locally instead of proxying them', async () => {
    const { send, requests } = await connected()
    const response = await send({ method: 'GET', path: `${GATEWAY_PREFIX}/__fnos-gateway/path-allowlist/events` })
    // No allowlist was configured for this gateway, so it reports 404 itself.
    expect(response.status).toBe(404)
    expect(requests).toHaveLength(0)
  })

  it('passes an upstream 400 through unchanged rather than marking it itself', async () => {
    // This is the crux of the reported failure: the browser's "400 Bad Request"
    // was DSH's own answer (an empty-body 400 from its webserver), forwarded by
    // the gateway. The gateway does not synthesize it, and it must not paper
    // over it either — the plugin-side fix is what removes the cause.
    const { send, requests } = await connected(400)
    const response = await send({ method: 'PUT', path: `${GATEWAY_PREFIX}${ROUTE}`, body: '{"version":1,"paths":[]}' })

    expect(response.status).toBe(400)
    // The request still reached DSH: the gateway is not the one refusing it.
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(ROUTE)
  })
})
