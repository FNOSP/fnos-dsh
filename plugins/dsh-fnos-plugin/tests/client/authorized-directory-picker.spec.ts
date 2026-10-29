import { describe, expect, it, vi } from 'vitest'

/**
 * 授权选择器的结果折叠。
 *
 * 实机反馈：用户点取消却弹出「没有授权该目录的权限」。这条链路上有两处会把
 * 取消说成失败，都在本文件覆盖范围内：
 *
 *  1. 取消信号要求 `data` 恰好是空数组（真机常常没有 data）；
 *  2. 失败原因用 `code === 1` 判权限（该码在部分版本里也用于普通取消失败）。
 *
 * 判定原则：**宁可不报错，也不要把用户主动取消说成失败**——后者会弹出一条
 * 他无法理解的提示。
 */

const pickSharedFile = vi.fn()

vi.mock('../../src/client/services/sdk.ts', () => ({
  createTrimApp: () => ({
    ready: async () => undefined,
    pickSharedFile,
  }),
}))

const { pickAuthorizedDirectory } = await import('../../src/client/services/authorized-directory-picker.ts')

const options = { title: '授权', okText: '确定' }

describe('FNOS-034 授权选择器：取消不报错', () => {
  it.each([
    ['SDK 返回 undefined', () => Promise.resolve(undefined)],
    ['官方 cancel 状态', () => Promise.resolve({ status: 'cancel' })],
    ['取消文案但 data 为 null', () => Promise.resolve({ code: 1, msg: '用户已取消', data: null })],
    ['取消文案但无 data 字段', () => Promise.resolve({ code: 1, msg: 'cancelled' })],
    ['取消文案但 data 非数组', () => Promise.resolve({ code: 1, msg: '操作已取消', data: {} })],
    ['抛 AbortError', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
    ['抛带取消文案的异常', () => Promise.reject(new Error('user cancelled'))],
  ])('%s → cancelled（不产生任何提示）', async (_label, impl) => {
    pickSharedFile.mockImplementationOnce(impl)
    await expect(pickAuthorizedDirectory(options)).resolves.toEqual({ status: 'cancelled' })
  })
})

describe('FNOS-034 授权选择器：真实失败仍要有原因', () => {
  it('官方 access_denied 归为权限问题', async () => {
    pickSharedFile.mockResolvedValueOnce({ status: 'error', error: 'access_denied' })
    const outcome = await pickAuthorizedDirectory(options)
    expect(outcome).toMatchObject({ status: 'failed', code: 'fnos-authorized-directory-permission-denied' })
  })

  it('code === 1 不再一律当权限问题', async () => {
    // 该码在部分 fnOS 版本里只是普通失败，硬判权限会给出误导性文案。
    pickSharedFile.mockResolvedValueOnce({ code: 1, msg: '接口异常', data: [] })
    const outcome = await pickAuthorizedDirectory(options)
    expect(outcome).toMatchObject({ status: 'failed', code: 'fnos-authorized-directory-request-failed' })
  })
})

describe('FNOS-034 授权选择器：成功路径', () => {
  it.each([
    ['data 里的路径', { code: 0, msg: '', data: ['/vol4/share'] }, '/vol4/share'],
    ['裸路径字符串', '/vol4/share', '/vol4/share'],
    ['paths 数组', { paths: ['/vol4/share'] }, '/vol4/share'],
  ])('%s 返回 picked', async (_label, value, expected) => {
    pickSharedFile.mockResolvedValueOnce(value)
    await expect(pickAuthorizedDirectory(options)).resolves.toEqual({ status: 'picked', path: expected })
  })

  it('code 0 但没选任何目录 → cancelled', async () => {
    pickSharedFile.mockResolvedValueOnce({ code: 0, msg: '', data: [] })
    await expect(pickAuthorizedDirectory(options)).resolves.toEqual({ status: 'cancelled' })
  })
})
