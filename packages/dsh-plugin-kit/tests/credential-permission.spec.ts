import { describe, expect, it } from 'vitest'
import { assessCredentialFile, assessCredentialMode, ownerUnreadableError } from '../src/credential-permission.ts'

/**
 * 共享权限判定（FNOS-011-01/05）。
 *
 * 测试用例规范要求覆盖 `600`/`644`/`0000`/`400`/不存在五种输入（TC-001~005、
 * TC-017）。`assessCredentialFile` 的 ENOENT → `absent` 分支由文件系统注入
 * 用例覆盖。
 */

describe('assessCredentialMode（三态判定）', () => {
  it('600 判定为可用（既有正常路径不变）', () => {
    expect(assessCredentialMode({ mode: 0o600 })).toBe('usable')
  })

  it('0000 判定为不可用（属主可读位缺失，不再放行）', () => {
    expect(assessCredentialMode({ mode: 0o000 })).toBe('unusable')
  })

  it('644 仍判定为不可用（既有拒绝语义不回退）', () => {
    expect(assessCredentialMode({ mode: 0o644 })).toBe('unusable')
  })

  it('400（属主只读）判定为可用：属主可读位存在即满足本判定', () => {
    // 判定条件是「group/other 位为空且属主可读」；属主可写不是本判定的拒绝
    // 条件（与上游 assertOwnerOnly 一致——它也只拦 group/other 位）。
    expect(assessCredentialMode({ mode: 0o400 })).toBe('usable')
  })

  it('440/444 等 group/other 可读形态仍拒绝', () => {
    expect(assessCredentialMode({ mode: 0o440 })).toBe('unusable')
    expect(assessCredentialMode({ mode: 0o444 })).toBe('unusable')
  })

  it('700（属主可执行）可用：执行位不在 group/other 上', () => {
    expect(assessCredentialMode({ mode: 0o700 })).toBe('usable')
  })
})

describe('assessCredentialFile（ENOENT → absent）', () => {
  it('stat 成功时按 mode 判定', async () => {
    await expect(assessCredentialFile(async () => ({ mode: 0o600 }), '/dsh/.credentials.yaml'))
      .resolves.toBe('usable')
  })

  it('ENOENT 判定为 absent，与「存在但不可读」可区分', async () => {
    const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' })
    await expect(assessCredentialFile(async () => { throw enoent }, '/dsh/.credentials.yaml'))
      .resolves.toBe('absent')
  })

  it('非 ENOENT 的读取失败上抛（必须暴露，不吞掉）', async () => {
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' })
    await expect(assessCredentialFile(async () => { throw eacces }, '/dsh/.credentials.yaml'))
      .rejects.toThrow('denied')
  })
})

describe('ownerUnreadableError（可诊断错误文案）', () => {
  it('含路径、当前权限位与修复命令', () => {
    const error = ownerUnreadableError('/dsh/.credentials.yaml', 0o000, 'codebuddy-auth')
    expect(error.message).toContain('/dsh/.credentials.yaml')
    expect(error.message).toContain('mode 000')
    expect(error.message).toContain('chmod 600 /dsh/.credentials.yaml')
  })

  it('权限位以三位八进制渲染（400 → 400）', () => {
    expect(ownerUnreadableError('/x', 0o400, 'ctx').message).toContain('mode 400')
  })

  it('不含凭据内容占位——文案只引用路径与权限位', () => {
    const message = ownerUnreadableError('/dsh/.credentials.yaml', 0o000, 'ctx').message
    expect(message).not.toMatch(/token|secret|password/i)
  })
})
