/**
 * 桥的「用哪个模型」决策（FNOS-013-05 的固定模型名设计）。
 *
 * Midscene 侧把 `MIDSCENE_MODEL_NAME` 固定成 `dsh-model`，于是**它不再关心实际模型**
 * ——换模型只改插件设置，`.env` 不动。真正的决策落在桥里，按优先级：
 *
 * 1. 插件配置 `models` 里的第一个**在目录中存在**的模型（用户显式指定）；
 * 2. DSH 当前模型选择（`agentDefaultModel.currentSelection()`，即会话里模型选择器
 *    所选项）——在目录中存在时用它；
 * 3. 目录里第一个具备图片能力的模型（兜底：DSH 的默认选择可能是没有视觉能力的
 *    模型，那样 Midscene 无法工作，此时挑一个能用的比直接失败更有帮助）。
 *
 * 每一步都要求「在目录中存在」：配置里写着但已被卸载/改名的模型必须跳过，否则
 * 用户会得到宿主的「未注册路由」错误，而真正的原因（配置指向了不存在的模型）被
 * 埋在下面。
 */
import type { ModelCatalogSnapshot, OpenAiModelEntry } from './catalog.ts'
import { resolveFamily } from '../contracts/model-family.ts'
import {
  DEDICATED_INTENTS,
  INTENT_CONFIG_FIELD,
  type MidsceneIntent,
} from '../contracts/intents.ts'

/** 决策结果：选中的模型 + 来源说明（用于诊断与提示）。 */
export interface ModelChoice {
  /** 选中的目录条目。 */
  readonly entry: OpenAiModelEntry
  /**
   * 选择来源：
   * - `configured`：来自插件配置的 `model`；
   * - `session`：跟随 DSH 当前模型选择；
   * - `fallback`：兜底挑的具备图片能力的模型。
   */
  readonly source: 'configured' | 'session' | 'fallback'
  /** 配置里指定了但目录中不存在的模型（供设置页提示）；未指定或存在时为空。 */
  readonly skippedConfigured: readonly string[]
}

/** 「DSH 当前模型选择」的最小读取面（便于测试注入）。 */
export interface SessionModelReader {
  /**
   * 读取当前选择。
   * @returns 「提供方/模型」形式的标识；无法读取时为 `undefined`。
   */
  readonly current: () => string | undefined
}

/**
 * 按优先级决定实际使用的模型。
 *
 * 优先级：**用户指定的那个** → DSH 当前会话模型（需具备识图能力）→ 目录里第一个具备
 * 识图能力的模型。任何时刻只有一个模型生效——这也是配置里只让选一个的原因。
 * @param snapshot - 目录快照。
 * @param configured - 插件配置里指定的模型（空串表示未指定）。
 * @param session - DSH 当前模型选择的读取面。
 * @returns 决策结果；目录为空时为 `undefined`。
 */
export function chooseModel(
  snapshot: ModelCatalogSnapshot,
  configured: string,
  session: SessionModelReader,
): ModelChoice | undefined {
  if (snapshot.entries.length === 0) return undefined
  const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]))
  const skippedConfigured: string[] = []

  // 1) 用户显式指定：存在着就用它。
  if (configured.trim() !== '') {
    const entry = byId.get(configured)
    if (entry !== undefined) return { entry, source: 'configured', skippedConfigured }
    // 配了但目录里没有（提供方被卸载或模型改名）：如实登记，让设置页能提示，
    // 而不是静默改用别的模型。
    skippedConfigured.push(configured)
  }

  // 2) 跟随 DSH 当前模型选择——但**只在它具备图片能力时**。
  //
  //    会话模型是用户为日常对话选的，不一定是给 Midscene 用的；选到纯文本模型时
  //    Midscene 无法工作（它靠截图理解页面）。这种情况跳过并落到下面的兜底，比让用户
  //    对着「模型不支持图片」的错误自己排查更省事——毕竟用户并没有为 Midscene 指定过模型。
  const current = session.current()
  const currentEntry = current === undefined ? undefined : byId.get(current)
  if (currentEntry !== undefined && currentEntry.vision === true) {
    return { entry: currentEntry, source: 'session', skippedConfigured }
  }
  if (currentEntry !== undefined) skippedConfigured.push(currentEntry.id)

  // 3) 兜底：目录里第一个具备图片能力的模型。会话模型不可用（无视觉能力或未选择）时
  //    走这里——Midscene 必须有识图模型才能工作。
  const vision = snapshot.entries.find(entry => entry.vision === true)
  if (vision !== undefined) return { entry: vision, source: 'fallback', skippedConfigured }

  // 目录里连一个图片模型都没有：退回第一个，让能力门控如实报错。
  return { entry: snapshot.entries[0]!, source: 'fallback', skippedConfigured }
}

/**
 * 按职责决策模型所需的配置面（只取与模型选择有关的字段）。
 *
 * 与完整的 {@link BridgeConfig} 解耦，使这个纯函数可以在单测里直接构造。
 */
export interface IntentModelConfig {
  /** 默认职责配置的模型。 */
  readonly model: string
  /** 定位职责配置的模型。 */
  readonly locateModel: string
  /** 规划职责配置的模型。 */
  readonly planningModel: string
  /** 页面理解职责配置的模型。 */
  readonly insightModel: string
  /** 目录为空时家族回落用的值。 */
  readonly family: string
}

/** 某个职责的模型决策结果。 */
export interface IntentModelChoice {
  /** 职责。 */
  readonly intent: MidsceneIntent
  /** 该职责实际会使用的模型标识；目录为空时为 `undefined`。 */
  readonly modelId: string | undefined
  /** 该职责使用的协议家族（按它自己的模型推导）。 */
  readonly family: string
  /** 该职责是否单独指定了模型（`false` 表示沿用默认职责）。 */
  readonly dedicated: boolean
  /**
   * 该职责的模型来源：
   * - `configured`：用户为该职责显式指定了模型；
   * - `session`：跟随 DSH 当前会话模型（仅默认职责可能出现）；
   * - `fallback`：兜底挑的识图模型（仅默认职责可能出现）；
   * - `inherited`：沿用默认职责的结果。
   */
  readonly source: 'configured' | 'session' | 'fallback' | 'inherited'
  /** 配置了但目录中不存在的模型（供界面如实提示，不静默改选）。 */
  readonly skippedConfigured: readonly string[]
}

/**
 * 按**每个职责自己的模型**分别决策（FNOS-021-02）。
 *
 * 与 {@link chooseModel} 的差别在两处，都源于上游的职责语义：
 *
 * 1. **家族按职责分别推导**：上游对专用职责的家族是独立变量（`MIDSCENE_LOCATE_MODEL_FAMILY`
 *    等），且专用模型**不逐字段继承**默认模型。若沿用「按默认模型推导一次」，用户把定位
 *    模型换成另一个系列时家族会停在默认模型那一套——正是需求禁止的「静默失准」。
 * 2. **未配置专用模型时回落默认职责**：不是回落会话模型。默认职责已经按
 *    「插件配置 → 会话模型 → 识图兜底」决策完毕，专用职责未配置就该跟着它的结果走。
 *
 * 专用职责配了但**目录里没有**该模型（提供方被卸载或模型改名）时，同样回落默认职责并
 * 如实登记（`skippedConfigured`），界面据此提示、配置保留用户的选择。
 * @param snapshot - 目录快照。
 * @param config - 各职责配置的模型。
 * @param session - DSH 当前模型选择的读取面。
 * @returns 每个职责的决策结果。
 */
export function resolveIntentModels(
  snapshot: ModelCatalogSnapshot,
  config: IntentModelConfig,
  session: SessionModelReader,
): Record<MidsceneIntent, IntentModelChoice> {
  const defaultChoice = chooseModel(snapshot, config.model, session)
  const defaultModelId = defaultChoice?.entry.id
  const defaultFamily = resolveFamily(defaultModelId ?? config.family).family

  const slots = {} as Record<MidsceneIntent, IntentModelChoice>
  slots.default = {
    intent: 'default',
    modelId: defaultModelId,
    family: defaultFamily,
    dedicated: false,
    source: defaultChoice?.source ?? 'fallback',
    skippedConfigured: defaultChoice?.skippedConfigured ?? [],
  }

  for (const intent of DEDICATED_INTENTS) {
    const configured = (config[INTENT_CONFIG_FIELD[intent]] ?? '').trim()
    // 未配置：沿用默认职责（不写专用变量组，上游自己会回落）。
    if (configured === '') {
      slots[intent] = {
        intent,
        modelId: defaultModelId,
        family: defaultFamily,
        dedicated: false,
        source: 'inherited',
        skippedConfigured: [],
      }
      continue
    }
    const entry = snapshot.entries.find(candidate => candidate.id === configured)
    // 配了但目录里没有：回落默认职责并如实登记，不静默改选别的模型。
    if (entry === undefined) {
      slots[intent] = {
        intent,
        modelId: defaultModelId,
        family: defaultFamily,
        dedicated: false,
        source: 'inherited',
        skippedConfigured: [configured],
      }
      continue
    }
    slots[intent] = {
      intent,
      modelId: entry.id,
      family: resolveFamily(entry.id).family,
      dedicated: true,
      source: 'configured',
      skippedConfigured: [],
    }
  }
  return slots
}
