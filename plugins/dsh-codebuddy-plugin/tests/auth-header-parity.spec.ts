import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { srcPath } from './paths.ts'

/**
 * 与官方 CLI（`@tencent-ai/codebuddy-code`）的 auth 请求头对齐。
 *
 * 核对方式：解包全局安装的 2.159.0，读它 `dist/codebuddy.js` 里四条 auth 请求的
 * 头构造，逐条比对。CLI 是这份契约的参考实现——服务端会按它演进，我们只是复刻。
 *
 * 两处此前缺失（均非刻意省略，源码里也没有「为什么不带」的说明）：
 *
 *  1. `auth/state` 缺 `X-No-Department-Info`（CLI 在这里发四个否定头，我们只发三个）；
 *     `login/account` 也缺同一个头——但注意它**不带** `X-No-Authorization`，因为这一步
 *     要用真实 token 换账号资料。
 *  2. `auth/token/refresh` 缺 `X-Auth-Refresh-Source: plugin`。CLI 在 refresh 与
 *     logout 上都带它，取值恒为 `plugin`，用于服务端区分刷新来源。
 *
 * 这两处**都不曾被观测为故障**（`auth/state` 的真实网络用例一直通过），因此这是
 * 对齐参考实现、而不是修一个已复现的问题——据此标注为防御性对齐。
 */
describe('auth 请求头与官方 CLI 对齐', () => {
  const SRC = readFileSync(srcPath('host/codebuddy.ts'), 'utf8')

  it('auth/state 发满四个 X-No-* 头（含 Department-Info）', () => {
    const start = SRC.indexOf('export async function requestAuthState')
    const body = SRC.slice(start, SRC.indexOf('export async function pollAuthToken', start))
    for (const header of ['X-No-Authorization', 'X-No-User-Id', 'X-No-Enterprise-Id', 'X-No-Department-Info']) {
      expect(body, `auth/state 缺 ${header}`).toContain(header)
    }
  })

  it('login/account 带真实 Authorization + 三个 X-No-*（不含 Authorization 的否定头）', () => {
    // 与 auth/state 不同：这一步**必须**带真实 `Authorization`（用刚拿到的 access
    // token 去换账号资料），因此 CLI 这里不发 `X-No-Authorization`，只发另外三个
    // 否定头。照抄「四处都发四个」会把这个端点发成无凭据请求。
    const start = SRC.indexOf('export async function getLoginAccount')
    const body = SRC.slice(start, start + 900)
    expect(body).toContain('Authorization')
    expect(body).not.toContain('X-No-Authorization')
    for (const header of ['X-No-User-Id', 'X-No-Enterprise-Id', 'X-No-Department-Info']) {
      expect(body, `login/account 缺 ${header}`).toContain(header)
    }
  })

  it('auth/token/refresh 带 X-Auth-Refresh-Source: plugin', () => {
    const start = SRC.indexOf('export async function refreshAccessToken')
    const body = SRC.slice(start, start + 900)
    expect(body).toContain('X-Auth-Refresh-Source')
    expect(body).toMatch(/'X-Auth-Refresh-Source':\s*'plugin'/)
  })
})
