import { describe, expect, it } from 'vitest'
import { parsePublishedAt } from '../../src/host/date.ts'

describe('FNOS-010-05 发布日期容错解析', () => {
  it('RFC2822（Tavily published_date）转 ISO', () => {
    // Tavily 返回 RFC2822；接缝字段是 provider-supplied ISO-8601。
    expect(parsePublishedAt('Wed, 16 Aug 2026 12:00:00 GMT')).toBe('2026-08-16T12:00:00.000Z')
  })

  it('已经是 ISO-8601 的取值原样规范化为 UTC ISO', () => {
    expect(parsePublishedAt('2026-08-16T12:00:00Z')).toBe('2026-08-16T12:00:00.000Z')
    expect(parsePublishedAt('2026-08-16')).toBe('2026-08-16T00:00:00.000Z')
  })

  it('英文日期（TinyFish date）解析成功', () => {
    expect(parsePublishedAt('Aug 16, 2026')).toBe('2026-08-16T00:00:00.000Z')
    expect(parsePublishedAt('16 Aug 2026')).toBe('2026-08-16T00:00:00.000Z')
  })

  it('相对时间按参考时刻换算', () => {
    const now = new Date('2026-09-30T12:00:00Z')
    expect(parsePublishedAt('1 month ago', now)).toBe('2026-08-30T12:00:00.000Z')
    expect(parsePublishedAt('2 days ago', now)).toBe('2026-09-28T12:00:00.000Z')
    expect(parsePublishedAt('3 hours ago', now)).toBe('2026-09-30T09:00:00.000Z')
    expect(parsePublishedAt('yesterday', now)).toBe('2026-09-29T12:00:00.000Z')
  })

  it('无法解析的取值返回 undefined，由调用方省略 publishedAt', () => {
    // 需求要求「解析失败时按无日期呈现」，不产生乱码或占位错误。
    expect(parsePublishedAt('unknown')).toBeUndefined()
    expect(parsePublishedAt('')).toBeUndefined()
    expect(parsePublishedAt(undefined)).toBeUndefined()
    expect(parsePublishedAt(null)).toBeUndefined()
    expect(parsePublishedAt('最近')).toBeUndefined()
  })
})
