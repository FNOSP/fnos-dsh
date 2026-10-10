/**
 * FNOS-010-11 真实网络验证：本地抓取失败 → 平台兜底取回。
 *
 * 用复合 provider 直接跑：
 * 1. 本地跳用一个必然失败的 stub（模拟 fake-ip DNS 被拒的 WEB_INVALID_URL）；
 * 2. 平台跳用真实 key 调 TinyFish Fetch / Tavily Extract；
 * 3. 断言取回真实正文，且两平台都失败时抛本地错误码。
 *
 * 目标站点用 `TARGET_URL` 覆盖，便于按**站点类型**验证兜底的普适性：
 * 文档站（默认，服务端静态渲染）、代码托管站（JS 重度 + 反爬策略）、
 * 动态应用页等。不同站点类型的抓取难度差异很大，只看一个站点不足以说明能力。
 */
import { WebError } from '@deepseek-ai/dsh-web'
import { CompositeFetchProvider } from '../src/host/fetch-failover-provider.ts'
import { TavilyExtractAdapter, TinyfishFetchAdapter } from '../src/host/fetch-platforms.ts'

const tinyfishKey = process.env.DSH_TINYFISH_KEYS?.split(',')[0] ?? ''
const tavilyKey = process.env.DSH_TAVILY_KEYS?.split(',')[0] ?? ''
// 目标站点：默认文档站；用 TARGET_URL 换其他站点类型重复验证。
const target = process.env.TARGET_URL ?? 'https://docs.tavily.com/documentation/api-reference/endpoint/extract'

const results: string[] = []
const check = (name: string, ok: boolean, detail: string) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

// 1) 本地失败 → TinyFish 兜底
{
  const provider = new CompositeFetchProvider({
    id: 'dsh-failover-search',
    local: { fetch: async () => { throw new WebError('non-public IP blocked', 'WEB_INVALID_URL') } },
    platforms: [{
      platform: 'tinyfish',
      backend: new TinyfishFetchAdapter({ apiKey: tinyfishKey, endpoint: 'https://api.fetch.tinyfish.ai' }),
    }],
  })
  const r = await provider.fetch({ url: target })
  const len = r.body.content.length
  // 阈值 200 字符：足以排除「取回一个空壳/错误页」，又不假设目标站点篇幅。
  check('本地失败 → TinyFish Fetch 取回', len > 200, `${len} 字符，status=${r.statusCode}`)
}

// 2) 本地失败 + TinyFish 不可用 → Tavily 兜底
{
  const provider = new CompositeFetchProvider({
    id: 'dsh-failover-search',
    local: { fetch: async () => { throw new WebError('non-public IP blocked', 'WEB_INVALID_URL') } },
    platforms: [
      { platform: 'tinyfish', backend: { available: () => false, fetch: async () => { throw new Error('skip') } } },
      { platform: 'tavily', backend: new TavilyExtractAdapter({ apiKey: tavilyKey, endpoint: 'https://api.tavily.com/extract' }) },
    ],
  })
  const r = await provider.fetch({ url: target })
  const len = r.body.content.length
  check('TinyFish 不可用 → Tavily Extract 取回', len > 200, `${len} 字符，status=${r.statusCode}`)
}

// 3) 本地成功 → 平台零调用，且**原型方法形状**的本地跳能正常被调用。
//
// 用原型方法（而非箭头函数属性）实现本地跳：官方 `HttpFetchProvider.fetch`
// 就是原型方法，取出裸引用会丢 `this`。复合 provider 用「以属主为接收者的
// 调用闭包」解决该问题，这一项钉住它。
//
// 说明：真实官方 provider 在本机无法完成一次成功取回——本机 DNS 处于代理的
// fake-ip 模式（所有域名解析到 198.18.0.0/15），官方 provider 的公网地址
// 检查会拒绝；即使改用 IP 直连，也会被其重定向策略拦下（实测
// `WEB_REDIRECT_BLOCKED`）。因此「本地成功」这一分支在此环境用等价形状验证。
{
  class PrototypeStyleLocal {
    hits = 0

    available(): boolean {
      return true
    }

    async fetch(request: { url: string }) {
      this.hits += 1
      return { url: request.url, statusCode: 200, body: { kind: 'text' as const, content: 'local ok' }, truncated: false }
    }
  }

  const local = new PrototypeStyleLocal()
  let platformCalls = 0
  const provider = new CompositeFetchProvider({
    id: 'dsh-failover-search',
    local,
    platforms: [{
      platform: 'tinyfish',
      backend: { fetch: async () => { platformCalls += 1; throw new Error('should not reach') } },
    }],
  })
  const r = await provider.fetch({ url: 'https://example.com' })
  check(
    '本地成功 → 平台零调用（原型方法接收者绑定正确）',
    platformCalls === 0 && local.hits === 1 && r.body.content === 'local ok',
    `localHits=${local.hits}, platformCalls=${platformCalls}, content=${r.body.content}`,
  )
}

// 4) 全跳失败 → 抛本地错误码
{
  const provider = new CompositeFetchProvider({
    id: 'dsh-failover-search',
    local: { fetch: async () => { throw new WebError('blocked', 'WEB_INVALID_URL') } },
    platforms: [
      { platform: 'tinyfish', backend: { available: () => false, fetch: async () => { throw new Error('skip') } } },
      { platform: 'tavily', backend: { available: () => false, fetch: async () => { throw new Error('skip') } } },
    ],
  })
  const code = await provider.fetch({ url: target }).then(() => 'NO_THROW', (e: unknown) => (e as { code?: string }).code ?? 'NO_CODE')
  check('全跳失败 → 保留本地错误码', code === 'WEB_INVALID_URL', `code=${code}`)
}

console.log(`目标站点: ${target}`)
console.log(results.join('\n'))
const failed = results.filter(r => r.startsWith('FAIL')).length
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`)
process.exitCode = failed === 0 ? 0 : 1
