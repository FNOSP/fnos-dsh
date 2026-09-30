import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describeAutoSyncTrigger, shouldAutoSyncModels } from '../../src/client/services/model-auto-sync.ts'

/**
 * FNOS-007-31-AC-02：**登录成功后以及打开已登录页面时，自动从账号同步一次模型目录**。
 *
 * 排查发现这条从未实现：`refresh-models` 路由只在 Host 注册，**没有任何调用方**
 * （客户端零处、Host 内部零处），四个 `modelRefresh*` 文案也是死代码。后果是模型
 * 列表一直停在插件补丁里写死的静态条目上，与账号实际可用的模型不一致——用户看到
 * 的就是「重装后还是旧的模型列表」。
 *
 * 为什么必须自动：DSH 的 settings 数组是**整体替换**语义，一旦某次把账号列表写进
 * 用户层，静态列表就永久失效，只能靠下一次同步覆盖。没有自动同步，列表会一直停在
 * 上一次写入的快照上。
 */
describe('模型目录自动同步的触发条件', () => {
  it('登录成功后同步一次', () => {
    expect(shouldAutoSyncModels({ signedIn: true, trigger: 'after-sign-in' })).toBe(true)
  })

  it('打开已登录页面时同步一次', () => {
    expect(shouldAutoSyncModels({ signedIn: true, trigger: 'page-open' })).toBe(true)
  })

  it('未登录时不同步（无凭据可查，只会白跑一次 502）', () => {
    expect(shouldAutoSyncModels({ signedIn: false, trigger: 'after-sign-in' })).toBe(false)
    expect(shouldAutoSyncModels({ signedIn: false, trigger: 'page-open' })).toBe(false)
  })

  it('同一次会话里页面打开只同步一次（轮询刷新不该反复打上游）', () => {
    // 状态查询是轮询的：每 5 分钟一次。若每次「已登录」都同步，就变成周期性
    // 打上游目录接口，既浪费配额也可能触发限流。
    const state = { synced: false }
    const first = shouldAutoSyncModels({ signedIn: true, trigger: 'page-open', alreadySynced: state.synced })
    state.synced = first
    const second = shouldAutoSyncModels({ signedIn: true, trigger: 'page-open', alreadySynced: state.synced })
    console.log('  首次:', first, '轮询后的第二次:', second)
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('登录成功后即使本会话已同步过，也要再同步一次', () => {
    // 重新登录可能换了账号，旧账号的列表必须被覆盖。
    expect(shouldAutoSyncModels({ signedIn: true, trigger: 'after-sign-in', alreadySynced: true })).toBe(true)
  })

  it('每个触发点都有可读的原因，便于排错', () => {
    console.log(' ', describeAutoSyncTrigger({ signedIn: true, trigger: 'after-sign-in' }))
    console.log(' ', describeAutoSyncTrigger({ signedIn: false, trigger: 'page-open' }))
    expect(describeAutoSyncTrigger({ signedIn: true, trigger: 'after-sign-in' })).toContain('sign-in')
    expect(describeAutoSyncTrigger({ signedIn: false, trigger: 'page-open' })).toContain('signed out')
  })
})

describe('自动同步确实被接上（不是又一个死代码）', () => {
  it('客户端组件在两个触发点都真的调用 autoSyncModels', () => {
    const section = readFileSync(new URL('../../src/components/CodexAuthSection.tsx', import.meta.url), 'utf8')
    // 断言**真实调用**（`autoSyncModels(input)`），而不是「出现过 autoSync 这个词」：
    // 只测后者时，把调用换成 `Promise.resolve(input)` 仍然全绿——这条用例最初就是
    // 这样漏过反转验证的。
    const calls = section.match(/autoSyncModels\(/gu) ?? []
    console.log('  autoSyncModels 调用点数量:', calls.length)
    // 两个：after-sign-in 与 page-open。
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(section).toContain("trigger: 'after-sign-in'")
    expect(section).toContain("trigger: 'page-open'")
  })

  it('同步目标是 refresh-models 路由，且路径来自契约常量', () => {
    const source = readFileSync(new URL('../../src/client/services/model-auto-sync.ts', import.meta.url), 'utf8')
    expect(source).toContain('CODEX_MODEL_REFRESH_PATH')
  })
})
