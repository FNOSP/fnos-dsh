import { describe, expect, it } from 'vitest'
import { apiKeyEntryVisible } from '../../src/client/services/account-entry.ts'

describe('API Key 兜底入口的可见性', () => {
  it('未登录时显示', () => {
    expect(apiKeyEntryVisible('signed-out')).toBe(true)
  })

  it('请求出错时也显示（仍属未登录）', () => {
    expect(apiKeyEntryVisible('error')).toBe(true)
  })

  it('授权进行中不显示', () => {
    expect(apiKeyEntryVisible('signing-in')).toBe(false)
  })

  it('已登录与加载中不显示', () => {
    expect(apiKeyEntryVisible('signed-in')).toBe(false)
    expect(apiKeyEntryVisible('loading')).toBe(false)
  })
})
