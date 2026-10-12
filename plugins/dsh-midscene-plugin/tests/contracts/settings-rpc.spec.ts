import { describe, expect, it } from 'vitest'
import {
  MIDSCENE_SETTINGS_NAMESPACE,
  MIDSCENE_SETTINGS_STATUS_PATH,
  MIDSCENE_SETTINGS_UPDATE_PATH,
  MIDSCENE_PACKAGE_NAME,
} from '../../src/contracts/settings-rpc.ts'

/**
 * 接入设置契约（FNOS-013-05、14 的设置页）。
 *
 * 这里钉住的是**两侧必须一致**的事实：路径、命名空间与包名。它们在宿主与浏览器
 * 半侧各写一次，任何一处漂移都会表现为「设置区块读不到数据」——而且不会在构建期
 * 报错（浏览器侧只是 fetch 一个不存在的路径拿到 404）。因此用测试固定。
 */

describe('接入设置契约', () => {
  it('命名空间与 cordis.patch.yml 的入口 id 一致', () => {
    // DSH 通过 entry.fiber.runtime.Config 解析命名空间；对不上会让 settings.update
    // 报 No configurable plugin entry，写入静默失败（界面看起来「保存了」）。
    expect(MIDSCENE_SETTINGS_NAMESPACE).toBe('dsh-midscene')
  })

  it('端点路径挂在包名路径下且互不相同', () => {
    expect(MIDSCENE_SETTINGS_STATUS_PATH).toBe('/plugins/dsh-midscene-plugin/settings')
    expect(MIDSCENE_SETTINGS_UPDATE_PATH).toBe('/plugins/dsh-midscene-plugin/settings/update')
    expect(MIDSCENE_SETTINGS_STATUS_PATH).not.toBe(MIDSCENE_SETTINGS_UPDATE_PATH)
  })

  it('包名与 package.json 一致（详情页 subject 判定按它匹配）', async () => {
    const manifest = await import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    const pkg = JSON.parse(manifest) as { name: string }
    expect(MIDSCENE_PACKAGE_NAME).toBe(pkg.name)
  })

  it('状态端点是更新端点的前缀（避免路由前缀匹配错位）', () => {
    // 上游按精确路径注册（kind: 'exact'），但保持这个关系能让路径一眼可读。
    expect(MIDSCENE_SETTINGS_UPDATE_PATH.startsWith(MIDSCENE_SETTINGS_STATUS_PATH)).toBe(true)
  })
})
