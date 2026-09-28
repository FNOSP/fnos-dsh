import { describe, expect, it, vi } from 'vitest'
import type { FpkApp } from '../src/config/workspace.js'

const mocks = vi.hoisted(() => ({
  multiselect: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: mocks.multiselect,
  select: vi.fn(),
}))

const { askFpkApps } = await import('../src/ui/prompts.js')

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
