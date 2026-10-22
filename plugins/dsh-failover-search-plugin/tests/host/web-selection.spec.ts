import { describe, expect, it } from 'vitest'
import { FAILOVER_PROVIDER_ID, WEB_SETTINGS_NAMESPACE } from '../../src/contracts/constants.ts'
import { ensureWebSelection } from '../../src/host/web-selection.ts'
import type { SettingsEntryLike, SettingsFormsLike } from '../../src/host/web-selection.ts'

/**
 * 构造一个 settings 替身：记录 describe/update 的调用。
 *
 * @param entries - describe() 要返回的条目。
 * @param options - 替身选项。
 * @param options.failUpdate - 为 true 时让 update 抛错，验证异常不被吞。
 */
function stubSettings(entries: readonly SettingsEntryLike[], options: { failUpdate?: boolean } = {}): {
  settings: SettingsFormsLike
  updates: { ns: string, patch: Record<string, unknown> }[]
} {
  const updates: { ns: string, patch: Record<string, unknown> }[] = []
  const settings: SettingsFormsLike = {
    describe: () => entries,
    update: async (ns, patch) => {
      if (options.failUpdate === true) throw new Error('write refused')
      updates.push({ ns, patch })
    },
  }
  return { settings, updates }
}

/** 一个指向插件的 `web` 条目。 */
function takeoverEntry(): SettingsEntryLike {
  return { ns: WEB_SETTINGS_NAMESPACE, value: { searchProvider: FAILOVER_PROVIDER_ID, fetchProvider: FAILOVER_PROVIDER_ID } }
}

describe('FNOS-010-12 补充：重新开启智能搜索时接管 web 接缝选择', () => {
  it('已经指向本插件时不写配置（避免多余覆盖）', async () => {
    const { settings, updates } = stubSettings([takeoverEntry()])

    await expect(ensureWebSelection(settings)).resolves.toBe('already')
    expect(updates).toEqual([])
  })

  it('被官方 Search/Fetch API 覆盖时写回两个键', async () => {
    const { settings, updates } = stubSettings([
      { ns: WEB_SETTINGS_NAMESPACE, value: { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' } },
    ])

    await expect(ensureWebSelection(settings)).resolves.toBe('updated')
    expect(updates).toEqual([
      { ns: 'web', patch: { searchProvider: FAILOVER_PROVIDER_ID, fetchProvider: FAILOVER_PROVIDER_ID } },
    ])
  })

  it('被官方 Messages 模式（deepseek-official / http）覆盖时同样写回', async () => {
    const { settings, updates } = stubSettings([
      { ns: WEB_SETTINGS_NAMESPACE, value: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
    ])

    await expect(ensureWebSelection(settings)).resolves.toBe('updated')
    expect(updates[0]?.patch).toEqual({
      searchProvider: FAILOVER_PROVIDER_ID,
      fetchProvider: FAILOVER_PROVIDER_ID,
    })
  })

  it('只有一个键正确时也要补齐另一个（接缝要求两者都指向本插件）', async () => {
    const { settings, updates } = stubSettings([
      { ns: WEB_SETTINGS_NAMESPACE, value: { searchProvider: FAILOVER_PROVIDER_ID, fetchProvider: 'http' } },
    ])

    await expect(ensureWebSelection(settings)).resolves.toBe('updated')
    expect(updates).toHaveLength(1)
  })

  it('settings 服务缺失时跳过，不抛异常', async () => {
    await expect(ensureWebSelection(undefined)).resolves.toBe('skipped')
  })

  it('web 行不可配置（未出现在 describe 里）时跳过', async () => {
    const { settings, updates } = stubSettings([{ ns: 'dsh-failover-search', value: { timeoutMs: 15000 } }])

    await expect(ensureWebSelection(settings)).resolves.toBe('skipped')
    expect(updates).toEqual([])
  })

  it('写入失败向上抛出，由调用方决定降级（开关本身不能因此失败）', async () => {
    const { settings } = stubSettings(
      [{ ns: WEB_SETTINGS_NAMESPACE, value: { searchProvider: 'deepseek-search-api' } }],
      { failUpdate: true },
    )

    await expect(ensureWebSelection(settings)).rejects.toThrow('write refused')
  })
})
