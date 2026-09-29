import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('dsh-fnos DSH 0.1.7 settings migration', () => {
  it('uses SettingsForms on Host and does not use removed settings APIs', async () => {
    const host = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8')
    const routes = await readFile(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')

    expect(host).toContain('ctx.settings.describe()')
    expect(host).not.toContain('ctx.settings.register')
    expect(host).not.toContain('ctx.settings.get')
    expect(routes).toContain('settings.describe()')
    expect(routes).toContain('settings.update(')
    expect(routes).not.toContain('SettingsScope')
  })

  it('uses ConfigForms and the plugin detail slot on Client', async () => {
    const client = await readFile(new URL('../../src/client/index.ts', import.meta.url), 'utf8')
    const persistence = await readFile(new URL('../../src/client/services/theme-persistence.ts', import.meta.url), 'utf8')

    expect(client).toContain('configForms')
    // 配置入口已从设置弹框迁到插件管理页的组合包详情页。
    expect(client).toContain('plugins.detail.section')
    expect(client).not.toContain('settings.plugins.tab')
    expect(client).not.toContain('settingsScope')
    expect(client).not.toContain('settings.plugin.item')
    expect(persistence).not.toContain('SettingsScope')
  })
})

/**
 * `plugins.detail.section` 是 **list** 座位，不像 keyed 的 `plugins.bundle.config`
 * 那样按包名分派：页面会给打开的**每个**插件详情页渲染它。
 *
 * 因此组件必须自己看 `subject`——漏掉这层判断，授权目录卡片就会出现在第三方
 * 插件的详情页上（用户在没有 fnOS 的场景里看到一张配不了的卡片，且它还会真的
 * 去请求那几个 /fnos 路由）。
 */
describe('list 座位的 subject 自筛（不筛会串到别的插件详情页）', () => {
  it('非 bundle 主题一律不渲染', async () => {
    const card = await readFile(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    expect(card).toMatch(/subject\.kind !== 'bundle'/)
  })

  it('包名不匹配一律不渲染', async () => {
    const card = await readFile(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    expect(card).toContain("FNOS_PACKAGE_NAME = '@tnnevol/dsh-fnos'")
    expect(card).toMatch(/subject\.pkg\?\.name !== FNOS_PACKAGE_NAME/)
  })

  it('subject 缺失时返回 null（页面未给出主题）', async () => {
    const card = await readFile(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    expect(card).toMatch(/subject === undefined\) return null/)
  })

  it('包名与 package.json 一致（写错就永远不渲染）', async () => {
    const card = await readFile(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { name: string }
    expect(card).toContain(`FNOS_PACKAGE_NAME = '${manifest.name}'`)
  })
})
