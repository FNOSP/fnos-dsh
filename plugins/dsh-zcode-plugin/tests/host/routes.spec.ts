import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { trustedRequest } from '../../src/host/routes.ts'

function request(overrides: {
  headers?: Record<string, string | undefined>
  remoteAddress?: string | undefined
} = {}): IncomingMessage {
  const headers: Record<string, string | undefined> = { host: '127.0.0.1:8080', ...overrides.headers }
  return {
    headers,
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1', encrypted: false },
  } as unknown as IncomingMessage
}

void ({} as ServerResponse)

describe('同源信任边界', () => {
  it('跨站请求一律拒绝', () => {
    expect(trustedRequest(request({ headers: { 'sec-fetch-site': 'cross-site' } }))).toBe(false)
  })

  it('同源 Origin 放行', () => {
    expect(trustedRequest(request({
      headers: { origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-origin' },
    }))).toBe(true)
  })

  it('不同 Origin 拒绝', () => {
    expect(trustedRequest(request({ headers: { origin: 'https://evil.example' } }))).toBe(false)
  })

  it('经网关代理时按 x-forwarded-* 判定同源', () => {
    expect(trustedRequest(request({
      headers: {
        'x-forwarded-host': 'dsm.example.com',
        'x-forwarded-proto': 'https',
        origin: 'https://dsm.example.com',
      },
    }))).toBe(true)
  })

  it('没有 Origin 时只信任回环地址', () => {
    expect(trustedRequest(request())).toBe(true)
    expect(trustedRequest(request({ remoteAddress: '::1' }))).toBe(true)
    expect(trustedRequest(request({ remoteAddress: '10.0.0.5' }))).toBe(false)
  })
})
