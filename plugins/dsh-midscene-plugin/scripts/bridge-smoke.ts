/**
 * Midscene Bridge Mode 冒烟脚本（FNOS-013-05/08/09 的交互验证）。
 *
 * **为什么用 Bridge Mode 而不是 CDP 直连**（实测对比，见测试规范的 Midscene 章节）：
 * Bridge Mode 由用户真实 Chrome 里的 Midscene 扩展反向连接脚本，因此
 * ① 浏览器窗口**用户可见**（CDP 的 headless 实例看不到）；
 * ② 复用用户真实的 cookies 与登录态（CDP 用的是全新 profile）；
 * ③ 无 macOS 钥匙串授权弹窗（那源于 Chrome for Testing 的 adhoc 签名）；
 * ④ 视口就是用户的真实窗口，不会出现「窄视口下侧边栏收缩成图标态」这个坑。
 *
 * 工作原理：本脚本是 server（默认 `127.0.0.1:3766`），**扩展作为 client 连过来**。
 * 首次连接时扩展会弹确认窗口，选 Allow（单次）或 Always Allow（后续自动）。
 *
 * 用法（在插件目录下执行；需要本机 Chrome 已安装 Midscene 扩展）：
 *   node --experimental-strip-types scripts/bridge-smoke.ts <目标URL>
 *
 * 模型配置来自终端环境变量（Bridge Mode 的硬性要求：模型配置在 Node 侧而不是
 * 浏览器侧）。若插件托管的桥接服务在运行，可直接向它取配置：
 *   curl -s http://127.0.0.1:8787/v1/midscene-env \
 *     | python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" > .env
 * 端口以 `/v1/health` 的 `port` 字段为准（被占用时桥会自动跳号）。
 */
import { readFileSync } from 'node:fs'
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'

/**
 * 从 `.env` 载入接入配置。
 *
 * Bridge Mode 要求模型配置在 Node 侧，而本仓库的约定是把它放在工作目录的 `.env`
 * （由插件的 `/v1/midscene-env` 生成，四行固定值、不含任何模型凭据）。
 * 文件不存在时不报错：允许调用方直接用环境变量提供配置。
 * @param path - `.env` 路径。
 */
function loadEnvFile(path: string): void {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of content.split('\n')) {
    const match = /^([A-Z_]+)="?([^"\n]*)"?$/.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) process.env[match[1]] = match[2]
  }
}

/** 读取 evaluateJavaScript 的返回值（Bridge 模式把它包在 `{ result: { value } }` 里）。 */
function bridgeValue<T>(payload: unknown): T | undefined {
  const wrapper = payload as { result?: { value?: T } } | undefined
  return wrapper?.result?.value
}

const targetUrl = process.argv[2]
if (targetUrl === undefined || targetUrl === '') {
  console.error('用法: node --experimental-strip-types scripts/bridge-smoke.ts <目标URL>')
  console.error('例:   node --experimental-strip-types scripts/bridge-smoke.ts "http://127.0.0.1:8070/?token=<token>"')
  process.exit(1)
}

loadEnvFile('.env')
const { MIDSCENE_MODEL_BASE_URL: baseUrl, MIDSCENE_MODEL_NAME: modelName, MIDSCENE_MODEL_FAMILY: family } = process.env
if (baseUrl === undefined || modelName === undefined) {
  console.error('缺少模型配置：请在当前工作目录放好 .env（含 MIDSCENE_MODEL_BASE_URL 与 MIDSCENE_MODEL_NAME），')
  console.error('或直接导出这些环境变量。配置可向插件托管的桥接服务获取（/v1/midscene-env）。')
  process.exit(1)
}
console.log(`模型配置: ${modelName} | ${family ?? '?'} | ${baseUrl}`)
console.log(`目标页面: ${targetUrl}`)

const agent = new AgentOverChromeBridge()

/**
 * 独立核实页面状态。
 *
 * **不采信 `ai()` 的自述**：实测出现过「act 自述已点击、页面并未变化」的情况
 * （见测试文档 BUG-03）。所有交互都要用页面内的真实状态判定结果。
 * @param label - 日志标签。
 * @param expression - 在页面内求值的表达式，应返回布尔值。
 * @returns 求值结果。
 */
async function verify(label: string, expression: string): Promise<boolean> {
  const raw = await agent.evaluateJavaScript(expression)
  const value = bridgeValue<boolean>(raw) === true
  console.log(`[核实] ${label}: ${value}`)
  return value
}

/**
 * 执行一次交互并在未生效时重试。
 *
 * 实测：单次点击可能不触发目标行为（坐标落在按钮内也会出现），重试一次即可稳定
 * 通过。这不是「坐标偏差」——事件捕获器确认成功时派发了完整且 `isTrusted` 的
 * 事件序列，且两次点击的坐标都在按钮范围内。
 * @param prompt - 自然语言指令。
 * @param expression - 判定是否生效的页面内表达式。
 * @param label - 日志标签。
 * @returns 是否最终生效。
 */
async function actUntil(prompt: string, expression: string, label: string): Promise<boolean> {
  const attempts = 2
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const said = await agent.ai(prompt)
    console.log(`act 自述（第 ${attempt} 次）: ${String(said).slice(0, 80)}`)
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (await verify(label, expression)) return true
    if (attempt < attempts) console.log('未生效，重试一次…')
  }
  return false
}

try {
  await agent.connectNewTabWithUrl(targetUrl)
  console.log('已连接（若 Chrome 弹出授权窗口，请点 Allow / Always Allow）')
  await new Promise(resolve => setTimeout(resolve, 2500))

  // 断言类步骤：验证「模型能读懂页面」，这是桥接链路可用的直接证据。
  await agent.aiAssert('页面显示 DeepSeek Harness 界面，能看到「新会话」入口与消息输入框')
  console.log('[核实] 首页断言: 通过')

  // 交互类步骤：附带独立核实与重试。
  const navigated = await actUntil(
    '点击左侧边栏的「插件」菜单项',
    'document.body.innerText.includes("添加插件")',
    '是否进入插件列表',
  )
  if (!navigated) {
    console.error('交互未生效（已重试一次）；请查看 Midscene 报告里的点击坐标与截图')
    process.exitCode = 1
  } else {
    await agent.aiAssert('当前页面是插件列表页，能看到「添加插件」按钮')
    console.log('[核实] 插件列表断言: 通过')
  }

  await agent.destroy()
  console.log('已断开连接')
} catch (error) {
  console.error(`失败: ${error instanceof Error ? error.message : String(error)}`)
  try { await agent.destroy() } catch { /* 断连失败不覆盖原始错误 */ }
  process.exitCode = 1
}
