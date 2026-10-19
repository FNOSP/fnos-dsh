import { describe, expect, it, vi } from 'vitest'
import type { FpkApp } from '../src/config/workspace.js'

const mocks = vi.hoisted(() => ({
  multiselect: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  autocomplete: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: mocks.multiselect,
  select: vi.fn(),
  text: vi.fn(),
}))

const { askFpkApps, bumpBaseline } = await import('../src/ui/prompts.js')

const app: FpkApp = {
  name: 'fn-deepseek-harness',
  label: 'DeepSeek Harness',
  requiresGateway: true,
}

describe('FPK application prompts', () => {
  it('selects the only FPK application without opening an interactive prompt', async () => {
    const selected = await askFpkApps([app])

    expect(selected).toEqual([app])
    expect(mocks.multiselect).not.toHaveBeenCalled()
  })
})

describe('bumpBaseline：基线建议值', () => {
  // 建议值用于「切换 DSH 基线」的输入框 placeholder，按 Tab 会填进输入框。
  // DSH 通常在同一个 minor 内连续推 rc，所以只递增最后一段。
  it('递增 rc 序号，保留前缀', () => {
    expect(bumpBaseline('0.2.1-rc.2')).toBe('0.2.1-rc.3')
    expect(bumpBaseline('0.2.1-rc.9')).toBe('0.2.1-rc.10')
    expect(bumpBaseline('0.2.1-rc.10')).toBe('0.2.1-rc.11')
  })

  it('带其他预发布标签时同样只动末段数字', () => {
    expect(bumpBaseline('0.2.1-alpha.5')).toBe('0.2.1-alpha.6')
  })

  it('换 minor 的基线取该 minor 的下一个 rc', () => {
    expect(bumpBaseline('0.2.2-rc.1')).toBe('0.2.2-rc.2')
  })

  it('末段不是数字时原样返回（placeholder 退化为当前值，用户可自行输入）', () => {
    // `1.0.0-beta` 没有 rc 序号可递增；原样返回比猜一个更安全。
    expect(bumpBaseline('1.0.0-beta')).toBe('1.0.0-beta')
  })

  it('无预发布段的正式版递增 patch 位', () => {
    // `0.2.1` → `0.2.2`：这是「下一个版本」的合理猜测；用户看到建议值后仍可改。
    expect(bumpBaseline('0.2.1')).toBe('0.2.2')
  })
})
