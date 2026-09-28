import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * DSH Desktop 上的 Codex 登录开窗语义（FNOS-008-07 / T03-03、T03-04）。
 *
 * Desktop 是 Electron 壳（`apps/desktop`）：它复用同一套 Web 前端
 * （`dsh-app://app/`）并把请求转发给同一个 Host，因此 `/plugins/.../auth/*`
 * 路由、Cookie 与状态轮询都照常可用；不需要新的传输层。
 *
 * 唯一差异在开窗。壳在主窗口装了 `setWindowOpenHandler`：
 *
 * ```ts
 * window.webContents.setWindowOpenHandler(({ url }) => {
 *   if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
 *   return { action: 'deny' }
 * })
 * ```
 *
 * 于是授权页**确实在系统浏览器里打开了**，但 `window.open(...)` 返回 `null`。
 *
 * 原实现把这个 `null` 当成「浏览器阻止了登录窗口」并 `return`：
 *
 * ```ts
 * const popup = window.open(CODEX_AUTH_VERIFICATION_URI, '_blank')
 * if (popup === null) { setStatus({ status: 'error', message: t('popupBlocked') }); return }
 * await jsonRequest(CODEX_AUTH_LOGIN_PATH, 'POST')   // ← 永不执行
 * ```
 *
 * 后果不是体验问题而是**功能阻断**：Desktop 上授权页开了，设备码却永不请求，
 * 用户看到「浏览器阻止了登录窗口」且无从重试成功。
 *
 * 因此这里守住：`null` 只代表「窗口句柄不可得」，登录必须继续。
 */

const SECTION = new URL('../../src/components/CodexAuthSection.tsx', import.meta.url)
const LOCALES = new URL('../../src/client/locales.ts', import.meta.url)

/** 只保留真实代码文本，避免解释该语义的注释命中断言。 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
}

/** 取 `signIn` 的函数体（到下一个顶层 `const signOut` 为止）。 */
function signInBody(source: string): string {
  const start = source.indexOf('const signIn = async')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('const signOut = async', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Desktop：window.open 返回 null 时登录必须继续', () => {
  it('null 不再被当成「登录窗口被阻止」而中断 signIn', async () => {
    const source = codeOnly(await readFile(SECTION, 'utf8'))
    const body = signInBody(source)
    // Desktop 下 popup 恒为 null：任何「null → 报错并 return」都会让登录在 Desktop 上完全不可用。
    expect(body).not.toContain("t('popupBlocked')")
    expect(body).not.toMatch(/if \(popup === null\)\s*\{[^}]*return/u)
    expect(body).not.toMatch(/if \(!popup\)\s*\{[^}]*return/u)
  })

  it('null 之后仍然请求设备码（login 端点必须可达）', async () => {
    const source = await readFile(SECTION, 'utf8')
    const body = signInBody(source)
    expect(body).toContain('CODEX_AUTH_LOGIN_PATH')
    // 请求设备码是「登录是否真的继续」的可观察判据。
    expect(body).toMatch(/jsonRequest<LoginChallenge>\(CODEX_AUTH_LOGIN_PATH, 'POST'\)/u)
  })

  it('null 时仍进入「等待授权」状态，而不是停在错误态', async () => {
    const source = await readFile(SECTION, 'utf8')
    const body = signInBody(source)
    expect(body).toContain("setStatus({ status: 'signing-in' })")
  })
})

describe('Desktop：窗口句柄可选，不影响取消与已登录账号', () => {
  it('登记窗口句柄前先判空，句柄不可得时不登记也不中断', async () => {
    const source = codeOnly(await readFile(SECTION, 'utf8'))
    const body = signInBody(source)
    // 句柄为 null 时 `authWindowsRef.current.add(null)` 会在取消时对 null 调 close()。
    // 正确写法是「先判空再登记」，且判空不得带 return（那会中断登录）。
    expect(body).toMatch(/if \(popup !== null\) authWindowsRef\.current\.add\(popup\)/u)
    expect(body).not.toMatch(/if \(popup === null\)[^\n]*return/u)
  })

  it('取消始终走 cancel 端点，与句柄是否可得无关', async () => {
    const source = await readFile(SECTION, 'utf8')
    const start = source.indexOf('const cancelSignIn = useCallback')
    const end = source.indexOf('const signIn = async', start)
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, end)
    expect(body).toContain('CODEX_AUTH_CANCEL_PATH')
    expect(body).not.toContain('CODEX_AUTH_LOGOUT_PATH')
  })

  it('「打开授权页面」按钮在 null 时静默跳过登记，不提前 return 掉后续逻辑', async () => {
    const source = codeOnly(await readFile(SECTION, 'utf8'))
    const start = source.indexOf("t('openAuthorization')")
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(Math.max(0, start - 900), start)
    expect(body).not.toMatch(/if \(opened === null\) return/u)
  })
})

describe('Desktop：保留既有登录语义', () => {
  it('授权窗口保留 opener（取消时需要能关掉它）', async () => {
    const source = codeOnly(await readFile(SECTION, 'utf8'))
    // 跨域后 `opener = null` 会让 close() 静默失效，`noopener` 亦同。
    expect(source).not.toContain('.opener = null')
    expect(source).not.toContain('noopener')
  })

  it('signIn 内不自动复制授权码（开窗后主文档已失焦，复制必失败）', async () => {
    const source = await readFile(SECTION, 'utf8')
    const body = signInBody(source)
    expect(body).not.toContain('navigator.clipboard')
    expect(body).not.toContain('execCommand')
    expect(body).not.toContain('copyTextToClipboard')
  })

  it('平台声明保持 web：Desktop 复用同一客户端载体', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dsh: { client: { platform: string } } }
    expect(manifest.dsh.client.platform).toBe('web')
  })

  it('删除已无引用的 popupBlocked 文案键', async () => {
    /**
     * 该键原本只服务「`window.open` 返回 null = 被浏览器拦截」这一判据。修复后
     * 没有任何代码路径再引用它（开窗失败不再作为独立错误呈现），留着会让后续
     * 维护者以为还存在「弹窗被拦截」这条路。这里同时盯住组件与文案表两处。
     */
    const source = await readFile(SECTION, 'utf8')
    const locales = await readFile(LOCALES, 'utf8')
    expect(source).not.toContain('popupBlocked')
    expect(locales).not.toContain('popupBlocked')
  })
})
