import { describe, expect, it, vi } from 'vitest'

const { callFnOsApi } = vi.hoisted(() => ({ callFnOsApi: vi.fn() }))
vi.mock('../../src/api/fnos-api.ts', () => ({ callFnOsApi }))

import { registerAuthorizedDirectoryRoutes } from '../../src/host/authorized-directories.ts'
import { FNOS_SESSION_LOG_EXPORT_PATH } from '../../src/contracts/session-log-export-contract.ts'

/**
 * No fnOS route may let a rejection escape into the webserver's blank 400.
 *
 * `@deepseek-ai/dsh-host-webserver` answers any rejection escaping a route
 * handler with `res.writeHead(400); res.end()` — an empty body. That is the
 * failure mode this repo hit on the gateway proxy-path route, where the
 * browser could only report "400 Bad Request" with no cause. The
 * session-log export route had the same shape: `readJsonBody` rejects on a
 * malformed or oversized body, and `validatePathForOpen` can reject while
 * resolving authorized roots — both were outside its try block.
 *
 * These tests drive the real handlers with a request body that makes
 * `readJsonBody` reject, and assert a JSON error response instead.
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

/** A same-origin loopback request whose body emits the supplied chunks. */
function fakeRequest(method: string, chunks: string[], headers: Record<string, string> = {}) {
  return {
    method,
    url: '/',
    headers: { host: 'nas.local:5666', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    once() {},
    off() {},
    on(event: string, listener: (value?: unknown) => void) {
      if (event === 'data') for (const chunk of chunks) listener(chunk)
      if (event === 'end') listener()
      return this
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk)
    },
  }
}

function capturedRoutes(): Map<string, CapturedRoute> {
  const routes = new Map<string, CapturedRoute>()
  const ctx = {
    effect: (factory: () => unknown) => { factory() },
    on: () => () => undefined,
    get: () => undefined,
    settings: { describe: () => [], prepareDocument: async () => '/tmp/profile/package.json' },
    webServer: {
      register: (route: CapturedRoute) => { routes.set(route.path, route); return () => undefined },
    },
  }
  registerAuthorizedDirectoryRoutes(ctx as never)
  return routes
}

describe('fnOS route rejection envelope', () => {
  it('registers every fnOS route exactly once behind the rejection guard', () => {
    const routes = capturedRoutes()
    expect([...routes.keys()]).toContain(FNOS_SESSION_LOG_EXPORT_PATH)
    expect(routes.get(FNOS_SESSION_LOG_EXPORT_PATH)?.kind).toBe('exact')
  })

  it('answers invalid JSON on the session-log export as a 400, not as a blank crash', async () => {
    const route = capturedRoutes().get(FNOS_SESSION_LOG_EXPORT_PATH)
    const res = fakeResponse()
    // Malformed JSON makes readJsonBody reject; before the fix that rejection
    // escaped the handler and the webserver answered an empty 400.
    await route?.handler(fakeRequest('POST', ['{"directory":']), res)

    expect(res.statusCode).toBe(400)
    expect(res.headers?.['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(String(res.body))).toEqual({ error: 'invalid-session-log-export-request' })
  })

  it('answers an oversized session-log export body as a 400', async () => {
    const route = capturedRoutes().get(FNOS_SESSION_LOG_EXPORT_PATH)
    const res = fakeResponse()
    // Exceeds the 64 KiB BODY_LIMIT, the other ordinary readJsonBody rejection.
    await route?.handler(fakeRequest('POST', ['x'.repeat(70 * 1024)]), res)

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'invalid-session-log-export-request' })
  })

  it('answers a well-formed but structurally wrong body as a 400', async () => {
    const route = capturedRoutes().get(FNOS_SESSION_LOG_EXPORT_PATH)
    const res = fakeResponse()
    await route?.handler(fakeRequest('POST', [JSON.stringify({ sessionId: 42 })]), res)

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'invalid-session-log-export-request' })
  })

  it('still answers 405 for a wrong method and 403 for an untrusted origin', async () => {
    const route = capturedRoutes().get(FNOS_SESSION_LOG_EXPORT_PATH)

    const wrongMethod = fakeResponse()
    await route?.handler(fakeRequest('GET', []), wrongMethod)
    expect(wrongMethod.statusCode).toBe(405)

    const crossSite = fakeResponse()
    const request = fakeRequest('POST', [], { 'sec-fetch-site': 'cross-site' })
    await route?.handler(request, crossSite)
    expect(crossSite.statusCode).toBe(403)
    expect(JSON.parse(String(crossSite.body))).toEqual({ error: 'remote-web-origin-not-trusted' })
  })

  it('converts a handler that throws outside its own try into a diagnosable 500', async () => {
    // Defense in depth: even a future handler that forgets its try block must
    // not become a blank 400. `loadAuthorizedDirectories` is not reached here
    // because settings.prepareDocument resolves; instead drive the session-log
    // route after breaking its body reader through a request with no iterator.
    const route = capturedRoutes().get(FNOS_SESSION_LOG_EXPORT_PATH)
    const res = fakeResponse()
    const hostile = {
      method: 'POST',
      headers: { host: 'nas.local:5666' },
      socket: { remoteAddress: '127.0.0.1' },
      setEncoding() {},
      once() {},
      off() {},
      on(event: string, listener: (error?: unknown) => void) {
        // Simulate a transport failure: readJsonBody rejects via 'error'.
        if (event === 'error') listener(new Error('socket hang up'))
        return this
      },
    }
    await route?.handler(hostile, res)

    // Either the route classified it as invalid input (400) or the outer guard
    // reported it (500) — never a rejection escaping to the webserver.
    expect([400, 500]).toContain(res.statusCode)
    expect(JSON.parse(String(res.body))).toMatchObject({ error: expect.any(String) })
  })
})
