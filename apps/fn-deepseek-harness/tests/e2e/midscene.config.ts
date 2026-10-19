/**
 * fn-deepseek-harness 应用级交互验收的 Midscene Test 项目配置（Bridge Mode）。
 *
 * 与插件内的 e2e 分工不同：
 * - **插件**的 `tests/e2e/` 验证插件自身功能（如智能搜索药丸按钮的形态与状态）；
 * - **本套**验证**应用产物**：FPK 在真实 NAS 上「从电脑上传」装到装完、装完后打开
 *   应用核对内置插件与凭据状态——这类验收跨插件，不属于任何单个插件。
 *
 * 装配全部来自共享包 `@tnnevol/dsh-e2e-kit`：接入配置向插件要、标签页先查后复用、
 * 交互独立核实、默认静默绑定（不抢用户前台）。
 *
 * ## 运行（在包根 `apps/fn-deepseek-harness/tests/` 下）
 *
 * ```bash
 * pnpm --filter @tnnevol/fn-deepseek-harness-e2e run test:e2e
 * # 或指定目标地址
 * DSH_NAS_URL="http://<nas>:5666/" pnpm run test:e2e
 * ```
 *
 * 前置：
 * 1. Chrome 已装 Midscene 扩展（`gbldofcpkknbggpkmbdaefngejllnief`）并已登录 NAS；
 * 2. NAS 页面已打开（用例**复用已开页**，不新开——见测试规范的标签页纪律）；
 * 3. 本机 DSH Web 在跑（提供 Midscene 桥；端口以 `/v1/health` 为准）。
 *
 * ## 两个实测约束（与插件 e2e 相同，务必遵守）
 *
 * 1. `files.include` **相对执行目录**（本包根）解析，不是相对本配置文件所在目录。
 * 2. YAML 里 `${name}` 是**项目变量**（缺失即报错），`${{NAME}}` 才是环境变量；
 *    `javascript` 步骤不要写模板字面量（会被扫描插值）。
 */
import { defineTestProject } from '@midscene/test/config'
import { createMidsceneNodes } from '@midscene/test/midscene'
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import { actUntilNode, assertInPage, clickInPage, defineBridgeSetup, type BridgeContext } from '@tnnevol/dsh-e2e-kit'

/**
 * 被测 NAS 的 fnOS Web 地址。
 *
 * 不给默认值：设备地址属于环境信息，写进仓库等于把内网拓扑公开（见贡献指南的
 * 对外回复规范）。要求显式传入，与 `DSH_FPK_DIR` 的处理方式一致。
 */
const targetUrl = process.env.DSH_NAS_URL
if (targetUrl === undefined || targetUrl === '') {
  throw new Error('缺少 DSH_NAS_URL：请指向被测 fnOS Web 地址（如 http://<nas>:5666/）')
}

/** FPK 上传目录：只授权这一个目录，最小权限（见测试规范的文件上传约定）。 */
const allowedDir = process.env.DSH_FPK_DIR
if (allowedDir === undefined || allowedDir === '') {
  throw new Error('缺少 DSH_FPK_DIR：请指向存放待安装 FPK 的目录（仅授权该目录）')
}

export default defineTestProject<BridgeContext>({
  projects: [
    {
      name: 'fnos-nas',
      setup: defineBridgeSetup({ targetUrl }),
      nodes: [
        ...createMidsceneNodes<BridgeContext>({
          agentClass: AgentOverChromeBridge,
          getAgent: ({ context }) => context.agent,
        }),
        // 精确断言：`javascript` 步骤的 throw 会被 CDP 吞掉（假阳性），这个 Node 不会。
        assertInPage,
        // 点击可能不触发行为（BUG-03），用它做「交互 + 核实 + 未生效重试」。
        actUntilNode,
        // 小控件优先用它：视觉定位对 <40px 的控件落点余量小（实测可偏到视口外）。
        clickInPage,
      ],
      // 相对执行目录（本包根）解析。
      files: { include: ['e2e/cases/**/*.yaml'] },
      // 默认排除写操作用例：TC-104 会**覆盖安装** NAS 上的现有应用，不该在只读验收里
      // 顺手跑掉。要跑它需临时把下面这行注释掉（CLI **没有** `--tags` 参数，实测确认，
      // 标签过滤只在配置里生效）。
      tags: { exclude: ['destructive'] },
      // YAML 用 `${fpkDir}` 引用（项目变量，非环境变量）。
      variables: { fpkDir: allowedDir },
    },
  ],
  test: {
    // NAS 界面是同一个浏览器窗口，用例并行会互相干扰；安装类用例也更长更贵。
    maxConcurrency: 1,
    // 单条用例上限。上传 + 安装要「选空间 → 上传 → 同意 → 向导 → 等安装完成」，而安装
    // 回调本身可能还要从 registry 补齐多个插件；实测同一用例在一台 NAS 上 163s，在另一台
    // （还缺 3 个插件要补装）超过 300s —— 上限按最慢的那条留足余量。
    testTimeout: 600_000,
  },
  output: { reportDir: './midscene_run/report' },
})
