/**
 * 真实网络冒烟脚本（T02/T09 的真实 key 验证）。
 *
 * 用途：用真实 TinyFish / Tavily key 走一遍复合提供方的六条链路——三方优先、
 * 来源间转移、官方兜底、禁用回落、多账号均摊、请求前探测——并打印每级尝试的
 * 脱敏事件。key 从环境变量读取，**不写入仓库、不落盘、不进日志**。
 *
 * 运行（cwd 为插件目录）：
 *   DSH_TINYFISH_KEYS='k1,k2' DSH_TAVILY_KEYS='k1' node --experimental-strip-types scripts/smoke.ts
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchResult } from '@deepseek-ai/dsh-web'
import { FailoverSearchProvider } from '../src/host/failover-provider.ts'
import { TavilyAdapter, TavilyUsageAdapter } from '../src/host/tavily-provider.ts'
import { TinyFishAdapter, TinyFishUsageAdapter } from '../src/host/tinyfish-provider.ts'
import type { AccountUsage, PlatformId, SourceAdapter } from '../src/contracts/types.ts'
import type { FailoverSearchSettings } from '../src/contracts/config.ts'

/** 读取逗号分隔的 key 列表。 */
function keys(name: string): string[] {
  return (process.env[name] ?? '').split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
}

/** 官方兜底级替身：真实链路里由官方提供方承担，冒烟只记录是否被调用。 */
function stubOfficial(mode: 'ok' | 'fail' | 'credential-missing') {
  const calls: unknown[] = []
  const provider: WebSearchProvider = {
    id: 'deepseek-official',
    available: () => mode === 'ok',
    search: async (): Promise<WebSearchResult> => {
      calls.push(1)
      if (mode === 'credential-missing') throw new WebError('缺少 DEEPSEEK_API_KEY', 'WEB_PROVIDER_CREDENTIAL_MISSING')
      if (mode === 'fail') throw new WebError('official down', 'WEB_PROVIDER_ERROR')
      return { sources: [{ url: 'https://official.example' }], truncated: false }
    },
  }
  return { provider, calls }
}

/** 构造配置取值。 */
function settings(overrides: Partial<FailoverSearchSettings> = {}): FailoverSearchSettings {
  return {
    tinyfishAccounts: [],
    tavilyAccounts: [],
    sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
    timeoutMs: 20000,
    samePlatformRetry: true,
    usageRefreshMinutes: 5,
    requestProbe: true,
    ...overrides,
  }
}

/** 断言辅助：失败即退出码 1。 */
const results: { name: string, ok: boolean, detail: string }[] = []
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

/** 构造提供方。 */
function build(
  config: FailoverSearchSettings,
  adapters: Partial<Record<PlatformId, SourceAdapter[]>>,
  official: WebSearchProvider,
  usage?: { snapshot: () => readonly AccountUsage[], isFresh: () => boolean },
) {
  const events: unknown[] = []
  const provider = new FailoverSearchProvider({
    readSettings: () => config,
    adapters: { tinyfish: adapters.tinyfish ?? [], tavily: adapters.tavily ?? [] },
    official: { id: official.id, available: () => official.available(), search: (request, signal) => official.search(request, signal) },
    ...(usage === undefined ? {} : { usage: { snapshot: usage.snapshot, isFresh: usage.isFresh } }),
    onAttempt: event => events.push(event),
  })
  return { provider, events }
}

const tinyfishKeys = keys('DSH_TINYFISH_KEYS')
const tavilyKeys = keys('DSH_TAVILY_KEYS')
if (tinyfishKeys.length === 0 && tavilyKeys.length === 0) {
  console.error('缺少测试 key：设置 DSH_TINYFISH_KEYS / DSH_TAVILY_KEYS（逗号分隔多账号）')
  process.exit(2)
}

const tinyfishAccounts = tinyfishKeys.map((key, index) => ({ key, label: `tinyfish-${index + 1}` }))
const tavilyAccounts = tavilyKeys.map((key, index) => ({ key, label: `tavily-${index + 1}` }))
const tinyfish = new TinyFishAdapter()
const tavily = new TavilyAdapter()
const query = 'deepseek harness release notes'

// ① 三方优先：仅 TinyFish 时由 TinyFish 返回，官方不被调用。
{
  const official = stubOfficial('ok')
  const { provider } = build(settings({ tinyfishAccounts }), { tinyfish: [tinyfish] }, official.provider)
  const result = await provider.search({ query, maxResults: 5 })
  check('FNOS-010-01-AC-01 三方优先', result.sources.length > 0 && official.calls.length === 0,
    `TinyFish 返回 ${result.sources.length} 条，官方调用 ${official.calls.length} 次`)
}

// ② 顺序最高且可用来源：两个平台都配，TinyFish 排前时由它返回。
{
  const official = stubOfficial('ok')
  const { provider, events } = build(settings({ tinyfishAccounts, tavilyAccounts }), { tinyfish: [tinyfish], tavily: [tavily] }, official.provider)
  const result = await provider.search({ query, maxResults: 5 })
  const first = (events[0] as { platform?: string } | undefined)?.platform
  check('FNOS-010-01-AC-02 顺序最高来源优先', first === 'tinyfish' && result.sources.length > 0,
    `首个尝试来源 ${String(first)}，返回 ${result.sources.length} 条`)
}

// ③ 来源间转移：TinyFish 用无效 key 必然失败，同一查询由 Tavily 完成。
{
  const official = stubOfficial('ok')
  const { provider, events } = build(
    settings({ tinyfishAccounts: [{ key: 'sk-tinyfish-invalid-for-failover-test' }], tavilyAccounts }),
    { tinyfish: [tinyfish], tavily: [tavily] },
    official.provider,
  )
  const result = await provider.search({ query, maxResults: 5 })
  const platforms = (events as { platform?: string, outcome?: string }[]).map(event => `${event.platform}:${event.outcome}`)
  check('FNOS-010-02-AC-01 来源间转移', result.sources.length > 0 && platforms.some(entry => entry.startsWith('tinyfish:failed')) && platforms.some(entry => entry.startsWith('tavily:succeeded')),
    `尝试序列 ${platforms.join(' → ')}`)
}

// ④ 官方兜底：三方 key 全部无效时回落官方。
{
  const official = stubOfficial('ok')
  const { provider, events } = build(
    settings({ tinyfishAccounts: [{ key: 'sk-tinyfish-invalid' }], tavilyAccounts: [{ key: 'tvly-invalid' }] }),
    { tinyfish: [tinyfish], tavily: [tavily] },
    official.provider,
  )
  const result = await provider.search({ query, maxResults: 5 })
  const platforms = (events as { platform?: string }[]).map(event => event.platform)
  check('FNOS-010-03-AC-02 官方兜底', result.sources[0]?.url === 'https://official.example' && official.calls.length === 1,
    `尝试序列 ${platforms.join(' → ')}，官方调用 ${official.calls.length} 次`)
}

// ⑤ 未配置 key 的来源直接跳过：不产生等待。
{
  const official = stubOfficial('ok')
  const { provider, events } = build(settings({ tavilyAccounts }), { tinyfish: [tinyfish], tavily: [tavily] }, official.provider)
  const result = await provider.search({ query, maxResults: 5 })
  const platforms = (events as { platform?: string }[]).map(event => event.platform)
  check('FNOS-010-02-AC-02 未配置来源跳过', !platforms.includes('tinyfish') && result.sources.length > 0,
    `尝试序列 ${platforms.join(' → ')}`)
}

// ⑥ 多账号均摊：同平台至少两个真实账号时连续请求分摊到各账号。
if (tinyfishAccounts.length >= 2) {
  const official = stubOfficial('ok')
  const { provider, events } = build(settings({ tinyfishAccounts }), { tinyfish: [tinyfish] }, official.provider)
  for (let index = 0; index < tinyfishAccounts.length * 2; index += 1) await provider.search({ query, maxResults: 3 })
  const accounts = (events as { account?: string }[]).map(event => event.account)
  const unique = new Set(accounts)
  check('FNOS-010-07-AC-01 多账号均摊（真实多账号）', unique.size === tinyfishAccounts.length,
    `连续 ${accounts.length} 次请求分布：${accounts.join(', ')}（覆盖 ${unique.size}/${tinyfishAccounts.length} 个账号）`)
} else {
  // 只有一个真实 key 时退化为「机制验证」：同一个 key 占两个池槽，真实网络下确认
  // 轮转确实按槽位分配请求。这**不能**替代「同平台两个真实账号的分摊效果由平台侧
  // 用量数据验证」这一验收条件，因此结果单独标注为部分验证。
  const official = stubOfficial('ok')
  const twice = [{ key: tinyfishAccounts[0]?.key ?? '', label: 'slot-a' }, { key: tinyfishAccounts[0]?.key ?? '', label: 'slot-b' }]
  const { provider, events } = build(settings({ tinyfishAccounts: twice }), { tinyfish: [tinyfish] }, official.provider)
  for (let index = 0; index < 4; index += 1) await provider.search({ query, maxResults: 3 })
  const accounts = (events as { account?: string }[]).map(event => event.account)
  const unique = new Set(accounts)
  check('FNOS-010-07-AC-01 轮转机制（单 key 占双槽，真实网络）', unique.size === 2,
    `槽位分布：${accounts.join(', ')}；同平台两个真实账号的分摊效果仍待验收`)
}

// ⑦ 请求前探测：快照标记已满的账号在请求前被跳过。
if (tinyfishAccounts.length >= 2) {
  const official = stubOfficial('ok')
  const exhausted: AccountUsage = {
    platform: 'tinyfish',
    accountLabel: 'tinyfish-1',
    fetchedAt: new Date().toISOString(),
    exhausted: true,
    details: {},
  }
  const { provider, events } = build(settings({ tinyfishAccounts }), { tinyfish: [tinyfish] }, official.provider, {
    snapshot: () => [exhausted],
    isFresh: () => true,
  })
  await provider.search({ query, maxResults: 3 })
  const accounts = (events as { account?: string }[]).map(event => event.account)
  check('FNOS-010-09-AC-01 请求前探测跳过', !accounts.includes('tinyfish-1'),
    `尝试账号 ${accounts.join(', ') || '（无）'}`)
} else {
  // 单 key 时用双槽配置验证探测跳过：账号代号粒度与真实多账号一致。
  const twice = [{ key: tinyfishAccounts[0]?.key ?? '', label: 'tinyfish-1' }, { key: tinyfishAccounts[0]?.key ?? '', label: 'tinyfish-2' }]
  const official = stubOfficial('ok')
  const exhausted: AccountUsage = {
    platform: 'tinyfish',
    accountLabel: 'tinyfish-1',
    fetchedAt: new Date().toISOString(),
    exhausted: true,
    details: {},
  }
  const { provider, events } = build(settings({ tinyfishAccounts: twice }), { tinyfish: [tinyfish] }, official.provider, {
    snapshot: () => [exhausted],
    isFresh: () => true,
  })
  await provider.search({ query, maxResults: 3 })
  const accounts = (events as { account?: string }[]).map(event => event.account)
  check('FNOS-010-09-AC-01 请求前探测跳过（双槽机制）', !accounts.includes('tinyfish-1'),
    `尝试账号 ${accounts.join(', ') || '（无）'}`)
}

// ⑧ 用量端点：真实查询两个平台的用量读数。
{
  const usageFacts: string[] = []
  if (tinyfishKeys[0] !== undefined) {
    const reading = await new TinyFishUsageAdapter().fetchUsage(tinyfishKeys[0])
    usageFacts.push(`TinyFish 钱包=${reading.error ?? JSON.stringify(reading.details)}`)
    check('FNOS-010-08-AC-02 TinyFish 钱包查询', reading.error === undefined && reading.details.balance !== undefined,
      reading.error ?? `balance=${reading.details.balance}`)
  }
  if (tavilyKeys[0] !== undefined) {
    const reading = await new TavilyUsageAdapter().fetchUsage(tavilyKeys[0])
    usageFacts.push(`Tavily 用量=${reading.error ?? JSON.stringify(reading.details)}`)
    check('FNOS-010-08-AC-01 Tavily 用量查询', reading.error === undefined && reading.details.planUsage !== undefined,
      reading.error ?? `planUsage=${reading.details.planUsage}`)
  }
}

const failed = results.filter(entry => !entry.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)
if (failed.length > 0) process.exit(1)
