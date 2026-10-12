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

/** 决策结果：选中的模型 + 来源说明（用于诊断与提示）。 */
export interface ModelChoice {
  /** 选中的目录条目。 */
  readonly entry: OpenAiModelEntry
  /**
   * 选择来源：
   * - `configured`：来自插件配置的 `models`；
   * - `session`：跟随 DSH 当前模型选择；
   * - `fallback`：兜底挑的具备图片能力的模型。
   */
  readonly source: 'configured' | 'session' | 'fallback'
  /** 配置里指定了但目录中不存在的模型（供设置页提示）。 */
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
 * @param snapshot - 目录快照。
 * @param configured - 插件配置里指定的模型列表（可空）。
 * @param session - DSH 当前模型选择的读取面。
 * @returns 决策结果；目录为空时为 `undefined`。
 */
export function chooseModel(
  snapshot: ModelCatalogSnapshot,
  configured: readonly string[],
  session: SessionModelReader,
): ModelChoice | undefined {
  if (snapshot.entries.length === 0) return undefined
  const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]))
  const skippedConfigured: string[] = []

  // 1) 用户显式指定：按顺序取第一个存在的。
  for (const name of configured) {
    const entry = byId.get(name)
    if (entry !== undefined) return { entry, source: 'configured', skippedConfigured }
    skippedConfigured.push(name)
  }

  // 2) 跟随 DSH 当前模型选择。它可能是没有视觉能力的模型——那是用户的显式选择，
  //    桥尊重它（能力门控会给出明确错误），不擅自替换。
  const current = session.current()
  const currentEntry = current === undefined ? undefined : byId.get(current)
  if (currentEntry !== undefined) return { entry: currentEntry, source: 'session', skippedConfigured }

  // 3) 兜底：目录里第一个具备图片能力的模型（Midscene 需要视觉能力）。
  const vision = snapshot.entries.find(entry => entry.vision === true)
  if (vision !== undefined) return { entry: vision, source: 'fallback', skippedConfigured }

  // 目录里连一个图片模型都没有：退回第一个，让能力门控如实报错。
  return { entry: snapshot.entries[0]!, source: 'fallback', skippedConfigured }
}
