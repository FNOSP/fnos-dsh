/**
 * Midscene 的「模型原生思考」意图 → 宿主 `reasoningEffort` 的映射（FNOS-021-03）。
 *
 * **问题**：Midscene 默认**关闭**模型原生思考（为了速度与稳定性），各家族适配器会把
 * 这个意图写进请求体的不同字段：
 *
 * | 家族 | 字段 |
 * | --- | --- |
 * | 豆包 / GLM / DeepSeek / Kimi / MiMo | `thinking: { type: 'enabled' \| 'disabled' }` |
 * | 千问 | `enable_thinking: boolean` |
 * | Gemini | `extra_body.google.thinking_config.thinking_level` |
 * | GPT-5 / GPT-6 | `reasoning_effort`（`none` 表示关闭） |
 *
 * 桥原先只读消息/温度/长度/停止词/工具，其余字段静默丢弃——于是 Midscene 以为已经关掉思考，
 * 桥却按宿主的默认策略开思考：**同一任务更慢、更贵，且没有任何提示**。
 *
 * **做法**：把意图映射到宿主 `GenerateOptions.reasoningEffort`。宿主只有这一个思考开关
 * （适配器拥有的不透明档位 id），没有 `thinking`/`enable_thinking` 这类字段——伪造一个
 * 超集字段对适配器无效，只会制造「以为传了」的假象。
 *
 * **取舍：宁可少传，不可乱传**。各提供方对「关闭」的表述不一致（`off` / `none` /
 * `disabled` / `minimal`），桥**只使用宿主 `resolveModelInfo` 真实披露的档位 id**，不自行
 * 猜测字符串：
 * - 找得到「关闭」档位 → 传它；
 * - 找不到 → **不传**（走宿主默认）。不传时可能仍会思考，但这比「传一个不存在的档位导致
 *   `UNSUPPORTED_REASONING_EFFORT`」安全得多，行为也退回升级前。
 *
 * @module dsh-midscene/reasoning
 */

import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** 表示「关闭 / 不做推理」的档位 id 或名字（统一小写比较）。 */
const OFF_EFFORT_TOKENS: readonly string[] = ['off', 'none', 'disabled']

/**
 * 表示「最低档推理」的档位 id 或名字。
 *
 * 它不等于「关闭」，但它是宿主能表达的最接近关闭的取值（Gemini 自己的 `minimal`
 * 就是这个语义）。只在找不到真正的关闭档位时作为退路。
 */
const MINIMAL_EFFORT_TOKENS: readonly string[] = ['minimal']

/** 从请求体解析出的思考意图。 */
export type ThinkingIntent =
  /** Midscene 想关闭原生思考（默认行为）。 */
  | { readonly kind: 'disabled' }
  /** Midscene 想开启原生思考但没指定档位。 */
  | { readonly kind: 'enabled' }
  /** Midscene 指定了具体档位（如 `medium`）。 */
  | { readonly kind: 'effort', readonly value: string }

/**
 * 把未知值收窄成普通对象。
 * @param value - 待判定值。
 * @returns 对象或 `undefined`。
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * 取一个非空字符串（去掉首尾空白）。
 * @param value - 待判定值。
 * @returns 非空字符串或 `undefined`。
 */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 判断一个档位取值是否在给定词表里。
 * @param value - 档位 id 或名字（已小写）。
 * @param tokens - 词表。
 * @returns 是否命中。
 */
function matchesToken(value: string, tokens: readonly string[]): boolean {
  return tokens.includes(value)
}

/**
 * 把一个「档位值」字符串转成意图。
 *
 * `none` / `minimal` 这类取值本身就是「不做推理」的写法，因此归到 `disabled`。
 * @param value - 档位取值。
 * @returns 思考意图。
 */
function intentFromEffortValue(value: string): ThinkingIntent {
  const normalized = value.toLowerCase()
  if (matchesToken(normalized, OFF_EFFORT_TOKENS) || matchesToken(normalized, MINIMAL_EFFORT_TOKENS)) {
    return { kind: 'disabled' }
  }
  return { kind: 'effort', value: normalized }
}

/**
 * 从 OpenAI 兼容请求体解析 Midscene 的思考意图。
 *
 * 按**明确的开关字段优先**的顺序判断（Midscene 每个家族只发其中一套，顺序主要用于
 * 同一请求里出现多个字段时的一致性）：
 * 1. `thinking.type`：`disabled` → 关；`enabled` → 开（若同时带 `reasoning_effort` 则用该档位）；
 * 2. `enable_thinking`：`false` → 关；`true` → 开；
 * 3. `reasoning_effort`：`none`/`minimal` → 关；其它 → 该档位；
 * 4. `extra_body.google.thinking_config.thinking_level`：同上。
 * @param body - 已解析的请求体。
 * @returns 思考意图；请求里没有任何相关字段时为 `undefined`（与升级前一致，不动）。
 */
export function parseThinkingIntent(body: Record<string, unknown>): ThinkingIntent | undefined {
  const reasoningEffort = nonEmptyString(body.reasoning_effort)
  const thinkingType = nonEmptyString(asRecord(body.thinking)?.type)?.toLowerCase()

  // 豆包 / GLM / DeepSeek / Kimi / MiMo：`thinking.type` 决定开关，`reasoning_effort` 只在开启时带档位。
  if (thinkingType === 'disabled') return { kind: 'disabled' }
  if (thinkingType === 'enabled') {
    return reasoningEffort === undefined ? { kind: 'enabled' } : intentFromEffortValue(reasoningEffort)
  }

  // 千问：`enable_thinking` 布尔。
  if (body.enable_thinking === false) return { kind: 'disabled' }
  if (body.enable_thinking === true) return { kind: 'enabled' }

  // GPT-5 / GPT-6：只发 `reasoning_effort`，用 `none` 表示关闭。
  if (reasoningEffort !== undefined) return intentFromEffortValue(reasoningEffort)

  // Gemini：`extra_body.google.thinking_config.thinking_level`，`minimal` 是最低档。
  const google = asRecord(asRecord(body.extra_body)?.google)
  const thinkingLevel = nonEmptyString(asRecord(google?.thinking_config)?.thinking_level)
  if (thinkingLevel !== undefined) return intentFromEffortValue(thinkingLevel)

  return undefined
}

/**
 * 在宿主披露的档位里挑出与意图匹配的那一个。
 *
 * **只返回宿主确实提供的 id**，绝不自行拼字符串——拼错的档位会在发起请求前被
 * `UNSUPPORTED_REASONING_EFFORT` 拦下，等于把一个本来能用的请求打成失败。
 * @param intent - 思考意图。
 * @param efforts - 宿主 `resolveModelInfo` 给出的可选档位（按由弱到强排序）。
 * @returns 命中的档位 id；无可表达档位时为 `undefined`（调用方据此不传）。
 */
export function pickReasoningEffort(
  intent: ThinkingIntent,
  efforts: readonly { readonly id: string, readonly name: string }[],
): string | undefined {
  if (efforts.length === 0) return undefined
  const has = (effort: { readonly id: string, readonly name: string }, tokens: readonly string[]): boolean =>
    matchesToken(effort.id.toLowerCase(), tokens) || matchesToken(effort.name.toLowerCase(), tokens)

  switch (intent.kind) {
    case 'disabled': {
      // 优先真正的「关闭」档位；没有再退到最低档。
      const off = efforts.find(effort => has(effort, OFF_EFFORT_TOKENS))
      if (off !== undefined) return off.id
      return efforts.find(effort => has(effort, MINIMAL_EFFORT_TOKENS))?.id
    }
    case 'enabled': {
      // 「开启思考」= 列表里第一个既非「关闭」也非「最低档」的档位。efforts 由弱到强排序，
      // 因此这取到的是「能思考」里最省的一档，而不是一路拉到 max（后者会明显更慢更贵）。
      // 宿主没有可用的「开启」档位时不传，按宿主默认走。
      return efforts.find(effort =>
        !has(effort, OFF_EFFORT_TOKENS) && !has(effort, MINIMAL_EFFORT_TOKENS))?.id
    }
    case 'effort': {
      const wanted = intent.value.toLowerCase()
      return efforts.find(effort =>
        effort.id.toLowerCase() === wanted || effort.name.toLowerCase() === wanted)?.id
    }
  }
}

/**
 * 解析一次请求最终要传给宿主的思考档位。
 *
 * 任何一步失败（请求里没有思考字段、宿主不披露档位、`resolveModelInfo` 报错或超时）都
 * 降级为 `undefined`——**请求照常发出**，思考行为退回宿主默认（与升级前一致）。
 * @param llm - 宿主模型层（只用到 `resolveModelInfo`）。
 * @param provider - 提供方路由键。
 * @param model - 模型 id。
 * @param body - 已解析的请求体。
 * @param signal - 可选中止信号。
 * @returns 宿主档位 id；不应传时为 `undefined`。
 */
export async function resolveReasoningEffort(
  llm: Pick<LlmRuntime, 'resolveModelInfo'>,
  provider: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReasoningEffortId | undefined> {
  const intent = parseThinkingIntent(body)
  if (intent === undefined) return undefined
  let efforts: readonly { readonly id: string, readonly name: string }[]
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    efforts = info.reasoning?.efforts ?? []
  } catch {
    // 目录/适配器暂时给不出元数据：不传，不影响请求本身。
    return undefined
  }
  const picked = pickReasoningEffort(intent, efforts)
  // 宿主档位 id 是不透明品牌类型，只有这里把字符串提升为品牌。
  return picked === undefined ? undefined : picked as ReasoningEffortId
}
