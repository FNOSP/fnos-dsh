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
      // 图标/设置类用例都是只读的；保留标签机制以便将来加写操作用例。
      tags: { exclude: ['destructive'] },
    },
  ],
  test: {
    // 同一浏览器窗口里并行操作会互相干扰；破坏性用例还要串行改文件状态。
    maxConcurrency: 1,
    testTimeout: 180_000,
  },
  output: { reportDir: './midscene_run/report' },
})
