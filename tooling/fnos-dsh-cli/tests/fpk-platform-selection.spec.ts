import { describe, expect, it, vi } from 'vitest'
import type { FpkApp } from '../src/config/workspace.js'

const mocks = vi.hoisted(() => ({
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
}))

vi.mock('@clack/prompts', () => ({
  autocomplete: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: mocks.isCancel,
  multiselect: mocks.multiselect,
  select: vi.fn(),
  text: vi.fn(),
}))

const { selectFpkPlatforms } = await import('../src/commands/build.js')

/**
 * FNOS-044-01：平台选择的三种结果必须可区分。
 *
 * 「显式指定」「没做选择」「取消」是三件事，压成一个 `FpkPlatform[] | undefined` 就分不开：
 * 前两者都要继续构建（后者按 manifest 声明取默认），第三者必须停下来不产出任何包。
 */

const app: FpkApp = {
  name: 'fn-deepseek-harness',
  label: 'DeepSeek Harness',
  platform: 'x86',
  requiresGateway: true,
}

describe('selectFpkPlatforms', () => {
  it('显式 --platform 参数优先，且不进入询问', async () => {
    const result = await selectFpkPlatforms([app], ['--platform', 'arm', '--platform', 'x86'], true)

    expect(result).toEqual({ platforms: ['arm', 'x86'], cancelled: false })
    expect(mocks.multiselect).not.toHaveBeenCalled()
  })

  it('交互执行时追问平台', async () => {
    mocks.multiselect.mockResolvedValueOnce(['arm'])
    const result = await selectFpkPlatforms([app], [], true)

    expect(result).toEqual({ platforms: ['arm'], cancelled: false })
    expect(mocks.multiselect).toHaveBeenCalledTimes(1)
  })

  it('非交互执行不追问：交回「没做选择」，由构建按 manifest 声明取默认', async () => {
    // clack 的 multiselect 在没有 TTY 时不会自己失败，它会画出选项然后永远等一个
    // 不会来的回车。挂住比报错更难查，所以非交互一律不进询问。
    const result = await selectFpkPlatforms([app], [], false)

    expect(result.cancelled).toBe(false)
    expect(result.platforms).toBeUndefined()
    expect(mocks.multiselect).not.toHaveBeenCalled()
  })

  it('取消平台询问视为取消本次 FPK 构建', async () => {
    // 取消不能退化成「没做选择」：那会绕过使用者的意图、按 manifest 声明又打一份包。
    mocks.multiselect.mockResolvedValueOnce(Symbol('cancel'))
    mocks.isCancel.mockImplementationOnce(() => true)

    expect(await selectFpkPlatforms([app], [], true)).toEqual({ cancelled: true })
  })

  it('非法平台取值报错而不是静默忽略', async () => {
    await expect(selectFpkPlatforms([app], ['--platform', 'mips'], false))
      .rejects.toThrow(/Supported platforms: x86, arm/u)
  })
})
