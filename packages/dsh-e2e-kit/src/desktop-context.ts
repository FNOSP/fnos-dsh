/**
 * Desktop CDP 执行项目的 context 与 setup。
 *
 * 与 `desktop-setup`（Computer Mode）**并存但分工不同**：那套驱动真实屏幕、会动用户鼠标；
 * 这套走渲染进程 CDP，完全静默。需要视觉判定时才用前者，其余一律用这套。
 *
 * @module dsh-e2e-kit/desktop-context
 */

import { defineProjectSetup } from '@midscene/test/config'
import { connectDesktopCdp, probeDesktopCdp, type DesktopCdpSession } from './desktop-cdp.ts'
import { applyBridgeEnv, loadBridgeEnv } from './env.ts'

/** Desktop CDP 项目 context：Node 通过它拿到会话。 */
export interface DesktopCdpContext {
  /** 已附加到渲染进程的 CDP 会话。 */
  readonly session: DesktopCdpSession
}

/** Desktop CDP setup 参数。 */
export interface DesktopCdpSetupOptions {
  /**
   * 渲染进程调试端口，缺省 `9333`（测试规范约定值）。
   *
   * 由启动开发态 Desktop 时的 `DSH_DESKTOP_RENDERER_DEBUG_PORT` 决定。
   */
  readonly debugPort?: number
  /** 模型接入配置的桥端口起始值，缺省插件默认端口。 */
  readonly bridgePort?: number
  /** 日志函数，默认 `console.log`。 */
  readonly log?: (message: string) => void
}

/**
 * 创建 Desktop CDP 模式的执行项目 setup。
 *
 * 前置检查都在 setup 阶段完成，缺一项就直接报错，不会跑到一半才失败：
 *
 * 1. 桥接服务在跑（模型配置来源，与 Computer Mode 共用同一套配置）；
 * 2. 调试端口上有 `dsh-app://` 渲染进程目标（开发态 Desktop 已在运行）。
 *
 * 用法（桌面测试项目的 `midscene.config.ts`）：
 *
 * ```ts
 * import { createMidsceneNodes } from '@midscene/test/midscene'
 * import { defineTestProject } from '@midscene/test/config'
 * import { ComputerAgent } from '@midscene/computer'
 * import { defineDesktopCdpSetup, desktopAssert, desktopClick } from '@tnnevol/dsh-e2e-kit'
 * import type { DesktopCdpContext } from '@tnnevol/dsh-e2e-kit'
 *
 * export default defineTestProject<DesktopCdpContext>({
 *   projects: [{
 *     name: 'dsh-desktop-cdp',
 *     setup: defineDesktopCdpSetup({ debugPort: 9333 }),
 *     nodes: [
 *       // agentClass 只决定注册哪些通用 Node；Desktop 只用自带的这两个页面内 Node，
 *       // 不实际调用 agent，因此给 ComputerAgent 仅用于拿到基础 Node 定义。
 *       ...createMidsceneNodes<DesktopCdpContext>({ agentClass: ComputerAgent, getAgent: () => undefined as never }),
 *       desktopAssert,
 *       desktopClick,
 *     ],
 *     files: { include: ['e2e/cases/**' + '/*.yaml'] },
 *   }],
 * })
 * ```
 */
export function defineDesktopCdpSetup(options: DesktopCdpSetupOptions = {}) {
  const log = options.log ?? ((message: string) => { console.log(message) })
  const debugPort = options.debugPort ?? 9333

  return defineProjectSetup<DesktopCdpContext>({
    name: 'midscene-desktop-cdp',
    async setup({ onTeardown }) {
      const env = await loadBridgeEnv(
        options.bridgePort === undefined ? {} : { from: options.bridgePort },
      )
      applyBridgeEnv(env)
      log(`模型接入配置已就绪（桥端口 ${env.port}，模型由桥按 dsh-model 决定）`)

      if (!await probeDesktopCdp(debugPort)) {
        throw new Error(
          `端口 ${debugPort} 上没有 DSH Desktop 的渲染进程（dsh-app://）。`
          + '请确认开发态 Desktop 已启动，且启动时设置了 DSH_DESKTOP_RENDERER_DEBUG_PORT。'
          + '连通性可先自查：curl http://127.0.0.1:' + debugPort + '/json/version',
        )
      }
      const session = await connectDesktopCdp({ port: debugPort })
      onTeardown(() => {
        session.close()
        log('已断开 Desktop CDP 会话')
      })
      log(`已附加 DSH Desktop 渲染进程（调试端口 ${debugPort}）`)

      return { session } satisfies DesktopCdpContext
    },
  })
}