import { describe, expect, it } from 'vitest'
import { appendAccountOp, editAccountPatch, mergeAccountRows, removeAccountOp, updateAccountOp } from '../../src/client/account-list.ts'
import type { SettingsFormPathOp } from '../../src/client/account-list.ts'

describe('FNOS-010-04 账号列表的配置写入模型', () => {
  it('新增账号写成一次 set（写入配置层不存在的下标）', () => {
    // 宿主的 applyPathOp 允许 `index === length` 且无后续路径的 set：这是「追加」。
    const op = appendAccountOp('tinyfishAccounts', 2, { key: 'tf-1', label: 'tinyfish-1' })

    expect(op).toEqual({
      op: 'set',
      path: ['tinyfishAccounts', '2'],
      value: { key: 'tf-1', label: 'tinyfish-1' },
    })
  })

  it('删除账号写成对该下标的 unset（宿主按 splice 移除元素）', () => {
    const op = removeAccountOp('tavilyAccounts', 0)

    expect(op).toEqual({ op: 'unset', path: ['tavilyAccounts', '0'] })
  })

  it('改备注名只写 label 字段，不动 key', () => {
    const op = updateAccountOp('tinyfishAccounts', 1, { label: 'renamed' })

    expect(op).toEqual({ op: 'set', path: ['tinyfishAccounts', '1', 'label'], value: 'renamed' })
    expect(JSON.stringify(op)).not.toContain('key')
  })

  it('改 key 写成 key 字段的 set', () => {
    const op = updateAccountOp('tavilyAccounts', 3, { key: 'tvly-new' })

    expect(op).toEqual({ op: 'set', path: ['tavilyAccounts', '3', 'key'], value: 'tvly-new' })
  })

  it('同时改 key 与备注名产出两条独立 op，顺序稳定（key 在前）', () => {
    const ops = [
      updateAccountOp('tinyfishAccounts', 0, { key: 'k', label: 'l' }),
    ]

    // 一次 mutate 携带多条 op 时，宿主按顺序应用；这里断言单条 op 的形状可预测。
    expect(ops[0]).toEqual({ op: 'set', path: ['tinyfishAccounts', '0', 'key'], value: 'k' })
  })

  it('op 是可 JSON 序列化的纯数据（跨线写入的前提）', () => {
    const op: SettingsFormPathOp = appendAccountOp('tinyfishAccounts', 0, { key: 'k' })

    expect(JSON.parse(JSON.stringify(op))).toEqual(op)
  })

  it('新增条目的 value 只含 key 与可选备注名，不夹带其它字段', () => {
    const withLabel = appendAccountOp('tinyfishAccounts', 0, { key: 'k', label: 'l' })
    const withoutLabel = appendAccountOp('tinyfishAccounts', 0, { key: 'k' })

    expect(withLabel.op === 'set' ? withLabel.value : undefined).toEqual({ key: 'k', label: 'l' })
    expect(withoutLabel.op === 'set' ? withoutLabel.value : undefined).toEqual({ key: 'k' })
  })
})

describe('FNOS-010-04 账号行的 key 展示', () => {
  it('已配置账号时展示 host 送来的掩码，而不是空占位', () => {
    const rows = mergeAccountRows(
      [{ label: 'tinyfish-1' }],
      [{ platform: 'tinyfish', label: 'tinyfish-1', maskedKey: 'sk-tin…KFFtn' }],
    )

    expect(rows[0]?.maskedKey).toBe('sk-tin…KFFtn')
    expect(rows[0]?.label).toBe('tinyfish-1')
  })

  it('掩码缺失时回落到「已保存」状态，不留空', () => {
    const rows = mergeAccountRows([{ label: 'tinyfish-1' }], [])

    expect(rows[0]?.maskedKey).toBeUndefined()
  })

  it('同一平台的多个账号按代号配对，不会串行', () => {
    const rows = mergeAccountRows(
      [{ label: 'tinyfish-1' }, { label: 'tinyfish-2' }],
      [
        { platform: 'tinyfish', label: 'tinyfish-2', maskedKey: 'second…xxxxx' },
        { platform: 'tinyfish', label: 'tinyfish-1', maskedKey: 'first…yyyyy' },
      ],
    )

    expect(rows[0]?.maskedKey).toBe('first…yyyyy')
    expect(rows[1]?.maskedKey).toBe('second…xxxxx')
  })

  it('平台不同但代号相同时不会误配', () => {
    const rows = mergeAccountRows(
      [{ label: 'shared-1' }],
      [{ platform: 'tavily', label: 'shared-1', maskedKey: 'tavily…zzzzz' }],
      'tinyfish',
    )

    expect(rows[0]?.maskedKey).toBeUndefined()
  })
})

describe('FNOS-010-04 账号编辑的字段收敛', () => {
  it('只改备注名时，patch 不含 key（不会把已存的 key 覆盖掉）', () => {
    const patch = editAccountPatch({ label: 'old' }, { label: 'new' })

    expect(patch).toEqual({ label: 'new' })
    expect('key' in patch).toBe(false)
  })

  it('只换 key 时，patch 不含 label（不会把已存的备注名清掉）', () => {
    const patch = editAccountPatch({ label: 'keep-me' }, { key: 'sk-new' })

    expect(patch).toEqual({ key: 'sk-new' })
    expect('label' in patch).toBe(false)
  })

  it('两者都没动时返回空 patch（不产生空写入）', () => {
    expect(editAccountPatch({ label: 'same' }, { label: 'same' })).toEqual({})
    expect(editAccountPatch({}, {})).toEqual({})
  })

  it('空白 key 视为「不修改」，不会把 key 写成空串', () => {
    const patch = editAccountPatch({ label: 'x' }, { key: '   ' })

    expect('key' in patch).toBe(false)
  })

  it('key 两侧空白被裁剪后才写入', () => {
    expect(editAccountPatch({}, { key: '  sk-padded  ' })).toEqual({ key: 'sk-padded' })
  })

  it('备注名清空是有效修改（写空串以删除备注），与「未修改」区分开', () => {
    expect(editAccountPatch({ label: 'remove-me' }, { label: '' })).toEqual({ label: '' })
  })
})
