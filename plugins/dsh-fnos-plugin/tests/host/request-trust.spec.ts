import { describe, expect, it } from 'vitest'
import { isTrustedFnosRequest } from '../../src/host/authorized-directories.ts'

/**
 * FNOS-017：同源判定的取值来源必须与网关实际转发的那一套头一致。
 *
 * 缺陷形态：`requestOrigin` 优先读 `x-forwarded-host`，而网关把 `origin` 改写成
 * loopback 权威。两者来源不同，远程域名访问下永远不相等，于是每个请求都 403
 * （`remote-web-origin-not-trusted`）。
 *
 * 这里同时守住两个方向：同源请求必须放行（否则功能不可用），跨站请求必须拒绝
 * （否则等于敞开大门）。只测一侧会把修复做偏。
 */

/** 构造一个请求桩：只需要 `headers` 与 `socket.remoteAddress` 参与判定。 */
function request(headers: Record<string, string>, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } } as unknown as Parameters<typeof isTrustedFnosRequest>[0]
}

/** 网关改写后的常态：host 与 origin 都是 loopback 权威。 */
const loopbackAuthority = '127.0.0.1:8787'
const loopbackOrigin = `http://${loopbackAuthority}`

describe('fnOS 路由同源判定（FNOS-017）', () => {
  it('放行网关改写后的同源请求', () => {
    expect(isTrustedFnosRequest(request({
      host: loopbackAuthority,
      origin: loopbackOrigin,
      'sec-fetch-site': 'same-origin',
    }))).toBe(true)
  })

  /**
   * 缺陷复现：远程域名访问时平台反代注入 `x-forwarded-host`。
   * 修复前此用例失败（判定为不可信）；修复后应放行。
   */
  it('放行带转发头但 origin 已被网关改写的同源请求', () => {
    expect(isTrustedFnosRequest(request({
      host: loopbackAuthority,
      origin: loopbackOrigin,
      'sec-fetch-site': 'same-origin',
      'x-forwarded-host': 'nas-abc123.fnos.net',
      'x-forwarded-proto': 'https',
    }))).toBe(true)
  })

  /** 转发头是逗号列表（多级反代）也不影响判定。 */
  it('忽略转发头的列表形态', () => {
    expect(isTrustedFnosRequest(request({
      host: loopbackAuthority,
      origin: loopbackOrigin,
      'sec-fetch-site': 'same-origin',
      'x-forwarded-host': 'cdn.example, nas-abc123.fnos.net',
      'x-forwarded-proto': 'https, http',
    }))).toBe(true)
  })

  it('拒绝外部 Origin', () => {
    expect(isTrustedFnosRequest(request({
      host: loopbackAuthority,
      origin: 'https://evil.example',
      'sec-fetch-site': 'same-origin',
    }))).toBe(false)
  })

  it('拒绝 Sec-Fetch-Site: cross-site，即使 Origin 看似同源', () => {
    expect(isTrustedFnosRequest(request({
      host: loopbackAuthority,
      origin: loopbackOrigin,
      'sec-fetch-site': 'cross-site',
    }))).toBe(false)
  })

  it('拒绝非回环来源且无 Origin 的请求', () => {
    expect(isTrustedFnosRequest(request({
      host: loopbackAuthority,
      'sec-fetch-site': 'same-origin',
    }, '192.0.2.50'))).toBe(false)
  })

  it('无 Origin 的回环请求按本地直通放行', () => {
    expect(isTrustedFnosRequest(request({
      host: 'nas.local:5666',
      'sec-fetch-site': 'same-origin',
    }))).toBe(true)
  })

  /** host 缺失时不应抛错，也不应因缺权威而误放行非回环请求。 */
  it('host 缺失时回环来源仍放行、非回环仍拒绝', () => {
    expect(isTrustedFnosRequest(request({}, '127.0.0.1'))).toBe(true)
    expect(isTrustedFnosRequest(request({}, '10.0.0.7'))).toBe(false)
  })
})
