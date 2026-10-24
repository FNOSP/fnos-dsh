import { describe, expect, it } from 'vitest'
import {
  ZCODE_DETAIL_ID,
  ZCODE_DETAIL_SLOT,
  ZCODE_PACKAGE_NAME,
  ZCODE_USAGE_ID,
  ZCODE_USAGE_SLOT,
  isZCodeBundleSubject,
} from '../../src/client/services/registration.ts'

describe('座位注册', () => {
  it('详情页座位是 plugins.detail.section', () => {
    expect(ZCODE_DETAIL_SLOT).toBe('plugins.detail.section')
    expect(ZCODE_USAGE_SLOT).toBe('conversation.input.right')
    expect(ZCODE_DETAIL_ID).not.toBe(ZCODE_USAGE_ID)
  })

  it('只认本插件组合包的详情页', () => {
    expect(isZCodeBundleSubject({ kind: 'bundle', pkg: { name: ZCODE_PACKAGE_NAME } })).toBe(true)
    expect(isZCodeBundleSubject({ kind: 'bundle', pkg: { name: '@tnnevol/dsh-opencode' } })).toBe(false)
    expect(isZCodeBundleSubject({ kind: 'plugin', pkg: { name: ZCODE_PACKAGE_NAME } })).toBe(false)
    expect(isZCodeBundleSubject({ kind: 'bundle' })).toBe(false)
    expect(isZCodeBundleSubject(undefined)).toBe(false)
  })
})
