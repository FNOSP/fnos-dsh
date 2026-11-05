import { describe, expect, it } from 'vitest'
import { assertNodeFloor, compareNodeVersion, parseNodeVersion } from '../src/install-callback-helper/node-version.ts'
import { InstallHelperError } from '../src/install-callback-helper/logger.ts'

describe('FNOS-046 install-time Node floor', () => {
  it('parses three-part versions with or without the v prefix', () => {
    expect(parseNodeVersion('v24.15.0')).toEqual([24, 15, 0])
    expect(parseNodeVersion('24.9.0')).toEqual([24, 9, 0])
    expect(parseNodeVersion('garbage')).toBeUndefined()
    expect(parseNodeVersion('')).toBeUndefined()
  })

  it('orders versions numerically instead of lexically', () => {
    // 词法比较会把 24.10.0 判成小于 24.9.0，是这类门禁最常见的实现错误。
    expect(compareNodeVersion('24.10.0', '24.9.0')).toBe(1)
    expect(compareNodeVersion('24.9.0', '24.9.0')).toBe(0)
    expect(compareNodeVersion('24.8.9', '24.9.0')).toBe(-1)
    expect(compareNodeVersion('23.99.0', '24.9.0')).toBe(-1)
    expect(compareNodeVersion('nonsense', '24.9.0')).toBeUndefined()
  })

  it('accepts a runtime at or above the floor', () => {
    expect(() => assertNodeFloor('24.9.0', 'v24.15.0')).not.toThrow()
    expect(() => assertNodeFloor('24.9.0', 'v24.9.0')).not.toThrow()
  })

  it('rejects a runtime below the floor with an actionable message', () => {
    expect(() => assertNodeFloor('24.9.0', 'v24.8.1')).toThrow(InstallHelperError)
    expect(() => assertNodeFloor('24.9.0', 'v24.8.1')).toThrow(/nodejs_v24/u)
    expect(() => assertNodeFloor('24.9.0', 'v24.8.1')).toThrow(/24\.8\.1/u)
    expect(() => assertNodeFloor('24.9.0', 'v24.8.1')).toThrow(/>= 24\.9\.0/u)
  })

  it('rejects unparsable input on either side', () => {
    expect(() => assertNodeFloor('24.9.0', 'unknown')).toThrow(InstallHelperError)
    expect(() => assertNodeFloor('not-a-version', 'v24.15.0')).toThrow(InstallHelperError)
  })
})
