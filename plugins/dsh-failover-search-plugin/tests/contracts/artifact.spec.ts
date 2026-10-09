import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/** 读取构建产物。 */
async function readBuilt(name: string): Promise<string> {
  return await readFile(new URL(`../../lib/${name}`, import.meta.url), 'utf8')
}

describe('FNOS-010-04 构建产物契约', () => {
  it('host 产物导出运行时 Config schema 值（不是仅类型）', async () => {
    // DSH 通过 `entry.fiber.runtime.Config` 解析配置命名空间；`interface Config`
    // 会在构建时擦除，随后每次 settings.update 都报
    // `No configurable plugin entry "dsh-failover-search"`。读 lib/ 而不是 src/：
    // 针对 src/ 的断言在构建前就能通过，看不出过期产物的问题。
    const built = await readBuilt('index.js')
    const exportList = built.match(/export\s*\{[^}]*\}/u)?.[0] ?? ''
    const names = exportList.replace(/^export\s*\{/u, '').replace(/\}$/u, '').split(',').map(name => name.trim())

    expect(names).toContain('Config')
  })

  it('host 产物外置官方包：不内联官方搜索结果提供方', async () => {
    const built = await readBuilt('index.js')

    // 内联会复制一份官方提供方实现，并让 credentials 解析路径分叉。
    expect(built).toContain('@deepseek-ai/dsh-web-search-deepseek')
    expect(built).not.toContain('web_search_20250305')
  })

  it('client 产物以插件包名为 id 注册到宿主模块表，并导出 apply/inject/name', async () => {
    const built = await readBuilt('client.js')

    // DSH 的客户端模块图按 npm 包名寻址：id 与 package.json 的 name 不一致时
    // 宿主拿不到这个模块（表现为插件详情页空白而无报错）。
    expect(built).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id: "@tnnevol\/dsh-failover-search"/u)
    // 三件套是 Cordis 客户端插件的加载契约：缺 name 无法诊断，缺 apply 不挂载，
    // 缺 inject 则 slp/connection 服务读不到。
    expect(built).toMatch(/exports\.apply = apply/u)
    expect(built).toMatch(/exports\.inject = inject/u)
    expect(built).toMatch(/exports\.name = name/u)
  })

  it('client 产物不含半截的样式 import（样式已内联）', async () => {
    const built = await readBuilt('client.js')

    // DSH 客户端模块表不认识 CSS import：留下 `import "./style.css"` 会让整个
    // 插件模块加载失败。
    expect(built.startsWith("import './style.css';")).toBe(false)
    expect(built).toContain('dataset.dshFailoverSearch')
  })

  it('client 产物只保留宿主模块表提供的外部依赖', async () => {
    const built = await readBuilt('client.js')
    const requires = [...built.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1] ?? '')

    // 允许残留的 require 必须都在 DSH 客户端的模块表里：
    // - react 家族与 `util` 由宿主提供；
    // - `dsh-client-ui-primitives` 是官方配置表单控件所在包，仓库内 fnOS 插件的
    //   产物同样按此形式 require 它（见 plugins/dsh-fnos-plugin/lib/client.js）。
    const allowed = (name: string): boolean =>
      name === 'react' || name.startsWith('react/')
      || name === 'react-dom' || name.startsWith('react-dom/')
      || name === 'util'
      || name === '@deepseek-ai/dsh-client-ui-primitives'

    for (const name of requires) {
      expect(allowed(name), `client 残留了模块表里没有的 require("${name}")`).toBe(true)
    }
  })
})
