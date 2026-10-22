/**
 * Midscene 的**模型职责**（FNOS-021-02）。
 *
 * 上游把模型策略从「三职责」扩展到「四职责」：默认模型提供全部能力，定位（Locate）、
 * 规划（Planning）、页面理解（Insight）三个职责各自可绑定专用模型，未配置者沿用默认。
 * 插件据此把「一个模型」扩展成「四个可选模型」。
 *
 * **每个职责必须有各自的对外模型名**：桥要靠请求里的 `model` 字段判断这次调用属于哪个
 * 职责——如果四组共用同一个名字，桥无从区分，专用职责配的模型就永远不会被用上，而且
 * **不会报错**（与「家族错了点击偏移」同一类静默失效）。因此专用职责的模型名在固定名
 * 之后带一个职责后缀（`dsh-model@locate`），桥据此路由。
 *
 * 本文件**不含任何 import**：浏览器半侧（设置页）也要用它渲染 Tabs，因此不能拖进
 * `node:crypto`、schemastery 之类宿主依赖。
 *
 * @module dsh-midscene/intents
 */

/**
 * 桥对外的固定模型名（默认职责）。
 *
 * 做成固定值后，用户可以把 `.env` 写死、不必随模型变化更新它——换模型只改插件设置。
 * 专用职责在它之后追加 `@职责` 后缀（见 {@link intentModelName}）。
 */
export const FIXED_MODEL_NAME = 'dsh-model'

/** 四个模型职责。 */
export const MIDSCENE_INTENTS = ['default', 'locate', 'planning', 'insight'] as const

/** 模型职责。 */
export type MidsceneIntent = (typeof MIDSCENE_INTENTS)[number]

/**
 * 三个**可选**职责（默认职责始终存在，且是其它职责的回落目标）。
 *
 * 顺序即接入配置里的分组顺序与设置页的 Tab 顺序。
 */
export const DEDICATED_INTENTS = ['locate', 'planning', 'insight'] as const

/** 可选职责。 */
export type DedicatedIntent = (typeof DEDICATED_INTENTS)[number]

/** 插件配置里承载各职责模型的字段名。 */
export type IntentConfigField = 'model' | 'locateModel' | 'planningModel' | 'insightModel'

/** 职责 → 插件配置字段名。 */
export const INTENT_CONFIG_FIELD: Record<MidsceneIntent, IntentConfigField> = {
  default: 'model',
  locate: 'locateModel',
  planning: 'planningModel',
  insight: 'insightModel',
}

/**
 * 职责 → Midscene 环境变量前缀。
 *
 * 与上游一致：默认职责用 `MIDSCENE_MODEL_*`，定位用 `MIDSCENE_LOCATE_MODEL_*`，规划用
 * `MIDSCENE_PLANNING_MODEL_*`，页面理解用 `MIDSCENE_INSIGHT_MODEL_*`。
 */
export const INTENT_ENV_PREFIX: Record<MidsceneIntent, string> = {
  default: 'MIDSCENE_MODEL',
  locate: 'MIDSCENE_LOCATE_MODEL',
  planning: 'MIDSCENE_PLANNING_MODEL',
  insight: 'MIDSCENE_INSIGHT_MODEL',
}

/** 职责 → 中文标签（接入配置的分组注释与设置页 Tab 用）。 */
export const INTENT_LABEL_ZH: Record<MidsceneIntent, string> = {
  default: '默认',
  locate: '定位',
  planning: '规划',
  insight: '页面理解',
}

/**
 * 拼出某个职责的对外模型名。
 *
 * 默认职责沿用固定名（`dsh-model`），专用职责追加 `@职责` 后缀。
 * @param intent - 职责。
 * @returns 对外模型名。
 */
export function intentModelName(intent: MidsceneIntent): string {
  return intent === 'default' ? FIXED_MODEL_NAME : `${FIXED_MODEL_NAME}@${intent}`
}

/**
 * 从请求里的模型名解析它属于哪个职责。
 *
 * 认得两种形态：固定名本身（默认职责）与带 `@职责` 后缀的专用名。其它取值（例如用户
 * 直接写了「提供方/模型」）返回 `undefined`，由调用方按显式路由处理。
 * @param raw - 请求里的 `model` 字段。
 * @returns 职责；不是本桥的固定名形态时为 `undefined`。
 */
export function parseIntentModelName(raw: string): MidsceneIntent | undefined {
  const value = raw.trim()
  if (value === FIXED_MODEL_NAME) return 'default'
  if (!value.startsWith(`${FIXED_MODEL_NAME}@`)) return undefined
  const suffix = value.slice(FIXED_MODEL_NAME.length + 1)
  return (MIDSCENE_INTENTS as readonly string[]).includes(suffix)
    ? suffix as MidsceneIntent
    : undefined
}
