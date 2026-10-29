import { describe, expect, it } from 'vitest'
import {
  PICKER_SDK_LOG_PREFIX,
  diagnosePickerResult,
  isPickerCancellation,
  isPickerNoSelection,
  logPickerSdkValue,
} from '../../src/client/input-references/picker-result.ts'

describe('fnOS shared-directory picker result', () => {
  it('treats only documented/explicit close signals as cancellation', () => {
    expect(isPickerCancellation(undefined)).toBe(true)
    expect(isPickerCancellation({ status: 'cancel' })).toBe(true)
    expect(isPickerCancellation({ status: 'canceled' })).toBe(true)
    expect(isPickerCancellation(new DOMException('The picker was closed', 'AbortError'))).toBe(true)
    expect(isPickerCancellation(new Error('用户取消授权'))).toBe(true)
  })

  it('silently treats an empty typed success response as no selection', () => {
    expect(isPickerNoSelection({ code: 0, msg: '', data: [] })).toBe(true)
    expect(isPickerNoSelection({ code: 0, msg: '', data: ['/vol4/share'] })).toBe(false)
    expect(isPickerNoSelection({ code: 1, msg: '仅管理员可进行此操作', data: [] })).toBe(false)
  })

  it('silently treats an explicit active-close bridge response as cancellation', () => {
    expect(isPickerCancellation({ code: 0, msg: '', data: [] })).toBe(false)
    expect(isPickerCancellation({ code: 1, msg: '仅管理员可进行此操作', data: [] })).toBe(false)
    expect(isPickerCancellation({ code: 2, msg: '用户取消选择', data: [] })).toBe(true)
    expect(isPickerCancellation({ code: 2, msg: '', data: [] })).toBe(false)
  })

  it('keeps callback errors, permission errors, and unknown shapes visible', () => {
    expect(isPickerCancellation({ status: 'error', error: 'access_denied', method: 'pickSharedFile' })).toBe(false)
    expect(isPickerCancellation(new Error('permission denied'))).toBe(false)
    expect(isPickerCancellation(null)).toBe(false)
    // 取消文案本身就是取消信号，不要求 data 存在。
    //
    // 旧断言要求「必须同时带空 data 数组」才算取消，但官方契约
    // （`@trimjs/web-app` 的 `AppBridgeResponse`）只声明 `msg: string`，
    // 没有约束 data 必须存在；真机取消时 data 常常缺失或为 null。坚持旧条件
    // 会让取消落到 `code !== 0 → error`，最终被翻成「没有权限」。
    expect(isPickerCancellation({ msg: '用户取消选择' })).toBe(true)
    expect(isPickerCancellation({ code: 2, msg: '用户取消选择', data: ['/vol4/share'] })).toBe(true)
  })

  it('summarizes the response without logging selected NAS paths', () => {
    const entries: unknown[][] = []
    const logger = {
      info: (...data: unknown[]) => entries.push(data),
      warn: (...data: unknown[]) => entries.push(data),
    }

    const diagnosis = logPickerSdkValue('resolved', {
      code: 0,
      msg: 'ok',
      data: ['/vol4/share/projects'],
    }, logger)

    expect(diagnosis).toMatchObject({
      outcome: 'success',
      reason: 'success-code-0',
      data: { kind: 'array', length: 1, itemTypes: ['string'] },
    })
    expect(entries[0]?.[0]).toBe(PICKER_SDK_LOG_PREFIX)
    expect(JSON.stringify(entries)).not.toContain('/vol4/share/projects')
  })

  /**
   * 取消必须与失败分开。
   *
   * 实机反馈：用户点取消却弹出「没有授权该目录的权限」。根因是取消判定要求
   * `data` 恰好是空数组——真机取消时 `data` 常常是 null / 缺失 / 非数组，
   * 条件不成立就落到 `code !== 0 → error`，再被调用方按 `code === 1` 翻成权限错误。
   */
  it.each([
    ['cancel status (official contract)', { status: 'cancel' }],
    ['cancel with non-empty data', { status: 'cancel', data: ['/vol4/x'] }],
    ['cancel message with null data', { code: 1, msg: '用户已取消', data: null }],
    ['cancel message without data field', { code: 1, msg: 'cancelled' }],
    ['cancel message with non-array data', { code: 1, msg: '操作已取消', data: {} }],
    ['english cancel message', { code: 1, msg: 'User cancelled the operation' }],
  ])('treats %s as cancellation', (_label, value) => {
    expect(diagnosePickerResult(value).outcome).toBe('cancelled')
  })

  it('still treats a real permission error as an error, not a cancellation', () => {
    // 只有取消文案 / cancel 状态才算取消；普通业务失败不能被吞成取消。
    const denial = diagnosePickerResult({ code: 1, msg: '仅管理员可进行此操作', data: [] })
    expect(denial.outcome).toBe('error')
    expect(denial.message).toBe('仅管理员可进行此操作')
  })

  it('records the actual shape of an administrator error for diagnostics', () => {
    expect(diagnosePickerResult({ code: 1, msg: '仅管理员可进行此操作', data: [] })).toMatchObject({
      outcome: 'error',
      reason: 'non-zero-code',
      code: 1,
      message: '仅管理员可进行此操作',
      data: { kind: 'array', length: 0 },
    })
  })
})
