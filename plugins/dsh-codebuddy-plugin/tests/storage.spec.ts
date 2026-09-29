import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activeEntry,
  clearStorage,
  getStoragePath,
  loadStorage,
  resolveEntryEndpoint,
  saveStorage,
} from '../src/host/storage.ts'
import { CODEBUDDY_ENDPOINT, CODEBUDDY_ENDPOINT_EXTERNAL } from '../src/contracts/constants.ts'
import type { CodeBuddyAccountEntry, CodeBuddyStorage } from '../src/host/storage.ts'
import { srcPath  } from './paths.ts'

let workdir: string | undefined

function useTempAuthFile(): string {
  workdir = mkdtempSync(join(tmpdir(), 'codebuddy-storage-'))
  const path = join(workdir, 'codebuddy-auth.json')
  process.env.DSH_CODEBUDDY_AUTH_FILE = path
  return path
}

afterEach(() => {
  delete process.env.DSH_CODEBUDDY_AUTH_FILE
  if (workdir !== undefined) {
    rmSync(workdir, { recursive: true, force: true })
    workdir = undefined
  }
})

function entry(id: string, uid: string, nickname = uid): CodeBuddyAccountEntry {
  return {
    id,
    auth: {
      accessToken: `token-${id}`,
      expiresAt: Date.now() + 3600_000,
      refreshToken: `refresh-${id}`,
      refreshExpiresAt: Date.now() + 86_400_000,
      domain: 'example.com',
    },
    account: { uid, nickname },
  }
}

/** Write raw JSON as an owner-only file, matching what saveStorage produces. */
function writeOwnerOnly(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}

describe('CodeBuddy multi-account storage', () => {
  it('reads back a saved multi-account document and resolves the active entry', async () => {
    useTempAuthFile()
    const a = entry('a', 'uid-a', '账号A')
    const b = entry('b', 'uid-b', '账号B')
    await saveStorage({ activeId: 'b', accounts: [a, b] })
    const loaded = await loadStorage()
    expect(loaded).toBeDefined()
    expect(loaded?.accounts).toHaveLength(2)
    expect(activeEntry(loaded!)!.account.uid).toBe('uid-b')
  })

  it('migrates the legacy single-account shape with that account active', async () => {
    const path = useTempAuthFile()
    writeOwnerOnly(path, {
      auth: {
        accessToken: 'legacy-token',
        expiresAt: Date.now() + 3600_000,
        refreshToken: 'legacy-refresh',
        refreshExpiresAt: Date.now() + 86_400_000,
        domain: 'example.com',
      },
      account: { uid: 'legacy-uid', nickname: '旧账号' },
    })
    const loaded = await loadStorage()
    expect(loaded).toBeDefined()
    expect(loaded?.accounts).toHaveLength(1)
    expect(activeEntry(loaded!)!.account.uid).toBe('legacy-uid')
    expect(activeEntry(loaded!)!.auth.accessToken).toBe('legacy-token')
  })

  it('falls back to the first entry when activeId does not match', async () => {
    useTempAuthFile()
    await saveStorage({ activeId: 'missing', accounts: [entry('a', 'uid-a'), entry('b', 'uid-b')] })
    const loaded = await loadStorage()
    expect(activeEntry(loaded!)!.id).toBe('a')
  })

  it('drops malformed entries and reads as signed out when none remain', async () => {
    const path = useTempAuthFile()
    writeOwnerOnly(path, {
      activeId: 'x',
      accounts: [{ id: 'x' }, null],
    })
    expect(await loadStorage()).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })

  it('reads an absent file as signed out', async () => {
    useTempAuthFile()
    expect(await loadStorage()).toBeUndefined()
    await clearStorage()
    expect(await loadStorage()).toBeUndefined()
  })

  it('normalizes empty-string account fields on load', async () => {
    const path = useTempAuthFile()
    const a = entry('a', 'uid-a')
    ;(a.account as Record<string, unknown>).uin = ''
    await saveStorage({ activeId: 'a', accounts: [a] })
    // Round-trip through the raw file: saved then loaded back.
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as CodeBuddyStorage
    expect((raw.accounts[0]!.account as Record<string, unknown>).uin).toBe('')
    const loaded = await loadStorage()
    expect(loaded?.accounts[0]?.account.uin).toBeUndefined()
  })

  it('keeps getStoragePath tracking the override', () => {
    const path = useTempAuthFile()
    expect(getStoragePath()).toBe(path)
  })

  it('persists and normalizes the optional local label', async () => {
    useTempAuthFile()
    const a = entry('a', 'uid-a', '账号A')
    a.account.label = '  工作账号  '
    await saveStorage({ activeId: 'a', accounts: [a] })
    const loaded = await loadStorage()
    expect(loaded?.accounts[0]?.account.label).toBe('工作账号')
  })

  it('omits the label when absent or blank', async () => {
    useTempAuthFile()
    await saveStorage({ activeId: 'a', accounts: [entry('a', 'uid-a', '账号A')] })
    const loaded = await loadStorage()
    expect(loaded?.accounts[0]?.account.label).toBeUndefined()
  })

  it('resolves the endpoint from the entry environment', () => {
    expect(resolveEntryEndpoint({ ...entry('a', 'u'), environment: 'external' })).toBe(CODEBUDDY_ENDPOINT_EXTERNAL)
    expect(resolveEntryEndpoint({ ...entry('a', 'u'), environment: 'internal' })).toBe('https://copilot.tencent.com')
    expect(resolveEntryEndpoint({ ...entry('a', 'u'), environment: 'ioa' })).toBe('https://copilot.tencent.com')
  })

  it('prefers an explicit entry endpoint over the environment default', () => {
    const item = { ...entry('a', 'u'), environment: 'internal', endpoint: 'https://corp.example.com///' }
    expect(resolveEntryEndpoint(item)).toBe('https://corp.example.com')
  })

  it('falls back to the legacy endpoint when the entry predates environments', () => {
    expect(resolveEntryEndpoint(entry('a', 'u'))).toBe(CODEBUDDY_ENDPOINT)
    expect(resolveEntryEndpoint({ ...entry('a', 'u'), environment: 'cloudhosted' })).toBe(CODEBUDDY_ENDPOINT)
  })

  it('lower-cases a hand-edited environment value on load', async () => {
    useTempAuthFile()
    const a = { ...entry('a', 'u'), environment: 'EXTERNAL' }
    await saveStorage({ activeId: 'a', accounts: [a] })
    const loaded = await loadStorage()
    expect(loaded?.accounts[0]?.environment).toBe('external')
    expect(resolveEntryEndpoint(activeEntry(loaded!))).toBe(CODEBUDDY_ENDPOINT_EXTERNAL)
  })
})

describe('normalizeEntry 必须保留客户端身份字段', () => {
  /**
   * 守一个真实缺陷：`normalizeEntry` 是**逐字段白名单重建**，而 `loadStorage`
   * 对每个条目都调用它。曾经漏掉 `client` / `clientVersion`，于是每次读盘都把
   * WorkBuddy 账号降级成 CLI：`resolveEntryEndpoint` 回落到 copilot.tencent.com，
   * 而凭据签发于 www.workbuddy.cn → 服务端不认、账号表现为掉线。
   *
   * 更严重的是 loadStorage 的结果会被切换/改名/删除/刷新等写路径回写磁盘，
   * 所以是**持久化擦除**而非内存态问题。这条用例用「写→读」往返锁住该字段。
   */
  it('client / clientVersion 经 saveStorage → loadStorage 往返后不丢', async () => {
    const { chmodSync, mkdtempSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'cb-roundtrip-'))
    const file = join(dir, 'codebuddy-auth.json')
    process.env.DSH_CODEBUDDY_AUTH_FILE = file

    const { buildAccountEntry, loadStorage, resolveEntryEndpoint, saveStorage } = await import('../src/host/storage.ts')
    const token = { accessToken: 'a', refreshToken: 'r', expiresIn: 3600, refreshExpiresIn: 7200, domain: 'www.workbuddy.cn' }
    const account = { uid: 'u1', nickname: 'n1' }

    const wb = buildAccountEntry(token as never, account as never, { client: 'workbuddy' })
    const cli = buildAccountEntry(token as never, { uid: 'u2', nickname: 'n2' } as never, { client: 'cli' })
    await saveStorage({ activeId: wb.id, accounts: [wb, cli] })

    // 磁盘原文本来就有（写路径正确）
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { accounts: Array<{ client?: string }> }
    expect(raw.accounts[0]!.client).toBe('workbuddy')

    // 关键：读盘后仍在（曾经在这里被抹掉）
    const loaded = (await loadStorage())!
    const loadedWb = loaded.accounts.find(e => e.account.uid === 'u1')!
    const loadedCli = loaded.accounts.find(e => e.account.uid === 'u2')!
    expect(loadedWb.client).toBe('workbuddy')
    expect(loadedWb.clientVersion).toBe('5.6.2')
    expect(loadedCli.client).toBe('cli')

    // 且端点解析正确 —— 这是该字段的实际用途
    expect(resolveEntryEndpoint(loadedWb)).toBe('https://www.workbuddy.cn')
    expect(resolveEntryEndpoint(loadedCli)).not.toBe('https://www.workbuddy.cn')

    delete process.env.DSH_CODEBUDDY_AUTH_FILE
    void chmodSync
  }, 60_000)

  it('缺失 client 的历史条目归一化为 cli（向后兼容）', async () => {
    const { chmodSync, mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'cb-legacy-'))
    const file = join(dir, 'codebuddy-auth.json')
    process.env.DSH_CODEBUDDY_AUTH_FILE = file
    // 模拟「建 client 字段之前」写入的条目。
    writeFileSync(file, JSON.stringify({
      activeId: 'old',
      accounts: [{
        id: 'old',
        auth: { accessToken: 'a', expiresAt: Date.now() + 3_600_000, refreshToken: 'r', refreshExpiresAt: Date.now() + 7_200_000, domain: 'd' },
        account: { uid: 'u', nickname: 'n' },
      }],
    }))
    // loadStorage 会拒绝非 owner-only 的文件（isOwnerOnly），因此必须设 0o600，
    // 否则返回 undefined —— 那是权限校验，不是格式问题。
    chmodSync(file, 0o600)
    const { loadStorage } = await import('../src/host/storage.ts')
    const loaded = (await loadStorage())!
    // 老条目没有该字段 → 按 CLI 处理，且补上固定版本号。
    expect(loaded.accounts[0]!.client).toBe('cli')
    expect(loaded.accounts[0]!.clientVersion).toBe('2.159.0')
    delete process.env.DSH_CODEBUDDY_AUTH_FILE
  }, 60_000)
})

describe('重新登录不应改变账号的客户端身份', () => {
  /**
   * 守一个真实缺陷：设置页的「重新登录」不带 `client`，而 `buildAccountEntry`
   * 对未指定的 client 会按 `cli` 落值，于是 host 侧「以本次登录为准」的覆盖逻辑
   * 会把 WorkBuddy 账号静默降级成 CLI —— 之后请求发往 copilot.tencent.com，
   * 而凭据签发于 www.workbuddy.cn。
   *
   * 修法是区分「显式指定」与「未指定」：未指定时保留既有值。
   * 这里用源码断言锁住该分支（host 侧完整登录流程需要真实 OAuth，无法单测）。
   */
  it('host 侧按「是否显式指定」分支，而不是看 fresh.client 是否为空', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      srcPath('host/auth-service.ts'),
      'utf8',
    )
    // 必须基于 options.client 判断（fresh.client 恒有值，看它永远为真）。
    expect(src).toContain('const clientSpecified = options.client !== undefined')
    expect(src).toMatch(/clientSpecified\s*\n?\s*\? \{/)
    // 未指定时要保留既有 client，而不是删掉或写成 cli。
    expect(src).toMatch(/existing\.client === undefined \? \{\} : \{ client: existing\.client \}/)
  })
})

/**
 * `nextActiveId` 决定一次登录之后谁是当前账号。
 *
 * 这条规则此前**零覆盖**，而「添加账号不抢占当前账号」的正确性全压在它身上：
 * `activate` 传错或规则写反，用户只是多存一个备用账号，正在用的账号却会被
 * 静默换掉，后续所有请求改走新账号。因此这里逐情形钉住。
 */
describe('nextActiveId：登录后谁是当前账号', () => {
  async function load() {
    const { nextActiveId } = await import('../src/host/storage.ts')
    return nextActiveId
  }

  it('首账号：无论 activate 与否都必须成为当前账号', async () => {
    // 否则会留下「有账号却没有当前账号」的空悬状态。
    const nextActiveId = await load()
    expect(nextActiveId(undefined, 'new', false)).toBe('new')
    expect(nextActiveId(undefined, 'new', true)).toBe('new')
  })

  it('新增账号 + activate=false：保持原当前账号（本次需求）', async () => {
    const nextActiveId = await load()
    expect(nextActiveId('old', 'new', false)).toBe('old')
  })

  it('新增账号 + activate=true：切换过去', async () => {
    const nextActiveId = await load()
    expect(nextActiveId('old', 'new', true)).toBe('new')
  })

  it('重复登录当前账号：即使 activate=false 也不能把自己挤下去', async () => {
    // wasActive 兜底：刷新当前账号的凭据仍属于当前账号。
    const nextActiveId = await load()
    expect(nextActiveId('me', 'me', false, true)).toBe('me')
  })

  it('重复登录非当前账号 + activate=false：保持原当前账号', async () => {
    const nextActiveId = await load()
    expect(nextActiveId('current', 'other', false, false)).toBe('current')
  })

  it('重复登录非当前账号 + activate=true：切换过去', async () => {
    const nextActiveId = await load()
    expect(nextActiveId('current', 'other', true, false)).toBe('other')
  })

  it('wasActive 默认 false', async () => {
    const nextActiveId = await load()
    expect(nextActiveId('current', 'other', false)).toBe('current')
  })

  it('current 与 freshId 相同时，wasActive 不影响结果', async () => {
    // 这条记录一个**等价性**事实，而不是在测行为差异：当两者相同，两个分支
    // 返回同一个值，因此 wasActive 在该情形下是冗余的。
    //
    // 之所以冗余却仍保留：它让规则自我表达「重复登录当前账号不能把自己挤下去」
    // 这一意图，且属于防御性写法。它成立的前提是调用点满足
    // `replaced.id === existing.id`（见下一条不变量），一旦该前提被破坏，
    // wasActive 就不再冗余——那时这条等价性断言与下一条会一起失效并提醒。
    const nextActiveId = await load()
    expect(nextActiveId('same', 'same', false, true)).toBe(nextActiveId('same', 'same', false, false))
  })

  it('调用点不变量：被复用的条目沿用原 id（wasActive 冗余的前提）', () => {
    const src = readFileSync(new URL('../src/host/auth-service.ts', import.meta.url), 'utf8')
    // 复用分支必须保留 existing.id，并据此算 wasActive。若有人改成新 id，
    // `activate || wasActive` 的保护语义就变了，需要重新审视。
    const start = src.indexOf('const wasActive =')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(src.indexOf('const existing = stored?.accounts.find'), start)
    expect(block).toMatch(/id: existing\.id/)
    expect(src.slice(start, start + 200)).toMatch(/stored\.activeId === existing\.id/)
  })
})

/**
 * 配置文件合并：账号凭据、三份自动偏好、成长任务运行状态原本散在 5 个文件里
 * （`codebuddy-auth.json` 与它的 4 个 `.auto-*.json` / `.growth-run.json` 兄弟），
 * 现在收敛为一份文档。
 *
 * 这组用例守两件事：**合并后字段一个都不能丢**，以及**老配置能自动升上来且
 * 旧文件被保留**（改名而非删除）。
 */
describe('配置文档合并与读时迁移', () => {
  it('把 4 个旧兄弟文件并入单一文档，字段逐项保留', async () => {
    const path = useTempAuthFile()
    writeOwnerOnly(path, { activeId: 'a', accounts: [entry('a', 'uid-a')] })
    writeOwnerOnly(`${path}.auto-switch.json`, { enabled: true, thresholdPct: 33 })
    writeOwnerOnly(`${path}.auto-checkin.json`, { enabled: false })
    writeOwnerOnly(`${path}.auto-travel.json`, { enabled: false })
    writeOwnerOnly(`${path}.growth-run.json`, {
      running: false,
      mode: 'all',
      startedAt: 1,
      summary: 'all:1 accounts',
    })

    const storage = await loadStorage()
    expect(storage?.activeId).toBe('a')
    expect(storage?.accounts.map(item => item.id)).toEqual(['a'])

    const { loadAutoSwitchConfig, loadAutoCheckinConfig, loadAutoTravelConfig } = await import('../src/host/storage.ts')
    expect(await loadAutoSwitchConfig()).toEqual({ enabled: true, thresholdPct: 33, fromDisk: true })
    expect(await loadAutoCheckinConfig()).toEqual({ enabled: false })
    expect(await loadAutoTravelConfig()).toEqual({ enabled: false })

    const { loadGrowthRunState } = await import('../src/host/growth-run.ts')
    expect(await loadGrowthRunState()).toMatchObject({ summary: 'all:1 accounts' })
  })

  it('迁移后磁盘上只剩一份文档，旧文件改名为 .migrated-* 保留', async () => {
    const path = useTempAuthFile()
    writeOwnerOnly(path, { activeId: 'a', accounts: [entry('a', 'uid-a')] })
    writeOwnerOnly(`${path}.auto-switch.json`, { enabled: false, thresholdPct: 5 })
    writeOwnerOnly(`${path}.growth-run.json`, { running: false, mode: 'all', startedAt: 1 })

    await loadStorage()

    const files = readdirSync(workdir!)
    expect(files.filter(name => name.includes('.migrated-'))).toHaveLength(2)
    // 旧的原始文件名不再存在（已改名），且旧内容确实被保留了下来。
    expect(files).not.toContain('codebuddy-auth.json.auto-switch.json')
    const archived = files.find(name => name.startsWith('codebuddy-auth.json.auto-switch.json.migrated-'))!
    expect(JSON.parse(readFileSync(join(workdir!, archived), 'utf-8'))).toEqual({ enabled: false, thresholdPct: 5 })
    // 新文档带版本号，且已含偏好。
    const merged = JSON.parse(readFileSync(path, 'utf-8')) as { version: number, prefs: { autoSwitch: unknown } }
    expect(merged.version).toBe(1)
    expect(merged.prefs.autoSwitch).toEqual({ enabled: false, thresholdPct: 5 })
  })

  it('重复读取幂等：第二次不再产生新的归档文件', async () => {
    const path = useTempAuthFile()
    writeOwnerOnly(path, { activeId: 'a', accounts: [entry('a', 'uid-a')] })
    writeOwnerOnly(`${path}.auto-checkin.json`, { enabled: false })

    await loadStorage()
    const afterFirst = readdirSync(workdir!).filter(name => name.includes('.migrated-')).length
    await loadStorage()
    expect(readdirSync(workdir!).filter(name => name.includes('.migrated-'))).toHaveLength(afterFirst)
  })

  it('单个兄弟文件损坏不影响其余迁移，也不阻断读取', async () => {
    const path = useTempAuthFile()
    writeOwnerOnly(path, { activeId: 'a', accounts: [entry('a', 'uid-a')] })
    writeFileSync(`${path}.auto-travel.json`, '{ not json', { encoding: 'utf-8', mode: 0o600 })
    writeOwnerOnly(`${path}.auto-checkin.json`, { enabled: false })

    const storage = await loadStorage()
    expect(storage?.accounts).toHaveLength(1)
    const { loadAutoCheckinConfig, loadAutoTravelConfig } = await import('../src/host/storage.ts')
    expect(await loadAutoCheckinConfig()).toEqual({ enabled: false })
    // 损坏的那份按「用户没配过」处理，回落到默认值。
    expect(await loadAutoTravelConfig()).toEqual({ enabled: true })
  })

  it('偏好与成长任务状态在未登录（零账号）时也能落盘', async () => {
    const path = useTempAuthFile()
    const { saveAutoCheckinConfig, loadAutoCheckinConfig } = await import('../src/host/storage.ts')
    const { beginGrowthRun, loadGrowthRunState } = await import('../src/host/growth-run.ts')

    await saveAutoCheckinConfig({ enabled: false })
    await beginGrowthRun('all')

    expect(await loadStorage()).toBeUndefined()
    expect(await loadAutoCheckinConfig()).toEqual({ enabled: false })
    expect((await loadGrowthRunState())?.running).toBe(true)
    const merged = JSON.parse(readFileSync(path, 'utf-8')) as { accounts: unknown[] }
    expect(merged.accounts).toEqual([])
  })

  it('保存偏好不会覆盖账号列表（同一份文档的不同片段）', async () => {
    const path = useTempAuthFile()
    await saveStorage({ activeId: 'a', accounts: [entry('a', 'uid-a')] })
    const { saveAutoSwitchConfig } = await import('../src/host/storage.ts')
    await saveAutoSwitchConfig({ enabled: false, thresholdPct: 42 })

    const storage = await loadStorage()
    expect(storage?.accounts.map(item => item.id)).toEqual(['a'])
    expect(storage?.prefs?.autoSwitch).toEqual({ enabled: false, thresholdPct: 42 })
    const merged = JSON.parse(readFileSync(path, 'utf-8')) as { version: number }
    expect(merged.version).toBe(1)
  })

  /**
   * 下面的用例守一个**最容易漏掉**的点：合并文档之后，凡是"重建文档对象"的
   * 地方都必须带上 `...current`，否则那份代码在改动自己关心的字段时会**顺手
   * 抹掉**其它片段。这类缺陷不会报错、也不会让任何已有用例变红——删账号时
   * 偏好与执行日志一起消失，只有真去读偏好才会发现。
   *
   * 因此逐个账号操作都断言"改动后 `prefs`/`growthRun` 仍在"。
   */
  it('删除账号保留偏好与成长任务状态', async () => {
    const path = useTempAuthFile()
    const { CodeBuddyAuthService } = await import('../src/host/auth-service.ts')
    const { CodeBuddySession } = await import('../src/host/session.ts')
    const { saveAutoSwitchConfig, loadAutoSwitchConfig } = await import('../src/host/storage.ts')
    const { beginGrowthRun, loadGrowthRunState } = await import('../src/host/growth-run.ts')

    await saveStorage({ activeId: 'a', accounts: [entry('a', 'uid-a'), entry('b', 'uid-b')] })
    await saveAutoSwitchConfig({ enabled: false, thresholdPct: 42 })
    await beginGrowthRun('all')
    expect((await loadGrowthRunState())?.running).toBe(true)

    const service = new CodeBuddyAuthService(
      { logger: { info: () => {}, warn: () => {}, error: () => {} }, effect: () => () => {}, inject: () => () => {}, get: () => undefined } as never,
      new CodeBuddySession(),
    )
    await service.removeAccount('b')

    expect((await loadStorage())?.accounts.map(item => item.id)).toEqual(['a'])
    expect(await loadAutoSwitchConfig()).toEqual({ enabled: false, thresholdPct: 42, fromDisk: true })
    expect((await loadGrowthRunState())?.running).toBe(true)
    // 文档仍带版本号：重建成"账号层文档"会丢掉它，下次读取又会当成待迁移。
    expect((JSON.parse(readFileSync(path, 'utf-8')) as { version: number }).version).toBe(1)
  })

  it('改名保留偏好与成长任务状态', async () => {
    const { CodeBuddyAuthService } = await import('../src/host/auth-service.ts')
    const { CodeBuddySession } = await import('../src/host/session.ts')
    const { saveAutoCheckinConfig, loadAutoCheckinConfig } = await import('../src/host/storage.ts')

    useTempAuthFile()
    await saveStorage({ activeId: 'a', accounts: [entry('a', 'uid-a')] })
    await saveAutoCheckinConfig({ enabled: false })

    const service = new CodeBuddyAuthService(
      { logger: { info: () => {}, warn: () => {}, error: () => {} }, effect: () => () => {}, inject: () => () => {}, get: () => undefined } as never,
      new CodeBuddySession(),
    )
    await service.renameLabel('a', '备注')

    expect((await loadStorage())?.accounts[0]?.account.label).toBe('备注')
    expect(await loadAutoCheckinConfig()).toEqual({ enabled: false })
  })

  it('切换当前账号保留偏好与成长任务状态', async () => {
    const { CodeBuddyAuthService } = await import('../src/host/auth-service.ts')
    const { CodeBuddySession } = await import('../src/host/session.ts')
    const { saveAutoTravelConfig, loadAutoTravelConfig } = await import('../src/host/storage.ts')

    useTempAuthFile()
    await saveStorage({ activeId: 'a', accounts: [entry('a', 'uid-a'), entry('b', 'uid-b')] })
    await saveAutoTravelConfig({ enabled: false })

    const service = new CodeBuddyAuthService(
      { logger: { info: () => {}, warn: () => {}, error: () => {} }, effect: () => () => {}, inject: () => () => {}, get: () => undefined } as never,
      new CodeBuddySession(),
    )
    await service.switchAccount('b')

    expect((await loadStorage())?.activeId).toBe('b')
    expect(await loadAutoTravelConfig()).toEqual({ enabled: false })
  })

  /**
   * `mutateStorage` 的**片段保全**不变量。
   *
   * 各账号写路径的回调都是"逐字段重建"文档（`{ activeId, accounts }`），只关心
   * 自己改的那部分。合并文档后，这种写法会顺手抹掉 `prefs`/`growthRun`——删账号
   * 时偏好与执行日志一起消失，且**不会报错**，只有真去读偏好才会发现。
   *
   * 与其要求每个调用点记得写 `...current`，事务层把回调结果**并回**当前文档，
   * 让"只关心自己那片"的写法天然安全。这条用例直接钉住该不变量：回调故意只返回
   * 自己关心的字段，断言其它片段仍在。
   */
  it('mutateStorage 把回调结果并回文档：回调只返回部分字段也不丢其它片段', async () => {
    const { mutateStorage, saveAutoSwitchConfig, loadAutoSwitchConfig, readGrowthRunState } = await import('../src/host/storage.ts')
    const { beginGrowthRun } = await import('../src/host/growth-run.ts')

    useTempAuthFile()
    await saveStorage({ activeId: 'a', accounts: [entry('a', 'uid-a'), entry('b', 'uid-b')] })
    await saveAutoSwitchConfig({ enabled: false, thresholdPct: 42 })
    await beginGrowthRun('all')

    // 刻意**不**写 `...current`：模拟"只关心账号字段"的调用点。
    await mutateStorage((current) => {
      if (current === undefined) return undefined
      return { activeId: 'b', accounts: current.accounts }
    })

    expect((await loadStorage())?.activeId).toBe('b')
    expect(await loadAutoSwitchConfig()).toEqual({ enabled: false, thresholdPct: 42, fromDisk: true })
    expect((await readGrowthRunState()) as { running: boolean } | undefined).toMatchObject({ running: true })
  })
})
