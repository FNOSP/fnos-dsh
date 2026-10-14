/**
 * DSH E2E Kit：本仓库 Midscene Test 交互测试的共享装配层。
 *
 * 三件事集中在这里，避免每个测试项目重复踩坑（都来自 FNOS-013 的实测代价）：
 * - {@link defineBridgeSetup}：用 Bridge Mode 接入**用户真实 Chrome**，并处理接入配置、
 *   标签页复用与收尾；
 * - {@link loadBridgeEnv}：接入配置向 DSH Midscene 插件获取（零密钥、端口自动探测）；
 * - {@link actUntil}：交互后独立核实、未生效重试（不采信 `ai()` 自述）；
 * - {@link assertInPage}：页面内精确断言（`javascript` 步骤无法让用例失败，见其模块注释）。
 *
 * 典型用法（`midscene.config.ts`）：
 *
 * ```ts
 * import { defineTestProject } from '@midscene/test/config'
 * import { createMidsceneNodes } from '@midscene/test/midscene'
 * import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
 * import { defineBridgeSetup, type BridgeContext } from '@tnnevol/dsh-e2e-kit'
 *
 * export default defineTestProject<BridgeContext>({
 *   projects: [{
 *     name: 'dsh-web',
 *     setup: defineBridgeSetup({ targetUrl: process.env.DSH_WEB_URL! }),
 *     nodes: createMidsceneNodes<BridgeContext>({
 *       agentClass: AgentOverChromeBridge,
 *       getAgent: ({ context }) => context.agent,
 *     }),
 *     files: { include: ['cases/**' + '/*.yaml'] },  // 实际写法见测试项目配置
 *   }],
 * })
 * ```
 *
 * @module dsh-e2e-kit
 */

export {
  DEFAULT_BRIDGE_PORT,
  PORT_PROBE_LIMIT,
  applyBridgeEnv,
  findBridgePort,
  loadBridgeEnv,
  type BridgeEnv,
} from './env.ts'
export {
  connectTarget,
  listTabs,
  type ConnectResult,
  type ConnectTargetOptions,
} from './connect.ts'
export {
  samePage,
  selectTab,
  type BrowserTab,
  type TabSelection,
} from './tab-policy.ts'
export {
  actUntil,
  type ActUntilOptions,
  type ActUntilResult,
} from './verify.ts'
export {
  createBridgeActions,
  defineBridgeSetup,
  type BridgeActions,
  type BridgeContext,
  type BridgeSetupOptions,
} from './project.ts'
export { assertInPage } from './assert-node.ts'
export { actUntil as actUntilNode } from './act-node.ts'
export { clickInPage } from './click-node.ts'
export { readPageVerdict, wrapPageScript, type PageVerdict } from './page-script.ts'
