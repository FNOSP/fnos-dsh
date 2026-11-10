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
