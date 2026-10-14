/**
 * DSH Desktop 的 CDP 通道：把开发态 Desktop 的渲染进程当作可断言对象。
 *
 * ## 为什么不用 Computer Mode（这是实测得出的结论，不是偏好）
 *
 * Computer Mode（`@midscene/computer`）驱动**真实屏幕**：截图 + 系统键鼠。在 macOS 上键鼠注入
 * 只有 `CGEventPost(kCGHIDEventTap)` 一条路径，操作的是**硬件级指针**——系统不存在「只对某个
 * 应用生效的隐形光标」，所以它**必然**会抢用户前台、动真实鼠标。实测确认该包内也没有
 * `virtualCursor` / `hideCursor` / `cursorless` 之类的开关（零命中）。
 *
 * 代价是实测的：一次 Desktop 视觉用例就把用户的办公界面切走、鼠标被接管。
 * 而测试规范本来就把 CDP 列为 Desktop 取证的**首选**。
 *
 * ## CDP 能做什么、不能做什么
 *
 * | 能（DOM 级，精确且零模型调用） | 不能 |
 * | --- | --- |
 * | 读 DOM 属性、类名、计算样式 | 视觉观感（「两态是否肉眼可辨」） |
 * | 页面内 `element.click()` 真实切换 React 状态 | 跨应用交互 |
 * | 断言版本号、插件清单等精确文本 | — |
 *
 * 「视觉可辨」这一类断言改由人工走查，或等 Computer Mode 支持虚拟光标后再补。
 *
 * ## 为什么自己写客户端而不用 AgentCDP
 *
 * `@midscene/web@1.15.1` 的导出子路径里**没有** `./cdp`（`agent-tools-cdp` 只是内部工具注册，
 * 未导出 `AgentCDP` 类）。而 CDP 附加渲染进程只需要 `Runtime.evaluate` 一条命令，
 * 为此引入一个不稳定的上游入口不划算——这里是约 60 行的最小实现，只依赖标准库 `WebSocket`。
 *
 * @module dsh-e2e-kit/desktop-cdp
 */

/** 判定结果：页面内脚本须返回的形状。 */
export interface DesktopVerdict {
  /** 是否成立。 */
  readonly pass: boolean
  /** 失败原因或补充说明。 */
  readonly detail?: string
}

/** CDP 客户端：连一个渲染进程，在其中求值脚本。 */
export interface DesktopCdpSession {
  /**
   * 在渲染进程内求值 `script`。
   *
   * @param script 表达式源码。
   * @returns 求值结果（`returnByValue: true`，故拿到的是可序列化值而非句柄）。
   * @throws 页面异常或传输失败时抛出——**异常会真正传播**，这正是它比 Midscene 的
   *   `javascript` 步骤可靠的地方（那个步骤把异常吞进 `exceptionDetails`）。
   */
  evaluate<T = unknown>(script: string): Promise<T>
  /** 断开连接。 */
  close(): void
}

/** 调试端口探测超时（本机回环，2 秒足够）。 */
const PROBE_TIMEOUT_MS = 2000

/** CDP `Runtime.evaluate` 单次调用超时。 */
const EVALUATE_TIMEOUT_MS = 30_000

/**
 * 探测渲染进程调试端口的可用性。
 * @param port - 调试端口，缺省 `9333`（测试规范的约定值）。
 * @returns 该端口上是否存在可附加的页面目标。
 */
export async function probeDesktopCdp(port = 9333): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return false
    const targets = await response.json() as Array<{ type?: string, url?: string }>
    return targets.some(t => t.type === 'page' && (t.url ?? '').startsWith('dsh-app://'))
  } catch {
    return false
  }
}

/**
 * 附加 Desktop 渲染进程并返回会话。
 *
 * 只挑选 `dsh-app://` 的页面目标——开发态启动器常同时开 DevTools（它不是 `page` 类型，
 * 但仍按 url 前缀过滤以免误选）。
 *
 * @param options - 连接参数。
 * @param options.port - 调试端口，缺省 `9333`。
 * @returns 已连接的会话。
 * @throws 找不到目标时抛出，错误信息含排查步骤。
 */
export async function connectDesktopCdp(options: { readonly port?: number } = {}): Promise<DesktopCdpSession> {
  const port = options.port ?? 9333
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `连不上 Desktop 渲染进程调试端口 ${port}（HTTP ${response.status}）。`
      + '请确认开发态 Desktop 已启动且带 DSH_DESKTOP_RENDERER_DEBUG_PORT。',
    )
  }
  const targets = await response.json() as Array<{ type?: string, url?: string, webSocketDebuggerUrl?: string }>
  const target = targets.find(t => t.type === 'page' && (t.url ?? '').startsWith('dsh-app://'))
  if (target?.webSocketDebuggerUrl === undefined) {
    throw new Error(
      `端口 ${port} 上没有 DSH Desktop 的渲染进程目标（dsh-app://）。`
      + '实际目标：'
      + (targets.map(t => `${t.type ?? '?'} ${t.url ?? ''}`).join('、') || '（空）')
      + '。若 Desktop 未在运行，请按测试规范启动开发态 Desktop。',
    )
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>()
  let nextId = 0

  socket.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      result?: { result?: { value?: unknown }, exceptionDetails?: { text?: string, exception?: { description?: string } } }
      error?: { message?: string }
    }
    const entry = message.id === undefined ? undefined : pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id!)
    if (message.error !== undefined) {
      entry.reject(new Error(message.error.message ?? 'CDP 调用失败'))
      return
    }
    // 页面异常必须转成 Node 侧错误：Desktop 用例的断言全靠它「真能失败」。
    const details = message.result?.exceptionDetails
    if (details !== undefined) {
      entry.reject(new Error(details.exception?.description ?? details.text ?? '页面内脚本抛出异常'))
      return
    }
    entry.resolve(message.result?.result?.value)
  }

  socket.onerror = () => {
    for (const entry of pending.values()) entry.reject(new Error('CDP 连接中断'))
    pending.clear()
  }

  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => { resolve() }
    socket.onerror = () => { reject(new Error(`无法连接 CDP WebSocket（端口 ${port}）`)) }
  })

  return {
    async evaluate<T>(script: string): Promise<T> {
      const id = ++nextId
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`CDP 求值超时（${EVALUATE_TIMEOUT_MS}ms）`))
        }, EVALUATE_TIMEOUT_MS).unref?.()
      })
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        // returnByValue 是必须的：不传的话对象只回 objectId 句柄，取不到值。
        params: { expression: script, returnByValue: true, awaitPromise: true },
      }))
      return await result as T
    },
    close() {
      for (const entry of pending.values()) entry.reject(new Error('CDP 会话已关闭'))
      pending.clear()
      socket.close()
    },
  }
}