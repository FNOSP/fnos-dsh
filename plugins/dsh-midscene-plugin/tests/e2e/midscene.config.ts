/**
 * FNOS-013 Midscene 插件的界面验收（Bridge Mode）。
 *
 * 覆盖插件在 DSH Web 上的**界面呈现**：设置区块（密钥/指定模型/.env 预览）与插件图标。
 * 桥接服务本体、模型目录、凭据边界等已由本地单测与 HTTP 断言覆盖；这里补的是
 * 「界面真的渲染出来、字段真的可用」这一环。
 *
 * ## 与其它 e2e 的分工
 *
 * | 位置 | 覆盖 |
 * | --- | --- |
 * | `apps/fn-deepseek-harness/tests/e2e/` | **应用级**：FPK 安装、应用启动、内置插件装载 |
 * | **本套** | 插件的设置界面与图标 |
 * | `plugins/dsh-failover-search-plugin/tests/e2e/` | 药丸按钮的形态与状态 |
 * | `plugins/dsh-codebuddy-plugin/tests/e2e/` | 凭据权限的两态呈现 |
 *
 * ## 运行（在插件根执行）
 *
 * ```bash
 * DSH_WEB_URL="http://127.0.0.1:8070/?token=…" pnpm run test:e2e
 * ```
 *
 * 前置：DSH Web 在 `8070` 运行（`DSH_HOME=<repo>/.dsh`）、Chrome 装有 Midscene 扩展、
 * 目标页已打开（用例复用已开页，不新开）。
 *
 * ## 语法约束（与其它 e2e 项目相同）
 *
 * 1. `files.include` 相对**执行目录**（插件根）解析；
 * 2. 字符串简写不能带 `options`（解析器报 `step N must contain exactly one node`）；
 * 3. 断言用 `dsh.assertInPage`，**不要**用 `javascript` 步骤（其 `throw` 被 CDP 吞掉，
 *    会造成假阳性——详见该 Node 的模块注释）。
 */
import { defineTestProject } from '@midscene/test/config'
import { createMidsceneNodes } from '@midscene/test/midscene'
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import { actUntilNode, assertInPage, clickInPage, defineBridgeSetup, type BridgeContext } from '@tnnevol/dsh-e2e-kit'

const targetUrl = process.env.DSH_WEB_URL
if (targetUrl === undefined || targetUrl === '') {
  throw new Error('缺少 DSH_WEB_URL：请传入带 token 的完整地址，例如 http://127.0.0.1:8070/?token=…')
}

/**
 * 第三方站点能力演示的参数（可选）。
 *
 * 本套的常规用例验的是插件**自己的界面**；`TC-060` 验的是插件的核心承诺——**按自然语言
 * 意图驱动任意第三方站点**。它必然依赖外部环境（站点地址、目录名、文件名），因此默认按
 * 标签排除，只在显式提供这三个值时运行：
 *
 * ```bash
 * DSH_BRIDGE_SITE="http://<host>:<port>/" \
 * DSH_BRIDGE_PATH="a/b/c" DSH_BRIDGE_FILE="某文件.jpg" pnpm run test:e2e
 * ```
 */
const demoSite = process.env.DSH_BRIDGE_SITE ?? ''
const demoPath = process.env.DSH_BRIDGE_PATH ?? ''
const demoFile = process.env.DSH_BRIDGE_FILE ?? ''

export default defineTestProject<BridgeContext>({
  projects: [
    {
      name: 'dsh-web',
      setup: defineBridgeSetup({ targetUrl }),
      nodes: [
        ...createMidsceneNodes<BridgeContext>({
          agentClass: AgentOverChromeBridge,
          getAgent: ({ context }) => context.agent,
        }),
        assertInPage,
        // 点击可能不触发行为（BUG-03），用它做「交互 + 核实 + 未生效重试」。
        actUntilNode,
        // 小控件优先用它：视觉定位对 <40px 的控件落点余量小（实测可偏到视口外）。
        clickInPage,
      ],
      files: { include: ['tests/e2e/cases/**/*.yaml'] },
      // 设置/图标类用例都是只读的；`destructive` 是写操作，`capability` 需要外部站点参数
      // （见上方 DSH_BRIDGE_* 说明），两者都默认不跑。
      tags: { exclude: ['destructive', 'capability'] },
      variables: { demoSite, demoPath, demoFile },
    },
  ],
  test: {
    // 同一浏览器窗口里并行操作会互相干扰；破坏性用例还要串行改文件状态。
    //
    // 1.16.5 起 `maxConcurrency` 被拆成两个字段并**在运行期显式拒绝旧名**
    // （`Midscene config test.maxConcurrency is no longer supported.`）。两者的默认值
    // 都是 1，因此写与不写行为一致；这里显式写出来，避免将来默认值变化时静默变成并发。
    maxConcurrentFiles: 1,
    maxConcurrentProjects: 1,
    // 1.16.5 新增的环境准备/清理上限（缺省不启用，与 1.16.0 一致）。本项目 setup 要
    // 连真实 Chrome 里的扩展，扩展未连上时旧行为是**无限等待**；设上限把它变成可诊断的
    // `SETUP_TIMEOUT`。取值按「本机扩展连接正常时数秒内完成」留足余量。
    setupTimeout: 120_000,
    teardownTimeout: 120_000,
    // 设置/图标类用例都在 200s 内完成；TC-060 要在一个陌生站点里逐级导航并自我纠正，
    // 实测 180s 会在它已经诊断出「点到了相邻行」时被掐断，因此按最慢的那条留余量。
    testTimeout: 600_000,
  },
  output: { reportDir: './midscene_run/report' },
})
