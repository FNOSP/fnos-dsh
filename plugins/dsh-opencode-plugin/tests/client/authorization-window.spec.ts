import { describe, expect, it, vi } from 'vitest'
import {
  PENDING_AUTHORIZATION_URL,
  browserWindowOpener,
  closeAuthorizationPlaceholder,
  navigateAuthorizationPlaceholder,
  openAuthorizationPlaceholder,
  openAuthorizationUrl,
} from '../../src/client/services/authorization-window.ts'

/** 假窗口：只实现编排用到的 `closed`、`location`、`close`。 */
function fakeWindow(closed = false): {
  closed: boolean
  location: { href: string }
  close: () => void
  closedCalls: number
} {
  const target = {
    closed,
    location: { href: '' },
    close: () => { target.closedCalls += 1; target.closed = true },
    closedCalls: 0,
  }
  return target
}

/** 假开窗器：记录每次调用的地址与返回值。 */
function fakeOpener(returns: (url: string) => Window | null) {
  const urls: string[] = []
  return {
    urls,
    opener: { open: (url: string) => { urls.push(url); return returns(url) } },
  }
}

describe('占位页开窗', () => {
  it('在同步调用里打开 about:blank（先于任何 await，保住用户手势）', () => {
    const { urls, opener } = fakeOpener(() => fakeWindow() as unknown as Window)
    const handle = openAuthorizationPlaceholder(opener)
    expect(urls).toEqual([PENDING_AUTHORIZATION_URL])
    expect(handle).not.toBeNull()
  })

  it('拿不到句柄时返回 null，不抛错（Desktop 壳 deny 掉 about: 协议）', () => {
    const { opener } = fakeOpener(() => null)
    expect(openAuthorizationPlaceholder(opener)).toBeNull()
  })

  it('非浏览器环境下 browserWindowOpener 安全返回 null', () => {
    const globalThisRef = globalThis as { window?: unknown }
    const previous = globalThisRef.window
    delete globalThisRef.window
    try {
      expect(browserWindowOpener().open('https://opencode.ai/console/device')).toBeNull()
    } finally {
      if (previous !== undefined) globalThisRef.window = previous
    }
  })

  it('window.open 抛错时不冒泡（CSP 或跨源限制不该崩溃调用点）', () => {
    const throwing = { open: () => { throw new Error('blocked by CSP') } }
    expect(openAuthorizationPlaceholder(throwing)).toBeNull()
  })
})

describe('占位页导航', () => {
  it('写入授权地址并返回 true', () => {
    const tab = fakeWindow()
    const ok = navigateAuthorizationPlaceholder(tab as unknown as Window, 'https://opencode.ai/console/device?user_code=USER-1')
    expect(ok).toBe(true)
    expect(tab.location.href).toBe('https://opencode.ai/console/device?user_code=USER-1')
  })

  it('句柄缺失时返回 false，让调用方改用直接开窗', () => {
    expect(navigateAuthorizationPlaceholder(null, 'https://opencode.ai/x')).toBe(false)
  })

  it('窗口已被用户关闭时返回 false 且不写入', () => {
    const tab = fakeWindow(true)
    expect(navigateAuthorizationPlaceholder(tab as unknown as Window, 'https://opencode.ai/x')).toBe(false)
    expect(tab.location.href).toBe('')
  })

  it('location 写入抛错时返回 false（跨源限制）', () => {
    const hostile = {
      closed: false,
      get location(): never { throw new Error('cross-origin') },
    } as unknown as Window
    expect(navigateAuthorizationPlaceholder(hostile, 'https://opencode.ai/x')).toBe(false)
  })
})

describe('直接开窗兜底', () => {
  it('把真实授权地址交给开窗器', () => {
    const { urls, opener } = fakeOpener(() => null)
    openAuthorizationUrl('https://opencode.ai/console/device?user_code=USER-1', opener)
    expect(urls).toEqual(['https://opencode.ai/console/device?user_code=USER-1'])
  })

  it('返回 null 不算失败：Desktop 壳接管时恒为 null 而页面已打开', () => {
    // 这条断言的意义是钉住「不得把 null 当拦截」——Codex 插件曾据此中断登录。
    const { opener } = fakeOpener(() => null)
    expect(() => openAuthorizationUrl('https://opencode.ai/x', opener)).not.toThrow()
  })
})

describe('收回占位页', () => {
  it('登录请求失败时关掉空白标签', () => {
    const tab = fakeWindow()
    closeAuthorizationPlaceholder(tab as unknown as Window)
    expect(tab.closedCalls).toBe(1)
  })

  it('句柄缺失或已关闭时不动作', () => {
    closeAuthorizationPlaceholder(null)
    const closed = fakeWindow(true)
    closeAuthorizationPlaceholder(closed as unknown as Window)
    expect(closed.closedCalls).toBe(0)
  })

  it('close 抛错时静默：关不掉不影响登录结果', () => {
    const hostile = { closed: false, close: () => { throw new Error('denied') } } as unknown as Window
    expect(() => closeAuthorizationPlaceholder(hostile)).not.toThrow()
  })
})

describe('完整编排（浏览器 → Desktop 两条路）', () => {
  it('浏览器：手势内开占位页，拿到地址后导航，不再二次开窗', async () => {
    const tab = fakeWindow()
    const { urls, opener } = fakeOpener(() => tab as unknown as Window)
    const placeholder = openAuthorizationPlaceholder(opener)
    const uri = await Promise.resolve('https://opencode.ai/console/device?user_code=USER-1')
    const navigated = navigateAuthorizationPlaceholder(placeholder, uri)
    if (!navigated) openAuthorizationUrl(uri, opener)
    expect(navigated).toBe(true)
    expect(urls).toEqual([PENDING_AUTHORIZATION_URL])
    expect(tab.location.href).toBe(uri)
  })

  it('Desktop：占位页被 deny，改为直接开真实地址且只开一次', async () => {
    const opened: string[] = []
    const opener = { open: (url: string) => { opened.push(url); return null } }
    const placeholder = openAuthorizationPlaceholder(opener)
    const uri = 'https://opencode.ai/console/device?user_code=USER-1'
    const navigated = navigateAuthorizationPlaceholder(placeholder, uri)
    if (!navigated) openAuthorizationUrl(uri, opener)
    expect(navigated).toBe(false)
    expect(opened).toEqual([PENDING_AUTHORIZATION_URL, uri])
  })

  it('开窗失败也不阻断：设备码流程与开窗结果互不依赖', async () => {
    const startDeviceLogin = vi.fn(async () => ({ userCode: 'USER-1', verificationUri: 'https://opencode.ai/x' }))
    const opener = { open: () => null }
    const placeholder = openAuthorizationPlaceholder(opener)
    const challenge = await startDeviceLogin()
    navigateAuthorizationPlaceholder(placeholder, challenge.verificationUri)
    expect(challenge.userCode).toBe('USER-1')
    expect(startDeviceLogin).toHaveBeenCalledTimes(1)
  })
})
