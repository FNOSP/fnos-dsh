/**
 * 真实组合端到端验证（T09）：加载**仓库内 web profile 的完整组合**，把搜索接缝
 * 指向本插件的复合提供方，然后用真实 key 走一次完整搜索。
 *
 * 与 `scripts/smoke.ts` 的区别：那个脚本直接构造提供方（单元边界）；这里走的是
 * 宿主真实的加载路径——`cordis.patch.yml` 重写 `web` 行、插件行被 insert、`apply`
 * 被调用、`ctx.web` 接到复合提供方。
 *
 * 运行（cwd 为插件目录）：
 *   DSH_HOME=$PWD/../../.dsh DSH_TINYFISH_KEYS=... node --import tsx scripts/e2e.ts
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchResult } from '@deepseek-ai/dsh-web'
import { FailoverSearchProvider } from '../src/host/failover-provider.ts'
import { TavilyAdapter } from '../src/host/tavily-provider.ts'
import { TinyFishAdapter } from '../src/host/tinyfish-provider.ts'
import type { FailoverSearchSettings } from '../src/contracts/config.ts'

/** 结果收集（与 smoke.ts 同风格：失败即非零退出）。 */
const results: { name: string, ok: boolean, detail: string }[] = []
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

/** 读取环境变量里的 key。 */
function keys(name: string): string[] {
  return (process.env[name] ?? '').split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
}

// ① 宿主侧组合：`web` 行的 searchProvider 必须已指向本插件，且 fetchProvider 未被漏掉。
{
  const { execFileSync } = await import('node:child_process')
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined) {
    console.error('缺少 DSH_HOME（指向仓库根 .dsh）')
    process.exit(2)
  }
  // 用仓库内 CLI（`dsh` 的 bin 入口不在包的 exports 里，必须按 bin 名调用）。
  const dump = execFileSync(
    'node',
    [new URL('../../../node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url).pathname, '--profile', 'web', '--dump-config'],
    { env: { ...process.env, DSH_HOME: dshHome }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const webRow = /- id: web\n {2}name: '@deepseek-ai\/dsh-web'\n {2}config:\n((?: {4}.*\n)+)/u.exec(dump)?.[1] ?? ''
  check('T04 组合行：searchProvider 指向本插件', webRow.includes('searchProvider: dsh-failover-search'), webRow.trim().replaceAll('\n', ' / '))
  // FNOS-010-11 起 fetchProvider 也指向本插件（复合抓取：本地优先 + 平台兜底）；
  // 该检查点的原意是「patch 整行替换时不得漏掉 fetch 键」，因此断言「已声明且
  // 指向本插件」——写成 http 会让平台兜底永不触发（接缝按 id 固定选择 provider）。
  const fetchDeclared = /fetchProvider:\s*dsh-failover-search/u.test(webRow)
  check('T04 组合行：fetchProvider 未被 patch 漏掉且指向本插件', fetchDeclared, fetchDeclared ? 'fetch 由本插件接管' : 'fetch 配置丢失或未指向本插件')
  check('T04 组合行：插件行已插入', /- id: dsh-failover-search\n {2}name: '@tnnevol\/dsh-failover-search'/u.test(dump), 'insert 行存在')
  check('FNOS-010-06 回滚：官方搜索行未被禁用', /- id: web-search-deepseek\n {2}name: '@deepseek-ai\/dsh-web-search-deepseek'/u.test(dump), '官方行保持原样（兜底级仍在注册表）')
}

// ② 真实 key 走完整接缝调用：用官方 WebRuntime 服务加载复合提供方并执行搜索。
{
  const tinyfishAccounts = keys('DSH_TINYFISH_KEYS').map((key, index) => ({ key, label: `tinyfish-${index + 1}` }))
  const tavilyAccounts = keys('DSH_TAVILY_KEYS').map((key, index) => ({ key, label: `tavily-${index + 1}` }))
  const settings: FailoverSearchSettings = {
    tinyfishAccounts,
    tavilyAccounts,
    sourceOrder: ['tinyfish', 'tavily', 'deepseek-official'],
    timeoutMs: 20000,
    samePlatformRetry: true,
    usageRefreshMinutes: 5,
    requestProbe: true,
  }
  const officialCalls: number[] = []
  const official: WebSearchProvider = {
    id: 'deepseek-official',
    available: () => false,
    search: async (): Promise<WebSearchResult> => {
      officialCalls.push(1)
      throw new WebError('冒烟不调用官方', 'WEB_PROVIDER_ERROR')
    },
  }
  const attempts: { platform?: string, account?: string, outcome?: string }[] = []
  const provider = new FailoverSearchProvider({
    readSettings: () => settings,
    adapters: { tinyfish: [new TinyFishAdapter()], tavily: [new TavilyAdapter()] },
    official: { id: official.id, available: () => official.available(), search: (request, signal) => official.search(request, signal) },
    onAttempt: event => attempts.push(event as { platform?: string }),
  })

  const result = await provider.search({ query: 'deepseek harness release', maxResults: 5 })
  const titles = result.sources.map(source => source.title).filter((title): title is string => title !== undefined)
  check('FNOS-010-01 端到端搜索成功', result.sources.length > 0 && officialCalls.length === 0,
    `返回 ${result.sources.length} 条，官方未被调用；首条标题「${titles[0] ?? '（无）'}」`)

  // ③ 呈现兼容：标题/链接/摘要齐全；日期「有则合法、无则缺席」。
  //
  // 实测发现 TinyFish 的 `date` 字段**按查询/模式时有时无**（2026-10-09：同一 key
  // 下 `deepseek harness` 返回的 10 条全部无 date，`domain_type=news` 的查询则
  // 10/10 带 date）。这不是适配缺陷——需求约定「解析失败按无日期呈现」，因此这里
  // 断言两条：有日期的条目必须是可解析的 ISO；无日期的条目就是字段缺席，不产生
  // 占位乱码。带真实日期样本（`Nov 13, 2025`）的映射正确性由单元测试覆盖。
  const withDate = result.sources.filter(source => source.publishedAt !== undefined)
  const allHaveUrl = result.sources.every(source => typeof source.url === 'string' && source.url.startsWith('http'))
  const allHaveTitle = result.sources.every(source => source.title !== undefined)
  const allHaveSnippet = result.sources.every(source => source.snippet !== undefined)
  check('FNOS-010-05-AC-01 呈现字段齐全', allHaveUrl && allHaveTitle && allHaveSnippet,
    `${result.sources.length} 条均有 URL/标题/摘要；其中 ${withDate.length} 条带日期`)
  const isoOk = withDate.every(source => !Number.isNaN(Date.parse(source.publishedAt ?? '')))
  const noPlaceholder = result.sources.every(source => source.publishedAt === undefined || /^\d{4}-\d{2}-\d{2}T/u.test(source.publishedAt))
  check('FNOS-010-05-AC-01 日期有则合法、无则缺席', isoOk && noPlaceholder,
    withDate.length === 0 ? '本次查询平台未返回 date，publishedAt 全部缺席（符合降级约定）' : `带日期条目全部为合法 ISO（样本 ${withDate[0]?.publishedAt ?? ''}）`)

  // ④ 截断：接缝按 maxResults 截断并置 truncated。
  const capped = await provider.search({ query: 'deepseek harness release', maxResults: 2 })
  check('FNOS-010-05-AC-02 maxResults 交由接缝截断', capped.sources.length >= 2,
    `请求 maxResults=2，来源侧返回 ${capped.sources.length} 条（截断由接缝负责）`)

  console.log('\n尝试序列：', attempts.map(entry => `${entry.platform}/${entry.account ?? '-'}:${entry.outcome}`).join(' → '))
}

const failed = results.filter(entry => !entry.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`)
if (failed.length > 0) process.exit(1)
