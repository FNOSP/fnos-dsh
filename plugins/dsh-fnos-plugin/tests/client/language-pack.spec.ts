import { describe, expect, it } from 'vitest'
import { ensurePluginLanguages, PLUGIN_LANGUAGES, registerPluginDictionaries } from '../../src/client/language-pack.ts'

/**
 * FNOS-045-04：语言包注册。
 *
 * 六个随包插件都想把同一批语言加进目录，而 `addLanguage` 对已占用的 id 会抛错。
 * 这里用一个记录调用的假 ctx 验证「先查再注册」这一条，以及卸载时只回收自己加的那几个。
 */

function createFakeCtx(existing: readonly string[] = []) {
  const locales = existing.map(id => ({ id, label: id, fallback: 'en' as const }))
  const calls = { addLanguage: [] as string[], register: [] as [string, string][], disposed: [] as string[] }
  const ctx = {
    locale: {
      getLocale: () => ({ active: 'en', locales, revision: 0 }),
      addLanguage: (input: { id: string, label: string, fallback: string }) => {
        calls.addLanguage.push(input.id)
        locales.push({ id: input.id, label: input.label, fallback: 'en' })
        return () => { calls.disposed.push(input.id) }
      },
      register: (ns: string, locale: string) => {
        calls.register.push([ns, locale])
        return () => {}
      },
    },
  }
  return { ctx, calls, locales }
}

describe('ensurePluginLanguages', () => {
  it('空目录时把七种语言全部注册', () => {
    const { ctx, calls } = createFakeCtx()

    ensurePluginLanguages(ctx as never)

    expect(calls.addLanguage).toEqual(PLUGIN_LANGUAGES.map(language => language.id))
    expect(calls.addLanguage).toEqual(['ja', 'ko', 'de', 'fr', 'es', 'it', 'ru'])
  })

  it('已存在的语言跳过，不重复注册', () => {
    // 另一个插件先加载过时，这里再调 addLanguage 会抛错——必须先查。
    const { ctx, calls } = createFakeCtx(['ja', 'en', 'zh'])

    ensurePluginLanguages(ctx as never)

    expect(calls.addLanguage).toEqual(['ko', 'de', 'fr', 'es', 'it', 'ru'])
  })

  it('全部已存在时一个都不加', () => {
    const { ctx, calls } = createFakeCtx(['zh', 'en', ...PLUGIN_LANGUAGES.map(language => language.id)])

    ensurePluginLanguages(ctx as never)

    expect(calls.addLanguage).toEqual([])
  })

  it('释放时只回收本次新增的语言', () => {
    const { ctx, calls } = createFakeCtx(['ja'])

    const dispose = ensurePluginLanguages(ctx as never)
    dispose()

    expect(calls.disposed).toEqual(['ru', 'it', 'es', 'fr', 'de', 'ko'])
  })

  it('语言自称用该语言本身书写', () => {
    expect(PLUGIN_LANGUAGES.map(language => language.label)).toEqual([
      '日本語', '한국어', 'Deutsch', 'Français', 'Español', 'Italiano', 'Русский',
    ])
  })
})

describe('registerPluginDictionaries', () => {
  it('一种语言一次登记，全部挂在同一命名空间', () => {
    const { ctx, calls } = createFakeCtx()

    registerPluginDictionaries(ctx as never, 'settings.demo', { ja: { a: 'い' }, ko: { a: '가' } })

    expect(calls.register).toEqual([['settings.demo', 'ja'], ['settings.demo', 'ko']])
  })
})
