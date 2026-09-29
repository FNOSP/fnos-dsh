import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { srcPath } from './paths.ts'

/**
 * 配置入口的注册契约。
 *
 * 设置弹框 → 插件管理页组合包详情页的迁移（FNOS-008-02）在这里收口。
 *
 * 座位用 `plugins.detail.section` 而不是官方的 `plugins.bundle.config`：上游
 * `PackageDetail` 的固定顺序是
 *
 *   1. `plugins.bundle.config`——组合包自己的配置
 *   2. 「包含的组件」（`RowsSection`）
 *   3. `plugins.detail.section`——本座位
 *
 * 需求要的顺序是「包含的组件 → 设置字段 → 账号管理 → Token 统计」，因此只能
 * 落在 3。代价是这个座位是 **list**（不按包名分派），页面会给打开的每个详情页
 * 都渲染它——组件必须自己按 `subject` 过滤，否则会在别的插件页面上显形。
 *
 * 这组用例守三类真实故障：
 *
 *  1. **注册消失**——配置区块在详情页里什么都不显示。上游页面的 `main` 注册把
 *     该 slot 声明为子 slot，注册方必须经 `ctx.slots.inject` 等它出现；少了
 *     inject 那一层，注册会在 slot 尚未存在时被丢弃。
 *  2. **key 拼错**——区块注册成功但挂在错误的组合包下，表现为"装了插件却没有
 *     配置入口"。key 必须与 package.json 的 name 完全一致。
 *  3. **旧入口残留**——设置弹框里还留着 CodeBuddy 区块，或全页面面板还能被
 *     hash 唤起（`#/codebuddy`）。需求要求这两处都不再出现。
 */
const CLIENT = readFileSync(srcPath('client/index.tsx'), 'utf8')
const PKG = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string }

/** 剥掉注释，避免解释性文字命中字符串断言。 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^[ \t]*\/\/.*$/gmu, '')
}

const CODE = codeOnly(CLIENT)

describe('CodeBuddy 配置注册到组合包详情页', () => {
  it('注册 plugins.detail.section（排在「包含的组件」之后）', () => {
    expect(CODE).toContain("'plugins.detail.section'")
    // 不再使用 bundle.config：它永远在「包含的组件」之前，满足不了需求顺序。
    expect(CODE).not.toContain("'plugins.bundle.config'")
  })

  it('经 slots.inject 等 slot 出现（否则注册会被丢弃）', () => {
    // 上游把该 slot 声明为页面 main 注册的子 slot，因此必须 inject 而不是直接
    // register：直接注册会落在"slot 还不存在"的时刻。
    expect(CODE).toMatch(/ctx\.slots\.inject\('plugins\.detail\.section'/)
    expect(CODE).toMatch(/ctx\.slots\.register\(\{\s*name: 'plugins\.detail\.section'/)
  })

  it('list 座位用 id 而不是 key，且不声明 inject（owner props 由页面给）', () => {
    // `plugins.detail.section` 是 list：要求 `id`；`subject` 由页面传入，因此
    // `inject` 必须是 undefined——写了会被类型系统拒收。
    expect(CODE).toMatch(/name: 'plugins\.detail\.section'[\s\S]{0,160}id: 'codebuddy'/)
    const reg = CODE.slice(CODE.indexOf("ctx.slots.register({\n    name: 'plugins.detail.section'"))
    expect(reg.slice(0, 240)).not.toContain('inject:')
  })

  it('注册的是详情页区块组件', () => {
    expect(CODE).toContain('CodeBuddyDetailSection')
  })

  it('key 与 package.json 的 name 一致（list 座位靠 subject 自筛）', () => {
    // list 座位不像 keyed 那样由页面按包名分派，因此包名出现在组件内部的
    // subject 判定里——这正是"不筛就会串页"的防线。
    expect(PKG.name).toBe('@tnnevol/dsh-codebuddy')
    const panel = readFileSync(srcPath('client/panel.tsx'), 'utf8')
    expect(panel).toContain(`CODEBUDDY_PACKAGE_NAME = '${PKG.name}'`)
    expect(panel).toMatch(/subject\.pkg\?\.name !== CODEBUDDY_PACKAGE_NAME/)
  })
})

describe('list 座位的 subject 过滤（不筛会串到别的插件页）', () => {
  const panel = readFileSync(srcPath('client/panel.tsx'), 'utf8')

  it('非 bundle 主题一律不渲染', () => {
    expect(panel).toMatch(/subject\.kind !== 'bundle'/)
  })

  it('包名不匹配一律不渲染（别的插件的详情页）', () => {
    expect(panel).toMatch(/subject\.pkg\?\.name !== CODEBUDDY_PACKAGE_NAME/)
  })

  it('subject 缺失时返回 null（页面未给出主题）', () => {
    expect(panel).toMatch(/subject === undefined\) return null/)
  })
})

describe('旧配置入口已移除', () => {
  it('不再注册设置弹框的 settings.section', () => {
    expect(CODE).not.toContain("'settings.section'")
  })

  it('不再注册组合包配置座位 plugins.bundle.config', () => {
    // 换成 detail.section 是为了拿到「组件列表之后」的位置。
    expect(CODE).not.toContain("'plugins.bundle.config'")
  })

  it('不再注册全页面面板 shell.overlay', () => {
    expect(CODE).not.toContain("'shell.overlay'")
  })

  it('不再有 hash 路由控制器与面板 hash', () => {
    expect(CODE).not.toContain('PanelRouteController')
    expect(CODE).not.toContain('#/codebuddy')
  })

  it('不再强转 slots 以绕过类型（字符串键注入的痕迹）', () => {
    // 迁移前用 `ctx.slots as unknown as {...}` 注入了类型包不在依赖图里的
    // `shell.overlay`。现在两个 slot 都有类型声明，不需要这种逃逸。
    // （`ctx as unknown as {...}` 取 remote 的强转是另一回事，保留。）
    expect(CODE).not.toContain('ctx.slots as unknown')
  })
})

describe('composer 用量指示器不受迁移影响', () => {
  it('仍然注册 conversation.input.right', () => {
    expect(CODE).toContain("'conversation.input.right'")
    expect(CODE).toContain("id: 'codebuddy-usage'")
  })
})

describe('package.json 声明了插件管理页的类型依赖', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    dsh: { client: { inject: string[] } }
    peerDependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const PM = '@deepseek-ai/dsh-client-ui-plugin-manager'

  it('dsh.client.inject 含插件管理页（客户端模块表按它装配）', () => {
    expect(pkg.dsh.client.inject).toContain(PM)
  })

  it('peer/dev 依赖都声明（类型只在编译期用，运行时不 import）', () => {
    expect(pkg.peerDependencies[PM]).toBeDefined()
    expect(pkg.devDependencies[PM]).toBeDefined()
  })

  it('运行时只做 type-only 引入该包', () => {
    // 客户端模块表里没有这个包的运行时入口，真 import 会直接报模块缺失。
    expect(CLIENT).toMatch(/import type \{\} from '@deepseek-ai\/dsh-client-ui-plugin-manager\/client'/)
    expect(CODE).not.toMatch(/^import \{[^}]*\} from '@deepseek-ai\/dsh-client-ui-plugin-manager/mu)
  })
})
