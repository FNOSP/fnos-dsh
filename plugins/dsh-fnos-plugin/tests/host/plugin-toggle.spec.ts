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

describe('安装进度内联在卡片里，不再弹二级弹框', () => {
  it('卡片内渲染进度组件，弹框已移除', () => {
    /*
      原先点「更新」弹一个二级弹框塞满 pnpm 输出：弹中弹、挡住列表、关掉即失。
      现在过程可见、结果留在原地、默认折叠不占版面。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('PluginInstallInline')
    expect(PANEL).not.toContain('PluginInstallDialog')
  })

  it('日志固定三行高度，默认折叠', () => {
    // 固定高度：pnpm 输出长度不可预期，撑开会把下面的卡片顶走。
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-install-inline-log {')
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('\n}', idx))
    expect(rule).toContain('height: 56px')
    expect(rule).toContain('overflow: auto')

    const CMP = readFileSync(new URL('../../src/components/PluginInstallInline.tsx', import.meta.url), 'utf8')
    // 默认折叠。
    expect(CMP).toContain("useState(false)")
    // 成功自动收起、失败常驻。
    expect(CMP).toContain("if (status !== 'succeeded') return")
  })

  it('状态用图标 + 文字 + 颜色三重表达', () => {
    // 只靠颜色的话色盲用户分不出成功与失败。
    const CMP = readFileSync(new URL('../../src/components/PluginInstallInline.tsx', import.meta.url), 'utf8')
    expect(CMP).toContain('lucide:circle-check')
    expect(CMP).toContain('lucide:circle-x')
    expect(CMP).toContain('installStatusSucceeded')
    expect(CMP).toContain('installStatusFailed')
  })
})

describe('插件图标与本地化名称', () => {
  it('名称取自 locale/zh.json 的 meta.title，图标取自 package.json 的 icon', () => {
    /*
      与官方 `readPluginMeta` 同源：`title` ← `meta.title`、`icon` ← `manifest.icon`。
      包作者写的中文名（如「插件市场」）比包名末段可读得多。
    */
    const SRC = readFileSync(new URL('../../src/host/installed-plugins.ts', import.meta.url), 'utf8')
    expect(SRC).toContain("'locale', 'zh.json'")
    expect(SRC).toContain('locale.meta?.title')
    expect(SRC).toContain('manifest.icon')
  })

  it('图标经插件路由读取，且校验路径不许穿越', () => {
    // `path` 来自查询串，不校验就能 `../../etc/passwd` 读任意文件。
    const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
    const idx = ROUTES.indexOf("path: FNOS_PLUGIN_ASSET_ROUTE")
    const block = ROUTES.slice(idx, idx + 2000)
    expect(block).toContain("asset.split('/').includes('..')")
    expect(block).toContain('unknown-plugin')
  })

  it('描述用 Typography 自带 tooltip，不用浏览器原生气泡', () => {
    // 原生 `title` 是浏览器自绘气泡，延迟约 1 秒、位置不受控。
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('ellipsis={{ rows: 3, expandable: true, collapsible: true, expandText: t(\'expand\'), collapseText: t(\'collapse\'), showTooltip: true }}')
  })
})

describe('插件说明：三行省略可展开', () => {
  it('用 Typography 的多行 ellipsis，而不是单行截断', () => {
    // 单行把大部分描述都切掉，而列表页的作用正是让人判断「这插件做什么」。
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('ellipsis={{ rows: 3, expandable: true, collapsible: true')
    expect(PANEL).toContain('DshTypography.Paragraph')
  })

  it('描述优先取中文片段', () => {
    /*
      现实中常见写法是英文在前、`·` 分隔、中文在后。界面语言是中文时，把英文那段
      显示出来对用户没有帮助。
    */
    const SRC = readFileSync(new URL('../../src/host/installed-plugins.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('preferChinese')
    expect(SRC).toContain('description = preferChinese(')
  })
})

describe('插件说明文案', () => {
  it('从 package.json 的 description 读取，与官方同源', () => {
    /*
      官方 `plugin-manager` 的 `INSPECT_FIELDS` 就是
      ['name','version','description','dsh']——描述来自同一个字段。
      没有它卡片只剩包名和版本号，用户没法判断「这个插件做什么」。
    */
    const SRC = readFileSync(new URL('../../src/host/installed-plugins.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('manifest.description')
    expect(SRC).toContain('description.trim()')
  })

  it('空描述按「没有」处理，不渲染空行', () => {
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('plugin.description === undefined ? null :')
    expect(PANEL).toContain('dsh-fnos-card-description')
  })
})

describe('插件名可跳转到仓库', () => {
  it('从 package.json 的 repository 归一化出可点击 URL', () => {
    /*
      npm 生态里 repository 有三种常见形态，都要认；认不出就不做链接，
      而不是给一个死链。
    */
    const SRC = readFileSync(new URL('../../src/host/installed-plugins.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('normalizeRepository')
    expect(SRC).toContain('git+')
    expect(SRC).toContain('github.com')
  })

  it('名称用 Typography 单行省略，链接交给它的 link 属性', () => {
    /*
      名称可能很长；`Typography.Text` 的 `ellipsis.showTooltip` 自带提示且只在真的
      被截断时弹。链接通过 `link` 属性传，不再手写 `<a>`。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('DshTypographyText')
    expect(PANEL).toContain("ellipsis={{ showTooltip: true }}")
    expect(PANEL).toContain("target: '_blank'")
    expect(PANEL).toContain("rel: 'noopener noreferrer'")
  })
})

describe('桥接插件禁止禁用', () => {
  it('界面：内置插件的开关置灰', () => {
    /*
      `@tnnevol/dsh-fnos` 一被禁用，授权目录、文件打开、网关反代、进程管理全失效，
      而「启用回来」这个动作正是它自己提供的——用户没有别的入口。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    const idx = PANEL.indexOf('<SwitchWithLoading')
    const block = PANEL.slice(idx, PANEL.indexOf('/>', idx))
    expect(block).toContain('plugin.bundled === true')
  })

  it('服务端：真正写入处拒绝禁用自己（界面置灰只挡鼠标）', () => {
    // 直接 POST 那个接口仍能绕开界面，必须由后端兜底。
    expect(TOGGLE).toContain('SELF_PACKAGE_NAME')
    expect(TOGGLE).toContain("error: 'management-required'")
    const idx = TOGGLE.indexOf('name === SELF_PACKAGE_NAME && !enabled')
    expect(idx).toBeGreaterThan(-1)
  })
})

describe('卸载要完整（参考官方 removeBundle）', () => {
  it('先停用（从 bundles 移出）再 pnpm remove', () => {
    /*
      只跑 `pnpm remove` 会留下半套状态：包装备删了，但 `dsh.profile.bundles` 里
      还留着它的名字——下次启动时 loader 找不到这个 bundle 层，插件视图里则是
      一个「有名字、没内容」的残影。用户看到的就是「卸了但还在列表里」。

      官方 `removeBundle` 的顺序：selectBundle(false) → pnpm remove → publishAndReload。
    */
    const SRC = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    const start = SRC.indexOf('export async function removePlugin')
    const body = SRC.slice(start)
    const deselect = body.indexOf('previous.filter(item => item !== name)')
    const pnpmRemove = body.indexOf("'remove', name")
    expect(deselect).toBeGreaterThan(-1)
    expect(pnpmRemove).toBeGreaterThan(deselect)
  })

  it('pnpm 失败时回滚停用，不留「已停用但仍占磁盘」', () => {
    const SRC = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    const start = SRC.indexOf('export async function removePlugin')
    const body = SRC.slice(start)
    expect(body).toContain('wasSelected')
    // 回滚：把名字加回去。
    expect(body).toContain('[...previous, name]')
  })

  it('删完后校验它真的不在依赖里', () => {
    const SRC = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(SRC).toContain("'still-in-dependencies'")
  })

  it('需要重启才完全生效时提示用户', () => {
    // 没有热更新通道，已加载的模块仍在进程内存里。
    const SRC = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('needRestart')
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("t('pluginRemoveNeedRestart')")
  })
})

describe('卡片式界面', () => {
  it('用卡片而不是表格行', () => {
    expect(PANEL).toContain('dsh-fnos-cards')
    expect(PANEL).toContain('dsh-fnos-card')
  })

  it('有启用开关、卸载与更新', () => {
    // 开关现在经 SwitchWithLoading（切换中换成 Spin）。
    expect(PANEL).toContain('SwitchWithLoading')
    expect(PANEL).toContain('toggleEnabled')
    expect(PANEL).toContain("t('uninstall')")
    // 现在是「更新」，且文案在 tooltip 里。
    expect(PANEL).toContain("t('pluginUpdateAction')")
  })

  it('内置插件不允许卸载（删了要重装整个应用才能恢复）', () => {
    expect(PANEL).toContain('plugin.bundled ? null :')
  })

  it('禁用态有视觉区分', () => {
    expect(PANEL).toContain('dsh-fnos-card--off')
    expect(PANEL).toContain("t('pluginDisabled')")
  })

  it('开关不带 size，保持药丸形；切换中换成 loading', () => {
    /*
      `size="small"` 把高度压到 16px、圆角随之近似方形，同一列表里两个开关看起来
      不是一套控件。

      切换时渲染 `DshSpin` 而不是「置灰的开关」：后者仍像个可操作控件，只是「坏了」，
      用户会以为没点中再点一次。
    */
    const CMP = readFileSync(new URL('../../src/components/SwitchWithLoading.tsx', import.meta.url), 'utf8')
    expect(CMP).toContain('DshSpin')
    expect(CMP).toContain('aria-busy')
    // 内部仍用不带 size 的 DshSwitch。
    const idx = CMP.indexOf('<DshSwitch')
    const block = CMP.slice(idx, CMP.indexOf('/>', idx))
    expect(block).not.toContain('size=')
  })

  it('更新与卸载都是图标按钮，文案进 tooltip', () => {
    /*
      同档的次要动作用文字按钮会让一行里堆两个大色块；图标 + tip 保住可读性。
      `aria-label` 必须有：图标按钮没有可见文本。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    for (const [key, icon] of [['pluginUpdateAction', 'lucide:download'], ['uninstall', 'lucide:trash']]) {
      const idx = PANEL.indexOf(`content={t('${key}')}`)
      expect(idx).toBeGreaterThan(-1)
      const block = PANEL.slice(idx, idx + 500)
      expect(block).toContain(icon)
      expect(block).toContain(`aria-label={t('${key}')}`)
    }
  })

  it('开关固定宽度，两种状态同宽', () => {
    /*
      Semi 用「宽度变化」表达状态（关 33px / 开 40px）。并排展示时右边缘参差不齐，
      看起来像两套控件。固定 40px 后，关闭只是钮左移而不是轨道缩短。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-card .semi-switch {')
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('}', idx))
    expect(rule).toContain('width: 40px')
  })

  it('置灰态保持药丸填充，不变成空心方框', () => {
    /*
      Semi 的 `-disabled` 把背景改成 transparent 再加一圈灰边框，视觉上像「空心
      方框」，与旁边实心的开关不像一套控件。这里改成浅灰填充 + 去边框，圆角不变。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-card .semi-switch.semi-switch-disabled {')
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('}', idx))
    expect(rule).toContain('background-color')
    expect(rule).toContain('border-color: transparent')
  })

  it('卡片三段式：名称行 / 版本徽标行 / 操作行', () => {
    /*
      对齐官方插件页的观感：名称独占一行、版本与状态第二行、操作行两端对齐。
      早前把五个元素全挤进一行，名称被压成 `dsh-plugin-wallp…`，开关与按钮
      也失去层级——看着齐，读起来分不清哪是身份、哪是状态、哪是动作。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('dsh-fnos-card-title')
    expect(PANEL).toContain('dsh-fnos-card-meta')
    expect(PANEL).toContain('dsh-fnos-card-actions')

    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-card-actions {')
    const rule = SCSS.slice(idx, SCSS.indexOf('}', idx))
    // 操作行两端对齐：开关在左、动作按钮在右。
    expect(rule).toContain('justify-content: space-between')
  })

  it('禁用态不给整体 opacity（否则卸载按钮像被禁用）', () => {
    /*
      `opacity: 0.72` 会把整张卡（含「卸载」按钮）一起压淡——按钮看起来像不可点，
      实际上点得动，反而让人不敢点。状态由徽标与开关表达。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-card--off {')
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('}', idx))
    expect(rule).not.toContain('opacity')
    expect(rule).toContain('border-left')
  })

  it('卸载按钮缩小内边距', () => {
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const idx = SCSS.indexOf('.dsh-fnos-card-uninstall.semi-button {')
    expect(idx).toBeGreaterThan(-1)
    const rule = SCSS.slice(idx, SCSS.indexOf('}', idx))
    expect(rule).toContain('padding: 0 8px')
    expect(rule).toContain('min-width: 0')
  })

  it('卡片用瀑布流：列宽固定、各自按内容撑高', () => {
    /*
      用 `columns` 而不是 `grid`：grid 的行高由该行最高的卡片决定，矮卡片会被拉出
      一块空白（描述展开后尤其明显）。`columns` 让卡片按内容自然高度紧密排列。
    */
    const SCSS = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
    const rule = SCSS.slice(SCSS.lastIndexOf('.dsh-fnos-cards {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('columns: 280px')
    expect(body).not.toContain('grid-template-columns')
    // 卡片必须避免被拆到两列之间。
    expect(SCSS).toContain('break-inside: avoid')
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
