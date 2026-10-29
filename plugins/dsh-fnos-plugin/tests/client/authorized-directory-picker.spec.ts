import { readFileSync } from 'node:fs'
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

describe('FNOS-034 授权选择器：选择阶段异常一律静默', () => {
  /**
   * 与插件设置页对齐。
   *
   * 设置页的既有实现是「`pickSharedFile` 阶段抛异常就静默返回」，它从未出现
   * 「取消却提示无权限」；面板走新服务，只在识别到取消时静默，其余弹提示——
   * 两者唯一的结构差异就在这。原生选择器是独立窗口，它能抛出的异常只有
   * 「用户关掉了它」，真正的授权失败走正常返回（`status: 'error'`），因此
   * 这里放宽不会掩盖真实错误。
   */
  it.each([
    ['普通 Error', new Error('something went wrong')],
    ['短 message 的 Error', new Error('x')],
    ['非 Error 对象', { reason: 'unknown' }],
    ['字符串', 'boom'],
    ['code: 1 的对象', { code: 1, msg: '' }],
  ])('抛 %s 时静默为 cancelled', async (_label, thrown) => {
    pickSharedFile.mockRejectedValueOnce(thrown)
    await expect(pickAuthorizedDirectory(options)).resolves.toEqual({ status: 'cancelled' })
  })

  it('但真正走返回值的权限失败仍要报出来', async () => {
    // 异常路径放宽后，必须确认返回值路径没有被一起放宽。
    pickSharedFile.mockResolvedValueOnce({ status: 'error', error: 'access_denied' })
    const outcome = await pickAuthorizedDirectory(options)
    expect(outcome).toMatchObject({ status: 'failed', code: 'fnos-authorized-directory-permission-denied' })
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

describe('FNOS-034 授权选择器：可观测性', () => {
  it('记录创建、返回与异常三个阶段的日志', () => {
    // 本地无法复现真机取消/失败的 shape，这条日志是唯一一手证据。
    const source = readFileSync(new URL('../../src/client/services/authorized-directory-picker.ts', import.meta.url), 'utf8')
    expect(source).toContain("logPickerSdkEvent('created'")
    expect(source).toContain("logPickerSdkValue('resolved'")
    expect(source).toContain("logPickerSdkValue('rejected'")
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

  it.each([
    ['code 0 + 空数组', { code: 0, msg: '', data: [] }],
    ['code 0 + data 为 null', { code: 0, msg: '', data: null }],
    ['code 0 + 无 data 字段', { code: 0, msg: '' }],
    ['code 0 + data 是无路径对象', { code: 0, msg: '', data: {} }],
    ['code 0 + 空字符串 data', { code: 0, msg: '', data: '' }],
  ])('取不到路径（%s）→ cancelled，不提示', async (_label, value) => {
    // 语义上「成功必然带路径」，所以 code 0 却拿不到路径只能是用户没选。
    // 真机取消形态比契约更杂，硬判失败会弹「无法授权」。
    pickSharedFile.mockResolvedValueOnce(value)
    await expect(pickAuthorizedDirectory(options)).resolves.toEqual({ status: 'cancelled' })
  })
})
