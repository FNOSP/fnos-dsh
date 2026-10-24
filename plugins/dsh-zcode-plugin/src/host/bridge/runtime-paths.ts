/**
 * ZCode 客户端运行时定位与插件自有数据目录。
 *
 * 为什么需要本机客户端：Start Plan 端点的请求由 agent 二进制自己构造并签名，
 * 插件无法在 Node 侧复现（HTTP 直连会被上游按来源拦掉）。因此执行通道是
 * 「托管官方 `zcode app-server` 子进程」，插件只负责协议、凭据与流改写。
 *
 * 数据目录策略：**不使用用户桌面端的数据目录**。桌面端的 `~/.zcode` 可能被
 * 文件策略限制为只读，子进程无法写入会话库/运行时目录时回合会静默卡住
 * （实测：send 被接受、`status: running`，但永远没有 model 请求）。这里改为
 * 在 DSH home 下建立一个插件专属、可写、每次启动都对账的目录：
 *
 * - `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` / `ZCODE_SESSION_DB` 全部指向它；
 * - provider 配置用客户端发行包里自带的那份（不依赖桌面端是否登录过）；
 * - 凭据由插件按客户端同款格式（AES-256-GCM + 机器指纹）写入。
 *
 * @module dsh-zcode/bridge/runtime-paths
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 客户端自带的 CLI 候选路径（按顺序探测第一个存在的）。 */
export const ZCODE_CLI_CANDIDATES: readonly string[] = [
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  '/opt/ZCode/resources/glm/zcode.cjs',
  join(homedir(), 'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'),
]

/** 探测不到客户端版本时的兜底值（仅影响客户端身份头，不参与鉴权）。 */
export const ZCODE_FALLBACK_APP_VERSION = '3.16.3'

/** 插件数据目录名（位于 DSH home 下）。 */
export const ZCODE_BRIDGE_DIRNAME = 'zcode-bridge'

/** 解析 CLI 路径；显式配置优先。 */
export function resolveZCodeCliPath(override?: string): string | undefined {
  const configured = override?.trim() ?? ''
  if (configured !== '') return existsSync(configured) ? resolve(configured) : undefined
  return ZCODE_CLI_CANDIDATES.find(candidate => existsSync(candidate))
}

/**
 * 解析客户端自带的 provider 配置。
 *
 * 发行包布局是 `Resources/glm/zcode.cjs` 与 `Resources/config/provider/zcode-builtin.json`；
 * 也兼容把配置放在 CLI 同目录 `provider/` 下的历史布局。
 */
export function resolveBuiltinConfigPath(cliPath: string): string | undefined {
  const cliDir = dirname(resolve(cliPath))
  const candidates = [
    join(cliDir, '..', 'config', 'provider', 'zcode-builtin.json'),
    join(cliDir, 'provider', 'zcode-builtin.json'),
  ]
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * 计算 `provider/updateAccountConfig` 要求的 `basedOnZCodeBuiltinRevision`。
 *
 * registry 的合并守卫做严格相等比较，一个字符都不能差，否则注入被**静默丢弃**：
 * 注入返回 `received`、`providerCount` 正常，但模型永远进不了会话。这也是最容易
 * 踩空的一处——所以这里直接对实际使用的配置文件取摘要。
 */
export function readBuiltinRevision(builtinPath: string): string {
  const anchored = resolve(builtinPath)
  const release = JSON.parse(readFileSync(anchored, 'utf8')) as { revision?: unknown }
  const revision = release.revision
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    throw new TypeError(`zcode: ${anchored} 缺少整数 revision`)
  }
  const hash = createHash('sha256').update(anchored).digest('hex')
  return `zcode-builtin:${revision}:${hash}`
}

/** 判断目录（或其最近已存在祖先）是否可写。 */
export function isWritableDirectory(target: string): boolean {
  let current = resolve(target)
  for (;;) {
    try {
      accessSync(current, constants.W_OK)
      return true
    } catch {
      const parent = dirname(current)
      if (parent === current) return false
      current = parent
    }
  }
}

/**
 * 复刻客户端 `resolveCredentialSecret` 的机器指纹。
 *
 * 必须与子进程看到的环境一致：插件不覆盖 `HOME`，否则子进程算出的指纹与这里
 * 不同，写进去的凭据它解不开。
 */
export function credentialSecret(explicit?: string): string {
  const fromEnv = explicit ?? process.env.ZCODE_CREDENTIAL_SECRET
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  let username = 'unknown'
  try {
    username = userInfo().username
  } catch {
    // 用户名不可得时与客户端一致地降级，避免整个通道因取不到用户名而不可用。
  }
  return `zcode-credential-fallback:${platform()}:${homedir()}:${username}`
}

/** 派生 AES-256-GCM 密钥（SHA-256 摘要，与客户端一致）。 */
export function deriveCredentialKey(explicitSecret?: string): Buffer {
  return createHash('sha256').update(credentialSecret(explicitSecret)).digest()
}

/** 用客户端同款格式加密单个凭据值（`enc:v1:<iv>.<tag>.<data>`）。 */
export function encryptCredential(plain: string, key: Buffer = deriveCredentialKey()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`
}

/** 客户端数据目录（`<base>/.zcode/v2`）。 */
export function zcodeDataDir(baseDir: string): string {
  return join(baseDir, '.zcode', 'v2')
}

/** 插件自有数据目录的默认位置。 */
export function defaultBridgeDataDir(dshHome: string): string {
  return join(dshHome, ZCODE_BRIDGE_DIRNAME)
}

/**
 * 建立插件自有数据目录并对账三份文件。
 *
 * 三份文件都是「必须存在且内容正确」的：凭据（鉴权）、`setting.json`
 * （`start-plan` 连接类型）、`provider_config.json`（空的个人 provider 规则）。
 * 客户端在缺失时会自行降级到 `0.0.0-dev` 目录，注入的 revision 与它对不上，
 * 表现为模型不在 registry 里——所以这里每次都写。
 */
export function prepareBridgeDataDir(options: {
  readonly dataDir: string
  readonly accountJwt: string
  readonly family: 'bigmodel' | 'zai'
}): string {
  const base = resolve(options.dataDir)
  const dataDir = zcodeDataDir(base)
  mkdirSync(dataDir, { recursive: true })

  // `writeFileSync` 的 mode 只在创建时生效；已有文件（可能是 0644 的旧版本）要显式收紧。
  const writePrivate = (name: string, body: string): void => {
    const target = join(dataDir, name)
    writeFileSync(target, body, { mode: 0o600 })
    try {
      chmodSync(target, 0o600)
    } catch {
      // Windows 无 POSIX 位，忽略。
    }
  }

  writePrivate(
    'credentials.json',
    `${JSON.stringify({
      zcodejwttoken: encryptCredential(options.accountJwt),
      'oauth:active_provider': encryptCredential(options.family),
    })}\n`,
  )
  writePrivate(
    'setting.json',
    `${JSON.stringify({
      providerFamilyConnectionSelections: { [options.family]: { kind: 'start-plan' } },
    })}\n`,
  )
  writePrivate(
    'provider_config.json',
    `${JSON.stringify({
      schemaVersion: 1,
      config: {
        providerConfigRules: { providerRules: [] },
        modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      },
    })}\n`,
  )
  return base
}
