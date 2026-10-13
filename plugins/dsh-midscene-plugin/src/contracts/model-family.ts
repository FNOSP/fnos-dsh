/**
 * 模型 → Midscene 协议家族的映射。
 *
 * **为什么需要它**：Midscene 只按 `MIDSCENE_MODEL_FAMILY` 选适配器，**完全不看模型名**
 * （其 `MODEL_ADAPTER_CONFIGS` 是纯家族名索引）。家族决定三件事：发给模型的提示词模板、
 * 坐标解析方式（形状／顺序／归一化基数）、以及哪些请求参数不受支持。填错的表现是
 * **静默错位**（点击偏几像素到几十像素），而不是报错——所以不能让用户凭猜填写。
 *
 * **映射依据**：Midscene 自己的文档与适配器实现（`@midscene/core` 的
 * `dist/es/ai-model/models/*`）。每个前缀对应一个真实存在的家族名，全部经
 * `MIDSCENE_FAMILIES` 校验。
 *
 * **未知模型不猜**：目录里可能有 Midscene 根本没适配的模型（如各家自研系列）。此时返回
 * `undefined`，由界面如实标注「未知」并要求用户手选——猜错比不猜更危险。
 *
 * @module dsh-midscene/model-family
 */

/** 一条「模型名前缀 → 家族」规则。 */
interface FamilyRule {
  /** 家族名（必须在 Midscene 白名单内）。 */
  readonly family: string
  /**
   * 匹配用的正则（对**小写**的模型标识执行）。
   *
   * 用正则而非 `startsWith`：模型标识里厂商名可以出现在不同位置
   * （`codebuddy/glm-5.3`、`zhipu/glm-4.6v`、`glm-5.3-flash` 都要命中）。
   */
  readonly pattern: RegExp
  /** 供人类阅读的判断依据。 */
  readonly reason: string
}

/**
 * 映射规则表。**顺序有意义**：先匹配到的胜出，因此更具体的规则必须排在更宽泛的前面
 * （例如 `kimi-k3` 必须排在 `kimi` 之前，否则 K3 会被判成旧家族）。
 */
const FAMILY_RULES: readonly FamilyRule[] = [
  { family: 'kimi3', pattern: /kimi[-_.]?k3|kimi3/u, reason: 'Kimi K3 系列（始终开启思考模式）' },
  { family: 'kimi', pattern: /kimi/u, reason: 'Kimi K2 及更早' },
  { family: 'gpt-6', pattern: /gpt[-_.]?6/u, reason: 'GPT-6 系列' },
  { family: 'gpt-5', pattern: /gpt[-_.]?5/u, reason: 'GPT-5 系列（UI 定位需 5.4 及以上）' },
  { family: 'gemini', pattern: /gemini/u, reason: 'Google Gemini（坐标顺序为 yx，与其他家族相反）' },
  { family: 'doubao-seed', pattern: /doubao[-_.]?seed|seed[-_.]?\d/u, reason: '豆包 Seed 系列' },
  { family: 'doubao-vision', pattern: /doubao/u, reason: '豆包旧视觉系列' },
  { family: 'qwen3-vl', pattern: /qwen3[-_.]?vl/u, reason: '千问 Qwen3-VL' },
  { family: 'qwen2.5-vl', pattern: /qwen2\.5[-_.]?vl|qwen[-_.]?vl/u, reason: '千问 Qwen2.5-VL / Qwen-VL' },
  { family: 'qwen3.6', pattern: /qwen3\.6/u, reason: '千问 Qwen3.6' },
  { family: 'qwen3.5', pattern: /qwen3\.5/u, reason: '千问 Qwen3.5' },
  { family: 'qwen3', pattern: /qwen[-_.]?3/u, reason: '千问 Qwen3 系列' },
  { family: 'deepseek', pattern: /deepseek/u, reason: 'DeepSeek 视觉系列（坐标形状为 point）' },
  { family: 'glm-v', pattern: /glm/u, reason: '智谱 GLM 视觉系列' },
  { family: 'xiaomi-mimo', pattern: /mimo/u, reason: '小米 MiMo' },
  { family: 'vlm-ui-tars-doubao-1.5', pattern: /ui[-_.]?tars.*1\.5|1\.5.*ui[-_.]?tars/u, reason: 'UI-TARS 1.5（豆包）' },
  { family: 'vlm-ui-tars-doubao', pattern: /ui[-_.]?tars.*doubao/u, reason: 'UI-TARS（豆包）' },
  { family: 'vlm-ui-tars', pattern: /ui[-_.]?tars/u, reason: 'UI-TARS 原生系列' },
  { family: 'auto-glm', pattern: /auto[-_.]?glm/u, reason: 'AutoGLM 系列' },
]

/** 映射结果。 */
export interface FamilyGuess {
  /** 推断出的家族。 */
  readonly family: string
  /** 判断依据（展示给用户，让结论可核对而不是「插件说啥就是啥」）。 */
  readonly reason: string
}

/**
 * 从模型标识推断 Midscene 协议家族。
 *
 * 输入可以是「提供方/模型」全称，也可以是模型名本身——两者都按子串匹配，
 * 因为厂商名在不同提供方下的位置不固定。
 * @param modelId - 模型标识（如 `codebuddy/glm-5.3-flash`）。
 * @returns 推断结果；无法可靠判断时为 `undefined`（**不猜**）。
 */
export function guessFamily(modelId: string): FamilyGuess | undefined {
  const normalized = modelId.toLowerCase()
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(normalized)) return { family: rule.family, reason: rule.reason }
  }
  return undefined
}

/**
 * 按家族筛选可选模型。
 *
 * `family` 为空时返回空数组：界面据此**隐藏模型字段**——没选家族就没有「能选的模型」
 * 这个概念，显示一个空下拉只会让人以为功能坏了。
 * @param models - 全部可选模型。
 * @param family - 当前家族；空值表示未选择。
 * @returns 属于该家族的模型（无法判断家族的模型**不包含**在内）。
 */
export function filterModelsByFamily<T extends { readonly id: string }>(
  models: readonly T[],
  family: string,
): readonly T[] {
  if (family.trim() === '') return []
  return models.filter(model => guessFamily(model.id)?.family === family)
}

/**
 * 切换家族后仍可保留的模型。
 *
 * 用途：用户从 `glm-v` 换到 `deepseek` 时，原先选中的 GLM 模型不再属于新家族，
 * 必须同时清掉——否则配置里会留下「家族是 deepseek、模型是 glm」的不匹配组合，
 * 而那种组合的表现是静默错位。
 *
 * 与 {@link filterModelsByFamily} 的差别：本函数**保留无法判断家族的条目**。过滤器用于
 * 「从目录里挑可选项」，未知条目本就无从展示；本函数用于「已有选择要不要清掉」，而对
 * 未知条目做保守处理更安全（见函数内注释）。
 * @param models - 原先选中的模型。
 * @param family - 新的家族。
 * @returns 仍属于新家族的模型（原顺序保留）。
 */
export function retainCompatibleModels(
  models: readonly string[],
  family: string,
): readonly string[] {
  if (family.trim() === '') return []
  // 无法判断家族的条目**保留**：那通常意味着它不在当前目录里（提供方被卸载或模型改名），
  // 而非「家族不符」。把它当作不兼容而清掉，会让用户卸载再装回提供方后丢失原有选择；
  // 是否真的不可用由界面按目录比对后提示（`modelsStale`）。
  return models.filter((model) => {
    const guess = guessFamily(model)
    return guess === undefined || guess.family === family
  })
}
