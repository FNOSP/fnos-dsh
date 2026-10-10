/**
 * FNOS-010 全流程真实网络验证：搜索 → 从结果里挑 URL → 取回正文。
 *
 * 为什么单独一个脚本：既有 `smoke.ts` 只测搜索、`fetch-fallback.ts` 只测抓取，
 * 两者都不覆盖**串联**——而模型的真实用法正是「先搜、拿到来源、再读某一篇的全文」
 * （`web_search` 的结果里带着 `Follow up with web_fetch ...` 的引导，见
 * `dsh-tool-web`）。串联里才会暴露的问题：搜索结果里的 URL 能否被取回
 * （重定向包装、相对地址）、站点类型差异（包管理站 / 代码托管站）、
 * 以及会话级开关对**两条链路同时**的约束。
 *
 * 目标站点用 `TARGET_SITES` 覆盖（逗号分隔的 `名称=查询词`），默认覆盖 npm 与 GitHub。
 * 断言的是**链路可完成**（搜索有来源 → 来源可被取回正文），而不是具体某条结果的内容。
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import { CompositeFetchProvider } from '../src/host/fetch-failover-provider.ts'
import { TavilyExtractAdapter, TinyfishFetchAdapter } from '../src/host/fetch-platforms.ts'
import { FailoverSearchProvider } from '../src/host/failover-provider.ts'
import { SessionToggleStore, runWithSession, shouldBypassActiveSession } from '../src/host/session-toggle.ts'
import { TavilyAdapter } from '../src/host/tavily-provider.ts'
import { TinyFishAdapter } from '../src/host/tinyfish-provider.ts'
import type { FailoverSearchSettings } from '../src/contracts/config.ts'

const tinyfishKeys = (process.env.DSH_TINYFISH_KEYS ?? '').split(',').filter(Boolean)
const tavilyKeys = (process.env.DSH_TAVILY_KEYS ?? '').split(',').filter(Boolean)

/** 默认站点集合：包管理站与代码托管站，两类站点的页面结构差异很大。 */
const DEFAULT_SITES = 'npm=https://www.npmjs.com 上的 @deepseek-ai/dsh 包,github=deepseek-harness github 仓库'
const sites = (process.env.TARGET_SITES ?? DEFAULT_SITES).split(',').map(entry => {
  const [name, query] = entry.split('=')
  return { name: name?.trim() ?? '', query: query?.trim() ?? '' }
}).filter(site => site.name.length > 0 && site.query.length > 0)

const results: string[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const settings: FailoverSearchSettings = {
  tinyfishAccounts: tinyfishKeys.map((key, index) => ({ key, label: `tinyfish-${index + 1}` })),
  tavilyAccounts: tavilyKeys.map((key, index) => ({ key, label: `tavily-${index + 1}` })),
  sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
  timeoutMs: 20000,
  samePlatformRetry: true,
  usageRefreshMinutes: 5,
  requestProbe: false,
}

const toggle = new SessionToggleStore()

/** 组一个复合搜索 provider（三方优先、官方兜底 + 会话门控）。 */
function makeSearchProvider(): FailoverSearchProvider {
  return new FailoverSearchProvider({
    readSettings: () => settings,
    adapters: { tinyfish: [new TinyFishAdapter()], tavily: [new TavilyAdapter()] },
    // 本脚本不验证官方兜底；用不可用的桩让三方链路成为唯一路径。
    official: {
      id: 'deepseek-official',
      available: () => false,
      search: async () => { throw new WebError('official disabled in this script', 'WEB_PROVIDER_CREDENTIAL_MISSING') },
    },
    usage: { snapshot: () => [], isFresh: () => false, locallyLimited: () => false },
    shouldBypass: () => shouldBypassActiveSession(toggle),
    onAttempt: event => console.log(`    · ${event.platform}/${event.account} ${event.outcome} (${event.durationMs}ms)`),
  })
}

/** 组一个复合抓取 provider（本地优先 + 平台兜底 + 会话门控）。 */
function makeFetchProvider(): CompositeFetchProvider {
  return new CompositeFetchProvider({
    id: 'dsh-failover-search',
    // 本地跳固定失败：本机 DNS 处于代理的 fake-ip 模式，官方本地抓取对域名一律被拒，
    // 正好让平台兜底成为唯一可行路径（这也正是真实使用里的兜底场景）。
    local: { fetch: async () => { throw new WebError('non-public IP blocked (fake-ip DNS)', 'WEB_INVALID_URL') } },
    platforms: [
      { platform: 'tinyfish', backend: new TinyfishFetchAdapter({ apiKey: tinyfishKeys[0] ?? '', endpoint: 'https://api.fetch.tinyfish.ai' }) },
      { platform: 'tavily', backend: new TavilyExtractAdapter({ apiKey: tavilyKeys[0] ?? '', endpoint: 'https://api.tavily.com/extract' }) },
    ],
    shouldBypass: () => shouldBypassActiveSession(toggle),
    onHop: event => console.log(`    · hop ${event.platform} ${event.outcome} (${event.durationMs}ms)`),
  })
}

console.log(`站点集合：${sites.map(site => site.name).join('、')}\n`)

// ① 全流程：搜索 → 取正文（开关开启）
for (const site of sites) {
  console.log(`########## ${site.name}：${site.query}`)
  const search = makeSearchProvider()
  const fetcher = makeFetchProvider()

  let result: WebSearchResult | undefined
  try {
    result = await runWithSession(`flow-${site.name}`, toggle, () => search.search({ query: site.query, maxResults: 5 }))
    check(`${site.name} 搜索返回来源`, (result.sources.length ?? 0) > 0, `${result.sources.length} 条来源`)
  } catch (error) {
    check(`${site.name} 搜索返回来源`, false, `搜索失败：${error instanceof Error ? error.message.slice(0, 120) : String(error)}`)
    console.log('')
    continue
  }

  // 逐条尝试取回，直到成功一条——模拟模型「挑一条来源读全文」的行为。
  const attempts: string[] = []
  let fetched: { url: string, length: number } | undefined
  for (const source of result.sources) {
    try {
      const page = await runWithSession(`flow-${site.name}`, toggle, () => fetcher.fetch({ url: source.url }))
      fetched = { url: source.url, length: page.body.content.length }
      break
    } catch (error) {
      attempts.push(`${new URL(source.url).hostname}: ${error instanceof Error ? error.message.slice(0, 60) : String(error)}`)
    }
  }

  check(
    `${site.name} 搜索结果可被取回正文`,
    fetched !== undefined && fetched.length > 200,
    fetched === undefined
      ? `全部来源取回失败（${attempts.slice(0, 2).join(' | ')}）`
      : `${fetched.url.slice(0, 72)} → ${fetched.length} 字符`,
  )
  console.log('')
}

// ② 开关关闭：两条链路都不接入本插件（三方零调用）
{
  console.log('########## 开关关闭：搜索与抓取都不接入本插件')
  toggle.setEnabled('flow-off', false)
  const search = makeSearchProvider()
  const fetcher = makeFetchProvider()
  // 关闭时：搜索直接走官方（本脚本官方不可用 → 抛错，且**不出现**三方 attempt 行）；
  // 抓取只走本地跳（固定失败 → 抛错，且**不出现**平台 hop 行）。判定依据是
  // 输出的日志行——若有 `· tinyfish/...` 或 `· hop tinyfish` 出现即为门控失效。
  const searchFailed = await runWithSession('flow-off', toggle, () => search.search({ query: 'anything', maxResults: 3 }))
    .then(() => false, () => true)
  const fetchFailed = await runWithSession('flow-off', toggle, () => fetcher.fetch({ url: 'https://www.npmjs.com/package/@deepseek-ai/dsh' }))
    .then(() => false, () => true)
  check('关闭时搜索不尝试三方（仅官方）', searchFailed, '搜索按官方路径失败（预期：本脚本官方不可用）')
  check('关闭时抓取不尝试平台（仅本地跳）', fetchFailed, '抓取按本地路径失败（预期：本地跳固定失败）')
  console.log('')
}

console.log(results.join('\n'))
const failed = results.filter(entry => entry.startsWith('FAIL')).length
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`)
process.exitCode = failed === 0 ? 0 : 1
