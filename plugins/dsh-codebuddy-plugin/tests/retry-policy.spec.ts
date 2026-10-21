import { describe, expect, it } from 'vitest'
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import { CODEBUDDY_RETRY_POLICY, CodeBuddyAdapter } from '../src/host/adapter.ts'

/**
 * `ResolvedRetryPolicy` 是 normal/always 的联合类型，只有 normal 才有
 * `retryableCodes`。先收窄再断言，否则「读错模式下的字段」会在类型层报错——
 * 这里刻意不做 `as any` 绕过，让策略模式本身也成为被断言的事实。
 */
function normalPolicy(): Extract<ResolvedRetryPolicy, { mode: 'normal' }> {
  expect(CODEBUDDY_RETRY_POLICY.mode).toBe('normal')
  return CODEBUDDY_RETRY_POLICY as Extract<ResolvedRetryPolicy, { mode: 'normal' }>
}

/**
 * 本路由必须自带重试策略。
 *
 * 背景（实测）：CodeBuddy 把请求校验失败报成 HTTP 400，响应体只有一句
 * `Invalid request parameters`，**没有业务码**——无法与网关侧的瞬时拒绝区分。
 * 官方默认集合不含该码，一次瞬时 400 就会终止整轮，用户必须手动「继续」。
 * 这些用例把「已纳入重试」与「有界」两件事钉住，避免以后被顺手改回默认集合。
 */
describe('CodeBuddy 路由重试策略', () => {
  it('INVALID_REQUEST 在可重试集合里（瞬时 400 不再终止整轮）', () => {
    expect(normalPolicy().retryableCodes).toContain('INVALID_REQUEST')
  })

  it('保留官方默认集合的全部错误码，不因追加而丢项', () => {
    for (const code of ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']) {
      expect(normalPolicy().retryableCodes).toContain(code)
    }
  })

  it('不把需要用户干预或换号的错误码混进来', () => {
    // 上下文超限换账号也没用；QUOTA 由适配器的换号逻辑处理，重试同一账号只是白耗请求。
    expect(normalPolicy().retryableCodes).not.toContain('CONTEXT_WINDOW_EXCEEDED')
    expect(normalPolicy().retryableCodes).not.toContain('QUOTA')
  })

  /**
   * 内容策略拦截是**确定性**失败：同一份请求内容重发多少次都还是被拦。
   * 它带业务码 11128，因此与 FNOS-020 处理的那类「不带业务码的瞬时 400」
   * 可以区分——后者该重试，前者重试纯属放大无效请求。
   */
  it('账号受限不在可重试集合里（换号才是正确动作）', () => {
    // 重试同一个受限账号毫无意义；它由本层的换号逻辑处理，不是重试。
    expect(normalPolicy().retryableCodes).not.toContain('ACCOUNT_RESTRICTED')
    // 其它 403 同理：换账号比原地重试更有效。
    expect(normalPolicy().retryableCodes).not.toContain('ACCOUNT_FORBIDDEN')
  })

  it('内容策略拦截不在可重试集合里（确定性失败）', () => {
    expect(normalPolicy().retryableCodes).not.toContain('CONTENT_BLOCKED')
    // 拦截与账号健康无关，换号也无用；换号集合只认额度与限流。
    expect(normalPolicy().retryableCodes).not.toContain('AUTH')
  })

  it('重试次数有界（2 次），不是官方的 5 次', () => {
    expect(normalPolicy().maxRetries).toBe(2)
  })

  it('适配器实例暴露该策略（基类默认返回 undefined 会退回官方集合）', () => {
    const policy = (CodeBuddyAdapter.prototype as unknown as {
      providerRetryPolicy(provider: string): unknown
    }).providerRetryPolicy('codebuddy')
    expect(policy).toBe(CODEBUDDY_RETRY_POLICY)
  })
})
