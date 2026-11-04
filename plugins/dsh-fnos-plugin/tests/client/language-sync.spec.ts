import { describe, expect, it } from 'vitest'
import { installFnosLanguageSync, resolveDshLocale } from '../../src/client/services/language-sync.ts'

/**
 * FNOS-045-05：飞牛界面语言 → DSH 界面语言。
 *
 * 这里用注入的 SDK 桩驱动，不依赖真实 `@trimjs/web-app`：语言同步的契约就是
 * 「读一次当前语言 + 订阅变化 + 只在目标语言已注册时切换」，把它绑在真实 SDK 上
 * 反而不容易覆盖回退与跳过的分支。
 */

type LanguageHandler = (language: unknown) => void

interface StubOptions {
  readonly language: string
  readonly isWeb?: boolean
  readonly isStandaloneWeb?: boolean
}

function createStubSdk(options: StubOptions) {
  const handlers = new Set<LanguageHandler>()
  const calls = {
    ready: 0,
    getPlatformConfig: 0,
    on: [] as string[],
    off: [] as string[],
    setLocale: [] as string[],
  }
  const sdk = {
    isWeb: options.isWeb ?? true,
    isStandaloneWeb: options.isStandaloneWeb ?? false,
    async ready() { calls.ready += 1 },
    async getPlatformConfig() {
      calls.getPlatformConfig += 1
      return { theme: 'light' as const, language: options.language, systemVersion: '1.2.0301', format: {} }
    },
    async $on(event: string, handler: LanguageHandler) {
      if (event !== 'os/language') return
      calls.on.push(event)
      handlers.add(handler)
    },
    async $off(event: string, handler: LanguageHandler) {
      if (event !== 'os/language') return
      calls.off.push(event)
      handlers.delete(handler)
    },
  }
  return {
    sdk,
    calls,
    emit(language: string): void { for (const handler of [...handlers]) handler(language) },
    get subscribed(): number { return handlers.size },
  }
}

const ALL = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'ru']

function optionsFor(stub: ReturnType<typeof createStubSdk>, available: readonly string[] = ALL) {
  const setLocale: string[] = []
  return {
    setLocale,
    options: {
      availableLocales: () => available.map(id => ({ id })),
      setLocale: (id: string) => { setLocale.push(id) },
      createSdk: () => stub.sdk as never,
    },
  }
}

describe('resolveDshLocale', () => {
  it('按主标签映射带地区的飞牛语言', () => {
    expect(resolveDshLocale('zh-CN')).toBe('zh')
    expect(resolveDshLocale('en-US')).toBe('en')
    expect(resolveDshLocale('ja-JP')).toBe('ja')
    expect(resolveDshLocale('ko-KR')).toBe('ko')
    expect(resolveDshLocale('de-DE')).toBe('de')
    expect(resolveDshLocale('fr-FR')).toBe('fr')
    expect(resolveDshLocale('es-ES')).toBe('es')
    expect(resolveDshLocale('it-IT')).toBe('it')
    expect(resolveDshLocale('ru-RU')).toBe('ru')
  })

  it('下划线与大小写同样接受', () => {
    expect(resolveDshLocale('ja_JP')).toBe('ja')
    expect(resolveDshLocale('JA-jp')).toBe('ja')
  })

  it('不认识的语言回退英文，而不是报错或留空', () => {
    expect(resolveDshLocale('th-TH')).toBe('en')
    expect(resolveDshLocale('')).toBe('en')
    expect(resolveDshLocale(undefined)).toBe('en')
    expect(resolveDshLocale(42)).toBe('en')
  })
})

describe('installFnosLanguageSync', () => {
  it('启动时按当前飞牛语言对齐一次', async () => {
    const stub = createStubSdk({ language: 'ja-JP' })
    const { setLocale, options } = optionsFor(stub)

    await installFnosLanguageSync({} as never, options)

    expect(stub.calls.getPlatformConfig).toBe(1)
    expect(setLocale).toEqual(['ja'])
  })

  it('订阅 os/language，切换后立即同步', async () => {
    const stub = createStubSdk({ language: 'zh-CN' })
    const { setLocale, options } = optionsFor(stub)

    await installFnosLanguageSync({} as never, options)
    expect(setLocale).toEqual(['zh'])

    stub.emit('ko-KR')
    stub.emit('ru-RU')
    expect(setLocale).toEqual(['zh', 'ko', 'ru'])
  })

  it('目标语言未注册时不切换，交给 DSH 的兜底', async () => {
    // 只注册中英时（例如插件语言包未加载），同步到日语会把界面切空，必须跳过。
    const stub = createStubSdk({ language: 'ja-JP' })
    const { setLocale, options } = optionsFor(stub, ['zh', 'en'])

    await installFnosLanguageSync({} as never, options)

    expect(setLocale).toEqual([])
  })

  it('非飞牛 Web 宿主不订阅也不切换', async () => {
    const stub = createStubSdk({ language: 'ja-JP', isWeb: false })
    const { setLocale, options } = optionsFor(stub)

    await installFnosLanguageSync({} as never, options)

    expect(setLocale).toEqual([])
    expect(stub.calls.on).toEqual([])
  })

  it('独立浏览器页面同样跳过', async () => {
    const stub = createStubSdk({ language: 'ja-JP', isStandaloneWeb: true })
    const { setLocale, options } = optionsFor(stub)

    await installFnosLanguageSync({} as never, options)

    expect(setLocale).toEqual([])
  })

  it('清理后不再响应语言变化', async () => {
    const stub = createStubSdk({ language: 'zh-CN' })
    const { setLocale, options } = optionsFor(stub)

    const dispose = await installFnosLanguageSync({} as never, options)
    expect(stub.subscribed).toBe(1)

    await dispose()
    expect(stub.subscribed).toBe(0)
    expect(stub.calls.off).toEqual(['os/language'])

    stub.emit('ja-JP')
    expect(setLocale).toEqual(['zh'])
  })
})
