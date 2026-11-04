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

const { askBuildSelection, askFpkApps, askFpkPlatforms, bumpBaseline } = await import('../src/ui/prompts.js')

const app: FpkApp = {
  name: 'fn-deepseek-harness',
  label: 'DeepSeek Harness',
  platform: 'x86',
  requiresGateway: true,
}

/** 清单没写 `platform` 的应用：`exactOptionalPropertyTypes` 下不能靠传 undefined 构造。 */
const appWithoutPlatform: FpkApp = {
  name: 'fn-no-platform',
  label: 'No Platform',
  requiresGateway: false,
}

describe('FPK application prompts', () => {
  it('selects the only FPK application without opening an interactive prompt', async () => {
    const selected = await askFpkApps([app])

    expect(selected).toEqual([app])
    expect(mocks.multiselect).not.toHaveBeenCalled()
  })
})

describe('构建任务选项顺序（FNOS-044-05）', () => {
  it('fnOS FPK 在前、项目文档居中、Harness 插件最后一行', async () => {
    mocks.multiselect.mockResolvedValueOnce(['fpk'])
    await askBuildSelection()

    const options = mocks.multiselect.mock.lastCall?.[0]?.options as Array<{ value: string }>
    expect(options.map(option => option.value)).toEqual(['fpk', 'docs', 'plugins'])
  })
})

describe('FPK 平台选择（FNOS-044-01）', () => {
  it('默认勾选 manifest 声明的平台', async () => {
    mocks.multiselect.mockResolvedValueOnce(['x86'])
    const platforms = await askFpkPlatforms([app])

    expect(platforms).toEqual(['x86'])
    const config = mocks.multiselect.mock.lastCall?.[0] as { initialValues?: string[], options: Array<{ value: string }> }
    expect(config.initialValues).toEqual(['x86'])
    expect(config.options.map(option => option.value)).toEqual(['x86', 'arm'])
  })

  it('多选两个平台时按选择顺序返回', async () => {
    mocks.multiselect.mockResolvedValueOnce(['arm', 'x86'])
    expect(await askFpkPlatforms([app])).toEqual(['arm', 'x86'])
  })

  it('应用未声明平台时不预勾任何值，交回使用者选择', async () => {
    // 猜一个默认值会让交互路径凭空产出「包内没有依据」的平台声明，
    // 而非交互路径同样情况是报错——两条路必须同判。
    mocks.multiselect.mockResolvedValueOnce(['x86'])
    await askFpkPlatforms([appWithoutPlatform])

    expect(mocks.multiselect.mock.lastCall?.[0]?.initialValues).toEqual([])
  })

  it('清单声明了不能作为构建目标的平台时不预勾', async () => {
    // `all` 是 manifest 合法值，但不是构建目标；预勾上它等于让使用者选完再吃一次失败。
    mocks.multiselect.mockResolvedValueOnce(['x86'])
    await askFpkPlatforms([{ ...app, platform: 'all' }])

    expect(mocks.multiselect.mock.lastCall?.[0]?.initialValues).toEqual([])
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
