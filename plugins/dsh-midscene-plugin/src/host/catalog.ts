/**
 * 模型目录映射（FNOS-013-02）：宿主模型层 → 标准 OpenAI 列表。
 *
 * 桥不硬编码任何提供方：目录聚合 `ctx.llm.listProviders()` 与逐提供方的
 * `listModels()`，把每个模型映射为一条 OpenAI 列表条目，模型标识用
 * 「提供方/模型」形式（见 `model-name.ts` 的解析规则）。新增提供方插件或
 * 用户配置新的自定义端点后，`llm/adapters-updated` 事件触发缓存失效，
 * 目录随之更新——**无需改动本插件**（AC-03）。
 */
import type { LlmModelInfo, LlmProviderInfo, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { formatModelName } from '../contracts/model-name.ts'

/** 标准 OpenAI 模型列表条目。 */
export interface OpenAiModelEntry {
  /** 对外模型标识，「提供方/模型」形式。 */
  readonly id: string
  /** 宿主给出的模型可读名（选择器与诊断用）。 */
  readonly name: string
  /** 提供方路由键；非标准字段，便于客户端排查。 */
  readonly owned_by: string
  /** 目录披露的补充说明。 */
  readonly description?: string
  /**
   * 能力标注（非标准扩展字段）：`input_modalities` 与宿主元数据一致。
   * 宿主未声明时为 `undefined`——「未知」与「明确不支持」语义不同。
   */
  readonly input_modalities?: readonly string[]
  /** 是否具备图片输入能力；供不支持扩展字段的客户端读取。 */
  readonly vision: boolean
}

/** 目录快照：列表条目 + 解析用的已知提供方。 */
export interface ModelCatalogSnapshot {
  readonly entries: readonly OpenAiModelEntry[]
  /** 宿主当前注册的提供方路由键（供「提供方/模型」最长前缀匹配）。 */
  readonly providers: readonly string[]
  /** 取快照的时刻（毫秒）。 */
  readonly fetchedAt: number
}

/**
 * 一个模型是否具备图片输入能力。
 *
 * 宿主契约：`inputModalities` 缺省表示**未知**，显式不含 `image` 表示**不支持**。
 * 桥把未知按不支持处理——把图片发给一个未声明图片能力的模型会得到提供方侧的
 * 报错，不如在桥面给出明确错误（需求行为约束：按模型能力门控）。
 * @param model - 宿主模型元数据。
 * @returns 是否可接受图片输入。
 */
export function modelSupportsImage(model: Pick<LlmModelInfo, 'inputModalities'>): boolean {
  return model.inputModalities?.includes('image') === true
}

/**
 * 把一个宿主模型映射为标准 OpenAI 条目。
 * @param model - 宿主模型元数据。
 * @returns 列表条目。
 */
export function toOpenAiModel(model: LlmModelInfo): OpenAiModelEntry {
  const supportsImage = modelSupportsImage(model)
  return {
    id: formatModelName(model.provider, model.id),
    name: model.name,
    owned_by: model.provider,
    ...model.description === undefined ? {} : { description: model.description },
    ...model.inputModalities === undefined ? {} : { input_modalities: [...model.inputModalities] },
    vision: supportsImage,
  }
}

/**
 * 聚合宿主模型层为目录快照。
 *
 * 逐提供方调用 `listModels()`：某个提供方列举失败（如自定义端点暂时不可达）
 * 时**不让整张目录失败**——记为该提供方零模型，其余提供方照常可用；失败清单
 * 由调用方记日志（本函数保持纯粹，便于单测）。
 * @param llm - 宿主模型层服务。
 * @returns 目录快照。
 */
export async function buildCatalog(llm: LlmRuntime): Promise<ModelCatalogSnapshot> {
  const providers: LlmProviderInfo[] = llm.listProviders()
  const entries: OpenAiModelEntry[] = []
  for (const provider of providers) {
    // 单个提供方失败不影响其它提供方：目录是尽力而为的聚合面。
    let models: readonly LlmModelInfo[] = []
    try {
      models = await llm.listModels(provider.id)
    } catch {
      models = []
    }
    for (const model of models) entries.push(toOpenAiModel(model))
  }
  return {
    entries,
    providers: providers.map(provider => provider.id),
    fetchedAt: Date.now(),
  }
}
