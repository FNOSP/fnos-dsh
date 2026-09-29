import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import connect from 'connect'
import type { GatewayOptions, GatewayServer } from '../types/gateway.js'
import { pathRewriteMiddleware, rewritePath } from '../middleware/path-rewrite.js'
import { createProxyHandler } from './proxy.js'
import { PATH_ALLOWLIST_EVENTS_PATH } from './path-allowlist.js'
import { WEB_CONTROL_RESTART_PATH, WEB_CONTROL_START_PATH, WEB_CONTROL_STATUS_PATH } from './web-process.js'
import { attachSseKeepalive } from '../middleware/sse-keepalive.js'

function webControl(options: GatewayOptions): connect.NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split('?', 1)[0]
    if (path !== WEB_CONTROL_STATUS_PATH && path !== WEB_CONTROL_START_PATH && path !== WEB_CONTROL_RESTART_PATH) return next()
    res.setHeader('content-type', 'application/json; charset=utf-8')
    if (options.webProcess === undefined) { res.statusCode = 404; res.end(JSON.stringify({ error: 'web-control-unavailable' })); return }
    if (path === WEB_CONTROL_STATUS_PATH && req.method === 'GET') {
      void options.webProcess.snapshot().then(value => res.end(JSON.stringify(value))).catch(() => {
        if (res.writableEnded) return
        res.statusCode = 503
        res.end(JSON.stringify({ error: 'web-control-failed' }))
      })
      return
    }
    if ((path === WEB_CONTROL_START_PATH || path === WEB_CONTROL_RESTART_PATH) && req.method === 'POST') {
      const administrator = req.headers['x-requested-with'] === 'fetch' && String(req.headers['x-trim-isadmin'] ?? '').toLowerCase() === 'true'
      if (!administrator) { res.statusCode = 403; res.end(JSON.stringify({ error: 'administrator-required' })); return }
      const operation = path === WEB_CONTROL_RESTART_PATH ? options.webProcess.restart() : options.webProcess.start()
      void operation.then(value => { res.statusCode = value.state === 'error' ? 503 : 200; res.end(JSON.stringify(value)) }).catch(() => {
        if (res.writableEnded) return
        res.statusCode = 503
        res.end(JSON.stringify({ error: 'web-control-failed' }))
      })
      return
    }
    res.statusCode = 405; res.end(JSON.stringify({ error: 'method-not-allowed' }))
  }
}

function pathAllowlistEvents(options: GatewayOptions): connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url?.split('?', 1)[0] !== PATH_ALLOWLIST_EVENTS_PATH) return next()
    if (req.method !== 'GET' || options.pathAllowlist === undefined) { res.statusCode = 404; res.end(); return }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' })
    res.flushHeaders()
    const clearKeepalive = attachSseKeepalive(res, {
      interval: options.sseKeepaliveInterval ?? 15_000,
      comment: 'fnos-gateway path allowlist keep-alive',
    })
    let closed = false
    const unsubscribe = options.pathAllowlist.subscribe(snapshot => {
      if (closed || res.destroyed || res.writableEnded) return
      res.write(`event: paths\ndata: ${JSON.stringify(snapshot)}\n\n`)
    })
    const cleanup = (): void => {
      if (closed) return
      closed = true
      clearKeepalive()
      unsubscribe()
    }
    req.once('close', cleanup)
    res.once('close', cleanup)
    res.once('error', cleanup)
  }
}

function webIndexAuthentication(options: GatewayOptions): connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== 'GET' || req.url?.split('?', 1)[0] !== '/') return next()

    void (async () => {
      const webProcess = options.webProcess
      let token = webProcess?.getLaunchToken?.()
      if (token === undefined) token = await webProcess?.waitForLaunchToken?.()
      // Keep the browser URL token-free. The proxy appends the current token
      // only to the loopback request sent to DSH Web.
      if (token === undefined || res.destroyed || res.writableEnded) { next(); return }
      next()
    })().catch(next)
  }
}

function removeSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }
}

export function createGateway(options: GatewayOptions): GatewayServer {
  const { socketPath, gatewayPrefix } = options

  const app = connect()
  app.use(pathRewriteMiddleware(gatewayPrefix))
  app.use(webControl(options))
  app.use(pathAllowlistEvents(options))
  app.use(webIndexAuthentication(options))
  const proxy = createProxyHandler(options)
  app.use(proxy)

  const openSockets = new Set<import('node:net').Socket>()
  let stopping = false

  const server: Server = createServer(app)
  /**
   * HTTP middleware is not invoked for an upgrade request, so the connect chain
   * (including the prefix rewrite) never runs. This handler performs that
   * rewrite.
   *
   * **Both this handler and HPM's own one run, and that is load-bearing.**
   * HPM subscribes `server.on('upgrade')` itself the first time one of its
   * middleware functions sees an HTTP request, and neither subscription
   * cancels the other: Node's `emit` snapshots the listener list, so a
   * `removeListener` performed inside a handler cannot stop a sibling that is
   * already queued for the same emit.
   *
   * The two therefore form an implicit pipeline, in registration order:
   *
   *  1. this handler rewrites `req.url` (gateway prefix → upstream path) and
   *     calls `proxy.upgrade()`, which **deliberately does nothing here** — HPM
   *     guards its public wrapper with `wsInternalSubscribed`, and that flag is
   *     already `true` by the time any HTTP request has been served;
   *  2. HPM's own handler then proxies, reading the URL this handler just
   *     rewrote.
   *
   * Upgrade requests that arrive *before* the first HTTP request are proxied by
   * this handler directly (HPM has not subscribed yet, so the guard lets it
   * through), which is why both calls are needed rather than either one alone.
   *
   * Consequence to keep in mind when changing this: removing this handler
   * breaks the prefix rewrite (upstream sees `/app/...` and answers 404), and
   * removing HPM's breaks proxying entirely once a page has loaded. The
   * regression tests in `tests/websocket-upgrade.spec.ts` cover both the path
   * seen upstream and the number of upstream connections.
   */
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    req.url = rewritePath(req.url, gatewayPrefix)
    // Node types the HTTP upgrade socket as Duplex, while HPM's public type
    // uses net.Socket; the runtime object supplied by Node is a net socket.
    proxy.upgrade(req, socket as Socket, head)
  }
  server.on('upgrade', onUpgrade)
  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.once('close', () => openSockets.delete(socket))
  })
  server.on('clientError', (_err, socket) => socket.destroy())

  const close = async (): Promise<void> => {
    if (stopping) {
      return
    }
    stopping = true
    for (const socket of openSockets) socket.destroy()
    options.pathAllowlist?.close()
    await options.webProcess?.stop()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 5000).unref()
    })
    removeSocket(socketPath)
  }

  removeSocket(socketPath)
  const listen = (): void => {
    server.listen(socketPath, () => { console.log(`fnOS gateway listening on ${socketPath}`) })
  }
  if (options.pathAllowlist === undefined) listen()
  else void options.pathAllowlist.start().then(listen).catch(error => {
    console.error('[fnos-gateway] path allowlist watcher failed', error)
    server.emit('error', error)
  })

  return { server, close }
}
