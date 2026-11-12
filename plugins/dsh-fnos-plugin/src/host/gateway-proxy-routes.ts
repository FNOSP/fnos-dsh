import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { FNOS_GATEWAY_BUILTIN_PREFIXES, FNOS_GATEWAY_PROXY_PATHS_FILE, FNOS_GATEWAY_PROXY_PATHS_ROUTE, FNOS_INSTALLED_PLUGINS_ROUTE, FNOS_PLUGIN_ASSET_ROUTE, FNOS_PLUGIN_INDEX_APPLY_ROUTE, FNOS_PLUGIN_INDEX_STATUS_ROUTE, FNOS_PLUGIN_INDEX_TOGGLE_ROUTE, FNOS_PLUGIN_INSTALL_ROUTE, FNOS_PLUGIN_INSTALL_STATE_ROUTE, FNOS_PLUGIN_INSTALL_LOG_ROUTE, FNOS_PLUGIN_TOGGLE_ROUTE, FNOS_PLUGIN_REMOVE_ROUTE, FNOS_NPM_MIRROR_STATUS_ROUTE, FNOS_NPM_MIRROR_USE_ROUTE, FNOS_NPM_MIRROR_INSTALL_ROUTE, normalizeGatewayProxyPaths, validateGatewayProxyPaths, type GatewayProxyPathsDocument } from '../contracts/gateway-proxy-contract.ts'
import { detectProxyPrefixes } from './gateway-proxy-detect.ts'
import { applyRecommendedIndexes, readIndexStatus, setMarketEnabled } from './plugin-index-sources.ts'
import { resolveRepairEnvironment } from './dependency-repair.ts'
import { installPlugin, readInstallLog, readInstallState, removePlugin } from './plugin-install.ts'
import { setPackageEnabled } from './plugin-toggle.ts'
import { readInstalledPlugins } from './installed-plugins.ts'
import { installNrm, readNpmMirrorStatus, switchNpmMirror } from './npm-mirror.ts'
import type { FnosSettings } from '../contracts/theme-contract.ts'

function send(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
async function body(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined } }
/**
 * Reject cross-site writes to the gateway allowlist.
 *
 * Compares against `host` only. The fnOS gateway rewrites `host` and `origin`
 * together to the loopback authority, so the two agree on the second hop;
 * `x-forwarded-host` belongs to the platform proxy and never matches the
 * rewritten Origin. Reading it here made every remote write 403, and trusting
 * it would let an intermediary authorize itself.
 *
 * A request without `Origin` keeps its previous meaning (admitted): this route's
 * callers include non-browser paths, and the same-origin check only arbitrates
 * requests that actually declare an origin.
 */
function trusted(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}

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

/**
 * 自动前缀的巡检间隔（毫秒）。
 *
 * 装插件后不会有任何「保存」动作，前缀因此必须由宿主自己发现并回写。3 秒足够
 * 让用户在装完后立刻可用，而空转只是一次内存 Map 遍历。
 */
const AUTO_PREFIX_POLL_MS = 3000

export function registerGatewayProxyRoutes(ctx: Context, settingsNamespace: string): void {
  const settings = ctx.settings
  const readSettings = (): FnosSettings => {
    const descriptor = settings.describe().find(row => row.ns === settingsNamespace)
    return descriptor?.value as FnosSettings ?? {}
  }
  /**
   * 当前自动识别到的前缀。
   *
   * 每次写文档都重新读一次路由表，而不是缓存：用户装/卸插件后前缀会变，
   * 缓存就要额外维护失效，容易留下残影（需求 FNOS-052-04 明确要求
   * 「插件停用后其前缀从生效集合消失」）。
   * @returns 自动前缀集合。
   */
  /**
   * 路由前缀 → 插件包名。
   *
   * ## 为什么能问到，以及为什么不能靠猜
   *
   * `webserver.register()` 只接收 `{ kind, path, handler }`，**不记录是谁注册的**
   * （见上游 `packages/host/webserver` 的 `WebRoute`）。所以直接反查是拿不到的。
   *
   * 但 **loader 侧知道**：每个插件条目有 `options.name`（模块名），而模块名就是
   * 包名。于是「这个前缀属于谁」可以这样判断——遍历 loader 条目，对每个插件调用
   * 它自己声明的路由前缀……可惜那需要读插件代码，不可行。
   *
   * 实际可行的做法是**用路由表反推**：前缀段与某插件包名的一部分相同即认为归属
   * 该包。这仍是启发式，所以：
   *
   * - 只在前缀段**完整出现在包名里**时认定（`/connect` ↛ `dsh-pet` 除非包名含
   *   `connect`）；
   * - 拿不准就留空，绝不猜。
   *
   * 真机数据也印证了这点：`/connect` 由 `dsh-pet` 提供、`/fnos-plugins` 由
   * `@tnnevol/dsh-fnos` 提供——按「包名末段 vs 前缀段」猜全部落空。
   */
  const buildOwnerResolver = (): ((prefix: string) => string | undefined) => {
    const loader = (ctx as unknown as { loader?: { entries?: () => Iterable<{ options?: { name?: string } }> } }).loader
    const names: string[] = []
    try {
      for (const entry of loader?.entries?.() ?? []) {
        const name = entry.options?.name
        if (typeof name === 'string' && name !== '') names.push(name)
      }
    } catch {
      // loader 不可读时退化为「无归属信息」。
    }
    return (prefix: string): string | undefined => {
      const segment = prefix.replace(/^\//u, '').toLowerCase()
      if (segment === '') return undefined
      // 只在包名**整体包含**该前缀段时认定，避免 `connect` 命中无关包。
      const hit = names.find(name => name.toLowerCase().includes(segment))
      return hit
    }
  }
  const ownerOf = buildOwnerResolver()
  const autoPrefixes = (): string[] => [...detectProxyPrefixes(ctx.webServer, ownerOf).prefixes]

  const file = gatewayProxyPathsFile()
  if (file !== undefined) {
    const sync = (value: FnosSettings): Promise<void> => writeDocument(file, {
      version: 1,
      paths: normalizeGatewayProxyPaths(value.gatewayProxyPaths ?? []) ?? [],
      auto: autoPrefixes(),
    })
    ctx.effect(() => {
      // 启动时的方向取决于 settings 是否为空：
      //
      //  - settings 有值 → 以它为准写向文件（正常运行、用户刚改过配置）；
      //  - settings 为空而文件有值 → **从文件恢复**。这是卸载重装后的场景：
      //    用户勾了「保留数据」，`TRIM_PKGVAR` 里的 allowlist 还在，但 profile
      //    是新建的、settings 为空。若这时仍按 settings 写文件，就会用空列表
      //    把缓存覆盖掉，用户的代理配置在首次启动瞬间永久丢失。
      //
      // 先恢复再镜像，只写一次，避免「先清空再回填」的中间态。
      const restoreOrSync = async (): Promise<void> => {
        const configured = normalizeGatewayProxyPaths(readSettings().gatewayProxyPaths ?? []) ?? []
        if (configured.length === 0) {
          const cached = await readDocument(file)
          const cachedPaths = normalizeGatewayProxyPaths(cached.paths) ?? []
          if (cachedPaths.length > 0) {
            await settings.update(settingsNamespace, { gatewayProxyPaths: cachedPaths })
            return
          }
        }
        await sync(readSettings())
      }
      void restoreOrSync().catch(error => { console.error('[dsh-fnos] unable to initialize gateway proxy paths', error) })

      /*
        **自动区段要自己巡检**：装完插件后没人会去点「保存」，只靠
        `settings/document-updated` 意味着新插件的路由永远不会进 allowlist——
        表现就是「插件装上去了、界面也认得它，但它的接口一直 404」。

        每 3 秒读一次路由表并比对；只有变化时才写文件（网关侧 `fs.watch` 收到后
        经 SSE 推给页面，无需刷新）。3 秒是权衡：装插件本身要几秒，用户不会感知
        延迟；而空转成本只是一次纯内存的 Map 遍历。
      */
      let lastAuto = JSON.stringify(autoPrefixes())
      const timer = setInterval(() => {
        const current = JSON.stringify(autoPrefixes())
        if (current === lastAuto) return
        lastAuto = current
        void sync(readSettings()).catch(error => { console.error('[dsh-fnos] unable to sync auto proxy prefixes', error) })
      }, AUTO_PREFIX_POLL_MS)
      ctx.effect(() => () => { clearInterval(timer) })

      return ctx.on('settings/document-updated', namespace => {
        if (namespace === settingsNamespace) {
          // 手动项变化时顺带把 lastAuto 对齐，避免巡检立刻又写一次同样的内容。
          lastAuto = JSON.stringify(autoPrefixes())
          void sync(readSettings()).catch(error => { console.error('[dsh-fnos] unable to mirror gateway proxy paths', error) })
        }
      })
    }, 'dsh-fnos: gateway proxy path settings mirror')
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_INSTALLED_PLUGINS_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      try {
        const environment = resolveRepairEnvironment()
        /*
          **默认不联网查更新（`updates=1` 才查）。**

          查更新是「每个插件发一次 registry 请求」，装十几个插件就要十几个网络
          往返——首屏因此很慢。官方 `listPlugins` 也只读本地清单，版本更新是另一
          条单独的调用。

          需要「有没有新版本」时由界面显式点刷新触发（带 `?updates=1`）。
        */
        const url = new URL(req.url ?? '/', 'http://localhost')
        const checkUpdates = url.searchParams.get('updates') === '1'
        send(res, 200, await readInstalledPlugins(
          environment?.profileDirectory,
          environment?.bundledDirectory,
          checkUpdates,
        ))
      } catch (error) {
        send(res, 500, { error: 'installed-plugins-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: installed plugins')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_INDEX_STATUS_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      try {
        // 语言用于取索引标题（索引的 `title` 按语言给出）。
        const locale = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'].slice(0, 5) : 'zh'
        send(res, 200, await readIndexStatus(ctx, locale))
      } catch (error) {
        send(res, 500, { error: 'index-status-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: plugin index status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_INDEX_APPLY_ROUTE,
    handler: async (req, res) => {
      // 写操作：POST + 同源。GET 会被预取意外触发。
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      try {
        send(res, 200, await applyRecommendedIndexes(ctx))
      } catch (error) {
        send(res, 500, { error: 'index-apply-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: plugin index apply')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_INSTALL_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      try {
        const payload = await body(req) as { name?: unknown } | undefined
        // 只接受规范包名：安装会执行 pnpm，名字必须能拼成合法参数，
        // 否则 `--foo` 之类的内容会被 pnpm 当成选项。
        if (typeof payload?.name !== 'string' || !/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u.test(body.name)) {
          return send(res, 400, { error: 'invalid-plugin-name' })
        }
        send(res, 200, await installPlugin(payload.name))
      } catch (error) {
        send(res, 500, { error: 'install-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: plugin install')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_INSTALL_STATE_ROUTE,
    handler: (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      send(res, 200, readInstallState())
    },
  }), 'dsh-fnos: plugin install state')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_INSTALL_LOG_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      // offset 让前端只取新增部分，避免每次轮询都重传整份日志。
      const offset = Number.parseInt(new URL(req.url ?? '/', 'http://x').searchParams.get('offset') ?? '0', 10)
      send(res, 200, await readInstallLog(Number.isFinite(offset) ? offset : 0))
    },
  }), 'dsh-fnos: plugin install log')

  /** 包名校验：安装/禁用/卸载都要过这一关（拼不成合法参数的名字一律拒绝）。 */
  const validName = (value: unknown): value is string =>
    typeof value === 'string' && /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u.test(value)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_TOGGLE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const payload = await body(req) as { name?: unknown, enabled?: unknown } | undefined
      if (!validName(payload?.name)) return send(res, 400, { error: 'invalid-plugin-name' })
      if (typeof payload?.enabled !== 'boolean') return send(res, 400, { error: 'invalid-enabled' })
      const result = await setPackageEnabled(payload.name, payload.enabled)
      send(res, result.ok ? 200 : 500, result.ok ? { ok: true } : { error: 'toggle-failed', message: result.error })
    },
  }), 'dsh-fnos: plugin toggle')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_REMOVE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const payload = await body(req) as { name?: unknown } | undefined
      if (!validName(payload?.name)) return send(res, 400, { error: 'invalid-plugin-name' })
      const result = await removePlugin(payload.name)
      /*
        并发卸载用 **409** 回应，而不是和普通失败一起塞进 500：这不是「卸载失败」，
        而是「这次请求不该被受理」。调用方据此给出「请勿重复操作」，也便于以后
        在别的入口里区分处理。
      */
      if (!result.ok && result.error === 'plugin-remove-in-progress') {
        return send(res, 409, { error: 'plugin-remove-in-progress' })
      }
      send(res, result.ok ? 200 : 500, result.ok
        // needRestart：已卸载但组合仍持有旧模块，重启 Web 后才完全消失。
        ? { ok: true, needRestart: result.needRestart === true }
        : { error: 'remove-failed', message: result.error })
    },
  }), 'dsh-fnos: plugin remove')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_NPM_MIRROR_STATUS_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      try {
        send(res, 200, await readNpmMirrorStatus())
      } catch (error) {
        send(res, 500, { error: 'mirror-status-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: npm mirror status')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_NPM_MIRROR_USE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const payload = await body(req) as { name?: unknown } | undefined
      if (typeof payload?.name !== 'string') return send(res, 400, { error: 'invalid-mirror-name' })
      const result = await switchNpmMirror(payload.name)
      send(res, result.ok ? 200 : 500, result.ok ? { ok: true } : { error: 'mirror-use-failed', message: result.error })
    },
  }), 'dsh-fnos: npm mirror use')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_NPM_MIRROR_INSTALL_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      try {
        const result = await installNrm()
        send(res, result.ok ? 200 : 500, result.ok ? { ok: true } : { error: 'install-nrm-failed', message: result.error })
      } catch (error) {
        send(res, 500, { error: 'install-nrm-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: install nrm')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_ASSET_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const name = url.searchParams.get('name') ?? ''
      const asset = url.searchParams.get('path') ?? ''
      /*
        **路径校验：只允许包目录内的相对路径。**

        `asset` 直接来自查询串。若不管，`../../../../etc/passwd` 就能读任意文件。
        这里要求：不以 `/` 开头、不含 `..` 段。包的定位仍只接受 `dependencies`
        里已声明的名字——不认识的包名直接拒绝，避免用它探测磁盘。
      */
      if (name === '' || asset === '' || asset.startsWith('/') || asset.split('/').includes('..')) {
        return send(res, 400, { error: 'invalid-asset-path' })
      }
      const environment = resolveRepairEnvironment()
      const profile = environment?.profileDirectory
      if (profile === undefined) return send(res, 400, { error: 'profile-unavailable' })
      try {
        const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>, devDependencies?: Record<string, string>
          dsh?: { profile?: { bundles?: string[] } }
        }
        const known = new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
          ...manifest.dsh?.profile?.bundles ?? [],
        ])
        if (!known.has(name)) return send(res, 404, { error: 'unknown-plugin' })
        const file = join(profile, 'node_modules', ...name.split('/'), ...asset.split('/'))
        const body = await readFile(file)
        const type = asset.endsWith('.svg') ? 'image/svg+xml'
          : asset.endsWith('.png') ? 'image/png'
            : asset.endsWith('.jpg') || asset.endsWith('.jpeg') ? 'image/jpeg'
              : asset.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'
        res.statusCode = 200
        res.setHeader('content-type', type)
        res.setHeader('cache-control', 'private, max-age=300')
        res.end(body)
      } catch {
        send(res, 404, { error: 'asset-not-found' })
      }
    },
  }), 'dsh-fnos: plugin asset')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_PLUGIN_INDEX_TOGGLE_ROUTE,
    handler: async (req, res) => {
      if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
      const payload = await body(req) as { enabled?: unknown } | undefined
      if (typeof payload?.enabled !== 'boolean') return send(res, 400, { error: 'invalid-enabled' })
      try {
        const result = await setMarketEnabled(ctx, payload.enabled)
        send(res, result.ok ? 200 : 500, result.ok
          ? { ok: true, needRestart: result.needRestart === true }
          : { error: 'index-toggle-failed', message: result.error })
      } catch (error) {
        send(res, 500, { error: 'index-toggle-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-fnos: plugin index toggle')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FNOS_GATEWAY_PROXY_PATHS_ROUTE,
    handler: async (req, res) => {
      try {
        if (!trusted(req)) return send(res, 403, { error: 'remote-web-origin-not-trusted' })
        const file = gatewayProxyPathsFile()
        if (file === undefined) return send(res, 503, { error: 'fnos-gateway-config-unavailable' })
        // GET 额外带上网关固定前缀：前端据此渲染「系统内置」只读区，
        // 让用户明白这些路径为什么不在自己的可编辑列表里。
        if (req.method === 'GET') {
          const detection = detectProxyPrefixes(ctx.webServer, ownerOf)
          return send(res, 200, {
            version: 1,
            paths: normalizeGatewayProxyPaths(readSettings().gatewayProxyPaths ?? []) ?? [],
            /*
              这里返回的是**完整识别结果对象**（available / reason / groups / prefixes），
              不只是前缀数组。

              只给数组时，界面分不清「当前环境读不到路由表」与「读到了但没有插件用
              绝对路径」——两种情况的处置完全不同（前者要引导手填，后者什么都不用做）。
              明细分组也来自这里，界面的按前缀展示才有数据。文档里的 `auto` 字段仍是
              纯数组（网关只关心要改写哪些前缀），两者形状不同是刻意的。
            */
            auto: detection,
            builtin: FNOS_GATEWAY_BUILTIN_PREFIXES,
          })
        }
        if (req.method !== 'PUT') return send(res, 405, { error: 'method-not-allowed' })
        const paths = validateGatewayProxyPaths(await body(req))
        if (paths === undefined) return send(res, 400, { error: 'invalid-gateway-proxy-paths' })
        // 保留 auto：用户保存手动项不该把自动区段清掉。
        const document: GatewayProxyPathsDocument = { version: 1, paths, auto: autoPrefixes() }
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
