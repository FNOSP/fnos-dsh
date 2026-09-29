import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Codex Auth 配置入口迁入插件管理页详情页（FNOS-008-03 / T03-01、T03-02）。
 *
 * 上游 DSH 0.1.7-rc.2 的架构决策把插件配置收归侧栏「插件」页：设置弹框只保留
 * 只读插件清单。官方给社区组合包的接缝是 `plugins.bundle.config`：
 *
 *  - 它按**包名**做 key（`key: '@tnnevol/dsh-codex-auth'`），渲染在组合包详情页
 *    的描述与组件列表之间，且**只以 `view: 'page'` 渲染**（`PluginConfigViewProps`）；
 *  - 组件忽略可选的 `form`（本插件配置自管理，不接 settings 命名空间表单）。
 *
 * 迁移前后数据读写路径完全不变：插件仍通过 `/plugins/.../auth/*` 路由与
 * `ctx.settings` 写入工作，因此这组断言只盯**注册契约**，不涉及数据层。
 */

const CLIENT = new URL('../../src/client/index.tsx', import.meta.url)
const MANIFEST = new URL('../../package.json', import.meta.url)

describe('Codex Auth 配置注册在插件详情页', () => {
  it('注册 plugins.bundle.config，key 为包名', async () => {
    const client = await readFile(CLIENT, 'utf8')
    expect(client).toContain("ctx.slots.inject('plugins.bundle.config'")
    expect(client).toContain("name: 'plugins.bundle.config'")
    expect(client).toContain("key: '@tnnevol/dsh-codex-auth'")
  })

  it('key 必须等于 package.json 的包名', async () => {
    /**
     * 详情页派发时用的是 `entryKey: pkg.name`（包名），而配置区块的渲染条件是
     * `ledger.bundles.has(pkg.name)`——它同样由注册时的 `key` 决定
     * （`ui-plugin-manager` 的 `config-ledger.ts`）。两处必须逐字相等：
     * 包名一旦改名而 key 没跟着改，区块会**静默不渲染**，且不报任何错误。
     */
    const client = await readFile(CLIENT, 'utf8')
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as { name: string }
    const key = /key: '([^']+)'/u.exec(client.slice(client.indexOf("ctx.slots.inject('plugins.bundle.config'")))
    expect(key?.[1]).toBe(manifest.name)
  })

  it('不再注册 settings.section 导航分区', async () => {
    const client = await readFile(CLIENT, 'utf8')
    // 双入口会让同一份配置在两处漂移；FNOS-008-04 要求设置侧不再有插件配置入口。
    expect(client).not.toContain("ctx.slots.inject('settings.section'")
    expect(client).not.toContain("name: 'settings.section'")
    expect(client).not.toContain("id: 'codex-auth'")
  })

  it('详情页入口不再提供设置分区专用的 label/order', async () => {
    const client = await readFile(CLIENT, 'utf8')
    // 详情页自行绘制标题与面包屑，配置条目不需要导航用的 label/order。
    const start = client.indexOf("ctx.slots.inject('plugins.bundle.config'")
    expect(start).toBeGreaterThan(-1)
    const end = client.indexOf('conversation.input.right', start)
    const registration = client.slice(start, end)
    expect(registration).not.toContain('label:')
    expect(registration).not.toContain('order:')
  })

  it('对话输入区用量状态保持不动', async () => {
    const client = await readFile(CLIENT, 'utf8')
    expect(client).toContain("ctx.slots.inject('conversation.input.right'")
    expect(client).toContain("name: 'conversation.input.right'")
    expect(client).toContain("id: 'codex-usage'")
  })

  it('声明 ui-plugin-manager 类型依赖（仅类型，不在运行时引入）', async () => {
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const pkg = '@deepseek-ai/dsh-client-ui-plugin-manager'
    // 上游 ui-settings-shell 同样以 devDependencies 持有该包；运行时通过 slot
    // 名注册，不 import 该包，避免客户端模块表缺项。
    expect(manifest.dsh.client.inject).toContain(pkg)
    expect(manifest.peerDependencies[pkg]).toBe('0.1.7-rc.2')
    expect(manifest.devDependencies[pkg]).toBe('catalog:dsh')
  })

  it('客户端不为该 slot 做运行时 import（只 import type）', async () => {
    const client = await readFile(CLIENT, 'utf8')
    expect(client).toContain("import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'")
    // 运行时 import 会在客户端模块表里找不到该包而抛错。
    expect(client).not.toMatch(/^import \{[^}]*\} from '@deepseek-ai\/dsh-client-ui-plugin-manager/mu)
  })

  it('新增依赖同步登记到 compatibility.json', async () => {
    const compat = JSON.parse(
      await readFile(new URL('../../compatibility.json', import.meta.url), 'utf8'),
    ) as { dshPluginApi: { packages: string[] } }
    // peerDependencies 与 compatibility.json 各写一份清单，改一处就会静默对不上。
    // 这里只钉住本次新增的包——它既是 `plugins.bundle.config` 的类型来源，也是
    // 客户端 inject 的登记项。更宽的 peer↔compat 全量一致性不是本次范围：
    // 既存清单本就有意存在差异（`@deepseek-ai/cordis` 是运行时框架依赖，不属于
    // 插件 API 面）。
    expect(compat.dshPluginApi.packages).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')
    // 清单保持字典序，避免同一份列表出现两种排列。
    const packages = compat.dshPluginApi.packages
    expect(packages).toEqual([...packages].sort())
  })

  it('组件不依赖设置弹框的视口/滚动容器', async () => {
    /**
     * 详情页把配置区块放进普通纵向 flex（`.detailSections`/`.detailSection`，
     * 无固定高度、由页面整体滚动），而设置弹框的配置区依赖弹框内容区滚动。
     * 组件若写死视口高度或自带滚动条，迁入详情页就会出现双重滚动或高度塌陷。
     */
    const style = await readFile(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    expect(style).not.toMatch(/height:\s*(?:100vh|100%)/u)
    expect(style).not.toMatch(/position:\s*fixed/u)
    // 根容器保持纵向 flex，与详情页区块的排布一致。
    expect(style).toMatch(/\.dsh-codex-auth-section\s*\{[^}]*display:\s*flex/u)
  })
})
