/**
 * Midscene Test 项目装配：Bridge Mode + 标签页纪律 + 接入配置。
 *
 * 为什么用 Bridge Mode 而不是官方示例里的 Playwright：Bridge Mode 由用户真实 Chrome
 * 里的 Midscene 扩展反向连接，因此浏览器窗口**用户可见**、复用真实登录态、无 macOS
 * 钥匙串弹窗、视口即真实窗口。Playwright 会在无头浏览器里跑，这些优势全部丢失。
 *
 * 本模块把三件用实测代价换来的事情封在一起，避免各测试项目重复踩坑：
 * ① 接入配置由插件托管（零密钥、端口自动探测）；
 * ② 标签页「先查后复用、收尾保留目标页」；
 * ③ 交互结果独立核实（不采信 act 自述）。
 *
 * @module dsh-e2e-kit/project
 */

import { defineProjectSetup } from '@midscene/test/config'
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import { applyBridgeEnv, loadBridgeEnv } from './env.ts'
import { connectTarget } from './connect.ts'
import { actUntil, type ActUntilOptions, type ActUntilResult } from './verify.ts'

/** 项目 context：Node 通过它拿到 Agent。 */
export interface BridgeContext {
  /** 桥接 Agent（已连接到目标页）。 */
  readonly agent: AgentOverChromeBridge
  /** 本次是否新开了标签页（决定收尾处置）。 */
  readonly createdTab: boolean
  /** 目标 URL。 */
  readonly targetUrl: string
}

/** {@link defineBridgeSetup} 的参数。 */
export interface BridgeSetupOptions {
  /**
   * 目标页面 URL。
   *
   * 必须是**具体实例的地址**：DSH Web 需要带 token 的完整 URL 才能进入会话界面。
   */
  readonly targetUrl: string
  /** 桥接服务的起始探测端口，默认 8787（桥会跳号，这里会自动跟随）。 */
  readonly bridgePort?: number
  /** 等待页面就绪的毫秒数，默认 2500。 */
  readonly settleMs?: number
  /** 日志函数，默认 `console.log`。 */
  readonly log?: (message: string) => void
  /**
   * 允许文件上传的目录，供**提示词驱动**的上传使用（可选）。
   *
   * 上传有两条独立路径，别混（读 `@midscene/core` 源码确认）：
   *
   * 1. **直接预设**：`aiAct(prompt, { fileChooserAccept: ['<绝对路径>'] })`，内部走
   *    `register()`，**不需要**本目录，直接用绝对路径。日常上传用这条最简单。
   * 2. **提示词驱动**：在提示词里让 AI 自行调用 `RegisterFileChooserAccept` 动作，
   *    内部走 `registerFromAllowedDir()`，**必须**有本目录——它会把相对路径 resolve
   *    到该目录下并校验不越界。
   *
   * 本字段只在路径 2 生效；且它属于 **`aiAct` 的选项**而非 Agent 构造参数（构造时传会被
   * 静默忽略——实测踩过：以为构造参数生效，其实是走了路径 1 才成功）。
   * 用例若用路径 2，请把该目录经项目变量传给 YAML 并在 `aiAct` 步骤上按需使用。
   *
   * 无论哪条路径都**只授权最小目录**（例如只放待上传产物的 `tmp/<某目录>/`），
   * 不要授予仓库根或家目录。
   */
  readonly fileChooserAllowedDir?: string
  /**
   * 绑定目标页时是否切到前台，默认 `false`（**静默**，不打断用户）。
   *
   * 默认静默是有意的：有头浏览器是用户正在使用的窗口，测试把它抢到前台会打断用户。
   * 只有需要人观察操作过程时才显式传 `true`。
   */
  readonly activate?: boolean
}

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 探测当前绑定的页面是否可响应。
 *
 * 有头浏览器里的页可能被冻结或丢弃（例如实例重启后遗留的页），此时任何
 * `evaluateJavaScript` 都会挂到超时，把整轮用例拖垮。用短超时先探一下，不可用就换页。
 * @param agent - 桥接 Agent。
 * @param timeoutMs - 探测超时，默认 8 秒（远小于 Midscene 自身的 30 秒）。
 * @returns 页面是否可响应。
 */
async function isResponsive(agent: AgentOverChromeBridge, timeoutMs = 8000): Promise<boolean> {
  try {
    await Promise.race([
      agent.evaluateJavaScript('1 + 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), timeoutMs)),
    ])
    return true
  } catch {
    return false
  }
}

/** 读 `evaluateJavaScript` 的布尔结果（同样兼容两种封套形态）。 */
function readBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  const value = (raw as { result?: { value?: unknown } } | undefined)?.result?.value
  return value === true
}

/** 读 `evaluateJavaScript` 的字符串结果。 */
function readString(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  const value = (raw as { result?: { value?: unknown } } | undefined)?.result?.value
  return typeof value === 'string' ? value : undefined
}

/**
 * 创建一个 Bridge Mode 的项目 setup。
 *
 * 在 setup 内完成：加载接入配置（向插件要）→ 连接目标页（已打开就复用）→ 把复用的页
 * 导航回目标地址（保证起点确定）→ 注册清理（保留目标页）。
 * @param options - setup 配置。
 * @returns 可传给 `defineTestProject` 的 setup 定义。
 */
export function defineBridgeSetup(options: BridgeSetupOptions) {
  const log = options.log ?? ((message: string) => { console.log(message) })
  const settleMs = options.settleMs ?? 2500

  return defineProjectSetup<BridgeContext>({
    name: 'midscene-bridge',
    async setup({ onTeardown }) {
      // 接入配置必须在创建 Agent 之前应用：Midscene 从 process.env 读模型配置。
      const env = await loadBridgeEnv({ ...options.bridgePort === undefined ? {} : { from: options.bridgePort } })
      applyBridgeEnv(env)
      log(`桥接配置已就绪（端口 ${env.port}，模型由桥按 dsh-model 决定）`)

      // Agent 可能因复用页失效而重建，因此用可变引用，teardown 时销毁当前那个。
      // 注意：`fileChooserAllowedDir` **不能**在这里传——它是 `aiAct` 的选项，
      // 构造参数里传会被静默忽略（详见 BridgeSetupOptions 里该字段的注释）。
      let agent = new AgentOverChromeBridge()
      onTeardown(async () => {
        // 始终保留目标页（`false` = 不关闭）。重复页由 Midscene 按新建记录自行清理，
        // 复用来的页不属于本次副作用，不应关闭。
        await agent.destroy(false)
        log('已断开连接（目标页保留）')
      })

      // 「先查后绑定」：setActiveTabId 只能绑定一次，因此必须在绑定前选定目标页
      // （这层顺序约束封装在 connectTarget 里，与探测脚本共用同一份实现）。
      // **显式默认 false**（静默）。不能靠「不传」来省事：`connectTarget` 自身的缺省是
      // `true`（保持其独立调用者的既有行为），若这里也传 undefined，就会落到 true 而把
      // 用户正在看的页面抢走——实测踩过：注释写着「缺省即 false」，代码却在切前台。
      const connected = await connectTarget(agent, options.targetUrl, {
        log,
        activate: options.activate ?? false,
      })
      let createdTab = !connected.reused

      // **先做健康检查，再动页面**：复用的页可能是浏览器冻结/丢弃的僵尸页（实测：
      // 残留页上 evaluateJavaScript 会挂到 Midscene 自身的 30s 超时，把整轮测试拖垮，
      // 而且这一步若排在导航之后，导航本身就会先挂）。所以顺序必须是：探活 → 不可用则
      // 换页 → 再导航。
      //
      // 换页的唯一办法是**重建 Agent**：setActiveTabId 只能绑定一次，同一 Agent 上无法
      // 切到别的页。
      if (!await isResponsive(agent)) {
        log('复用页无响应（可能已被浏览器丢弃），改为新开一个标签页')
        try { await agent.destroy(false) } catch { /* 旧连接已失效，忽略 */ }
        agent = new AgentOverChromeBridge()
        // 同样遵守静默约定：僵尸页兜底新开页时也不抢前台。
        await agent.connectNewTabWithUrl(options.targetUrl, {
          activateTab: options.activate ?? false,
        })
        createdTab = true
        await sleep(settleMs)
      }

      // 复用页可能停在上次测试留下的状态（实测遇到过「停在插件列表页」导致首页断言
      // 失败），因此复用后先把目标地址重走一遍，保证用例从确定起点开始。新开的页本身
      // 就是该地址，不必刷新（省一次模型调用与等待）。
      if (!createdTab) {
        await agent.evaluateJavaScript(`location.href = ${JSON.stringify(options.targetUrl)}`)
        await sleep(Math.max(settleMs, 3000))
        log('已把复用页导航回目标地址')
      }

      return { agent, createdTab, targetUrl: options.targetUrl }
    },
  })
}

/** 绑定到某个 context 的交互助手。 */
export interface BridgeActions {
  /**
   * 在页面内求值。
   * @param expression - JavaScript 表达式。
   * @returns 求值结果（已解封套）。
   */
  readonly evaluate: (expression: string) => Promise<unknown>
  /**
   * 判定页面内某个条件是否成立。
   * @param expression - 返回布尔值的表达式。
   * @returns 是否成立。
   */
  readonly check: (expression: string) => Promise<boolean>
  /**
   * 执行交互并核实（未生效自动重试一次）。
   * @param prompt - 自然语言指令。
   * @param checkExpression - 判定生效的页面内表达式。
   * @param label - 日志标签。
   * @returns 交互结果。
   */
  readonly actUntil: (prompt: string, checkExpression: string, label: string) => Promise<ActUntilResult>
  /**
   * 断言（自然语言），失败即抛错。
   * @param prompt - 自然语言断言。
   * @returns 无返回值；不成立时抛错。
   */
  readonly assert: (prompt: string) => Promise<void>
  /** 读当前页面 URL（便于日志与诊断）。 */
  readonly currentUrl: () => Promise<string | undefined>
}

/**
 * 为项目 context 创建交互助手。
 *
 * 用例既可以用 YAML（Node 形式），也可以在 TS 里直接调这些助手——后者适合需要条件
 * 分支或循环的复杂流程。
 * @param context - {@link defineBridgeSetup} 产出的 context。
 * @param log - 日志函数。
 * @returns 交互助手。
 */
export function createBridgeActions(context: BridgeContext, log: (message: string) => void = console.log): BridgeActions {
  const evaluate = async (expression: string): Promise<unknown> =>
    await context.agent.evaluateJavaScript(expression)

  const check = async (expression: string): Promise<boolean> => readBoolean(await evaluate(expression))

  const runAct = async (
    prompt: string,
    checkExpression: string,
    label: string,
  ): Promise<ActUntilResult> => {
    const actOptions: ActUntilOptions = {
      act: async () => await context.agent.ai(prompt),
      check: async () => await check(checkExpression),
      label,
      log,
    }
    return await actUntil(actOptions)
  }

  const assert = async (prompt: string): Promise<void> => {
    await context.agent.aiAssert(prompt)
  }

  const currentUrl = async (): Promise<string | undefined> => readString(await evaluate('location.href'))

  return { evaluate, check, actUntil: runAct, assert, currentUrl }
}
