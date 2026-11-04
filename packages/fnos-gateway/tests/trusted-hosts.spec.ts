import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatTrustedHostIssues, validateTrustedHosts } from '../src/install-callback-helper/trusted-hosts.ts'

/**
 * FNOS-043：「可信访问地址」的校验（issue #30）。
 *
 * 事故链条：向导放行 `http://192.0.2.10` → DSH 的 `assertTrustedAuthority()`
 * 以「不是裸 host[:port]」拒绝 → `connection` 是 required 插件 → `dsh web`
 * exit 1 → 界面报「请检查 Node.js 依赖」，用户无法自救。
 *
 * 因此这里钉住三件事：与 DSH 相同的接受面、明确拒绝的诱因、以及三处实现
 * （向导正则 / 安装回调 / 启动日志）**判定一致**——两套规则漂移就会重新放行。
 */

const accepted = [
  '192.0.2.10',
  '192.0.2.10:5666',
  'nas',
  'nas.local',
  'nas.local:5666',
  'xn--fiqs8s.example',
  '[fd00::1]',
  '[fd00::1]:5666',
  'a.b-c_d:1',
  '192.0.2.10:65535',
]

const rejected: Array<[string, string]> = [
  ['http://192.0.2.10', 'scheme'],
  ['https://nas', 'scheme'],
  ['192.0.2.10/', 'path'],
  ['nas/web', 'path'],
  ['user@nas', 'userinfo'],
  ['nas 5666', 'whitespace'],
  ['nas\t5666', 'whitespace'],
  ['::1', 'ipv6-unbracketed'],
  ['fd00::1', 'ipv6-unbracketed'],
  ['[fd00::1', 'ipv6-unbracketed'],
  ['nas:', 'port-invalid'],
  ['nas:0', 'port-invalid'],
  ['nas:65536', 'port-invalid'],
  ['nas:05666', 'port-leading-zero'],
  ['-nas', 'host-invalid'],
  ['nas-', 'host-invalid'],
]

describe('FNOS-043 单条目判定与 DSH 一致', () => {
  it('接受裸 host / host:port / 方括号 IPv6 / punycode', () => {
    for (const value of accepted) {
      expect(validateTrustedHosts(value), value).toMatchObject({ ok: true, issues: [] })
    }
  })

  it('拒绝带协议头、路径、userinfo、空白、裸 IPv6 与非法端口', () => {
    for (const [value, problem] of rejected) {
      const result = validateTrustedHosts(value)
      expect(result.ok, value).toBe(false)
      expect(result.issues[0]?.problem, value).toBe(problem)
    }
  })

  it('多条目逐个判定，好的不掩盖坏的', () => {
    const result = validateTrustedHosts('nas:5666,http://bad,other:1')
    expect(result.ok).toBe(false)
    expect(result.entries).toBe(3)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toEqual({ entry: 'http://bad', problem: 'scheme' })
  })

  it('空条目（多余逗号）被拒', () => {
    expect(validateTrustedHosts('a,,b').issues.map(i => i.problem)).toEqual(['empty'])
    expect(validateTrustedHosts('a,').issues.map(i => i.problem)).toEqual(['empty'])
    expect(validateTrustedHosts(',a').issues.map(i => i.problem)).toEqual(['empty'])
  })

  it('整体为空视为未配置（升级路径上可能没有该值）', () => {
    expect(validateTrustedHosts('')).toEqual({ ok: true, entries: 0, issues: [] })
  })

  it('日志文案带上条目原文与原因', () => {
    const detail = formatTrustedHostIssues(validateTrustedHosts('http://192.0.2.10').issues)
    expect(detail).toContain('http://192.0.2.10')
    expect(detail).toContain('协议头')
  })
})

describe('FNOS-043 向导正则与本校验器判定一致', () => {
  const config = JSON.parse(readFileSync(
    new URL('../../../apps/fn-deepseek-harness/wizard/config', import.meta.url),
    'utf8',
  )) as unknown

  function findField(node: unknown): { pattern?: string } | undefined {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findField(item)
        if (found !== undefined) return found
      }
      return undefined
    }
    if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (record.field === 'wizard_trusted_hosts') {
        const rules = record.rules as Array<{ pattern?: string }> | undefined
        return rules?.find(rule => typeof rule.pattern === 'string')
      }
      for (const value of Object.values(record)) {
        const found = findField(value)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  const pattern = findField(config)?.pattern ?? ''
  const wizard = new RegExp(pattern, 'u')

  it('向导正则接受校验器接受的每一个值', () => {
    expect(pattern).not.toBe('')
    for (const value of accepted) expect(wizard.test(value), value).toBe(true)
  })

  it('向导正则拒绝校验器拒绝的每一个值', () => {
    for (const [value] of rejected) expect(wizard.test(value), value).toBe(false)
  })

  it('向导正则不接受空串（该字段必填）', () => {
    expect(wizard.test('')).toBe(false)
  })
})

describe('FNOS-043 安装与启动两侧都接上校验', () => {
  const installCallback = readFileSync(
    new URL('../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url),
    'utf8',
  )
  const mainScript = readFileSync(
    new URL('../../../apps/fn-deepseek-harness/cmd/main', import.meta.url),
    'utf8',
  )

  it('安装回调调用校验器，并在失败时中止安装', () => {
    expect(installCallback).toContain('run_install_callback_helper validate-trusted-hosts')
    expect(installCallback).toContain('validate_trusted_hosts()')
    // 失败必须走 fail_install（写入 TRIM_TEMP_LOGFILE 并 exit 1），而不是只记日志。
    expect(installCallback).toMatch(/fail_install "「可信访问地址」填写有误/u)
    // 必须挂在配置校验里，才在真正装东西之前生效。
    expect(installCallback).toMatch(/validate_install_configuration\(\) \{[\s\S]*validate_trusted_hosts/u)
  })

  it('启动脚本把非法值记进日志，并点明不是依赖问题', () => {
    expect(mainScript).toContain('report_trusted_hosts_configuration')
    expect(mainScript).toContain("validate-trusted-hosts")
    expect(mainScript).toContain('不是 Node.js 依赖问题')
    // 只记录，不改写用户输入。
    expect(mainScript).not.toContain('sed -e \'s#^[A-Za-z]')
  })
})

describe('FNOS-043 三份向导必须一致', () => {
  // 真机教训：app 目录里有 wizard/{config,install,upgrade} 三份向导，装/升级各用一份。
  // 首版只改了 config，结果升级走 upgrade —— 界面仍是旧规则，`http://` 照旧被放行。
  // 这条用例把三份的 pattern 钉在一起，再漏就在测试阶段暴露。
  const files = ['config', 'install', 'upgrade'] as const

  function trustedHostPattern(path: string): string | undefined {
    const data = JSON.parse(readFileSync(new URL(`../../../apps/fn-deepseek-harness/wizard/${path}`, import.meta.url), 'utf8')) as unknown
    function walk(node: unknown): string | undefined {
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = walk(item)
          if (found !== undefined) return found
        }
        return undefined
      }
      if (node !== null && typeof node === 'object') {
        const record = node as Record<string, unknown>
        if (record.field === 'wizard_trusted_hosts') {
          const rules = record.rules as Array<{ pattern?: string }> | undefined
          return rules?.find(rule => typeof rule.pattern === 'string')?.pattern
        }
        for (const value of Object.values(record)) {
          const found = walk(value)
          if (found !== undefined) return found
        }
      }
      return undefined
    }
    return walk(data)
  }

  const patterns = files.map(file => ({ file, pattern: trustedHostPattern(file) }))

  it('三份向导都存在可信地址字段', () => {
    for (const entry of patterns) expect(entry.pattern, entry.file).toBeTypeOf('string')
  })

  it('三份的正则完全相同', () => {
    const unique = new Set(patterns.map(entry => entry.pattern))
    expect(unique.size, JSON.stringify(patterns.map(p => p.file))).toBe(1)
  })

  it('三份都拒绝带协议头的写法', () => {
    for (const entry of patterns) {
      const regex = new RegExp(entry.pattern ?? '', 'u')
      expect(regex.test('http://192.0.2.10'), entry.file).toBe(false)
      expect(regex.test('192.0.2.10:5666'), entry.file).toBe(true)
    }
  })
})
