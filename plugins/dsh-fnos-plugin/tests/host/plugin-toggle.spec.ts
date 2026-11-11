import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsePatchEntries } from '../../src/host/plugin-toggle.ts'

/**
 * 插件启用/禁用：解析 profile patch。
 *
 * 「禁用」与「卸载」是两件事——禁用只加 `disabled: true`，模块与配置都还在。
 * 卡片式界面要正确显示状态，前提是这里的解析准确。
 */
const TOGGLE = readFileSync(new URL('../../src/host/plugin-toggle.ts', import.meta.url), 'utf8')
const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')

describe('patch 解析', () => {
  it('读出条目与 disabled 状态', () => {
    const text = `- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes: []
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  disabled: true
`
    const entries = parsePatchEntries(text)
    expect(entries).toEqual([
      { id: 'plugin-market', name: '@deepseek-ai/dsh-plugin-market', enabled: true },
      { id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general', enabled: false },
    ])
  })

  it('没有 disabled 视为启用', () => {
    const entries = parsePatchEntries('- id: a\n  name: x\n')
    expect(entries[0]?.enabled).toBe(true)
  })

  it('保留没有 name 的条目（它们可能是禁用指令）', () => {
    /*
      早前这里断言「忽略没有 name 的条目」，但那把 `- id: X / disabled: true`
      这类**禁用指令**也一起丢了，导致无法启用已禁用的插件。
      现在 name 为空串、条目保留。
    */
    expect(parsePatchEntries('- id: alone\n  config: {}\n')).toEqual([{ id: 'alone', name: '', enabled: true }])
  })

  it('解析失败不猜，返回空', () => {
    expect(parsePatchEntries('')).toEqual([])
    expect(parsePatchEntries('not yaml at all')).toEqual([])
  })
})

describe('解析必须保留只有 id 的条目', () => {
  it('id-only 的禁用条目不能被过滤掉', () => {
    /*
      真机踩到：`- id: X / disabled: true` 这种**只有 id** 的条目在解析时被整个
      丢掉，于是 `setPackageEnabled` 的 byId 匹配永远找不到它——已禁用过的插件
      无法再启用，也识别不出「这个包已有 id 条目」。

      这同时是「无法禁用」的最后一环：patch 里明明有 4 条 wallpaper 的禁用条目，
      界面却一直是启用状态、点禁用还报错。
    */
    const entries = parsePatchEntries(`- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
- id: dsh-plugin-wallpaper-engine
  disabled: true
`)
    expect(entries).toHaveLength(2)
    // 只有 id 的条目 name 为空串。
    expect(entries[1]).toEqual({ id: 'dsh-plugin-wallpaper-engine', name: '', enabled: false })
  })

  it('注释行不影响解析', () => {
    // 真实文件开头有三行 `#` 说明。
    const entries = parsePatchEntries(`# Your patch layer for this dsh profile
# a top-level YAML array
- id: a
  name: x
`)
    expect(entries).toEqual([{ id: 'a', name: 'x', enabled: true }])
  })

  it('读不到文件时用与官方同构的骨架（含注释）', () => {
    // 写 `[]` 会丢注释，且 flow/block sequence 语法不一致。
    expect(TOGGLE).toContain('DEFAULT_PATCH_SKELETON')
    expect(TOGGLE).toContain('Your patch layer for this dsh profile')
  })
})

describe('禁用写入', () => {
  it('原子写：先临时文件再 rename', () => {
    // 半个 YAML 会让整个 profile 起不来。
    expect(TOGGLE).toContain('writeAtomic')
    expect(TOGGLE).toContain('rename')
  })

  it('按 entry id 改，而不是按包名', () => {
    // 一个包可能对应多条组合条目（服务端/客户端分开挂载），要全部覆盖。
    expect(TOGGLE).toContain('matchedIds.has(currentId)')
    expect(TOGGLE).toContain('matchedIds = new Set(')
  })

  it('非 bundle 但有 bundle patch 声明时仍可解析 entry id（兜底）', () => {
    /*
      真机根因：`dsh-plugin-wallpaper-engine` 是 bundle，贡献 9 条 entry，id 是
      `wallpaper-engine` / `wallpaper-engine-fx` / ...，**没有一条等于包名**。
      写 `- id: <包名>` 只是追加一条不指向任何条目的补丁，禁用完全不生效。

      真实 id 的唯一来源是该包 package.json 里 `dsh.bundle.patch` 指到的文件。
    */
    expect(TOGGLE).toContain('resolveEntryIds')
    expect(TOGGLE).toContain("manifest.dsh?.bundle?.patch")
  })

  it('id 尚不在 patch 中时要追加禁用指令', () => {
    // 这些 entry 由 bundle 层声明，profile patch 里本来没有它们的行。
    expect(TOGGLE).toContain('missingIds')
    // 用正则避开「字符串里出现模板占位」的 lint 规则。
    expect(TOGGLE).toMatch(/- id: \$\{id\}/u)
    expect(TOGGLE).toContain("disabled: true")
  })
})

describe('禁用：entry id 解析与去重', () => {
  it('找不到对应条目时如实报错，不盲写 id = 包名', () => {
    /*
      真机踩到：`dsh-plugin-wallpaper-engine` 在 profile 依赖里、也确实被加载，但
      patch 里没有它的 name 条目（由 bundle 内部挂载）。早前盲写
      `- id: dsh-plugin-wallpaper-engine` 只是追加一条对不上任何条目的补丁：
      界面看「点了没反应」，而且每点一次多一条（实测堆了 4 条）。
    */
    expect(TOGGLE).toContain("error: 'entry-not-found'")
    expect(TOGGLE).toContain('byId = entries.filter(entry => entry.id === name)')
  })

  it('按 id 行作为插入锚点（name 可能不存在）', () => {
    // 只在 `name:` 后插入的实现在「无 name 条目」上完全不生效。
    expect(TOGGLE).toContain('const isAnchor = idMatch !== null')
  })

  it('去重：同 id 的「仅 id + disabled」条目只保留一条', () => {
    expect(TOGGLE).toContain('dedupeAppendedEntries')
    expect(TOGGLE).toContain('onlyDisabled')
  })
})

describe('启用状态的两条判据', () => {
  it('bundle 型插件看它是否在 dsh.profile.bundles 里', () => {
    /*
      真机踩到：`dsh-plugin-wallpaper-engine` 在 dependencies 里、但**不在 bundles**
      数组里（即未启用），而早前只查 patch 就把它显示成了「启用」，于是点开关
      看起来毫无反应（其实是「已禁用 → 想启用」这一步写错了分支）。
    */
    const SRC = readFileSync(new URL('../../src/host/installed-plugins.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('isBundlePackage')
    expect(SRC).toContain('readBundleSelection')
    expect(SRC).toContain('selected.includes(plugin.name)')
  })
})

describe('bundle 与普通插件走不同路径（复用官方实现）', () => {
  it('bundle 改 package.json 的 dsh.profile.bundles', () => {
    /*
      官方 `dsh-plugin-manager` 的分工：
        - `setBundleEnabled` → 增删 package.json 的 `dsh.profile.bundles`
        - `setPluginEnabled` → 写 patch 的 `disabled`

      bundle 是一整层组合补丁，写 `disabled` 对它无效——真机对
      `dsh-plugin-wallpaper-engine` 验证过，写了完全没反应。
    */
    expect(TOGGLE).toContain('setBundleEnabled')
    expect(TOGGLE).toContain('dsh?.profile?.bundles')
    expect(TOGGLE).toContain('previous.filter(item => item !== name)')
  })

  it('按官方判据识别 bundle（dsh.bundle.patch 存在）', () => {
    // 与官方 operations.ts 的 bundleManifest 同判据。
    expect(TOGGLE).toContain('isBundle')
    expect(TOGGLE).toContain("manifest.dsh?.bundle?.patch === 'string'")
  })

  it('分派顺序：bundle 优先，非 bundle 才写 patch', () => {
    // 只看 setPackageEnabled 函数体内：文件里另有多处 parsePatchEntries 定义。
    const start = TOGGLE.indexOf('export async function setPackageEnabled')
    const body = TOGGLE.slice(start)
    const idx = body.indexOf('await isBundle(profileDirectory, name)')
    const patchIdx = body.indexOf('const entries = parsePatchEntries(text)')
    expect(idx).toBeGreaterThan(-1)
    expect(patchIdx).toBeGreaterThan(idx)
  })
})

describe('卡片式界面', () => {
  it('用卡片而不是表格行', () => {
    expect(PANEL).toContain('dsh-fnos-cards')
    expect(PANEL).toContain('dsh-fnos-card')
  })

  it('有启用开关、卸载与更新', () => {
    expect(PANEL).toContain('DshSwitch')
    expect(PANEL).toContain('toggleEnabled')
    expect(PANEL).toContain("t('uninstall')")
    expect(PANEL).toContain("t('pluginInstallAction')")
  })

  it('内置插件不允许卸载（删了要重装整个应用才能恢复）', () => {
    expect(PANEL).toContain('plugin.bundled ? null :')
  })

  it('禁用态有视觉区分', () => {
    expect(PANEL).toContain('dsh-fnos-card--off')
    expect(PANEL).toContain("t('pluginDisabled')")
  })

  it('卡片一行两个，窄容器自动退化单列', () => {
    // 单列时每张卡只有一行文字却占满整宽，一屏放不下几个。
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const rule = SCSS.slice(SCSS.lastIndexOf('.dsh-fnos-cards {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))')
  })

  it('「已是最新」也用徽标，与其它状态同构', () => {
    // 裸文字会让同行看起来没对齐——其它状态都是带底色的块。
    const idx = PANEL.indexOf("t('installedUpToDate')")
    const around = PANEL.slice(Math.max(0, idx - 160), idx)
    expect(around).toContain('dsh-fnos-installed-badge')
  })
})

describe('接口', () => {
  it('启用/卸载都是 POST + 同源 + 包名校验', () => {
    expect(ROUTES).toContain('FNOS_PLUGIN_TOGGLE_ROUTE')
    expect(ROUTES).toContain('FNOS_PLUGIN_REMOVE_ROUTE')
    expect(ROUTES).toContain('invalid-enabled')
    expect(ROUTES).toContain('validName')
  })
})
