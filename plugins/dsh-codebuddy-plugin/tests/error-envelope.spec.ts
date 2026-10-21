import { describe, expect, it } from 'vitest'
import { wireErrorMessage, wireErrorDetail } from '../src/host/types.ts'
import { httpErrorCode } from '../src/host/adapter.ts'

/**
 * CodeBuddy 的错误信封与 OpenAI 不同，实测两种形态（均不兼容 `error.message`）：
 *
 *   ① 扁平：{"code":6004,"msg":"您的使用量已超出频率限制，将在 … 重置，您也可以切换其他模型继续使用。"}
 *   ② 嵌套：{"error":{"data":{"code":14017,"msg":"体验版尚未激活。…"}}}
 *
 * 只读 `error.message` 会丢掉服务端原文，用户只看到兜底的
 * `CodeBuddy API error (HTTP 429)` —— 而原文里写着何时重置、可换哪个模型。
 */
const FLAT = {
  code: 6004,
  msg: '您的使用量已超出频率限制，将在 2026-09-11 19:24:44 UTC+8 重置，您也可以切换其他模型继续使用。',
  requestId: '0f0bddda-b97a-4956-8cbe-871f9ea7ec9',
}
const NESTED = {
  error: { data: { code: 14017, msg: '体验版尚未激活。请退出当前账号后重新登录，即可立即激活并开始免费体验。', requestId: 'b8b020dc' } },
}
const OPENAI = { error: { message: 'rate limited', type: 'rate_limit', code: '429' } }

describe('wireErrorMessage：三种形态都能取到原文', () => {
  it('扁平形态（顶层 msg）', () => {
    expect(wireErrorMessage(FLAT)).toContain('您的使用量已超出频率限制')
    expect(wireErrorMessage(FLAT)).toContain('19:24:44')
  })

  it('嵌套形态（error.data.msg）', () => {
    expect(wireErrorMessage(NESTED)).toContain('体验版尚未激活')
  })

  it('OpenAI 兼容形态（error.message）', () => {
    expect(wireErrorMessage(OPENAI)).toBe('rate limited')
  })

  it('优先级：OpenAI message 优先于 CodeBuddy 字段', () => {
    const both = { error: { message: 'openai', data: { msg: 'codebuddy' } }, msg: 'flat' }
    expect(wireErrorMessage(both)).toBe('openai')
  })

  it('空串/空白不算有效文案（回退到调用方的兜底）', () => {
    expect(wireErrorMessage({ msg: '' })).toBeUndefined()
    expect(wireErrorMessage({ msg: '   ' })).toBeUndefined()
    expect(wireErrorMessage({})).toBeUndefined()
    expect(wireErrorMessage(undefined)).toBeUndefined()
  })
})

describe('wireErrorDetail：分类文本带上业务码', () => {
  it('含业务 code 与文案（DSH 的英文正则匹配不上中文，code 是补充依据）', () => {
    const detail = wireErrorDetail(FLAT)
    expect(detail).toContain('6004')
    expect(detail).toContain('您的使用量已超出频率限制')
  })

  it('嵌套形态的 code 也能取到', () => {
    expect(wireErrorDetail(NESTED)).toContain('14017')
  })

  it('空体返回空串（不是 "undefined" 字样）', () => {
    expect(wireErrorDetail(undefined)).toBe('')
    expect(wireErrorDetail({})).toBe('')
  })
})

describe('httpErrorCode 的分类', () => {
  it('401 → AUTH；其它 403 → ACCOUNT_FORBIDDEN（可换号）', () => {
    // 401 = 凭据本身不被接受（鉴权失败）；
    // 403 = 上游拒绝这次请求，换账号可继续，因此独立成码并进入换号集合。
    // 内容拦截与账号受限都在此之前按业务码分流，不会落到这里。
    expect(httpErrorCode(401, FLAT)).toBe('AUTH')
    expect(httpErrorCode(403, undefined)).toBe('ACCOUNT_FORBIDDEN')
  })

  it('429 + 业务码 6004 → QUOTA（账号×模型额度耗尽，需换账号）', () => {
    /**
     * 实测 6004 = 账号 × 模型的额度用尽（同一账号换模型即 200、别的账号同模型也
     * 200）。必须归 QUOTA 才能触发**换账号**；归 RATE_LIMIT 只会让外层原地重试
     * 同一账号同一模型——在重置之前不可能成功。
     */
    expect(httpErrorCode(429, FLAT)).toBe('QUOTA')
  })

  it('429 但无业务码 → RATE_LIMIT（保守：不确定是否换号有效）', () => {
    expect(httpErrorCode(429, { msg: 'too many requests' })).toBe('RATE_LIMIT')
    expect(httpErrorCode(429, undefined)).toBe('RATE_LIMIT')
  })

  it('嵌套形态里的 6004 同样识别', () => {
    expect(httpErrorCode(429, { error: { data: { code: 6004, msg: '超额' } } })).toBe('QUOTA')
  })

  it('400 + 上下文超限文案 → CONTEXT_WINDOW_EXCEEDED', () => {
    expect(httpErrorCode(400, { error: { message: 'context window exceeded' } }))
      .toBe('CONTEXT_WINDOW_EXCEEDED')
  })

  it('400 其它 → INVALID_REQUEST', () => {
    expect(httpErrorCode(400, { msg: '参数不合法' })).toBe('INVALID_REQUEST')
  })

  /**
   * 内容策略拦截：判决依据是**业务码**，不是状态码也不是文案。
   *
   * 实测两种状态码都出现过（400 与 403，视上游节点而定），而 403 与鉴权失败同码，
   * 因此必须在按状态分派之前按业务码识别——否则 403 的拦截会被误判成 AUTH。
   */
  it('业务码 11128 → CONTENT_BLOCKED（400 与 403 都识别）', () => {
    const blocked = { code: 11128, msg: 'Illegal API invocation from an unapproved channel' }
    expect(httpErrorCode(400, blocked)).toBe('CONTENT_BLOCKED')
    expect(httpErrorCode(403, blocked)).toBe('CONTENT_BLOCKED')
  })

  it('嵌套信封里的 11128 同样识别', () => {
    expect(httpErrorCode(400, { error: { data: { code: 11128, msg: 'blocked' } } }))
      .toBe('CONTENT_BLOCKED')
    expect(httpErrorCode(400, { error: { code: '11128', message: 'blocked' } }))
      .toBe('CONTENT_BLOCKED')
  })

  /**
   * 账号被上游限制：403 + 业务码 11140 + `request illegal`。
   *
   * 它必须独立于 `AUTH`：鉴权失败要重新登录（且不换号），受限账号则是**换号即可
   * 恢复**，两者对用户与对故障转移的意义完全不同。
   */
  it('业务码 11140 + request illegal → ACCOUNT_RESTRICTED', () => {
    const restricted = { code: 11140, msg: 'request illegal' }
    expect(httpErrorCode(403, restricted)).toBe('ACCOUNT_RESTRICTED')
  })

  /**
   * 同一个业务码还承载「模型级限流」形态：那种文案不含 `request illegal`，
   * 应归 `RATE_LIMIT`（限流，不是封禁）。只按码判定会把限流误报成受限。
   */
  it('业务码 11140 但文案是模型级限流 → 仍按限流处理', () => {
    const modelRate = { code: 11140, msg: 'The model provider is busy, please retry later' }
    expect(httpErrorCode(400, modelRate)).toBe('INVALID_REQUEST')
    expect(httpErrorCode(429, modelRate)).toBe('RATE_LIMIT')
  })

  /**
   * 其它 403：上游拒绝这次请求，但既不是内容拦截也不是账号受限。
   * 它同样只针对当前账号，换号可继续——与 `AUTH` 分开才能进入换号集合。
   */
  it('无业务码的 403 → ACCOUNT_FORBIDDEN', () => {
    expect(httpErrorCode(403, undefined)).toBe('ACCOUNT_FORBIDDEN')
    expect(httpErrorCode(403, { msg: 'forbidden' })).toBe('ACCOUNT_FORBIDDEN')
  })

  /** 403 上的两类已知形态必须先被业务码分流，不能落进「其它 403」。 */
  it('403 上的内容拦截与账号受限仍走各自的分支', () => {
    const blocked = { code: 11128, msg: 'Illegal API invocation from an unapproved channel' }
    const restricted = { code: 11140, msg: 'request illegal' }
    expect(httpErrorCode(403, blocked)).toBe('CONTENT_BLOCKED')
    expect(httpErrorCode(403, restricted)).toBe('ACCOUNT_RESTRICTED')
    expect(httpErrorCode(403, blocked)).not.toBe('ACCOUNT_FORBIDDEN')
    expect(httpErrorCode(403, restricted)).not.toBe('ACCOUNT_FORBIDDEN')
  })

  it('受限不被误判为鉴权失败或内容拦截', () => {
    const restricted = { code: 11140, msg: 'request illegal' }
    expect(httpErrorCode(403, restricted)).not.toBe('AUTH')
    expect(httpErrorCode(403, restricted)).not.toBe('CONTENT_BLOCKED')
    // 401 仍必须是鉴权失败：token 真的无效时要让上层丢弃内存凭据。
    expect(httpErrorCode(401, { msg: 'unauthorized' })).toBe('AUTH')
  })

  it('内容拦截不被误判为额度或请求非法', () => {
    // 三者都是 400/403 家族，但处理方式完全不同：拦截不重试、不换号；
    // 额度换号；请求非法重试。分类错了就会触发错误的恢复动作。
    const blocked = { code: 11128, msg: 'Illegal API invocation from an unapproved channel' }
    expect(httpErrorCode(400, blocked)).not.toBe('INVALID_REQUEST')
    expect(httpErrorCode(400, blocked)).not.toBe('QUOTA')
    expect(httpErrorCode(403, blocked)).not.toBe('AUTH')
  })

  it('5xx → SERVER', () => {
    expect(httpErrorCode(503, undefined)).toBe('SERVER')
  })

  it('英文的额度耗尽文案能被 DSH 正则识别为 QUOTA', () => {
    expect(httpErrorCode(400, { error: { message: 'insufficient quota' } }))
      .toBe('QUOTA')
  })
})
