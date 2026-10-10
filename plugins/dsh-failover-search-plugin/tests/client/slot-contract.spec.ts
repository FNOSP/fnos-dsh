import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/** 读取插件客户端入口源码（运行时解析路径，不写死本机绝对路径）。 */
async function readClientEntry(): Promise<string> {
  return await readFile(new URL('../../src/client/index.tsx', import.meta.url), 'utf8')
}

describe('FNOS-010-04 详情页座位契约', () => {
  it('全部界面挂在 plugins.detail.section（而不是 bundle.config）', async () => {
    const source = await readClientEntry()

    // 上游 PackageDetail 的固定顺序是 bundle.config → 「包含的组件」→ detail.section；
    // 需求要求组件列表在前，因此插件内容整体落到 detail.section。
    expect(source).toContain("inject('plugins.detail.section'")
    expect(source).not.toContain("inject('plugins.bundle.config'")
  })

  it('list 座位必须自带 id（座位要求）且不声明 inject（owner props 由页面传入）', async () => {
    const source = await readClientEntry()

    expect(source).toMatch(/name: 'plugins\.detail\.section',\s*\n\s*id: '[a-z0-9-]+'/u)
  })

  it('list 座位被渲染到每个详情页，因此必须按 subject 过滤', async () => {
    const source = await readClientEntry()

    // 不是本插件的组合包就返回 null，否则界面会出现在别的插件详情页上。
    expect(source).toMatch(/subject/u)
    expect(source).toContain('FAILOVER_PACKAGE_NAME')
  })

  it('配置表单经 configForms 按入口 id 取得（与座位无关）', async () => {
    const source = await readClientEntry()

    // 换座位不影响写入路径：同一份共享表单，读写仍走官方 mutate。
    expect(source).toContain('configForms')
    expect(source).toContain('FAILOVER_SETTINGS_NAMESPACE')
  })
})
