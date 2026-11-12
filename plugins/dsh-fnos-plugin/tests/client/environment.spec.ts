import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 运行环境识别。
 *
 * 这一组断言守住的是**一个真实故障**：全插件原先用 `isEmbeddedFnosFrame()`
 * （`window.parent !== window`）判断「是否运行在 fnOS 里」。独立浏览器页面
 * 不是 iframe，于是被当成「本地开发」整支跳过——会话头部的日志入口、设置里的
 * 「打开配置文件」、授权目录的 SDK 调用全都不存在，控制台也没有任何报错。
 *
 * 三条判据必须彼此独立：
 *  - `embedded`：iframe + 网关托管
 *  - `standalone`：非 iframe + 网关托管（本次修复的对象）
 *  - `none`：网关未托管（本地 `dsh web` 开发）
 */

type Env = 'embedded' | 'standalone' | 'none'

/** 搭一个最小 DOM：只提供 `<base>`，判据只读它。 */
function withBase(baseHref: string | undefined): void {
  const documentStub = {
    querySelector: (selector: string) => {
      if (selector !== 'base' || baseHref === undefined) return null
      return { href: baseHref }
    },
  }
  vi.stubGlobal('document', documentStub)
}

/** 搭一个 window：`parent === window` 表示不在 iframe 里。 */
function withWindow(embedded: boolean): void {
  const windowStub: Record<string, unknown> = {}
  windowStub.parent = embedded ? {} : windowStub
  vi.stubGlobal('window', windowStub)
}

async function loadEnvironment(): Promise<typeof import('../../src/client/services/environment.ts')> {
  vi.resetModules()
  return import('../../src/client/services/environment.ts')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('fnOS 运行环境识别', () => {
  it('网关托管 + iframe = embedded', async () => {
    withWindow(true)
    withBase('http://nas.local:5666/app/fn-deepseek-harness/')
    const env = await loadEnvironment()
    expect(env.detectFnosEnvironment()).toBe<Env>('embedded')
    expect(env.isFnosHosted()).toBe(true)
    expect(env.hasFnosHostBridge()).toBe(true)
  })

  it('网关托管 + 非 iframe = standalone（独立浏览器页面）', async () => {
    /*
      这就是本次要修的那一格：旧判据 `window.parent !== window` 在这里为 false，
      于是功能全被跳过。独立浏览器页面**是** fnOS 应用，只是没有宿主桥。
    */
    withWindow(false)
    withBase('http://nas.local:5666/app/fn-deepseek-harness/')
    const env = await loadEnvironment()
    expect(env.detectFnosEnvironment()).toBe<Env>('standalone')
    expect(env.isFnosHosted()).toBe(true)
    // 关键区别：属于 fnOS，但没有宿主桥，文件类能力必须改道或拒绝。
    expect(env.hasFnosHostBridge()).toBe(false)
  })

  it('没有 <base> = none（本地 DSH Web 开发）', async () => {
    withWindow(false)
    withBase(undefined)
    const env = await loadEnvironment()
    expect(env.detectFnosEnvironment()).toBe<Env>('none')
    expect(env.isFnosHosted()).toBe(false)
    expect(env.hasFnosHostBridge()).toBe(false)
  })

  it('<base> 不指向 /app/ 时不算 fnOS', async () => {
    // 别的部署也可能注入 <base>（例如挂在子路径下），不能只看「有没有 base」。
    withWindow(true)
    withBase('http://example.com/some/other/app/')
    const env = await loadEnvironment()
    expect(env.detectFnosEnvironment()).toBe<Env>('none')
  })

  it('<base> 是非法 URL 时降级为 none，不抛错', async () => {
    withWindow(true)
    withBase('not a url')
    const env = await loadEnvironment()
    expect(env.detectFnosEnvironment()).toBe<Env>('none')
  })

  it('没有 document 时不抛错（SSR / 测试环境）', async () => {
    vi.stubGlobal('document', undefined)
    const env = await loadEnvironment()
    expect(env.detectFnosEnvironment()).toBe<Env>('none')
    expect(env.isGatewayHosted()).toBe(false)
  })
})
