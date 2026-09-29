import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { srcPath } from './paths.ts'

/**
 * 配置入口的注册契约。
 *
 * 设置弹框 → 插件管理页组合包详情页的迁移（FNOS-008-02）在这里收口。上游
 * `0.1.7-rc.2` 为社区组合包提供的接缝是 `plugins.bundle.config`，**以包名为
 * key**，只以 `view: 'page'` 渲染在详情页的描述与组件列表之间。
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
  it('以包名为 key 注册 plugins.bundle.config', () => {
    expect(CODE).toContain("'plugins.bundle.config'")
    expect(CODE).toContain(`key: '${PKG.name}'`)
  })

  it('经 slots.inject 等 slot 出现（否则注册会被丢弃）', () => {
    // 上游把该 slot 声明为页面 main 注册的子 slot，因此必须 inject 而不是直接
    // register：直接注册会落在"slot 还不存在"的时刻。
    expect(CODE).toMatch(/ctx\.slots\.inject\('plugins\.bundle\.config'/)
    expect(CODE).toMatch(/ctx\.slots\.register\(\{\s*name: 'plugins\.bundle\.config'/)
  })

  it('注册的是详情页区块组件', () => {
    expect(CODE).toContain('CodeBuddyDetailSection')
  })

  it('key 与 package.json 的 name 一致（挂错组合包就不显示）', () => {
    // 用真实包名反向确认，避免 key 写成一个"看起来对"的字面量。
    expect(PKG.name).toBe('@tnnevol/dsh-codebuddy')
    expect(CODE).toContain(`key: '${PKG.name}'`)
  })
})

describe('旧配置入口已移除', () => {
  it('不再注册设置弹框的 settings.section', () => {
    expect(CODE).not.toContain("'settings.section'")
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
