/**
 * 持久化 OAuth token 存储，磁盘上仅属主可读。
 *
 * 存储放在 harness 主目录（`$DSH_HOME`，经与 harness 相同的
 * `@deepseek-ai/dsh-home-paths` 解析）而不是插件包里，因此重装不会把用户
 * 登出。写入是原子的（先写临时文件再改名）：一个损坏的文件会让用户陷入
 * 凭据不可读的困境，且无法与"从未登录"区分开。
 *
 * 文档是多账号的：每个已登录的 CodeBuddy 账号一条条目，外加哪一条是当前
 * 活动。所有读取都经过 {@link loadStorage}，它还会就地迁移旧的单账号
 * 结构，因此调用方只会看到当前结构。
 *
 * @module dsh-codebuddy/storage
 */

import type { CodeBuddyAccountEntry, CodeBuddyStorage, LegacyCodeBuddyStorage, AutoSwitchConfig, AutoCheckinConfig, AutoTravelConfig } from '../types/host/storage'
export type { CodeBuddyAccountEntry, CodeBuddyStorage, LegacyCodeBuddyStorage, AutoSwitchConfig, AutoCheckinConfig, AutoTravelConfig } from '../types/host/storage'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { SerialQueue } from './concurrency.ts'
import {
  CODEBUDDY_CLIENT_ENDPOINTS,
  CODEBUDDY_CLIENT_VERSIONS,
  CODEBUDDY_ENDPOINT,
  CODEBUDDY_ENVIRONMENT_ENDPOINTS,
  normalizeClientId,
  type CodeBuddyClientId,
  type CodeBuddyEnvironment,
} from '../contracts/constants.ts'
import type { Account, AuthToken } from './types.ts'

/**
 * 从新签发的 token 与账号事实构建持久化凭据。
 *
 * 所有登录路径共用它，避免它们在存储结构上各自漂移：Web 认证服务写出的
 * 正是这个对象。条目 id 是一个新鲜的本地 uuid；重新登录同一账号会新增一
 * 条条目，登录路径随后按 uid 去重。
 * @param token - 浏览器登录完成后签发的 token。
 * @param account - 这些 token 所签发给的已登录账号。
 * @param options - 可选的登录事实：`label`（覆盖 `account.nickname` 的
 *   本地展示备注名）、`environment`（登录所针对的网络）和 `endpoint`
 *   （cloudhosted/selfhosted 的显式服务根地址）。
 * @returns 待持久化的凭据条目。
 */
export function buildAccountEntry(
  token: AuthToken,
  account: Account,
  options: { label?: string, environment?: string, endpoint?: string, client?: CodeBuddyClientId } = {},
): CodeBuddyAccountEntry {
  /**
   * 备注名缺省时**回落到昵称**，而不是留空。
   *
   * 过去只在展示层做 `label ?? nickname` 回落，存储里始终没有 label。后果是
   * 「备注名」这一项在导出的凭据文件、日志、以及任何直接读文档的消费者眼里都是
   * **缺失**的——想知道这个账号叫什么只能自己去拼回落逻辑，而回落规则一旦分散就
   * 会各写各的。
   *
   * 落盘为昵称之后，「备注名」成为一份**自解释**的数据：读文档就能看到每个账号
   * 叫什么；用户之后通过重命名覆盖它即可。
   *
   * 注意 trim 后为空串也按缺省处理：表单清空或不填都会得到昵称。
   */
  const nickname = account.nickname.trim()
  const trimmed = options.label?.trim()
  const label = trimmed === undefined || trimmed.length === 0 ? nickname : trimmed
  const environment = options.environment?.trim()
  const endpoint = options.endpoint?.trim().replace(/\/+$/, '')
  // 客户端身份与版本都是账号的稳定属性：版本取自固定映射，不随机生成。
  const client = normalizeClientId(options.client)
  // 时长字段可能缺失：缺省时按 0 处理（即「立即过期」），由后续的刷新流程接管；
  // 直接用 undefined 做乘法则会得到 NaN，NaN 比较恒为 false，会静默变成
  // 「永不过期」这种最危险的结果。
  const expiresIn = token.expiresIn ?? 0
  const refreshExpiresIn = token.refreshExpiresIn ?? 0
  return {
    id: randomUUID(),
    auth: {
      accessToken: token.accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      // refreshToken 缺失时存空串：调用方用真值判断，空串等价于「没有可刷新凭据」，
      // 比存 undefined 更能被既有逻辑安全处理。
      refreshToken: token.refreshToken ?? '',
      refreshExpiresAt: Date.now() + refreshExpiresIn * 1000,
      domain: token.domain,
    },
    account: {
      uid: account.uid,
      nickname: account.nickname,
      // 始终写入：缺省时上面已回落为昵称（理由见函数开头）。
      // 昵称也为空（服务端未返回）时省略，让「没有名字」这一事实保持可见，
      // 而不是落一个空串进文档。
      ...label.length === 0 ? {} : { label },
      ...account.uin === undefined ? {} : { uin: account.uin },
      ...account.enterpriseId === undefined ? {} : { enterpriseId: account.enterpriseId },
      ...account.enterpriseName === undefined ? {} : { enterpriseName: account.enterpriseName },
      ...account.enterpriseUserName === undefined ? {} : { enterpriseUserName: account.enterpriseUserName },
      ...account.departmentFullName === undefined
        ? {}
        : { departmentFullName: account.departmentFullName },
    },
    ...environment === undefined || environment.length === 0 ? {} : { environment },
    ...endpoint === undefined || endpoint.length === 0 ? {} : { endpoint },
    client,
    clientVersion: CODEBUDDY_CLIENT_VERSIONS[client],
  }
}

/**
 * @deprecated 旧的单账号构造函数，为仍在引用 {@link buildStorage} 的调用方
 * 保留；委托给 {@link buildAccountEntry}。
 */
export function buildStorage(token: AuthToken, account: Account): CodeBuddyAccountEntry {
  return buildAccountEntry(token, account)
}

/**
 * 一个账号条目的有效服务根地址。
 *
 * 解析顺序：条目的显式 `endpoint`（cloudhosted/selfhosted），其次环境的
 * 默认端点，最后是环境概念出现之前存储条目所用的旧版硬编码端点。每个
 * 请求——认证握手、刷新、模型目录、计量、聊天——都必须经过这个函数，
 * 这样凭据才绝不会被发给陌生主机。
 * @param entry - 已存储的账号条目。
 * @returns 不带末尾斜杠的服务根地址。
 */
export function resolveEntryEndpoint(entry: CodeBuddyAccountEntry): string {
  const explicit = entry.endpoint?.trim().replace(/\/+$/, '')
  if (explicit !== undefined && explicit.length > 0) return explicit
  // WorkBuddy 账号的登录与计费都在 workbuddy.cn，与环境无关：环境端点表里没有
  // 它，若按环境解析会把请求打到 CodeBuddy 的地址上（凭据不被承认）。
  const client = normalizeClientId(entry.client)
  if (client !== 'cli') return CODEBUDDY_CLIENT_ENDPOINTS[client]
  const env = entry.environment?.trim().toLowerCase() as CodeBuddyEnvironment | undefined
  if (env !== undefined && env in CODEBUDDY_ENVIRONMENT_ENDPOINTS) {
    return CODEBUDDY_ENVIRONMENT_ENDPOINTS[env as Exclude<CodeBuddyEnvironment, 'cloudhosted' | 'selfhosted'>]
  }
  return CODEBUDDY_ENDPOINT
}

/**
 * 规范化一个账号条目：剔除空的可选字符串，让所有消费方的
 * `=== undefined` 判断都成立。
 * @param entry - 原始条目。
 * @returns 移除了空的可选账号字段后的条目。
 */
function normalizeEntry(entry: CodeBuddyAccountEntry): CodeBuddyAccountEntry {
  const a = entry.account
  const pick = (v: string | undefined): string | undefined =>
    v === undefined || v.length === 0 ? undefined : v
  const label = pick(a.label)?.trim()
  const environment = pick(entry.environment)?.toLowerCase()
  const endpoint = pick(entry.endpoint)?.replace(/\/+$/, '')
  const client = normalizeClientId(entry.client)
  return {
    id: entry.id,
    auth: entry.auth,
    account: {
      uid: a.uid,
      nickname: a.nickname,
      ...label === undefined || label.length === 0 ? {} : { label },
      ...pick(a.uin) === undefined ? {} : { uin: a.uin },
      ...pick(a.enterpriseId) === undefined ? {} : { enterpriseId: a.enterpriseId },
      ...pick(a.enterpriseName) === undefined ? {} : { enterpriseName: a.enterpriseName },
      ...pick(a.enterpriseUserName) === undefined ? {} : { enterpriseUserName: a.enterpriseUserName },
      ...pick(a.departmentFullName) === undefined ? {} : { departmentFullName: a.departmentFullName },
    },
    ...environment === undefined ? {} : { environment },
    ...endpoint === undefined ? {} : { endpoint },
    // **客户端身份必须原样保留**。它是决定请求发往哪个服务平面的字段
    // （见 resolveEntryEndpoint），而本函数是逐字段白名单重建——漏掉它会让
    // 每次读盘都把 WorkBuddy 账号降级成 CLI：
    //   client 丢失 → normalizeClientId 回落 'cli' → 端点变成 copilot.tencent.com，
    //   而凭据签发于 www.workbuddy.cn → 服务端不认，账号表现为「掉线」。
    // 且 loadStorage 的结果会被各写路径（切换/改名/删除/刷新）回写磁盘，
    // 因此不是内存态问题，而是**持久化擦除**。
    // 教训：白名单重建时新增的持久化字段必须同步加到这里。
    client,
    clientVersion: entry.clientVersion ?? CODEBUDDY_CLIENT_VERSIONS[client],
  }
}

/**
 * 配置文件合并后的文档版本。
 *
 * `0` 是**合并之前**的结构：账号凭据在 `codebuddy-auth.json`，三份自动偏好
 * 与成长任务运行状态散在旁边的兄弟文件里。读到没有 `version` 或 `version`
 * 小于本值的文档即触发迁移。
 */
export const STORAGE_VERSION = 1

/**
 * 旧版分散文件的磁盘后缀（相对凭据文档路径）。
 *
 * 保留在这里是为了让读时迁移与 `scripts/migrate-storage.mjs` 使用**同一份**
 * 文件名清单——两边各写一份的话，新增一个子文件就会只改一边。
 */
export const LEGACY_SIBLING_SUFFIXES = {
  autoSwitch: '.auto-switch.json',
  autoCheckin: '.auto-checkin.json',
  autoTravel: '.auto-travel.json',
  growthRun: '.growth-run.json',
} as const

/**
 * 接受旧版 `{auth, account}` 文档，作为初始的唯一条目。
 * @param legacy - 多账号出现之前的凭据。
 * @returns 迁移后的多账号结构，旧账号为活动账号。
 */
function migrateLegacy(legacy: LegacyCodeBuddyStorage): CodeBuddyStorage {
  const entry = normalizeEntry({ id: randomUUID(), auth: legacy.auth, account: legacy.account })
  return { version: STORAGE_VERSION, activeId: entry.id, accounts: [entry] }
}

/**
 * 读取并解析一个旧版兄弟文件；缺失或损坏时返回 `undefined`。
 *
 * 迁移必须容忍单个子文件损坏：读不动的那一份按"用户没配过"处理并继续迁移
 * 其余部分，而不是让整次迁移失败、把用户挡在登录之外。
 * @param path - 待读取的文件绝对路径。
 * @returns 解析后的值；文件缺失、不可读或不是合法 JSON 时为 `undefined`。
 */
async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf-8')) as unknown
  } catch {
    return undefined
  }
}

/** 从任意值里取出布尔字段，非布尔一律当作缺省。 */
function readEnabled(value: unknown): boolean | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const enabled = (value as { enabled?: unknown }).enabled
  return typeof enabled === 'boolean' ? enabled : undefined
}

/**
 * 把旧版分散文件的内容并入单一文档。
 *
 * 三份自动偏好与成长任务状态原本各占一个兄弟文件；这里逐个探测并把内容搬进
 * `prefs` / `growthRun`。任何一份缺失都只是让对应字段保持缺省——各读取函数
 * 仍会回落到自己的默认值，因此"从未配过"与"迁移后没有该字段"语义一致。
 * @param base - 已解析的凭据部分（多账号结构或旧单账号结构迁移而来）。
 * @returns 带 `prefs`/`growthRun` 的合并文档。
 */
async function mergeLegacySiblings(base: CodeBuddyDocument): Promise<CodeBuddyDocument> {
  const path = getStoragePath()
  const [autoSwitch, autoCheckin, autoTravel, growthRun] = await Promise.all([
    readJsonFile(`${path}${LEGACY_SIBLING_SUFFIXES.autoSwitch}`),
    readJsonFile(`${path}${LEGACY_SIBLING_SUFFIXES.autoCheckin}`),
    readJsonFile(`${path}${LEGACY_SIBLING_SUFFIXES.autoTravel}`),
    readJsonFile(`${path}${LEGACY_SIBLING_SUFFIXES.growthRun}`),
  ])
  const prefs: NonNullable<CodeBuddyStorage['prefs']> = {}
  const switchEnabled = readEnabled(autoSwitch)
  if (switchEnabled !== undefined) {
    const raw = autoSwitch as { thresholdPct?: unknown }
    // 阈值沿用原读取函数的收敛规则（0–100 整数，非法值回落 10），
    // 这样迁移与不迁移读到的偏好完全一致。
    const thresholdPct = typeof raw.thresholdPct === 'number' && Number.isFinite(raw.thresholdPct)
      ? Math.max(0, Math.min(100, Math.round(raw.thresholdPct)))
      : 10
    prefs.autoSwitch = { enabled: switchEnabled, thresholdPct }
  }
  const checkinEnabled = readEnabled(autoCheckin)
  if (checkinEnabled !== undefined) prefs.autoCheckin = { enabled: checkinEnabled }
  const travelEnabled = readEnabled(autoTravel)
  if (travelEnabled !== undefined) prefs.autoTravel = { enabled: travelEnabled }
  return {
    ...base,
    version: STORAGE_VERSION,
    ...Object.keys(prefs).length === 0 ? {} : { prefs },
    ...growthRun === undefined ? {} : { growthRun },
  }
}

/**
 * 迁移旧版兄弟文件，并把它们改名为 `.migrated-<ts>` 保留。
 *
 * 为什么改名而不是删除：这些文件里是账号偏好与执行日志，删除是不可逆的。
 * 改名后既能让"下次读取不再重复迁移"，又给用户留了手工回退的余地。
 * 改名失败**不**影响本次迁移——内容已经并入新文档，残留的旧文件顶多让下次
 * 读取再迁移一次（幂等）。
 * @param stamp - 追加到文件名上的时间戳（毫秒）。
 * @returns 实际改名成功的文件数。
 */
export async function archiveLegacySiblings(stamp: number = Date.now()): Promise<number> {
  const path = getStoragePath()
  let moved = 0
  for (const suffix of Object.values(LEGACY_SIBLING_SUFFIXES)) {
    const from = `${path}${suffix}`
    try {
      await fs.rename(from, `${from}.migrated-${stamp}`)
      moved += 1
    } catch {
      // 不存在或改名失败都跳过：迁移结果已经落盘，这里只是清理。
    }
  }
  return moved
}

/**
 * 凭据文件的绝对路径。
 *
 * 经 `@deepseek-ai/dsh-home-paths` 解析，因此遵循 harness 自身的主目录
 * 优先级（配置路径 > `$DSH_HOME` > `~/.dsh`），绝不会分叉到另一个单独
 * 计算的主目录。`DSH_CODEBUDDY_AUTH_FILE` 保留为测试与搬迁用的显式逃生口。
 */
export function getStoragePath(): string {
  const override = process.env.DSH_CODEBUDDY_AUTH_FILE
  if (override !== undefined && override.length > 0) return override
  return dshHomePath('codebuddy-auth.json')
}

/** 一次迁移的结果，供脚本输出与测试断言。 */
export interface MigrationOutcome {
  /** 迁移前是否存在待合并的旧兄弟文件。 */
  readonly legacyFiles: readonly string[]
  /** 是否已写出合并后的文档。 */
  readonly written: boolean
  /** 改名成功的旧文件数。 */
  readonly archived: number
  /** 合并后文档中的账号数。 */
  readonly accounts: number
  /** 合并后文档是否带偏好。 */
  readonly hasPrefs: boolean
  /** 合并后文档是否带成长任务状态。 */
  readonly hasGrowthRun: boolean
}

/**
 * 把磁盘上的分散配置合并为一份文档。
 *
 * **读时迁移与显式脚本共用这一个入口**：两边各写一份实现的话，将来多加一个
 * 子文件只会改一边，另一条路径就静默漏掉它。已合并的文档在这里是幂等空操作。
 *
 * @param options - 可选：`stamp` 指定归档文件名的时间戳（默认当前时刻，
 *   测试可固定）。
 * @returns 迁移结果摘要。
 */
export async function migrateStorageDocument(
  options: { stamp?: number } = {},
): Promise<MigrationOutcome> {
  const path = getStoragePath()
  const before = await listLegacySiblings(path)
  // `readDocument` 内部完成合并、写回与归档（缺 `version` 时才触发）。
  const document = await readDocument()
  const remaining = await listLegacySiblings(path)
  // 已合并的文档若仍有残留旧文件（上次归档失败、或用户手工拷回），补一次归档，
  // 否则下次读取会再做一遍无用的合并。
  if (before.length > 0 && remaining.length > 0) {
    await archiveLegacySiblings(options.stamp ?? Date.now())
  }
  const stillThere = await listLegacySiblings(path)
  return {
    legacyFiles: before,
    written: document !== undefined,
    archived: before.length - stillThere.length,
    accounts: document?.accounts.length ?? 0,
    hasPrefs: document?.prefs !== undefined,
    hasGrowthRun: document?.growthRun !== undefined,
  }
}

/** 列出实际存在的旧版兄弟文件路径。 */
async function listLegacySiblings(path: string): Promise<string[]> {
  const found: string[] = []
  for (const suffix of Object.values(LEGACY_SIBLING_SUFFIXES)) {
    const candidate = `${path}${suffix}`
    try {
      await fs.stat(candidate)
      found.push(candidate)
    } catch {
      // 不存在即跳过。
    }
  }
  return found
}

/**
 * 路径是否仅属主可读。
 *
 * 与 `@deepseek-ai/dsh-credentials-local` 在加载自己的凭据文档前所做的
 * 仅属主检查一致：任何 group 或 other 的读/写位被置位即视为文件已暴露，
 * 检查失败。Windows 没有 POSIX mode，因此在那里跳过检查——保护程度
 * 取决于创建与替换 API 所表达的内容，与 dsh-credentials-local 相同。
 * @param path - 凭据文件路径。
 * @returns 文件不存在（尚无可保护之物）或以仅属主权限存在时为 true；
 *   文件存在且已暴露时为 false。
 */
async function isOwnerOnly(path: string): Promise<boolean> {
  if (process.platform === 'win32') return true
  let mode: number
  try {
    mode = (await fs.stat(path)).mode
  } catch {
    // 不存在不算暴露；调用方把它当作"没有凭据"。
    return true
  }
  // 0o077 = group + other 的读/写/执行位。
  return (mode & 0o077) === 0
}

/**
 * 读取已存储的凭据文档，遇到旧的单账号结构时予以迁移。
 *
 * 在读取任何字节之前，先检查文件的 mode：一个宿主机上其他用户可读的
 * 凭据按不存在对待而不被使用，因此丢失了仅属主 mode 的文件（一次错误
 * 的手工 chmod、从别处拷贝而来）绝不会被加载。按不存在对待还能自愈——
 * 下一次登录会以 `0o600` 重写该文件。
 *
 * 旧版 `{auth, account}` 文档透明迁移：变成一条条目为活动的多账号存储，
 * 且只存在于内存中——下一次保存会重写为新结构。`activeId` 不匹配任何
 * 条目的文档保留其条目但把第一条解析为活动，因此手工编辑过的文件退化为
 * "另一个账号是活动"而不是"已登出"。
 * @returns 凭据文档；不存在或不可用时为 `undefined`。文件缺失、损坏与
 *   权限不安全这三种情况刻意是同一个答案：都意味着"这里没有可安全用于
 *   认证的东西"，而登录流程对每一种都是修复手段。
 */
export async function loadStorage(): Promise<CodeBuddyStorage | undefined> {
  const document = await readDocument()
  if (document === undefined || document.accounts.length === 0) return undefined
  const activeId = document.accounts.some(entry => entry.id === document.activeId)
    ? document.activeId!
    : document.accounts[0]!.id
  return { ...document, activeId, accounts: document.accounts }
}

/**
 * 磁盘上的完整文档，含**尚无账号**的情形。
 *
 * 与 {@link CodeBuddyStorage} 的差别只有一处：它允许 `accounts` 为空。这不是
 * 可有可无的宽松——自动偏好与成长任务运行状态与凭据同处一份文档，而两者在
 * 用户还没登录时就必须能落盘（此前各占一个文件，天然没有这个约束）。
 * 账号相关读取仍然经 {@link loadStorage}，它把「零账号」呈现为 `undefined`
 * （即"未登录"），调用方的语义不变。
 */
interface CodeBuddyDocument {
  version: number
  activeId?: string
  accounts: CodeBuddyAccountEntry[]
  prefs?: NonNullable<CodeBuddyStorage['prefs']>
  growthRun?: unknown
}

/**
 * 接受旧版单账号结构，或把已识别的文档降级成文档层形状。
 * @param storage - 账号层文档。
 * @returns 补上 `version` 的文档。
 */
function asDocument(storage: CodeBuddyStorage): CodeBuddyDocument {
  return { ...storage, version: STORAGE_VERSION }
}

/**
 * 读取并规范化整份文档（含零账号的情形），必要时完成迁移。
 *
 * @returns 文档；文件缺失、损坏或权限不安全时为 `undefined`。
 */
async function readDocument(): Promise<CodeBuddyDocument | undefined> {
  const path = getStoragePath()
  try {
    if (!(await isOwnerOnly(path))) return undefined
    const raw = await fs.readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return undefined
    const record = parsed as Record<string, unknown>
    // 账号列表缺失但有 `prefs`/`growthRun` 的文档是合法的：用户尚未登录，
    // 但已经改过自动偏好（或跑过成长任务）。
    const rawAccounts = Array.isArray(record.accounts) ? record.accounts : []
    const accounts = rawAccounts
      .filter(entry => entry !== null && typeof entry === 'object'
        && typeof (entry as CodeBuddyAccountEntry).id === 'string'
        && ((entry as CodeBuddyAccountEntry).id?.length ?? 0) > 0
        && (entry as CodeBuddyAccountEntry).auth?.accessToken !== undefined
        && (entry as CodeBuddyAccountEntry).account?.uid !== undefined)
      .map(entry => normalizeEntry(entry as CodeBuddyAccountEntry))
    const activeId = typeof record.activeId === 'string' ? record.activeId : undefined
    const base: CodeBuddyDocument = {
      ...record,
      version: STORAGE_VERSION,
      ...activeId === undefined ? {} : { activeId },
      accounts,
    }
    // 已合并的文档直接返回；缺 `version` 的是拆分时期的结构，需要把旁边的
    // 兄弟文件并进来。
    if (typeof record.version === 'number' && record.version >= STORAGE_VERSION) return base
    // 旧版单账号结构没有任何账号被识别出来时，再按 legacy 形状试一次。
    if (accounts.length === 0 && !('prefs' in record) && !('growthRun' in record)) {
      const legacy = parsed as LegacyCodeBuddyStorage
      if (legacy.auth?.accessToken !== undefined && legacy.account?.uid !== undefined) {
        return await migrateInPlace(asDocument(migrateLegacy(legacy)))
      }
      // 认不出内容的文档按不存在处理，与旧实现的语义一致。
      return undefined
    }
    return await migrateInPlace(base)
  } catch {
    return undefined
  }
}

/**
 * 就地完成一次迁移：并入兄弟文件、写回单一文档、把旧文件改名保留。
 *
 * 写回失败**不**让读取失败：内存里的文档是完整的，本次会话照常可用；旧文件
 * 因为改名失败而留在原处，下一次读取会再迁移一次（幂等）。反过来若在这里
 * 抛出，用户会在升级后直接变成"未登录"。
 * @param base - 已解析并合并了兄弟文件的文档。
 * @returns 合并后的文档。
 */
async function migrateInPlace(base: CodeBuddyDocument): Promise<CodeBuddyDocument> {
  const merged = await mergeLegacySiblings(base)
  try {
    await saveDocument(merged)
    await archiveLegacySiblings()
  } catch {
    // 落盘失败时仍返回合并结果，见上方说明。
  }
  return merged
}

/**
 * 一次登录之后，`activeId` 应该指向谁。
 *
 * 从 `runLogin` 里提出来的纯规则，便于在不发真实网络请求的前提下验证——
 * 「添加账号不抢占当前账号」这条行为的正确性全压在它身上。
 *
 * 三种情形：
 *  - **首个账号**（`current` 为 undefined）：无视 `activate`，新条目必须成为
 *    当前账号，否则会出现「有账号却没有当前账号」的空悬状态；
 *  - **重复登录已存在账号**：`activate || wasActive`——刷新当前账号的凭据不能
 *    把它自己挤下去；
 *  - **新增账号**：`activate` 为真才切过去，否则保持原样。
 *
 * @param current - 本次登录前的 `activeId`；一个账号都没有时为 undefined。
 * @param freshId - 本次登录产生（或复用）的条目 id。
 * @param activate - 调用方是否要求切换为当前账号。
 * @param wasActive - 被复用的已存在条目此前是否就是当前账号。
 * @returns 落库时应写入的 `activeId`。
 */
export function nextActiveId(
  current: string | undefined,
  freshId: string,
  activate: boolean,
  wasActive = false,
): string {
  if (current === undefined) return freshId
  return activate || wasActive ? freshId : current
}

/**
 * 当前活动账号条目。
 * @param storage - 凭据文档。
 * @returns `activeId` 指向的条目，或第一条。
 */
export function activeEntry(storage: CodeBuddyStorage): CodeBuddyAccountEntry {
  const active = storage.accounts.find(entry => entry.id === storage.activeId)
  return active ?? storage.accounts[0]!
}

/**
 * 凭据文档的写入串行队列。
 *
 * 文档是**单个 JSON**（全部账号共处一份），写入点分散在 session 与 auth-service
 * 两处（切换、改名、删除、登录、token 刷新）。并发写各读一次旧值再各自写回时，
 * 后写的那次会**整体覆盖**前一次的结果，表现为「刚切过去的账号又变回去」
 * 「刚删掉的账号复活」「刚改的备注名丢了」。同类竞态此前已在 token 刷新路径上
 * 真实发生过。
 *
 * 锁放在 storage 层而不是各调用方：只有包住「读-改-写」整个事务才能挡住跨模块
 * 的竞态；放在某个类里只能串行那个类自己的写入。
 */
const mutationQueue = new SerialQueue()

/**
 * 在锁内对凭据文档做一次「读 → 改 → 写」事务。
 *
 * `mutate` 收到**锁内最新**的文档（可能是别的写入刚改过的），返回的新文档会被
 * 立即持久化；返回 `undefined` 表示放弃本次写入（例如 CAS 失败或账号不存在），
 * 此时不落盘也不报错。整个事务期间持有锁，因此不会与其它写入交叉。
 *
 * @param mutate - 纯函数式改动；返回新文档则写入，返回 `undefined` 则放弃。
 * @returns `mutate` 的返回值（写入后的文档或 `undefined`）。
 */
export async function mutateStorage(
  mutate: (current: CodeBuddyStorage | undefined) => CodeBuddyStorage | undefined | Promise<CodeBuddyStorage | undefined>,
): Promise<CodeBuddyStorage | undefined> {
  let outcome: CodeBuddyStorage | undefined
  const written = await mutateDocument(async (current) => {
    // 零账号的文档对账号层调用方呈现为"未登录"（`undefined`），与
    // `loadStorage` 的口径一致。
    const visible = current.accounts.length === 0
      ? undefined
      : { ...current, activeId: current.activeId ?? current.accounts[0]!.id } as CodeBuddyStorage
    const next = await mutate(visible)
    if (next === undefined) return undefined
    outcome = next
    return { ...current, ...next }
  })
  return written === undefined ? undefined : outcome
}

/**
 * 在锁内对**整份文档**做一次「读 → 改 → 写」事务。
 *
 * 与 {@link mutateStorage} 的差别是它不把"零账号"折叠成 `undefined`，因此
 * 偏好与成长任务状态在用户尚未登录时也能落盘。
 *
 * @param mutate - 锁内最新的文档在等着被改；返回 `undefined` 表示放弃写入。
 * @returns 写入后的文档，或放弃时的 `undefined`。
 */
export async function mutateDocument(
  mutate: (current: CodeBuddyDocument) => CodeBuddyDocument | undefined | Promise<CodeBuddyDocument | undefined>,
): Promise<CodeBuddyDocument | undefined> {
  return mutationQueue.runExclusive(async () => {
    const current = (await readDocument()) ?? emptyDocument()
    const next = await mutate(current)
    if (next === undefined) return undefined
    await saveDocument(next)
    return next
  })
}

/** 一份空白文档：没有账号，也没有任何偏好。 */
function emptyDocument(): CodeBuddyDocument {
  return { version: STORAGE_VERSION, accounts: [] }
}

/**
 * 以仅属主权限原子地写入凭据文档。
 *
 * 这是**整份文档**的写入：调用方须传入完整的 `CodeBuddyStorage`（各写路径
 * 都基于锁内最新的文档构造，见 `mutateStorage`）。只想改一个片段时用
 * `mutateStorage` / `mutateDocument`，不要自己读-改-写。
 * @param storage - 待持久化的凭据文档。
 */
export async function saveStorage(storage: CodeBuddyStorage): Promise<void> {
  await saveDocument({ ...storage, version: STORAGE_VERSION })
}

/**
 * 以仅属主权限原子地写入整份文档（允许零账号）。
 * @param document - 待持久化的文档。
 */
async function saveDocument(document: CodeBuddyDocument): Promise<void> {
  const path = getStoragePath()
  await fs.mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify({ ...document, version: STORAGE_VERSION }, null, 2), { encoding: 'utf-8', mode: 0o600 })
    await fs.rename(temp, path)
  } catch (error) {
    await fs.unlink(temp).catch(() => {
      // 写入本身已经失败；临时文件缺失提供不了额外信息。
    })
    throw error
  }
  await fs.chmod(path, 0o600).catch(() => {
    // 没有 POSIX mode 的文件系统（Windows、部分网络挂载）无法收窄权限；
    // 凭据仍会被写入。
  })
}

/**
 * 读取自动切号偏好；默认开启，阈值为 10%。
 *
 * `fromDisk` 表示这份偏好确实存在于文档中，而不是回落到了默认值——调用方
 * 据此判断能否让客户端把已有的 localStorage 值迁移上来（老用户升级）。
 */
export async function loadAutoSwitchConfig(): Promise<AutoSwitchConfig> {
  const stored = (await readDocument())?.prefs?.autoSwitch
  if (stored === undefined) return { enabled: true, thresholdPct: 10, fromDisk: false }
  return { enabled: stored.enabled, thresholdPct: stored.thresholdPct, fromDisk: true }
}

/**
 * 在锁内改动文档的 `prefs` 片段。
 *
 * 走文档锁而不是自己读-改-写：偏好写入与账号操作（登录、切换、删除、token
 * 刷新）、成长任务状态改的是**同一份文档**，各自读一次再各自写回会让后写的
 * 那次整体覆盖前一次的结果。
 *
 * 刻意用 `mutateDocument` 而不是 `mutateStorage`：用户尚未登录时（零账号）
 * 也要能保存偏好。
 * @param patch - 基于当前片段计算新片段。
 */
async function mutatePrefs(
  patch: (current: NonNullable<CodeBuddyStorage['prefs']>) => NonNullable<CodeBuddyStorage['prefs']>,
): Promise<void> {
  await mutateDocument((current) => ({ ...current, prefs: patch(current.prefs ?? {}) }))
}

/** 写入自动切号偏好。 */
export async function saveAutoSwitchConfig(config: Omit<AutoSwitchConfig, 'fromDisk'>): Promise<void> {
  const { enabled, thresholdPct } = config
  await mutatePrefs(prefs => ({ ...prefs, autoSwitch: { enabled, thresholdPct } }))
}

/** 读取自动签到偏好；默认开启。 */
export async function loadAutoCheckinConfig(): Promise<AutoCheckinConfig> {
  const stored = (await readDocument())?.prefs?.autoCheckin
  return { enabled: stored?.enabled ?? true }
}

/** 写入自动签到偏好。 */
export async function saveAutoCheckinConfig(config: AutoCheckinConfig): Promise<void> {
  const { enabled } = config
  await mutatePrefs(prefs => ({ ...prefs, autoCheckin: { enabled } }))
}

/** 读取自动出游偏好；默认开启。 */
export async function loadAutoTravelConfig(): Promise<AutoTravelConfig> {
  const stored = (await readDocument())?.prefs?.autoTravel
  return { enabled: stored?.enabled ?? true }
}

/** 写入自动出游偏好。 */
export async function saveAutoTravelConfig(config: AutoTravelConfig): Promise<void> {
  const { enabled } = config
  await mutatePrefs(prefs => ({ ...prefs, autoTravel: { enabled } }))
}

/**
 * 读取成长任务运行状态片段。
 *
 * 由 `growth-run` 模块解释内容；storage 只负责搬进搬出，避免两个模块在类型
 * 层互相依赖（`growth-run` 依赖 storage，反向依赖会成环）。
 * @returns 原始片段；不存在时为 `undefined`。
 */
export async function readGrowthRunState(): Promise<unknown> {
  return (await readDocument())?.growthRun
}

/**
 * 在锁内对成长任务运行状态做一次「读 → 改 → 写」事务。
 *
 * **必须走这个函数而不是自己 `read` 再 `save`**：状态与账号凭据、自动偏好
 * 同处一份文档，分开读写时并发的偏好写入会把刚追加的执行日志整体覆盖回去。
 * 合并之前两者各有一把锁（同一目录、两份读-改-写），合并文档后只剩这一把锁，
 * 正是修复它的时机。
 *
 * 与偏好一致使用文档锁而非账号层锁：成长任务状态在用户尚未登录时也可能写入。
 * @param mutate - 基于当前片段计算新片段；返回 `undefined` 表示清除该片段。
 */
export async function mutateGrowthRunState(
  mutate: (current: unknown) => unknown,
): Promise<void> {
  await mutateDocument((current) => {
    const next = mutate(current.growthRun)
    if (next === undefined) {
      const { growthRun: _dropped, ...rest } = current
      return rest
    }
    return { ...current, growthRun: next }
  })
}

/**
 * 删除已存储的凭据文档（若存在）。
 *
 * `prefs` 与 `growthRun` 是同一份文档的片段，因此随之一起消失。这是**登出
 * 全部账号**的语义：回到初始状态。单账号删除不走这里——那条路径在锁内重建
 * 文档并保留其余片段（见 `AuthService.removeAccount`）。
 */
export async function clearStorage(): Promise<void> {
  await mutationQueue.runExclusive(async () => {
    await fs.unlink(getStoragePath()).catch(() => {
      // 本就不存在即是期望的终态。
    })
  })
}
