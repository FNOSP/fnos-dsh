import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/server/gateway-server.ts'
import { browserSessionCookieName } from '../src/server/proxy.ts'

/**
 * WebSocket 升级（`/api/remote.mux`）在网关上的两个缺陷。
 *
 * 用户可见症状：页面打开后 mux 请求**断联一次**，随后重连成功——所以很容易被
 * 当成「网络抖动」而忽略。实测根因有两个，都在网关侧。
 */

const P = '/app/fn-deepseek-harness'
/**
 * 清理：`gateway.close()` 会等 `server.close()` 回调，而**升级后的 socket 不计入
 * HTTP 连接池**，Node 的 close 不会因为它而返回——所以先强制销毁残留连接，再关网关。
 * 每个清理步骤都加超时，避免任何一步卡住整个用例（此前就是这里让 4 条用例全部
 * 报 hook 超时，而断言其实是过的）。
 */
const cleanups: Array<() => Promise<void>> = []
const withTimeout = async (op: () => Promise<void> | void): Promise<void> => {
  await Promise.race([
    Promise.resolve().then(op),
    new Promise<void>(r => setTimeout(r, 1500)),
  ])
}
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) {
    try { await withTimeout(c) } catch { /* 清理失败不影响断言结论 */ }
  }
}, 15_000)

interface Harness {
  sock: string
  gateway: ReturnType<typeof createGateway>
  upgrades: string[]
  /** 上游在每次升级上收到的 Cookie。 */
  upgradeCookies: Array<string | undefined>
  /** 上游权威：cookie 名按它派生。 */
  upstreamHost: string
  upstreamPort: number
}

async function harness(opts: { requireSession?: boolean } = {}): Promise<Harness> {
  const upgrades: string[] = []
  const upgradeCookies: Array<string | undefined> = []
  let sessionCookie = ''
  // 模拟 DSH：带 Token 的首页换取会话（303 + Set-Cookie），其它请求照常应答。
  const upstream = createServer((q, s) => {
    if (/token=/u.test(q.url ?? '')) {
      s.writeHead(303, { location: './', 'set-cookie': `${sessionCookie}; Path=/; HttpOnly; SameSite=Strict` })
      s.end()
      return
    }
    s.writeHead(200)
    s.end('ok')
  })
  upstream.on('upgrade', (req, socket) => {
    upgrades.push(req.url ?? '')
    upgradeCookies.push(req.headers.cookie)
    // 模拟 DSH 的准入：升级只认会话 Cookie，不认 Token。
    if (opts.requireSession === true && !String(req.headers.cookie ?? '').includes(sessionCookie)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
      socket.end()
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.on('error', () => {})
  })
  const port = await new Promise<number>(r => upstream.listen(0, '127.0.0.1', () => r((upstream.address() as { port: number }).port)))
  sessionCookie = `${browserSessionCookieName('127.0.0.1', port)}=gateway-session`
  const dir = await mkdtemp(join(tmpdir(), 'ws-upgrade-'))
  const sock = join(dir, 'g.sock')
  const gateway = createGateway({
    socketPath: sock, gatewayPrefix: P, upstreamHost: '127.0.0.1', upstreamPort: port,
    webProcess: {
      getLaunchToken: () => 'launch-token',
      snapshot: async () => ({ state: 'running' as const }),
    } as never,
  })
  await once(gateway.server, 'listening')
  cleanups.push(async () => gateway.close())
  cleanups.push(async () => {
    // 主动断开所有仍挂着的连接，否则 server.close() 永远不回调。
    gateway.server.closeAllConnections?.()
    await new Promise<void>(r => upstream.close(() => r()))
  })
  cleanups.push(async () => rm(dir, { recursive: true, force: true }))
  return { sock, gateway, upgrades, upgradeCookies, upstreamHost: '127.0.0.1', upstreamPort: port }
}

/** 发一次普通 HTTP 请求：这会让 HPM 订阅它自己的 upgrade handler。 */
async function oneHttpRequest(sock: string): Promise<void> {
  await new Promise<void>(resolve => {
    const c = createConnection(sock)
    c.once('connect', () => c.write(`GET ${P}/ HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n`))
    c.on('data', () => {})
    c.once('close', () => resolve())
    c.once('error', () => resolve())
    setTimeout(() => { c.destroy(); resolve() }, 1200)
  })
}

/** 发一次 WebSocket 升级，返回客户端收到的字节与连接是否已被断开。 */
async function oneUpgrade(sock: string, path = `${P}/api/remote.mux`): Promise<{ text: string, destroyed: boolean }> {
  const client = createConnection(sock)
  await once(client, 'connect')
  client.write([
    `GET ${path} HTTP/1.1`,
    'Host: h',
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '', '',
  ].join('\r\n'))
  let text = ''
  client.on('data', d => { text += d.toString('utf8') })
  client.on('error', () => {})
  await new Promise(r => setTimeout(r, 400))
  const destroyed = client.destroyed
  client.destroy()
  return { text, destroyed }
}

describe('WS 升级的凭据', () => {
  it('浏览器不带 Cookie 时附带网关会话：预热后首个升级即得到 101', async () => {
    const h = await harness({ requireSession: true })
    await h.gateway.warmSession()
    const { text } = await oneUpgrade(h.sock)

    expect(h.upgrades[0]).not.toContain('token=')
    expect(h.upgradeCookies[0]).toContain('gateway-session')
    expect(text).toContain('101 Switching Protocols')
    expect(text).not.toContain('401')
  })

  it('浏览器带来的会话 Cookie 不上送，凭据也不进 URL', async () => {
    const h = await harness({ requireSession: true })
    await h.gateway.warmSession()
    const name = browserSessionCookieName(h.upstreamHost, h.upstreamPort)
    const client = createConnection(h.sock)
    await once(client, 'connect')
    client.write([
      `GET ${P}/api/remote.mux HTTP/1.1`, 'Host: h', 'Connection: Upgrade', 'Upgrade: websocket',
      `Cookie: ${name}=from-browser; theme=dark`,
      'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', '',
    ].join('\r\n'))
    let text = ''
    client.on('data', d => { text += d.toString('utf8') }); client.on('error', () => {})
    await new Promise(r => setTimeout(r, 300))
    client.destroy()
    expect(h.upgrades[0]).not.toContain('token=')
    expect(h.upgradeCookies[0]).toBe(`theme=dark; ${name}=gateway-session`)
    expect(text).toContain('101')
  })
})

describe('WS 升级的路径改写', () => {
  /**
   * 升级请求**必须**去掉网关前缀再交给上游。
   *
   * 这条覆盖的是一条隐式流水线：网关自己的 handler 负责改写 `req.url`，HPM 自订阅的
   * handler 负责真正代理（网关那次 `proxy.upgrade()` 被 HPM 的 `wsInternalSubscribed`
   * guard 吞掉，是 no-op）。两个订阅都无法取消对方——Node 的 `emit` 用监听器快照。
   *
   * 因此只要改动其中一个的注册顺序或存在性，这条就会红：上游会收到
   * `/app/fn-deepseek-harness/api/remote.mux` 而不是 `/api/remote.mux`，真实 DSH 对此
   * 回 404，mux 连接建立不起来。
   */
  it('HTTP 请求之后（HPM 已自订阅）上游仍收到去前缀的路径', async () => {
    const h = await harness()
    await oneHttpRequest(h.sock)
    const before = h.upgrades.length
    const { text } = await oneUpgrade(h.sock)
    console.log('  上游收到:', JSON.stringify(h.upgrades.slice(before)))
    const pathname = new URL(h.upgrades.at(-1) ?? '/', 'http://upstream.invalid').pathname
    expect(pathname).toBe('/api/remote.mux')
    expect(h.upgrades.at(-1)).not.toContain('fn-deepseek-harness')
    expect(text).toContain('101')
  })

  it('首连（HTTP 之前）也收到去前缀的路径', async () => {
    const h = await harness()
    const { text } = await oneUpgrade(h.sock)
    console.log('  上游收到:', JSON.stringify(h.upgrades))
    const pathname = new URL(h.upgrades.at(-1) ?? '/', 'http://upstream.invalid').pathname
    expect(pathname).toBe('/api/remote.mux')
    expect(text).toContain('101')
  })
})

describe('WS 升级的订阅者', () => {
  it('HPM 自订阅后同一次升级仍只代理一次（上游只被连一次）', async () => {
    const h = await harness()
    await oneHttpRequest(h.sock)
    const before = h.upgrades.length
    const { text } = await oneUpgrade(h.sock)

    console.log('  upgrade 监听器数:', h.gateway.server.listenerCount('upgrade'))
    console.log('  本次升级引发的上游连接数:', h.upgrades.length - before)

    // 监听器变成 2 是 HPM 的内部行为，无法（也不该）阻止；关键是**只代理一次**。
    expect(h.upgrades.length - before).toBe(1)
    expect(text).toContain('101')
  })

  it('连续多次升级都只代理一次', async () => {
    const h = await harness()
    await oneHttpRequest(h.sock)
    await oneUpgrade(h.sock)
    await oneUpgrade(h.sock)
    await oneHttpRequest(h.sock)
    await oneUpgrade(h.sock)
    console.log('  三次升级后的上游连接数:', h.upgrades.length)
    expect(h.upgrades.length).toBe(3)
  })
})
