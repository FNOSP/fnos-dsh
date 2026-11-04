/**
 * 「可信访问地址」的校验：与 DSH `client-connection` 的接受条件保持一致。
 *
 * 背景（issue #30）：向导里填 `http://192.0.2.10` 能让安装完成，但 DSH 的
 * `assertTrustedAuthority()` 只接受**规范化的裸 authority**（`host` 或
 * `host:port`，要经 WHATWG 解析后原样还原）。带 scheme、路径、`user@`、空白、
 * 悬空冒号或补零端口都会被它拒绝；`connection` 是 required 插件，于是
 * `dsh web` 直接 exit 1，界面却报「请确认 Node.js v24 等依赖已安装」。
 *
 * 这里**不替用户改写**（不做静默规范化）：DSH 的设计就是「typo 要大声失败」，
 * 我们只负责在更早的位置用同一套判定把问题说清楚——向导拦一次、安装拦一次、
 * 启动前再记一条日志。
 *
 * 判定细则（与 DSH 的注释逐条对应）：
 * - 允许：`nas`、`nas:5666`、`192.0.2.10:5666`、`[fd00::1]`、`[fd00::1]:5666`、
 *   punycode 主机名（`xn--...`）、逗号分隔的多个条目。
 * - 拒绝：`http://x`、`x/path`、`user@x`、含空白、`x:`（悬空冒号）、
 *   `x:05666`（补零端口）、`x:0` / `x:65536`（越界）、裸 IPv6（`::1`、
 *   `fd00::1`，必须加方括号）、空条目（`a,,b`、结尾逗号）。
 */

/** 单条目被拒的原因，供调用方翻成可读文案。 */
export type TrustedHostProblem =
  | 'empty'
  | 'scheme'
  | 'path'
  | 'userinfo'
  | 'whitespace'
  | 'ipv6-unbracketed'
  | 'port-invalid'
  | 'port-leading-zero'
  | 'host-invalid'

export interface TrustedHostIssue {
  /** 条目原文（未修剪，便于日志里对齐用户输入）。 */
  entry: string
  problem: TrustedHostProblem
}

export interface TrustedHostValidation {
  /** 全部条目都合法（或整体为空）。 */
  ok: boolean
  /** 拆分出的条目数。 */
  entries: number
  issues: TrustedHostIssue[]
}

/** 1-65535，且不允许前导零（`05666` 会把「精确端口」放宽成别的语义）。 */
const PORT_PATTERN = /^(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/u

/** 主机名（含 punycode 与点分 IPv4）：首尾必须是字母数字。 */
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u

/** 方括号 IPv6 字面量（`[fd00::1]`）。 */
const IPV6_PATTERN = /^\[[0-9A-Fa-f:.]+\]$/u

function checkEntry(entry: string): TrustedHostProblem | undefined {
  if (entry.length === 0) return 'empty'
  // 先按「一眼可辨」的字符违规分类，报错更贴近用户实际写的东西。
  if (/\s/u.test(entry)) return 'whitespace'
  if (entry.includes('://')) return 'scheme'
  if (entry.includes('/')) return 'path'
  if (entry.includes('@')) return 'userinfo'

  // 方括号 IPv6：方括号内整体是地址，冒号不作为端口分隔符。
  if (entry.startsWith('[')) {
    const close = entry.indexOf(']')
    if (close < 0) return 'ipv6-unbracketed'
    const address = entry.slice(0, close + 1)
    if (!IPV6_PATTERN.test(address)) return 'host-invalid'
    const rest = entry.slice(close + 1)
    if (rest.length === 0) return undefined
    if (!rest.startsWith(':')) return 'host-invalid'
    return portProblem(rest.slice(1))
  }

  const firstColon = entry.indexOf(':')
  if (firstColon < 0) return HOST_PATTERN.test(entry) ? undefined : 'host-invalid'

  // 未加方括号的 IPv6：出现第二个冒号即视为「漏了方括号」。
  if (entry.includes(':', firstColon + 1)) return 'ipv6-unbracketed'

  const host = entry.slice(0, firstColon)
  if (!HOST_PATTERN.test(host)) return 'host-invalid'
  return portProblem(entry.slice(firstColon + 1))
}

function portProblem(port: string): TrustedHostProblem | undefined {
  if (port.length === 0) return 'port-invalid'
  if (PORT_PATTERN.test(port)) return undefined
  // 纯数字但不合法：区分「补零」与「越界」，前者是常见误解。
  if (/^\d+$/u.test(port)) return port.length > 1 && port.startsWith('0') ? 'port-leading-zero' : 'port-invalid'
  // 非数字段落在 `host:` 之后，通常是用户把自己的 scheme 当成端口写了。
  return 'scheme'
}

/**
 * 校验向导里的「可信访问地址」原始字符串。
 *
 * 空字符串视为「未配置」（升级路径上可能没有该值），返回 ok。
 */
export function validateTrustedHosts(raw: string): TrustedHostValidation {
  if (raw.length === 0) return { ok: true, entries: 0, issues: [] }
  const entries = raw.split(',')
  const issues: TrustedHostIssue[] = []
  for (const entry of entries) {
    const problem = checkEntry(entry)
    if (problem !== undefined) issues.push({ entry, problem })
  }
  return { ok: issues.length === 0, entries: entries.length, issues }
}

/** 把原因翻成中文，日志与报错共用。 */
export function describeTrustedHostProblem(problem: TrustedHostProblem): string {
  switch (problem) {
    case 'empty': return '有空条目（多余逗号）'
    case 'scheme': return '带了 http:// 或 https:// 之类的协议头'
    case 'path': return '带了路径（例如结尾的 /）'
    case 'userinfo': return '带了 user@ 形式的前缀'
    case 'whitespace': return '含空白字符'
    case 'ipv6-unbracketed': return 'IPv6 地址必须写在方括号里（如 [fd00::1]）'
    case 'port-invalid': return '端口为空、越界或不是数字（有效范围 1-65535）'
    case 'port-leading-zero': return '端口不能有前导零'
    case 'host-invalid': return '主机名不合法'
  }
}

/** 一行可读结论，例如用于安装失败或启动日志。 */
export function formatTrustedHostIssues(issues: readonly TrustedHostIssue[]): string {
  return issues
    .map(issue => `"${issue.entry}"：${describeTrustedHostProblem(issue.problem)}`)
    .join('；')
}
