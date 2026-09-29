/**
 * Codex 模型能力契约：DSH 侧描述的七个模型能力，host 与 client 共用。
 *
 * 为什么必须存在这样一份清单，而不是让它只活在 `cordis.patch.yml` 里：
 *
 * 1. 配置里的 `models` 数组是**整体替换**内置目录，不是逐字段合并。DSH 内置的
 *    pi-ai Codex 目录在 `0.87.0` 及更早版本里没有 `gpt-6-sol` / `gpt-6-luna`，
 *    因此只写 `id`/`name` 的条目会静默回落成 `reasoning: false`（选择器显示
 *    「当前模型未提供推理等级」）、`input: ["text"]`（图片不能选）和
 *    `contextWindow: 262144`（比真实窗口小，长任务被提前压缩）。回落**不报错**，
 *    所以只能靠声明完整字段来避免。
 * 2. 设置页的「获取可用模型」弹框把候选项交给官方编辑器，编辑器再按候选项的
 *    `inputModalities`/`contextWindow`/`maxTokens` 生成新行。候选项缺这些字段时，
 *    新加入的模型行同样缺能力——这正是上面那种残缺条目被写进用户层的原因。
 *    客户端桥接因此也从这里取能力，而不是自己再抄一份。
 * 3. 两处各写一份必然漂移，所以 [`cordis.patch.yml`](../../cordis.patch.yml) 的条目
 *    与本文由 `tests/host/model-capabilities.spec.ts` 逐字段比对：补丁改了而契约没改
 *    （或反过来）测试即失败，不会静默降级。
 *
 * 取值对齐 pi-ai `0.87.1` 的 Codex 目录。
 *
 * @module dsh-codex-auth/model-capabilities
 */

/** 能力清单里允许出现的输入模态；与 llm-pi-ai 的 `input` 词表一致。 */
export type CodexInputModality = 'text' | 'image'

/**
 * `reasoningEfforts` 的取值语义。同一个字段有三种含义，写法不能混：
 *
 * - **不声明 `off`**：该模型不支持关闭思考，`off` 被钉死为不可用；
 * - **`off: null`**：提供 `off`，且选它时不发送任何思考参数；
 * - **`off: 'none'`**：提供 `off`，选它时发送字面量 `"none"`。
 */
export type CodexReasoningWire = string | null

/** 一个 Codex 模型的完整能力。 */
export interface CodexModelCapability {
  /** 模型 id，同时是后端接受的模型名。 */
  readonly id: string
  /** 展示名。 */
  readonly name: string
  /** 请求与响应合计的上下文窗口。 */
  readonly contextWindow: number
  /** 单次响应最大输出 token。 */
  readonly maxTokens: number
  /** 接受的输入模态。 */
  readonly input: readonly CodexInputModality[]
  /**
   * 思考等级到线路值的映射。未出现的等级表示该模型不提供；`off` 的三种语义
   * 见 {@link CodexReasoningWire}。
   */
  readonly reasoningEfforts: Readonly<Record<string, CodexReasoningWire>>
}

/** 深思等级的共同前缀：`minimal..max`，各模型的真实线路值。 */
const FULL_LEVELS = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
} as const

const CONTEXT_WINDOW = 272_000
const MAX_TOKENS = 128_000
/** 七个模型当前都是图文输入；单独抽出来避免每行重复书写造成漂移。 */
const TEXT_AND_IMAGE: readonly CodexInputModality[] = ['text', 'image']

/**
 * Codex Auth 声明并保证的模型集合，顺序即补丁中的书写顺序。
 *
 * `gpt-6-astra` 的目录条目把 `off` 映射为 `null`，即该模型确实没有 `off`；
 * `gpt-5.5` 的目录不提供 `max`，因此它的等级到 `xhigh` 为止。
 */
export const CODEX_MODEL_CAPABILITIES: readonly CodexModelCapability[] = [
  {
    id: 'gpt-6-astra',
    name: 'GPT-6-Astra',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    reasoningEfforts: { ...FULL_LEVELS },
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6-Sol',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    reasoningEfforts: { off: 'none', ...FULL_LEVELS },
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6-Luna',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    reasoningEfforts: { off: 'none', ...FULL_LEVELS },
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    reasoningEfforts: { off: null, ...FULL_LEVELS },
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    reasoningEfforts: { off: null, ...FULL_LEVELS },
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    reasoningEfforts: { off: null, ...FULL_LEVELS },
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
    input: TEXT_AND_IMAGE,
    // 目录不为 gpt-5.5 提供 `max`，所以这里到 `xhigh` 为止。
    reasoningEfforts: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  },
]

/** 按 id 取能力；未知 id 返回 `undefined`（调用方决定是否省略字段而不是猜）。 */
export function codexModelCapability(id: string): CodexModelCapability | undefined {
  return CODEX_MODEL_CAPABILITIES.find(model => model.id === id)
}
