import { describe, expect, it } from 'vitest'
import type { MidsceneSettingsRequest, MidsceneSettingsSnapshot } from '../../src/contracts/settings-rpc.ts'
import {
  DEDICATED_INTENTS,
  INTENT_CONFIG_FIELD,
  INTENT_ENV_PREFIX,
  MIDSCENE_INTENTS,
  intentModelName,
  parseIntentModelName,
} from '../../src/contracts/intents.ts'
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

describe('清空模型（单选的必备能力）', () => {
  // 背景：多选时靠删除标签即可取消；改为单选后靠 Semi Select 自带的清空图标（×）。
  // 该图标要求组件收到 `showClear`（不是 Input 的 `allowClear`）才渲染，
  // 契约层对应「空串是合法值」——清空即写入空串。
  it('空串是合法写入值，代表未指定', () => {
    const request: MidsceneSettingsRequest = { action: 'update', model: '' }
    expect(request.model).toBe('')
  })

  it('已选模型的快照通过 model 字段暴露，空串表示未指定', () => {
    const selected: MidsceneSettingsSnapshot['model'] = 'codebuddy/glm-5.3-flash'
    const cleared: MidsceneSettingsSnapshot['model'] = ''
    expect(selected).not.toBe(cleared)
    expect(cleared).toBe('')
  })
})

describe('多职责快照契约（FNOS-021-02）', () => {
  it('职责列表与契约导出一致且顺序固定（Tabs 顺序由它决定）', () => {
    expect([...MIDSCENE_INTENTS]).toEqual(['default', 'locate', 'planning', 'insight'])
    // 可选职责是职责列表去掉 default，不多不少。
    expect([...DEDICATED_INTENTS]).toEqual(MIDSCENE_INTENTS.filter(intent => intent !== 'default'))
  })

  it('每个职责都有各自的配置字段与环境变量前缀（共名会让桥无法路由）', () => {
    // 字段名与前缀都是「每个职责一个」，没有共用同一个键的组合。
    expect(new Set(Object.values(INTENT_CONFIG_FIELD)).size).toBe(MIDSCENE_INTENTS.length)
    expect(new Set(Object.values(INTENT_ENV_PREFIX)).size).toBe(MIDSCENE_INTENTS.length)
    // 前缀与上游一致：默认用 MIDSCENE_MODEL_*，专用职责用 MIDSCENE_<职责>_MODEL_*。
    expect(INTENT_ENV_PREFIX.default).toBe('MIDSCENE_MODEL')
    expect(INTENT_ENV_PREFIX.locate).toBe('MIDSCENE_LOCATE_MODEL')
  })

  it('对外模型名：默认是固定名，专用职责带 @职责 后缀且互不相同', () => {
    const names = MIDSCENE_INTENTS.map(intent => intentModelName(intent))
    expect(names).toEqual(['dsh-model', 'dsh-model@locate', 'dsh-model@planning', 'dsh-model@insight'])
    expect(new Set(names).size).toBe(names.length)
    // 反解回职责（桥就是靠这一步判断请求属于哪个职责）。
    for (const intent of MIDSCENE_INTENTS) {
      expect(parseIntentModelName(intentModelName(intent))).toBe(intent)
    }
  })

  it('不是本桥固定名形态的取值不解析成职责（交给「提供方/模型」路径）', () => {
    for (const raw of ['codebuddy/glm-5.3', 'dsh-model@nope', 'dsh-model@', 'dsh-modelx', '']) {
      expect(parseIntentModelName(raw), raw).toBeUndefined()
    }
  })

  it('写入请求可携带三个专用职责字段，空串表示沿用默认', () => {
    const request: MidsceneSettingsRequest = {
      action: 'update',
      locateModel: '',
      planningModel: 'codebuddy/glm-5.3',
      insightModel: 'codebuddy/kimi-k3-1',
    }
    expect(request.locateModel).toBe('')
  })

  it('快照的每个职责条目带「选了什么」与「实际用什么」两个字段', () => {
    const slot: MidsceneSettingsSnapshot['slots'][number] = {
      intent: 'locate',
      configuredModel: '',
      resolvedModel: 'codebuddy/glm-5.3',
      family: 'glm-v',
      dedicated: false,
    }
    // 未配置专用职责时：configuredModel 为空、resolvedModel 是默认职责的结果。
    expect(slot.configuredModel).toBe('')
    expect(slot.resolvedModel).toBe('codebuddy/glm-5.3')
    expect(slot.dedicated).toBe(false)
  })
})
