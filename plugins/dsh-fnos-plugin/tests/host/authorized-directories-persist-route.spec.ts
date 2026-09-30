import { describe, expect, it, vi } from 'vitest'

const { callFnOsApi } = vi.hoisted(() => ({ callFnOsApi: vi.fn() }))
// `FnOsApiError` 必须保留真实实现：`errorResponse` 用 `instanceof` 判定权限错误，
// 只 mock 掉 `callFnOsApi` 却丢掉这个导出会让 `instanceof` 抛错，路由于是退化成
// 兜底的 `fnos-route-failed`（500），把断言引向错误的结论。
vi.mock('../../src/api/fnos-api.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/api/fnos-api.ts')>(),
  callFnOsApi,
}))

import { registerAuthorizedDirectoryRoutes } from '../../src/host/authorized-directories.ts'
import { FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH } from '../../src/contracts/authorized-directories-contract.ts'

/**
 * 持久化回写路由（FNOS-009-09-AC-01 / AC-03）。
 *
 * 卡片在用户增删目录和校验剔除之后都会 POST 这条路由，因此它的写入语义就是
 * 持久化契约本身：归一化、去重、以及**写入失败时不清空既有记录**。
 *
 * 这里驱动真实处理器而不是只测辅助函数，因为最容易出错的一层在路由上：
 * 重新抛出的异常被 DSH webserver 转成空体 400，而恢复旧值的逻辑一旦缺失，
 * 一次失败的写就会把用户攒下的目录全部抹掉。
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

/**
 * 同源 loopback 请求：`isTrustedFnosRequest` 对 loopback 直接放行。
 *
 * `on` 必须真正把数据分发给监听器：路由用 `readJsonBody` 读取请求体，而它
 * 订阅的是 `data`/`end` 事件而不是异步迭代。只返回 `this` 的桩会让 Promise
 * 永不 settle，表现为测试超时而不是断言失败。
 */
function fakeRequest(method: string, payload?: unknown) {
  const chunks = payload === undefined ? [] : [JSON.stringify(payload)]
  return {
    method,
    headers: { host: 'nas.local:5666' },
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

/**
 * 捕获路由并记录 settings 写入。
 *
 * `update` 可被替换为拒绝，用来验证写入失败时既有记录不被清空。
 */
function harness(updateImpl?: (ns: string, patch: Record<string, unknown>) => Promise<void>) {
  const routes = new Map<string, CapturedRoute>()
  const stored: Array<[string, Record<string, unknown>]> = []
  const update = vi.fn(updateImpl ?? (async (ns: string, patch: Record<string, unknown>) => {
    stored.push([ns, patch])
  }))
  const ctx = {
    effect: (factory: () => unknown) => { factory() },
    on: () => () => undefined,
    get: () => undefined,
    settings: {
      describe: () => [{ ns: 'dsh-fnos', value: {} }],
      update,
      prepareDocument: async () => '/tmp/profile/package.json',
    },
    webServer: {
      register: (route: CapturedRoute) => { routes.set(route.path, route); return () => undefined },
    },
  }
  registerAuthorizedDirectoryRoutes(ctx as never, { settingsNamespace: 'dsh-fnos' })
  return { routes, update, stored }
}

describe('authorized-directory persist route', () => {
  it('writes the submitted paths to the settings namespace', async () => {
    const { routes, update, stored } = harness()
    const res = fakeResponse()

    await routes.get(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH)?.handler(
      fakeRequest('POST', { paths: ['/vol4/mine', '/vol2/media'] }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    expect(stored[0]?.[0]).toBe('dsh-fnos')
    expect(stored[0]?.[1]).toEqual({ authorizedDirectories: ['/vol4/mine', '/vol2/media'] })
    expect(JSON.parse(String(res.body))).toEqual({ paths: ['/vol4/mine', '/vol2/media'] })
  })

  it('normalizes and de-duplicates before storing', async () => {
    const { routes, stored } = harness()
    const res = fakeResponse()

    await routes.get(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH)?.handler(
      fakeRequest('POST', { paths: ['/vol4/mine/', '/vol4/mine', ' ', 'relative', '/vol2/media'] }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(stored[0]?.[1]).toEqual({ authorizedDirectories: ['/vol4/mine', '/vol2/media'] })
  })

  it('commits a full eviction as an empty list', async () => {
    const { routes, stored } = harness()
    const res = fakeResponse()

    // 剔除到空是合法结果，不能因为「空数组像没数据」就跳过写入。
    await routes.get(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH)?.handler(
      fakeRequest('POST', { paths: [] }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(stored[0]?.[1]).toEqual({ authorizedDirectories: [] })
  })

  it('answers a diagnosable error instead of a blank 400 when the body is malformed', async () => {
    const { routes, update } = harness()
    const res = fakeResponse()

    // 非法结构必须在写入前被拒绝，且不能碰 settings。
    await routes.get(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH)?.handler(
      fakeRequest('POST', { paths: 'not-an-array' }),
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'invalid-fnos-paths' })
    expect(update).not.toHaveBeenCalled()
  })

  it('does not clear existing data when the settings write fails', async () => {
    const { routes, update } = harness(async () => { throw new Error('settings unavailable') })
    const res = fakeResponse()

    await routes.get(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH)?.handler(
      fakeRequest('POST', { paths: ['/vol4/mine'] }),
      res,
    )

    // 09-AC-03：写入失败时既有数据不被清空或改写。这里只发过一次写入，
    // 且失败后没有追加任何「清空」写——遗留数据比丢数据安全。
    expect(update).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'fnos-authorized-directory-request-failed' })
  })

  it('rejects a non-POST method without touching settings', async () => {
    const { routes, update } = harness()
    const res = fakeResponse()

    await routes.get(FNOS_AUTHORIZED_DIRECTORIES_PERSIST_PATH)?.handler(fakeRequest('GET'), res)

    expect(res.statusCode).toBe(405)
    expect(update).not.toHaveBeenCalled()
  })
})
