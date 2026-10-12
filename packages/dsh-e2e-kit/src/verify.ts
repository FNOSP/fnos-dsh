/**
 * 结果核实：不采信 `ai()` 的自述，用页面内真实状态判定交互是否生效。
 *
 * 这是 BUG-03 的教训：Midscene 单次点击可能不触发目标行为（实测两次点击坐标都落在
 * 按钮内，一次生效一次不生效），而 `aiAct` 仍会**自述成功**。只信自述会得出「功能
 * 正常」的错误结论——这比失败更危险。
 *
 * 因此交互步骤应始终配一个「页面内状态」判定，并在未生效时重试一次。
 *
 * @module dsh-e2e-kit/verify
 */

/** 交互与核实的组合配置。 */
export interface ActUntilOptions {
  /**
   * 执行一次交互（如 `() => agent.aiAct('点击…')`）。
   * @returns 任意返回值，仅用于日志。
   */
  readonly act: () => Promise<unknown>
  /**
   * 判定是否生效：在页面内求值，返回 `true` 表示生效。
   * @returns 是否生效。
   */
  readonly check: () => Promise<boolean>
  /** 日志标签，用于输出「第几次尝试」「是否生效」。 */
  readonly label: string
  /** 重试次数（默认 1，即最多尝试 2 次）。 */
  readonly retries?: number
  /**
   * 每次尝试后的等待毫秒数（默认 2000）。
   *
   * 页面跳转与渲染需要时间，立刻核实会把「还没渲染完」误判为「未生效」。
   */
  readonly settleMs?: number
  /** 日志输出函数，默认 `console.log`。 */
  readonly log?: (message: string) => void
}

/** 交互结果。 */
export interface ActUntilResult {
  /** 最终是否生效。 */
  readonly ok: boolean
  /** 实际尝试次数。 */
  readonly attempts: number
  /** 每次尝试的自述（截断后的字符串）。 */
  readonly said: readonly string[]
}

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 执行交互并在未生效时重试。
 *
 * 语义上等价于「做一件事，确认它真的发生了」——而不是「调用了一个会自称成功的接口」。
 * @param options - 交互、核实与日志配置。
 * @returns 结果，含是否生效与实际尝试次数。
 */
export async function actUntil(options: ActUntilOptions): Promise<ActUntilResult> {
  const attempts = (options.retries ?? 1) + 1
  const settleMs = options.settleMs ?? 2000
  const log = options.log ?? ((message: string) => { console.log(message) })
  const said: string[] = []

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const output = await options.act()
    const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
    said.push(text.slice(0, 200))
    log(`[${options.label}] act 自述（第 ${attempt} 次）: ${text.slice(0, 80)}`)

    await sleep(settleMs)
    if (await options.check()) {
      log(`[核实] ${options.label}: true`)
      return { ok: true, attempts: attempt, said }
    }
    if (attempt < attempts) log(`[${options.label}] 未生效，重试一次…`)
  }

  log(`[核实] ${options.label}: false`)
  return { ok: false, attempts, said }
}
