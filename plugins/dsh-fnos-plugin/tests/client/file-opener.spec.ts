import { describe, expect, it, vi } from 'vitest'
import { openFnosEntry, type EntryOpenerSdk } from '../../src/client/services/file-opener.ts'

/**
 * FNOS-040-01：打开条目时按类型分流到 fnOS 的不同能力。
 *
 * 这条链路的关键不在「调用成功」，而在**不要把目录交给 `openFile`**——目录没有
 * 默认应用，交给文件打开只会失败；也不要在 carrier 未就绪时假装成功，那样用户
 * 会以为面板坏了。
 */

function fakeSdk(overrides: Partial<EntryOpenerSdk> = {}): EntryOpenerSdk & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isWeb: true,
    isStandaloneWeb: false,
    ready: async () => { calls.push('ready') },
    openFile: async (path: string) => { calls.push(`openFile:${path}`) },
    openFileManager: async (path: string) => { calls.push(`openFileManager:${path}`) },
    ...overrides,
  }
}

describe('FNOS-040-01 按条目类型选择打开方式', () => {
  it('目录交给文件管理器定位', async () => {
    const sdk = fakeSdk()
    await openFnosEntry('/vol2/1000/Photos', 'directory', () => sdk)
    expect(sdk.calls).toEqual(['ready', 'openFileManager:/vol2/1000/Photos'])
  })

  it('文件交给 fnOS 的打开/预览能力', async () => {
    const sdk = fakeSdk()
    await openFnosEntry('/vol2/1000/a.pdf', 'file', () => sdk)
    expect(sdk.calls).toEqual(['ready', 'openFile:/vol2/1000/a.pdf'])
  })

  it('先等 carrier 就绪再发起打开', async () => {
    const sdk = fakeSdk()
    await openFnosEntry('/vol2/1000/a.pdf', 'file', () => sdk)
    expect(sdk.calls[0]).toBe('ready')
  })

  it('standalone 模式下明确失败，而不是静默无效', async () => {
    const sdk = fakeSdk({ isStandaloneWeb: true })
    await expect(openFnosEntry('/vol2/1000', 'directory', () => sdk)).rejects.toThrow(/web carrier/u)
    expect(sdk.calls).toEqual(['ready'])
  })

  it('非 web carrier 同样失败', async () => {
    const sdk = fakeSdk({ isWeb: false })
    await expect(openFnosEntry('/vol2/1000', 'directory', () => sdk)).rejects.toThrow(/web carrier/u)
  })

  it('SDK 自身的失败向上抛出，由调用方提示', async () => {
    const sdk = fakeSdk({
      openFile: vi.fn(async () => { throw new Error('fnos rejected') }),
    })
    await expect(openFnosEntry('/vol2/1000/a.pdf', 'file', () => sdk)).rejects.toThrow('fnos rejected')
  })
})
