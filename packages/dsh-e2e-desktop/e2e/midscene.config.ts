/**
 * DSH Desktop 交互验收的 Midscene Test 项目配置（**CDP 模式**）。
 *
 * ## 为什么是 CDP 而不是 Computer Mode
 *
 * Computer Mode（`@midscene/computer`）驱动**真实屏幕**：在 macOS 上键鼠注入只有
 * `CGEventPost(kCGHIDEventTap)` 一条路径，操作的是**硬件级指针**，系统不存在「只对某个应用
 * 生效的隐形光标」。实测后果：一次 Desktop 视觉用例就把用户的办公界面切走、鼠标被接管，
 * 而该包内也没有任何虚拟光标开关（`virtualCursor` / `hideCursor` / `cursorless` 零命中）。
 *
 * 本配置走渲染进程 CDP：**不移动鼠标、不切前台**，且零模型调用（毫秒级）。
 * 测试规范本就把它列为 Desktop 取证的**首选**。
 *
 * ## 代价（据实说明）
 *
 * CDP 没有视觉判定，因此本套**只断言 DOM 级事实**：`aria-pressed`、类名、计算样式、
 * 可见文本、精确版本号。「两态肉眼是否可辨」这类**视觉观感**结论由人工走查得出，
 * 在 `docs/tests/` 台账里如实标注为人工确认，不伪装成自动断言。
 *
 * ## 为什么用例放在包里而不是各插件
 *
 * 测试规范要求「非 fnOS 插件的功能至少同时覆盖 DSH Web 与 DSH Desktop」。Web 侧用例跟着
 * 各插件走，但 **Desktop 侧的用例天然跨插件**——它验的是「同一功能在两个客户端表现一致」，
 * 被测对象是 Desktop 这个宿主。因此集中在这里，`docs/tests/` 里的用例编号仍是权威台账。
 *
 * ## 运行（在包根 `packages/dsh-e2e-desktop/` 下）
 *
 * ```bash
 * pnpm run test:e2e
 * # 调试端口非默认时
 * DSH_DESKTOP_DEBUG_PORT=9333 pnpm run test:e2e
 * ```
 *
 * 前置（缺任一项会在 setup 阶段直接报错，不会跑到一半才失败）：
 *
 * 1. **开发态 Desktop 已在跑**：上游源码检出 `fork-pj/deepseek-harness`，
 *    `DSH_HOME` 指向项目根 `.dsh`（profile 必须是 `.dsh/profiles/desktop`，
 *    **不得**用 `~/.dsh/profiles/desktop`），并带 `DSH_DESKTOP_RENDERER_DEBUG_PORT`；
 * 2. 本机 DSH Web 在跑（提供 Midscene 桥，端口以 `/v1/health` 为准）。
 *
 * ## 两条实测约束
 *
 * 1. `files.include` 相对**执行目录**（本包根）解析，不是相对本配置文件所在目录。
 * 2. 本套**不需要** `@midscene/computer`：它只为 `createMidsceneNodes` 提供基础 Node
 *    定义（注册阶段要求 `agentClass` 有 `getTestRunnerNodeDefinitions()`），不实际实例化。
 *
 * ## 为什么 package.json 里显式声明了 `@computer-use/libnut`
 *
 * 那是 Computer Mode 的键鼠依赖，**本配置用不到**，可以删。保留说明见 `git log`。
 */
import { defineTestProject } from '@midscene/test/config'
import { defineDesktopCdpSetup, desktopAssert, desktopClick, desktopClickText, sleep, type DesktopCdpContext } from '@tnnevol/dsh-e2e-kit'

/** 渲染进程调试端口，与启动 Desktop 时的 DSH_DESKTOP_RENDERER_DEBUG_PORT 一致。 */
const debugPort = Number.parseInt(process.env.DSH_DESKTOP_DEBUG_PORT ?? '9333', 10)

export default defineTestProject<DesktopCdpContext>({
  projects: [
    {
      name: 'dsh-desktop-cdp',
      setup: defineDesktopCdpSetup({ debugPort }),
      // **只注册页面内 Node**。通用 Agent Node（aiAct/aiAssert/…）需要视觉模型与真实
      // agent，本通道用不上，因此**刻意不注册**——不给出用不了的选项，比给出后运行时
      // 报「agent 是 undefined」更诚实，也让本包不必依赖 @midscene/computer。
      nodes: [
        // 精确断言（页面异常经 CDP 真正传播，用例会真的失败）。
        desktopAssert,
        // 按 CSS 选择器点击：零坐标偏差，实测能真实切换 React 状态。
        desktopClick,
        // 类名带构建哈希时按可见文本点击（见该 Node 的注释）。
        desktopClickText,
        // 等待放在 Node 侧：页面内定时器会被后台窗口节流（实测放大约 8 倍）。
        sleep,
      ],
      // 相对执行目录（本包根）解析。glob 的两个星号与斜杠必须拆开拼，
      // 否则连续斜杠会在注释块里提前闭合。
      files: { include: ['e2e/cases/**' + '/*.yaml'] },
      // 破坏性用例（改权限 / 移走凭据）默认不跑：用标签排除，需要时临时注释掉下面这行
      // （CLI **没有** `--tags` 参数，实测确认；标签过滤只在配置里生效）。
      tags: { exclude: ['destructive'] },
    },
  ],
  test: {
    // 用例改的是同一个渲染进程，串行执行避免互相干扰。
    maxConcurrency: 1,
    // 页面内判定是毫秒级，超时只需覆盖偶发的渲染阻塞。
    testTimeout: 120_000,
  },
  output: { reportDir: './midscene_run/report' },
})