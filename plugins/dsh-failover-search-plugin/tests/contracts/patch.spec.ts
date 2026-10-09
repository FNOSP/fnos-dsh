import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/** 读取本插件目录下的文件（运行时解析，不写死本机绝对路径）。 */
async function read(relative: string): Promise<string> {
  return await readFile(new URL(`../../${relative}`, import.meta.url), 'utf8')
}

describe('FNOS-010-01/06/10 组合包 patch 契约', () => {
  it('web 行整行替换时完整重述 fetchProvider（patch 不做深度合并）', async () => {
    const patch = await read('cordis.patch.yml')

    // 发行版基线的 `web` 行是 `searchProvider: deepseek-official` + `fetchProvider: http`；
    // patch 的 config 是整行替换，漏掉 fetchProvider 会让网页抓取配置丢失。
    expect(patch).toMatch(/- id: web\n\s+config:\n\s+searchProvider: dsh-failover-search\n\s+fetchProvider: http\n/u)
  })

  it('插入本插件行，行 id 与搜索提供方 id 同名', async () => {
    const patch = await read('cordis.patch.yml')

    expect(patch).toMatch(/- insert:\n\s+- id: dsh-failover-search\n\s+name: '@tnnevol\/dsh-failover-search'/u)
  })

  it('不重写官方搜索插件行：官方提供方仍在注册表里作为兜底级', async () => {
    const patch = await read('cordis.patch.yml')

    // 兜底靠插件内部的链尾调用，而不是禁用官方行；禁用会让兜底失去提供方。
    expect(patch).not.toContain('web-search-deepseek')
    expect(patch).not.toContain('disabled')
  })

  it('package.json 声明 bundle patch 与 client 半侧', async () => {
    const pkg = JSON.parse(await read('package.json')) as {
      name: string
      displayName: string
      version: string
      dsh: { bundle: { patch: string }, client: { inject: string[], platform: string } }
      exports: Record<string, unknown>
    }

    expect(pkg.name).toBe('@tnnevol/dsh-failover-search')
    expect(pkg.displayName).toBe('Failover Search')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
    // 详情页用量区块要用的座位契约来自插件管理页包，必须在注入清单里。
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')
    expect(pkg.exports['./client']).toBe('./lib/client.js')
    expect(pkg.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
  })

  it('compatibility.json 的 DSH 基线是仓库当前基线 0.2.0-rc.2', async () => {
    const compatibility = JSON.parse(await read('compatibility.json')) as {
      dshPluginApi: { version: string, packages: string[] }
    }

    expect(compatibility.dshPluginApi.version).toBe('0.2.0-rc.2')
    expect(compatibility.dshPluginApi.packages).toContain('@deepseek-ai/dsh-web')
    expect(compatibility.dshPluginApi.packages).toContain('@deepseek-ai/dsh-web-search-deepseek')
  })

  it('npm 元数据指向本仓库的插件子目录', async () => {
    const pkg = JSON.parse(await read('package.json')) as {
      repository: { url: string, directory: string }
      homepage: string
    }

    expect(pkg.repository.url).toContain('github.com/FNOSP/fnos-dsh')
    expect(pkg.repository.directory).toBe('plugins/dsh-failover-search-plugin')
    expect(pkg.homepage).toContain('/plugins/dsh-failover-search')
  })
})
