import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  collectMetrics,
  readRuntimeStatus,
  resetCpuSamplingForTest,
  resolveRuntimePorts,
} from '../../src/host/runtime-status.ts'

/**
 * 「运行」分组的契约与采集。
 *
 * 这一组数据有一个容易写错的地方：**读不到不等于 0**。磁盘读写在非 Linux 或
 * 权限不足时拿不到，此时给 `null`；填 0 会让界面显示「没有读写」，与「读不到」
 * 混为一谈，用户据此判断「进程很闲」是错的。下面的用例专门守这一条。
 */
const CARD = readFileSync(new URL('../../src/components/RuntimeStatusCard.tsx', import.meta.url), 'utf8')
const CONTRACT = readFileSync(new URL('../../src/contracts/runtime-status-contract.ts', import.meta.url), 'utf8')
const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
const LOCALES = readFileSync(new URL('../../src/client/locales.ts', import.meta.url), 'utf8')
const ROUTES = readFileSync(new URL('../../src/host/runtime-status-routes.ts', import.meta.url), 'utf8')

beforeEach(() => { resetCpuSamplingForTest() })

describe('运行状态：端口解析', () => {
  it('从 DSH_UPSTREAM_PORT 与 wizard_port 各取各的端口', () => {
    const ports = resolveRuntimePorts({ DSH_UPSTREAM_PORT: '3080', wizard_port: '5666' })
    expect(ports.web).toBe(3080)
    expect(ports.gateway).toBe(5666)
  })

  it('缺省时不编造默认值，字段直接缺省', () => {
    const ports = resolveRuntimePorts({})
    expect(ports.web).toBeUndefined()
    expect(ports.gateway).toBeUndefined()
  })

  it('非法端口被丢弃而不是当成 0 或 NaN', () => {
    expect(resolveRuntimePorts({ DSH_UPSTREAM_PORT: 'abc' }).web).toBeUndefined()
    expect(resolveRuntimePorts({ DSH_UPSTREAM_PORT: '0' }).web).toBeUndefined()
    expect(resolveRuntimePorts({ DSH_UPSTREAM_PORT: '70000' }).web).toBeUndefined()
  })

  it('本地开发用 DSH_WEB_PORT 兜底', () => {
    expect(resolveRuntimePorts({ DSH_WEB_PORT: '9321' }).web).toBe(9321)
  })
})

describe('运行状态：指标采集', () => {
  it('首帧没有 CPU 百分比（百分比需要两次采样求差）', async () => {
    const first = await collectMetrics(1_000)
    expect(first.cpuPercent).toBeUndefined()
    expect(first.rssBytes).toBeGreaterThan(0)
    expect(first.heapUsedBytes).toBeGreaterThan(0)
  })

  it('第二帧起给出 0–100 之间的 CPU 百分比', async () => {
    await collectMetrics(1_000)
    const second = await collectMetrics(2_000)
    expect(second.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(second.cpuPercent).toBeLessThanOrEqual(100)
  })

  it('磁盘读写读不到时为 null，而不是 0', async () => {
    const metrics = await collectMetrics(1_000)
    // 非 Linux 上两者都是 null；Linux 上应是数字。都允许，但**不允许** null 变 0。
    for (const value of [metrics.diskReadBytes, metrics.diskWriteBytes]) {
      expect(value === null || typeof value === 'number').toBe(true)
    }
    expect(typeof metrics.diskReadBytes === 'number' && metrics.diskReadBytes === 0 ? 'number-zero' : 'ok').toBe('ok')
  })

  it('快照里 platform 依 DSH_HOME 判定', async () => {
    expect((await readRuntimeStatus({ DSH_HOME: '/x' })).platform).toBe('fnos')
    expect((await readRuntimeStatus({})).platform).toBe('local')
  })

  it('pid 是当前进程', async () => {
    expect((await readRuntimeStatus({})).pid).toBe(process.pid)
  })
})

describe('运行状态：网络与四宫格', () => {
  it('网络字节读不到时为 null，不填 0', async () => {
    const m = await collectMetrics(1_000)
    for (const v of [m.netRxBytes, m.netTxBytes]) {
      expect(v === null || typeof v === 'number').toBe(true)
    }
  })

  it('图表是 2×2 四宫格，网络格画上下行两条线', () => {
    // 四格：CPU / 内存 / 磁盘 / 网络；网络拆成下行与上行两条系列。
    expect(CARD).toContain("key: 'netRx'")
    expect(CARD).toContain("key: 'netTx'")
    expect(CARD).toContain('NET_CELL_INDEX')
    // 全部用百分比：ECharts 不认 grid.width 里的 calc()，混用会把两格算重。
    expect(CARD).toContain("left: i % 2 === 0 ? '6%' : '52.83%'")
    expect(CARD).toContain("top: Math.floor(i / 2) === 0 ? '12%' : '58%'")
    expect(CARD).toContain("width: i % 2 === 0 ? '42%' : '41.17%'")
    // calc 混百分比是这台机器的实际踩坑点，加断言防止回退。
    expect(CARD).not.toMatch(/width: .*calc\(/)
    // `containLabel` 会把纵轴刻度算进绘图区，左侧被推、右侧不动，左右就不齐。
    // 只断言 grid 的实际配置行——注释里提到它属于说明文字。
    expect(CARD).toMatch(/grid: \[0, 1, 2, 3\]\.map\(i => \(\{ \.\.\.cell\(i\) \}\)\)/)
  })

  it('tooltip 带单位（只有数字看不出 MB/s 还是 KB/s）', () => {
    expect(CARD).toContain('valueFormatter')
    // 系列名里带单位，tooltip 直接显示「名称: 值 单位」。
    expect(CARD).toMatch(/name: `\$\{t\(s\.labelKey\)\} \(\$\{s\.unit\}\)`/)
  })

  it('网络与磁盘都按每秒增量换算，而不是画累计值', () => {
    expect(CARD).toContain('lastNetRef')
    expect(CARD).toContain('rateOf')
  })
})

describe('运行状态：进程树与结束', () => {
  it('只能动进程树内的进程，且根与 init 受保护', async () => {
    const { killProcess } = await import('../../src/host/runtime-processes.ts')
    // 关键安全边界：不在本树内的 pid 一律拒绝。
    const outside = await killProcess(1, 'SIGTERM')
    expect(outside.ok).toBe(false)
    expect(outside.reason).toBe('protected-process')
    // 自己也不能杀。
    const self = await killProcess(process.pid, 'SIGKILL')
    expect(self.ok).toBe(false)
  })

  it('只接受 SIGTERM / SIGKILL 两种信号', async () => {
    const { killProcess, ALLOWED_SIGNALS } = await import('../../src/host/runtime-processes.ts')
    expect([...ALLOWED_SIGNALS]).toEqual(['SIGTERM', 'SIGKILL'])
    const bad = await killProcess(1234, 'SIGUSR2' as 'SIGTERM')
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('signal-not-allowed')
  })

  it('非 Linux 上返回空列表而不是抛错', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    const tree = await listProcessTree()
    expect(Array.isArray(tree)).toBe(true)
  })

  it('kill 路由是 POST + 同源 + 限制 body 体积', () => {
    expect(ROUTES).toContain("'method-not-allowed'")
    expect(ROUTES).toContain('MAX_BODY_BYTES')
    expect(CONTRACT).toContain("FNOS_RUNTIME_KILL_ROUTE = '/plugins/dsh-fnos/runtime/kill'")
  })

  it('命令行省略用 Semi Typography 的 ellipsis（自带 tooltip）', () => {
    const LIST = readFileSync(new URL('../../src/components/RuntimeProcessList.tsx', import.meta.url), 'utf8')
    // 自写 text-overflow 只有原生 title 提示；Semi 的 ellipsis 用站内 Tooltip，
    // 且只在真的被截断时才显示。
    expect(LIST).toContain('ellipsis={{ showTooltip: true }}')
    expect(LIST).toContain('DshTypography')
    expect(LIST).not.toContain('title={item.command}')
  })

  it('标题旁不带 info 图标（运行 / 进程两处）', () => {
    // 标题旁边挂一个「i」在视觉上是噪音，而这段说明不是必须读的内容。
    const CARD = readFileSync(new URL('../../src/components/RuntimeStatusCard.tsx', import.meta.url), 'utf8')
    const LIST = readFileSync(new URL('../../src/components/RuntimeProcessList.tsx', import.meta.url), 'utf8')
    expect(CARD).not.toContain('DshIconInfoCircle')
    expect(LIST).not.toContain('DshIconInfoCircle')
  })

  it('界面如实说明这是 OS 视角而不是会话任务，并提供两档结束', () => {
    const LIST = readFileSync(new URL('../../src/components/RuntimeProcessList.tsx', import.meta.url), 'utf8')
    // 标题旁的 info 图标已按用户要求去掉。
    expect(LIST).not.toContain('runtimeProcessesTip')
    expect(LIST).toContain("'SIGTERM'")
    expect(LIST).toContain("'SIGKILL'")
    // 破坏性动作必须确认（用 DshModal，不用被 lint 禁用的 window.confirm）。
    expect(LIST).toContain('DshModal')
    expect(LIST).toContain('setConfirming')
    // 不可杀的行不渲染按钮。
    expect(LIST).toContain('item.canKill')
  })
})

describe('运行状态：日志面板', () => {
  it('日志走 ctx.logger.exporter，而不是读文件（应用不写日志文件）', () => {
    const LOGS = readFileSync(new URL('../../src/host/runtime-logs.ts', import.meta.url), 'utf8')
    expect(LOGS).toContain('ctx.logger.exporter')
    // 环形缓冲必须有上限，否则进程会随运行时间吃光内存。
    expect(LOGS).toContain('buffer.splice(0, buffer.length - limit)')
    expect(LOGS).toContain('MAX_LOG_LIMIT')
  })

  it('日志接口是只读 GET，支持 limit/level/q', () => {
    expect(ROUTES).toContain('FNOS_RUNTIME_LOGS_ROUTE')
    expect(CONTRACT).toContain("FNOS_RUNTIME_LOGS_ROUTE = '/plugins/dsh-fnos/runtime/logs'")
  })

  it('面板有级别筛选、搜索、条数自定义，且占满剩余高度', () => {
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('DshSelect')
    expect(PANEL).toContain("type=\"search\"")
    expect(PANEL).toContain('setLimit')
    expect(PANEL).toContain('DEFAULT_LIMIT')
    // 占满剩余空间
    const rule = SCSS.slice(SCSS.indexOf('.dsh-fnos-logs {'), SCSS.indexOf('.dsh-fnos-logs-bar {'))
    expect(rule).toContain('height: 100%')
    expect(rule).toContain('flex-direction: column')
  })

  it('日志按级别着色，且不只靠颜色传达信息', () => {
    // 每种级别既有徽标底色也有文字标签。
    expect(SCSS).toContain('.dsh-fnos-logs-line--error .dsh-fnos-logs-badge')
    expect(SCSS).toContain('.dsh-fnos-logs-line--warn .dsh-fnos-logs-badge')
    const PANEL = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('levelKey')
  })
})

describe('运行状态：日志换行与整行同色', () => {
  it('日志行允许换行，不再用省略号截断', () => {
    const i = SCSS.indexOf('.dsh-fnos-logs-line {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    // 日志的价值在后半段（路径、错误码），省略号恰好切掉它。
    expect(rule).not.toContain('white-space: nowrap')
    const t = SCSS.indexOf('.dsh-fnos-logs-text {')
    const textRule = SCSS.slice(t, SCSS.indexOf('}', t))
    expect(textRule).not.toContain('text-overflow: ellipsis')
    // 长路径也要能断开。
    expect(textRule).toContain('overflow-wrap: anywhere')
  })

  it('整行同色：级别色由行元素统一赋值，子元素继承', () => {
    // 早前只有徽章有级别色、正文是继承色，一行里出现两种颜色。
    expect(SCSS).toContain('--dsh-fnos-log-color')
    // 该选择器有两条规则（布局 + 着色），取带 color 的那条。
    const rules = Array.from(SCSS.matchAll(/^\.dsh-fnos-logs-line \{([\s\S]*?)^\}/gmu)).map(m => m[1])
    expect(rules.some(rule => rule?.includes('color: var(--dsh-fnos-log-color'))).toBe(true)
    for (const sel of ['.dsh-fnos-logs-time {', '.dsh-fnos-logs-name {', '.dsh-fnos-logs-text {']) {
      const j = SCSS.indexOf(sel)
      expect(SCSS.slice(j, SCSS.indexOf('}', j))).toContain('color: inherit')
    }
  })

  it('运行与日志轮询都是 5 秒', () => {
    expect(CARD).toContain('INTERVAL_MS = 5000')
    const LOGS = readFileSync(new URL('../../src/components/RuntimeLogPanel.tsx', import.meta.url), 'utf8')
    expect(LOGS).toContain('INTERVAL_MS = 5000')
  })

  it('运行页字号统一 14px', () => {
    const block = SCSS.slice(SCSS.indexOf('.dsh-fnos-runtime-ports {'), SCSS.indexOf('.dsh-fnos-runtime-chart {'))
    // 标签与数值都不得出现 12/15/18。
    expect(block).not.toMatch(/font-size: 1[258]px/)
    expect(block).toContain('font-size: 14px')
  })
})

describe('运行状态：两排读数外观一致', () => {
  it('端口行与指标行都有内边距与底色（否则看起来像两个层级）', () => {
    const portItem = SCSS.slice(SCSS.indexOf('.dsh-fnos-runtime-ports {'), SCSS.indexOf('.dsh-fnos-runtime-now {'))
    const nowItem = SCSS.slice(SCSS.indexOf('.dsh-fnos-runtime-now-item {'))
    const nowRule = nowItem.slice(0, nowItem.indexOf('}'))
    // 两排都是读数，视觉上必须同构。
    expect(portItem).toContain('padding: 8px 10px')
    expect(nowRule).toContain('padding: 8px 10px')
    expect(portItem).toContain('border-radius: 8px')
    expect(nowRule).toContain('border-radius: 8px')
  })
})

describe('运行状态：可结束的永远排最上面', () => {
  it('排序按 canKill，而不是只看是不是根进程', () => {
    /*
      真机踩到：受保护的并不止根进程——`gateway-proxy.mjs` 也受保护，它按 pid
      混在中间，用户得先扫过它才能找到真正能动手的那条。

      这一栏的用途就是「找到该结束的那个进程」，所以可结束的必须永远在最上面。
    */
    const SRC = readFileSync(new URL('../../src/host/runtime-processes.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('if (a.canKill !== b.canKill) return a.canKill ? -1 : 1')
  })

  it('实测：所有 canKill 的记录都排在不可结束的前面', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    const list = await listProcessTree(process.pid, 'user')
    const firstUnkillable = list.findIndex(item => !item.canKill)
    if (firstUnkillable >= 0) {
      // 一旦出现不可结束的，后面不能再有可结束的。
      expect(list.slice(firstUnkillable).every(item => !item.canKill)).toBe(true)
    }
  })

  it('同为不可结束时，根进程排最后', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    const list = await listProcessTree(process.pid, 'user')
    const rootIndex = list.findIndex(item => item.isRoot)
    if (rootIndex >= 0) {
      // 根进程之后不应再有其它不可结束的进程。
      expect(list.slice(rootIndex + 1).every(item => !item.canKill)).toBe(true)
    }
  })
})

describe('运行状态：入口进程受保护', () => {
  it('gateway-proxy 与根进程同等保护（结束它等于应用失联）', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    const tree = await listProcessTree(process.pid, 'user')
    for (const item of tree) {
      // 按文件名识别：它是框架以 ppid=1 拉起的，pid 每次重启都变。
      if (item.command.includes('gateway-proxy.mjs')) {
        expect(item.canKill).toBe(false)
      }
    }
    // 规则本身必须存在（当前环境没跑网关时列表里不会有它）。
    const src = readFileSync(new URL('../../src/host/runtime-processes.ts', import.meta.url), 'utf8')
    expect(src).toContain("PROTECTED_NAMES: readonly string[] = ['gateway-proxy.mjs']")
  })

  it('结束接口复用树里的 canKill，不另算一遍规则', () => {
    // 若接口只按 pid 判断，就会出现「界面显示受保护、接口却允许杀」的危险不一致。
    const src = readFileSync(new URL('../../src/host/runtime-processes.ts', import.meta.url), 'utf8')
    expect(src).toContain('if (!target.canKill) return { ok: false, reason: ')
  })
})

describe('运行状态：进程排序', () => {
  it('根进程固定排最后（它永远不可操作，不该占最显眼的位置）', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    const list = await listProcessTree(process.pid, 'user')
    if (list.length === 0) return
    const rootIndex = list.findIndex(item => item.isRoot)
    // 根可能在也可能不在（uid 口径下当前进程必然在），在就必须是最后一条。
    if (rootIndex >= 0) expect(rootIndex).toBe(list.length - 1)
  })

  it('可操作项排在根之前，同组内按 pid 升序', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    const list = await listProcessTree(process.pid, 'user')
    const killable = list.filter(item => item.canKill)
    const pids = killable.map(item => item.pid)
    expect([...pids].sort((a, b) => a - b)).toEqual(pids)
    // canKill 为 false 的只允许出现在末尾。
    const firstUnkillable = list.findIndex(item => !item.canKill)
    if (firstUnkillable >= 0) {
      expect(list.slice(firstUnkillable).every(item => !item.canKill)).toBe(true)
    }
  })
})

describe('运行状态：按 uid 枚举（覆盖网关进程）', () => {
  it('默认按 uid 枚举，而不是只爬进程树', async () => {
    const { listProcessTree } = await import('../../src/host/runtime-processes.ts')
    // 两种口径都要能跑通；user 口径应包含当前进程。
    const byUser = await listProcessTree(process.pid, 'user')
    const byTree = await listProcessTree(process.pid, 'tree')
    expect(Array.isArray(byUser)).toBe(true)
    expect(Array.isArray(byTree)).toBe(true)
    // 进程树必然包含根；user 口径在非 Linux 上为空。
    if (byTree.length > 0) expect(byTree.some(p => p.isRoot)).toBe(true)
  })

  it('快照声明口径为 user 并给出 uid', async () => {
    const { readRuntimeStatus } = await import('../../src/host/runtime-status.ts')
    const status = await readRuntimeStatus({})
    expect(status.processScope).toBe('user')
    if (typeof process.getuid === 'function') expect(status.uid).toBe(process.getuid())
  })

  it('按 uid 枚举能抓到 ppid=1 的兄弟进程（这正是它优于进程树的地方）', () => {
    const SRC = readFileSync(new URL('../../src/host/runtime-processes.ts', import.meta.url), 'utf8')
    expect(SRC).toContain("scope === 'user'")
    expect(SRC).toContain('readUid')
    // 网关由框架以 ppid=1 拉起，纯树遍历到不了——这一点必须在注释里说清。
    expect(SRC).toContain('ppid=1')
  })
})

describe('运行状态：与左侧菜单对齐', () => {
  it('分组标题重置 h3 默认外边距（否则右列永远低 15px）', () => {
    // 浏览器默认给 h3 `margin: 1em 0`；不重置的话无论怎么调上层 padding，
    // 标题都被推低 15px，右列顶部对不上左侧菜单项。
    const i = SCSS.indexOf('.dsh-fnos-authorized-card-name {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('margin: 0')
  })

  it('内容行上下 16，首行标题落在菜单项下方 6px', () => {
    const i = SCSS.indexOf('.dsh-fnos-config-panel > * {')
    const rule = SCSS.slice(i, SCSS.indexOf('}', i))
    expect(rule).toContain('padding: 16px 0')
    // 面板顶(84) + 16 = 100；菜单项顶(94)，差 6，与官方一致。
    expect(rule).toContain('border-bottom')
  })
})

describe('运行状态：路由与契约', () => {
  it('路由只读且禁止缓存（指标每秒变，缓存会让轮询拿到同一份）', () => {
    expect(ROUTES).toContain("'cache-control': 'no-store'")
    expect(CONTRACT).toContain("FNOS_RUNTIME_STATUS_ROUTE = '/plugins/dsh-fnos/runtime/status'")
  })

  it('路由要求同源', () => {
    expect(ROUTES).toContain('remote-web-origin-not-trusted')
    expect(ROUTES).toContain('trusted(req)')
  })
})

describe('运行状态：图表', () => {
  it('按需引入 echarts，不整包引入', () => {
    expect(CARD).toContain("from 'echarts/core'")
    expect(CARD).toContain("from 'echarts/charts'")
    // 整包引入会让插件产物多出近 1MB。
    expect(CARD).not.toContain("from 'echarts'")
  })

  it('读写从累计值换算成每秒速率（否则是一条只会上升的斜线）', () => {
    expect(CARD).toContain('lastIoRef')
    expect(CARD).toContain('elapsed')
  })

  it('echarts 必须打进产物（当外部依赖会让整个插件加载失败）', () => {
    // 真机实测：宿主的模块表没有 echarts，按外部依赖处理后运行时直接报
    // `require("echarts/charts") missed the module table`，插件整体不加载。
    const build = readFileSync(new URL('../../tsdown.config.ts', import.meta.url), 'utf8')
    expect(build).toContain('/^echarts(?:\\/|$)/u')
    expect(build).toContain('alwaysBundle')
  })

  it('图表容器有确定高度，否则 ECharts 画布为 0 不显示', () => {
    const rule = SCSS.slice(SCSS.indexOf('.dsh-fnos-runtime-chart {'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('height:')
  })

  it('采样点数有上限，不会无限增长', () => {
    expect(CARD).toContain('POINTS')
    expect(CARD).toMatch(/slice\(-POINTS\)/)
  })
})

describe('运行状态：文案', () => {
  it('中英都有「运行」分组与三项指标', () => {
    for (const key of ['configSectionRuntime', 'runtimeTitle', 'runtimeCpu', 'runtimeMemory', 'runtimeDisk']) {
      const hits = LOCALES.split('\n').filter(line => line.trim().startsWith(`${key}:`))
      // 英 + 中 = 2；其余 7 种语言另算，这里只要求至少这两份。
      expect(hits.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('九种语言都补齐了运行键', () => {
    const langs = ['', '.de', '.es', '.fr', '.it', '.ja', '.ko', '.ru']
    const files = langs.map(suffix => readFileSync(new URL(`../../src/client/locales${suffix}.ts`, import.meta.url), 'utf8'))
    for (const text of files) {
      expect(text).toContain('runtimeTitle:')
      expect(text).toContain('runtimeFailed:')
    }
  })
})
