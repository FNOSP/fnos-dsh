import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { openAuthUrl } from '../src/client/external-opener.ts'
import { srcPath } from './paths.ts'

/**
 * DSH Desktop 上的 OAuth 开窗语义。
 *
 * Desktop 是 Electron 壳（`apps/desktop`）：它加载的是**同一套** Web 前端
 * （`dsh-app://app/`），并把该源的请求整体转发给同一个 Host
 * （`forwardWebRequest`），Host 侧的 /codebuddy RPC、/api、Remote WebSocket
 * 与 Cookie 鉴权因此照常可用。因此适配 Desktop **不需要**新的传输层，
 * 也不允许改 `dsh.client.platform`。
 *
 * 唯一真实的差异是开窗：壳在主窗口上装了
 * `setWindowOpenHandler`，对 http/https 调 `shell.openExternal(url)`
 * 并**一律返回 `{ action: 'deny' }`**。于是：
 *
 *  - 授权页确实在系统浏览器里打开了（这是期望行为）；
 *  - 但 `window.open(...)` 的返回值是 `null`——不是「被拦截」。
 *
 * 把 `null` 当成失败就会在 Desktop 上误报「弹窗被拦截」并阻断一条本来
 * 成功的登录。Codex 插件正是按返回值判定的（它只在独立浏览器工作）；
 * CodeBuddy 必须保持对返回值不敏感。
 */
describe('Desktop 开窗：返回 null 不等于被拦截', () => {
  it('Desktop 壳 deny 后返回 null：不报错、不抛异常，视为已外部打开', () => {
    // 壳交给 shell.openExternal 后返回 deny，window.open 结果为 null。
    const desktopOpen = vi.fn(() => null)

    expect(() => { openAuthUrl('https://example.com/auth', desktopOpen) }).not.toThrow()
    expect(desktopOpen).toHaveBeenCalledWith('https://example.com/auth')
  })

  it('独立浏览器返回窗口句柄时同样正常', () => {
    const handle = { closed: false }
    const browserOpen = vi.fn(() => handle)

    expect(() => { openAuthUrl('https://example.com/auth', browserOpen) }).not.toThrow()
    expect(browserOpen).toHaveBeenCalledTimes(1)
  })

  it('开窗抛异常时不让登录流程崩溃（未处理异常会让宿主 fail-loud 退出）', () => {
    const throwingOpen = vi.fn(() => { throw new Error('blocked by policy') })

    expect(() => { openAuthUrl('https://example.com/auth', throwingOpen) }).not.toThrow()
  })

  it('空 URL 不开窗', () => {
    const open = vi.fn(() => null)

    openAuthUrl('', open)

    expect(open).not.toHaveBeenCalled()
  })
})

describe('三个登录入口都必须走同一个开窗实现', () => {
  const SECTION = readFileSync(srcPath('components/CodeBuddySection.tsx'), 'utf8')
  const PANEL = readFileSync(srcPath('client/panel.tsx'), 'utf8')

  /**
   * 剥离注释后再找调用点。
   *
   * 直接 `toContain('window.open')` 会被解释这一语义的注释命中（注释里正当地
   * 写着 `window.open` 返回 null），于是断言在「实现已改对」时反而失败。
   * 这里只保留真实代码文本。
   */
  function codeOnly(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^[ \t]*\/\/.*$/gmu, '')
  }

  it('两个宿主都不再有裸 window.open 调用', () => {
    // 裸调用是「被后来者按返回值判定拦截」的入口；收拢到一处才守得住语义。
    for (const [name, source] of [['CodeBuddySection.tsx', SECTION], ['panel.tsx', PANEL]] as const) {
      expect(codeOnly(source), `${name} 仍在直接调用 window.open`).not.toContain('window.open(')
    }
  })

  it('两个宿主都通过 openAuthUrl 打开登录页', () => {
    expect(SECTION).toContain('openAuthUrl(')
    expect(PANEL).toContain('openAuthUrl(')
  })
})

describe('Desktop 复用 web 客户端载体，平台声明不得改动', () => {
  it('dsh.client.platform 保持 web', () => {
    /**
     * `dsh-client-modules` 的扫描是 `decl.platform !== 'web'` 即跳过：
     * 改成 desktop/electron 会让插件在 Web 与 Desktop 上**同时**消失。
     * Desktop 的浏览器半侧正是同一个 web 载体。
     */
    const manifest = JSON.parse(readFileSync(srcPath('..', 'package.json'), 'utf8')) as {
      dsh: { client: { platform: string } }
    }

    expect(manifest.dsh.client.platform).toBe('web')
  })
})
