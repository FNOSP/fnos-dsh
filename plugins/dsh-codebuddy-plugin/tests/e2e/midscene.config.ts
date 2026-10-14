/**
 * FNOS-011 凭据权限呈现的 Midscene Test 项目配置（Bridge Mode）。
 *
 * 覆盖 CodeBuddy 插件在「凭据不可读」与「凭据不存在」两种情形下的**界面呈现**——
 * 这是单测覆盖不到的最后一环：单测能断言 `credentialState` 的载荷，但「界面真的把
 * 警示块渲染出来、文案对用户可读」只有真实浏览器能证明。
 *
 * ## 与单测的分工（避免重复）
 *
 * | 层 | 覆盖 |
 * | --- | --- |
 * | `packages/dsh-plugin-kit/tests/credential-permission.spec.ts` | 五种权限位的判定（`600`/`644`/`0000`/`400`/不存在） |
 * | `plugins/dsh-codebuddy-plugin/tests/storage-file-state.spec.ts` | `panelStatus` 是否携带 `credentialState` |
 * | **本套** | 界面实际渲染：警示块出现、文案可读、与「未登录」可区分 |
 *
 * ## 破坏性前置（务必读）
 *
 * `TC-013`（`0000`）会在 `DSH_HOME` 下**临时改权限**，`TC-014`（不存在）会**临时移走**凭据
 * 文件。两者都按测试规范的「账号状态测试顺序与 auth 配置备份」执行：先备份到
 * `tmp/auth-back/`、改状态、取证、**恢复时显式 `chmod 600`**（`cp -p` 会带上源文件的
 * 权限位，在 ACL 卷上可能是 `0000`，只依赖它会制造下一次启动失败）。
 *
 * 因此本套用**标签排除**：默认只跑只读用例；破坏性用例需显式选标签执行。
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
      // 破坏性用例（改权限 / 移走凭据）默认不跑：用标签排除，需要时显式选。
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
