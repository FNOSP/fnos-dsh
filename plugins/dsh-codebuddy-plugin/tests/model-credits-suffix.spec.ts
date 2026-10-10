import { describe, expect, it } from 'vitest'
import type { CodeBuddyModel } from '../src/types/host/types.d.ts'
import { CodeBuddyAdapter } from '../src/host/adapter.ts'

/**
 * 模型名称倍速小尾巴（FNOS-012-01）。
 *
 * DSH 0.2.0-rc.2 起 `ui-model-selection` 不再渲染目录 `description`（上游有意
 * 移除），模型选择器两个面（/model 弹窗与 composer 菜单）都只渲染
 * `model.name`。倍速因此改由 adapter 在名称上直接拼小尾巴承载，本套件锁定
 * 三态：有倍速、未披露、零倍率。
 */

/** 构造一条最小目录条目（listModels 会剔除未披露容量的条目，故两个容量字段必填）。 */
function catalogModel(overrides: Partial<CodeBuddyModel> = {}): CodeBuddyModel {
  return {
    id: 'hy-3',
    name: 'Hy3',
    maxAllowedSize: 128_000,
    maxOutputTokens: 8_192,
    ...overrides,
  } as CodeBuddyModel
}

/** 从适配器取一条目录条目的选择器投影。 */
async function listedModel(model: CodeBuddyModel): Promise<{ name: string, id: string, provider: string } | undefined> {
  const adapter = new CodeBuddyAdapter({
    session: {
      modelsOrEmpty: async () => [model],
    },
    options: () => {
      throw new Error('not used in this suite')
    },
  } as unknown as ConstructorParameters<typeof CodeBuddyAdapter>[0])
  const models = await adapter.listModels('codebuddy')
  return models[0]
}

describe('模型名称倍速小尾巴', () => {
  it('有倍速的模型：名称后缀 · 倍率', async () => {
    const listed = await listedModel(catalogModel({ credits: 'x3.33' }))
    expect(listed?.name).toBe('Hy3 · x3.33')
    expect(listed?.id).toBe('hy-3')
  })

  it('目录未披露倍速：保持原名称，不编造数值', async () => {
    expect((await listedModel(catalogModel()))?.name).toBe('Hy3')
    // 显式空白等价缺省。
    expect((await listedModel(catalogModel({ credits: '  ' })))?.name).toBe('Hy3')
  })

  it('零倍率模型照常展示 x0.00——零倍率是有效事实', async () => {
    expect((await listedModel(catalogModel({ credits: 'x0.00' })))?.name).toBe('Hy3 · x0.00')
  })

  it('倍速只影响展示：模型 id 不变，请求路由不受影响', async () => {
    const listed = await listedModel(catalogModel({ credits: 'x0.05' }))
    expect(listed?.id).toBe('hy-3')
    expect(listed?.provider).toBe('codebuddy')
  })
})
