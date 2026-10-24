import { createDecipheriv, createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform, tmpdir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  credentialSecret,
  defaultBridgeDataDir,
  deriveCredentialKey,
  encryptCredential,
  isWritableDirectory,
  prepareBridgeDataDir,
  readBuiltinRevision,
  resolveBuiltinConfigPath,
  resolveZCodeCliPath,
  ZCODE_CLI_CANDIDATES,
  zcodeDataDir,
} from '../../../src/host/bridge/runtime-paths.ts'

/** 每个用例自建临时根目录，afterEach 统一回收（用例之间不共享状态）。 */
const tempRoots: string[] = []

function tempDir(prefix = 'zcode-runtime-spec-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

/** 写入一份 provider 配置；`revision` 为 undefined 时省略该字段。 */
function writeBuiltinConfig(path: string, revision: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(revision === undefined ? {} : { revision })}\n`)
}

/** 按客户端的 `enc:v1:<iv>.<tag>.<data>` 格式解密，用于验证密文可被同款实现还原。 */
function decryptCredential(value: string, key: Buffer): string {
  const prefix = 'enc:v1:'
  if (!value.startsWith(prefix)) {
    throw new Error(`凭据缺少 ${prefix} 前缀：${value.slice(0, 24)}`)
  }
  const parts = value.slice(prefix.length).split('.')
  if (parts.length !== 3) {
    throw new Error(`凭据密文应为三段 base64url，实际 ${String(parts.length)} 段`)
  }
  const [ivText, tagText, dataText] = parts as [string, string, string]
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** 具名环境变量：读取 JSON 文件，失败信息里带上文件名。 */
function readJson(path: string): Record<string, unknown> {
  const text = readFileSync(path, 'utf8')
  expect(text.endsWith('\n'), `${path} 应以换行结尾`).toBe(true)
  return JSON.parse(text) as Record<string, unknown>
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
  tempRoots.length = 0
})

describe('resolveZCodeCliPath', () => {
  it('显式配置且文件存在时返回解析后的绝对路径', () => {
    const cli = join(tempDir(), 'zcode.cjs')
    writeFileSync(cli, '')

    expect(resolveZCodeCliPath(cli)).toBe(resolve(cli))
  })

  it('显式配置但文件不存在时返回 undefined，不回落到内置候选', () => {
    const missing = join(tempDir(), 'not-installed', 'zcode.cjs')

    expect(resolveZCodeCliPath(missing)).toBeUndefined()
  })

  it('显式配置为相对路径时按 cwd 解析', () => {
    const cli = join(tempDir(), 'zcode.cjs')
    writeFileSync(cli, '')
    const configured = relative(process.cwd(), cli)

    expect(resolveZCodeCliPath(configured)).toBe(resolve(cli))
  })

  it('空白配置视为未配置：结果只能是内置候选之一或 undefined', () => {
    for (const override of ['', '   ', '\t']) {
      const resolved = resolveZCodeCliPath(override)
      const accepted = resolved === undefined || ZCODE_CLI_CANDIDATES.includes(resolved)
      expect(accepted, `空白配置 "${override}" 不应原样返回`).toBe(true)
    }
  })
})

describe('resolveBuiltinConfigPath', () => {
  it('发行包布局：<Resources>/config/provider/zcode-builtin.json', () => {
    const resources = join(tempDir(), 'Resources')
    const cli = join(resources, 'glm', 'zcode.cjs')
    const config = join(resources, 'config', 'provider', 'zcode-builtin.json')
    mkdirSync(join(resources, 'glm'), { recursive: true })
    writeFileSync(cli, '')
    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, '{}')

    expect(resolveBuiltinConfigPath(cli)).toBe(config)
  })

  it('历史布局：CLI 同目录 provider/zcode-builtin.json', () => {
    const glm = join(tempDir(), 'glm')
    const cli = join(glm, 'zcode.cjs')
    const config = join(glm, 'provider', 'zcode-builtin.json')
    mkdirSync(glm, { recursive: true })
    writeFileSync(cli, '')
    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, '{}')

    expect(resolveBuiltinConfigPath(cli)).toBe(config)
  })

  it('两种布局同时存在时优先发行包布局', () => {
    const resources = join(tempDir(), 'Resources')
    const cli = join(resources, 'glm', 'zcode.cjs')
    const preferred = join(resources, 'config', 'provider', 'zcode-builtin.json')
    const legacy = join(resources, 'glm', 'provider', 'zcode-builtin.json')
    mkdirSync(join(resources, 'glm'), { recursive: true })
    writeFileSync(cli, '')
    for (const path of [preferred, legacy]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '{}')
    }

    expect(resolveBuiltinConfigPath(cli)).toBe(preferred)
  })

  it('两种布局都缺失时返回 undefined', () => {
    const cli = join(tempDir(), 'zcode.cjs')
    writeFileSync(cli, '')

    expect(resolveBuiltinConfigPath(cli)).toBeUndefined()
  })
})

describe('readBuiltinRevision', () => {
  it('按 zcode-builtin:<revision>:<sha256(绝对路径)> 组合', () => {
    const path = join(tempDir(), 'config', 'provider', 'zcode-builtin.json')
    writeBuiltinConfig(path, 7)
    const expected = `zcode-builtin:7:${createHash('sha256').update(resolve(path)).digest('hex')}`

    expect(readBuiltinRevision(path)).toBe(expected)
  })

  it('含 .. 的入参先解析成绝对路径再取摘要（与内部加载路径对齐）', () => {
    const root = tempDir()
    const path = join(root, 'provider', 'zcode-builtin.json')
    writeBuiltinConfig(path, 3)
    const withDotDot = join(root, 'provider', '..', 'provider', 'zcode-builtin.json')
    const expected = `zcode-builtin:3:${createHash('sha256').update(resolve(path)).digest('hex')}`

    expect(readBuiltinRevision(withDotDot)).toBe(expected)
  })

  it('revision 必须是整数：缺失 / 字符串 / 小数都抛错并带上配置路径', () => {
    const cases: Array<[string, unknown]> = [
      ['缺少 revision', undefined],
      ['revision 为字符串', '7'],
      ['revision 为小数', 1.5],
    ]
    for (const [label, revision] of cases) {
      const path = join(tempDir(), 'zcode-builtin.json')
      writeBuiltinConfig(path, revision)
      try {
        readBuiltinRevision(path)
        expect.unreachable(`${label} 时应抛错`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message, `${label} 的报错应包含 "缺少整数 revision"`).toContain('缺少整数 revision')
        expect(message, `${label} 的报错应包含解析后的配置路径`).toContain(resolve(path))
      }
    }
  })
})

describe('encryptCredential', () => {
  const SECRET = 'runtime-paths-spec-secret'
  const key = deriveCredentialKey(SECRET)

  it('输出 enc:v1: 前缀与三段 base64url，可被同款解密还原', () => {
    const encrypted = encryptCredential('glm-account-jwt', key)

    expect(encrypted.startsWith('enc:v1:')).toBe(true)
    const parts = encrypted.slice('enc:v1:'.length).split('.')
    expect(parts, '密文应为 iv.tag.data 三段').toHaveLength(3)
    for (const [index, part] of parts.entries()) {
      expect(part, `第 ${String(index + 1)} 段应为 base64url`).toMatch(/^[A-Za-z0-9_-]+$/)
    }
    expect(decryptCredential(encrypted, key)).toBe('glm-account-jwt')
  })

  it('同一明文两次加密的密文不同（随机 IV），但都能还原', () => {
    const first = encryptCredential('same-plaintext', key)
    const second = encryptCredential('same-plaintext', key)

    expect(first).not.toBe(second)
    expect(decryptCredential(first, key)).toBe('same-plaintext')
    expect(decryptCredential(second, key)).toBe('same-plaintext')
  })

  it('默认密钥取自 credentialSecret：可用 deriveCredentialKey(固定 secret) 复现', () => {
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', SECRET)
    const encrypted = encryptCredential('中文凭据-😀')

    expect(decryptCredential(encrypted, deriveCredentialKey(SECRET))).toBe('中文凭据-😀')
  })

  it('传入自定义 key 时按该 key 加解密，换 key 解密失败', () => {
    const custom = createHash('sha256').update('another-secret').digest()
    const encrypted = encryptCredential('payload', custom)

    expect(decryptCredential(encrypted, custom)).toBe('payload')
    expect(() => decryptCredential(encrypted, key)).toThrow()
  })
})

describe('credentialSecret 与 deriveCredentialKey', () => {
  it('显式参数优先于环境变量，并去掉首尾空白', () => {
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', 'from-env')

    expect(credentialSecret('  explicit-secret  ')).toBe('explicit-secret')
  })

  it('未传显式参数时使用环境变量', () => {
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', '  from-env  ')

    expect(credentialSecret()).toBe('from-env')
  })

  it('环境变量为空白时回退到机器指纹', () => {
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', '   ')

    expect(credentialSecret()).toBe(
      `zcode-credential-fallback:${platform()}:${homedir()}:${userName()}`,
    )
  })

  it('环境变量未设置时回退到机器指纹，且形态稳定', () => {
    const original = process.env.ZCODE_CREDENTIAL_SECRET
    delete process.env.ZCODE_CREDENTIAL_SECRET
    try {
      const secret = credentialSecret()
      expect(secret.startsWith('zcode-credential-fallback:')).toBe(true)
      expect(secret).toContain(`:${platform()}:`)
      expect(secret).toContain(`:${homedir()}:`)
    } finally {
      if (original !== undefined) process.env.ZCODE_CREDENTIAL_SECRET = original
    }
  })

  it('密钥是 secret 的 SHA-256 摘要（32 字节，确定性）', () => {
    const derived = deriveCredentialKey('abc')
    const expected = createHash('sha256').update('abc').digest()

    expect(derived).toHaveLength(32)
    expect(derived.equals(expected)).toBe(true)
    expect(deriveCredentialKey('abc').equals(derived)).toBe(true)
    expect(deriveCredentialKey('abd').equals(derived)).toBe(false)
  })
})

/** 与服务端 fingerprint 一致的降级用户名；取不到时实现里也回退 `unknown`。 */
function userName(): string {
  try {
    return userInfo().username
  } catch {
    return 'unknown'
  }
}

describe('isWritableDirectory', () => {
  it('已存在且可写的目录返回 true', () => {
    expect(isWritableDirectory(tempDir())).toBe(true)
  })

  it('目录尚不存在但最近已存在祖先可写时返回 true（语义是「能建出来」）', () => {
    const root = tempDir()

    expect(isWritableDirectory(join(root, 'a', 'b', 'c'))).toBe(true)
  })

  it('不可写的根级路径返回 false', () => {
    // 根目录对非 root 不可写；用不存在的根级名字验证「一路向上都不可写」。
    if (isRoot) return
    expect(isWritableDirectory(`/zcode-spec-unwritable-${String(process.pid)}`)).toBe(false)
  })

})

describe('prepareBridgeDataDir', () => {
  function prepare(family: 'bigmodel' | 'zai' = 'bigmodel', jwt = 'jwt-value'): {
    base: string
    dataDir: string
  } {
    const requested = join(tempDir(), 'bridge')
    const returned = prepareBridgeDataDir({ dataDir: requested, accountJwt: jwt, family })
    return { base: returned, dataDir: zcodeDataDir(requested) }
  }

  it('写入三份文件并返回解析后的数据根目录', () => {
    const { base, dataDir } = prepare()

    expect(base).toBe(resolve(dirname(dirname(dataDir))))
    for (const name of ['credentials.json', 'setting.json', 'provider_config.json']) {
      expect(() => statSync(join(dataDir, name)), `${name} 应已写入`).not.toThrow()
    }
  })

  it('三份文件权限都是 0600', () => {
    const { dataDir } = prepare()

    for (const name of ['credentials.json', 'setting.json', 'provider_config.json']) {
      const mode = statSync(join(dataDir, name)).mode & 0o777
      expect(mode, `${name} 的权限应为 0600`).toBe(0o600)
    }
  })

  it('credentials.json 以 enc:v1 写入 JWT 与 active provider，可解密还原', () => {
    const { dataDir } = prepare('bigmodel', 'account-jwt-123')
    const credentials = readJson(join(dataDir, 'credentials.json'))
    const key = deriveCredentialKey()

    expect(Object.keys(credentials).sort()).toEqual(['oauth:active_provider', 'zcodejwttoken'])
    const token = credentials.zcodejwttoken
    const active = credentials['oauth:active_provider']
    expect(typeof token).toBe('string')
    expect(typeof active).toBe('string')
    expect(decryptCredential(token as string, key)).toBe('account-jwt-123')
    expect(decryptCredential(active as string, key)).toBe('bigmodel')
  })

  it('setting.json 把家族声明为 start-plan 连接类型', () => {
    const { dataDir } = prepare('zai')
    const setting = readJson(join(dataDir, 'setting.json'))

    expect(setting).toEqual({
      providerFamilyConnectionSelections: { zai: { kind: 'start-plan' } },
    })
  })

  it('provider_config.json 是空的个人 provider 规则骨架', () => {
    const { dataDir } = prepare()

    expect(readJson(join(dataDir, 'provider_config.json'))).toEqual({
      schemaVersion: 1,
      config: {
        providerConfigRules: { providerRules: [] },
        modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      },
    })
  })

  it('重复调用会按新凭据对账覆盖（启动时幂等重写）', () => {
    const requested = join(tempDir(), 'bridge')
    prepareBridgeDataDir({ dataDir: requested, accountJwt: 'old-jwt', family: 'bigmodel' })
    const returned = prepareBridgeDataDir({
      dataDir: requested,
      accountJwt: 'new-jwt',
      family: 'bigmodel',
    })
    const dataDir = zcodeDataDir(requested)
    const credentials = readJson(join(dataDir, 'credentials.json'))

    expect(returned).toBe(resolve(requested))
    expect(decryptCredential(credentials.zcodejwttoken as string, deriveCredentialKey()))
      .toBe('new-jwt')
    expect(statSync(join(dataDir, 'credentials.json')).mode & 0o777).toBe(0o600)
  })
})

describe('数据目录布局常量', () => {
  it('zcodeDataDir 是 <base>/.zcode/v2，插件目录是 <dshHome>/zcode-bridge', () => {
    expect(zcodeDataDir('/data/base')).toBe('/data/base/.zcode/v2')
    expect(defaultBridgeDataDir('/dsh/home')).toBe('/dsh/home/zcode-bridge')
  })
})
