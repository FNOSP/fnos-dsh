import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/server/gateway-server.ts'
import { browserSessionCookieName } from '../src/server/proxy.ts'

/**
 * FNOS-030：会话由网关持有。
 *
 * 飞牛 App 的套壳与 NAS 不同站，浏览器不保存 `SameSite=Strict` 的 DSH 会话 Cookie。
 * 这里的「浏览器」从不保存任何 Cookie，用来模拟这种套壳；修复前它会在首页 303 里打转。
 */

const P = '/app/fn-deepseek-harness'
const TOKEN = 'launch-token'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await Promise.race([cleanup(), new Promise<void>(resolve => setTimeout(resolve, 1500))]).catch(() => undefined)
  }
}, 15_000)

interface FakeDsh {
  port: number
  cookieName: string
  /** 上游收到的每个请求：路径与会话 Cookie 是否有效。 */
  seen: Array<{ url: string, cookie: string | undefined, authenticated: boolean }>
  mints: number
  /** 让已签发的会话全部失效（相当于 DSH 换了签名密钥）。 */
  revokeAll: () => void
  /** 之后的换取都不再下发 Cookie。 */
  refuseMint: () => void
}

/** 按 DSH `BrowserAuth` 的规则模拟上游：带 Token 的首页 → 303 + Set-Cookie；其它请求只认 Cookie。 */
async function fakeDsh(): Promise<FakeDsh> {
  const valid = new Set<string>()
  let mintAllowed = true
  const state = { seen: [] as FakeDsh['seen'], mints: 0, cookieName: '' }
  const sessionOf = (req: IncomingMessage): string | undefined => {
    for (const pair of String(req.headers.cookie ?? '').split(';')) {
      const [name, ...rest] = pair.trim().split('=')
      if (name === state.cookieName) return rest.join('=')
    }
    return undefined
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const session = sessionOf(req)
    const authenticated = session !== undefined && valid.has(session)
    state.seen.push({ url: req.url ?? '', cookie: req.headers.cookie, authenticated })
    if (url.searchParams.has('token')) {
      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('token') === TOKEN) {
        const headers: Record<string, string> = { 'cache-control': 'no-store', location: './' }
        if (mintAllowed) {
          const value = `v1.session-${String(++state.mints)}`
          valid.add(value)
          headers['set-cookie'] = `${state.cookieName}=${value}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`
        }
        res.writeHead(303, headers)
        res.end()
        return
      }
      res.writeHead(401)
      res.end()
      return
    }
    if (!authenticated) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required')
      return
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>DSH</title>')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'plugin-pref=dark; Path=/' })
    res.end('{}')
  })
  server.on('upgrade', (req, socket) => {
    const session = sessionOf(req)
    const authenticated = session !== undefined && valid.has(session)
    state.seen.push({ url: req.url ?? '', cookie: req.headers.cookie, authenticated })
    socket.on('error', () => {})
    if (!authenticated) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  const port = await listen(server)
  state.cookieName = browserSessionCookieName('127.0.0.1', port)
  cleanups.push(async () => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  }))
  return {
    port,
    get cookieName() { return state.cookieName },
    get seen() { return state.seen },
    get mints() { return state.mints },
    revokeAll: () => valid.clear(),
    refuseMint: () => { mintAllowed = false },
  }
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('upstream did not bind to a TCP port')
  return address.port
}

async function gatewayFor(dsh: FakeDsh): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'fnos-gateway-session-'))
  const socketPath = join(directory, 'gateway.sock')
  const gateway = createGateway({
    socketPath,
    gatewayPrefix: P,
    upstreamHost: '127.0.0.1',
    upstreamPort: dsh.port,
    webProcess: {
      getLaunchToken: () => TOKEN,
      snapshot: async () => ({ state: 'running' as const, pid: process.pid }),
      start: async () => ({ state: 'running' as const, pid: process.pid }),
      restart: async () => ({ state: 'running' as const, pid: process.pid }),
      stop: async () => undefined,
    } as never,
  })
  await once(gateway.server, 'listening')
  cleanups.push(async () => rm(directory, { recursive: true, force: true }))
  cleanups.push(async () => gateway.close())
  return socketPath
}

interface Reply { status: number | undefined, location: string | undefined, setCookie: string[] }

function send(socketPath: string, path: string, options: { method?: string, cookie?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { accept: 'text/html' }
    if (options.cookie !== undefined) headers.cookie = options.cookie
    const request = httpRequest({ socketPath, path, method: options.method ?? 'GET', headers }, res => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, setCookie: res.headers['set-cookie'] ?? [] }))
      res.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

/** 像浏览器一样跟随跳转，但从不保存 Cookie（跨站套壳）；最多 5 跳，超过即视为死循环。 */
async function openInAppShell(socketPath: string): Promise<{ final: Reply, hops: number }> {
  let path = `${P}/`
  for (let hops = 1; hops <= 5; hops += 1) {
    const reply = await send(socketPath, path)
    if (reply.status !== 303 || reply.location === undefined) return { final: reply, hops }
    path = new URL(reply.location, `http://nas.invalid${path}`).pathname
  }
  return { final: { status: 303, location: undefined, setCookie: [] }, hops: 6 }
}

function upgrade(socketPath: string, path: string, cookie?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath)
    let text = ''
    client.on('data', chunk => { text += chunk.toString('utf8') })
    client.on('error', reject)
    client.once('connect', () => {
      client.write([
        `GET ${path} HTTP/1.1`, 'Host: nas.invalid', 'Connection: Upgrade', 'Upgrade: websocket',
        ...(cookie === undefined ? [] : [`Cookie: ${cookie}`]),
        'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', '',
      ].join('\r\n'))
    })
    setTimeout(() => { client.destroy(); resolve(text) }, 400)
  })
}

const dshAuth = (cookies: string[]): string[] => cookies.filter(cookie => cookie.startsWith('dsh-auth-') && !/Max-Age=0/iu.test(cookie))

describe('FNOS-030 网关持有 DSH 会话', () => {
  it('跨站套壳（浏览器不存 Cookie）多次打开首页都不循环，且只换取一次会话', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)

    for (let visit = 0; visit < 3; visit += 1) {
      const { final, hops } = await openInAppShell(socketPath)
      expect(final.status).toBe(200)
      expect(hops).toBe(1)
      expect(dshAuth(final.setCookie)).toEqual([])
    }
    expect(dsh.mints).toBe(1)
    // 浏览器侧的请求从不带 Token
    expect(dsh.seen.filter(entry => !entry.url.includes('token=')).every(entry => entry.authenticated)).toBe(true)
  })

  it('API 与插件路由的请求都附带网关会话，插件自己的 Set-Cookie 照常下发', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)

    const api = await send(socketPath, `${P}/api/settings/describe`, { method: 'POST' })
    expect(api.status).toBe(200)
    expect(api.setCookie).toEqual(['plugin-pref=dark; Path=/'])
    // 会话日志导出由插件读取到达 DSH 的请求上的 Cookie
    const exportRoute = await send(socketPath, `${P}/plugins/dsh-fnos/session-log/export`, { method: 'POST' })
    expect(exportRoute.status).toBe(200)
    expect(dsh.seen.at(-1)?.authenticated).toBe(true)
  })

  it('WebSocket 升级附带网关会话（DSH 的升级只认 Cookie，不认 Token）', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)

    await openInAppShell(socketPath)
    const text = await upgrade(socketPath, `${P}/api/remote.mux`)
    expect(text).toContain('101 Switching Protocols')
    expect(dsh.seen.at(-1)?.url).toBe('/api/remote.mux')
  })

  it('并发的首次请求共用一次换取', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)

    const replies = await Promise.all(Array.from({ length: 6 }, () => send(socketPath, `${P}/api/ping`)))
    expect(replies.map(reply => reply.status)).toEqual([200, 200, 200, 200, 200, 200])
    expect(dsh.mints).toBe(1)
  })

  it('会话被 DSH 拒绝后，首页重新换取一次并恢复', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)
    await openInAppShell(socketPath)

    dsh.revokeAll()
    const { final, hops } = await openInAppShell(socketPath)
    expect(final.status).toBe(200)
    expect(hops).toBe(1)
    expect(dsh.mints).toBe(2)
  })

  it('非首页请求被拒时原样返回 401，下一个请求换取新会话', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)
    await send(socketPath, `${P}/api/ping`)

    dsh.revokeAll()
    expect((await send(socketPath, `${P}/api/ping`, { method: 'POST' })).status).toBe(401)
    expect((await send(socketPath, `${P}/api/ping`, { method: 'POST' })).status).toBe(200)
    expect(dsh.mints).toBe(2)
  })

  it('换取一直失败时首页有限次往返后返回 401，不循环', async () => {
    const dsh = await fakeDsh()
    dsh.refuseMint()
    const socketPath = await gatewayFor(dsh)

    const { final, hops } = await openInAppShell(socketPath)
    expect(final.status).toBe(401)
    expect(hops).toBe(1)
    expect(dsh.seen.length).toBeLessThanOrEqual(4)
  })

  it('浏览器遗留的 dsh-auth Cookie 被忽略并清除，其它 Cookie 原样上送', async () => {
    const dsh = await fakeDsh()
    const socketPath = await gatewayFor(dsh)
    const legacy = `${dsh.cookieName}=v1.from-old-gateway`

    const reply = await send(socketPath, `${P}/`, { cookie: `${legacy}; dsh-auth-other=x; theme=dark` })
    expect(reply.status).toBe(200)
    const upstreamCookie = dsh.seen.at(-1)?.cookie ?? ''
    expect(upstreamCookie).toContain('theme=dark')
    expect(upstreamCookie).not.toContain('from-old-gateway')
    expect(upstreamCookie).not.toContain('dsh-auth-other')
    for (const name of [dsh.cookieName, 'dsh-auth-other']) {
      for (const path of ['/', `${P}/`]) {
        expect(reply.setCookie.some(cookie => cookie.startsWith(`${name}=;`)
          && cookie.includes(`Path=${path};`) && /Max-Age=0/iu.test(cookie))).toBe(true)
      }
    }
  })
})
