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

import { GENERIC_FAMILY } from './config.ts'

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
 * 解析实际使用的模型对应的家族。
 *
 * 与 {@link guessFamily} 的差别：本函数**永不返回 undefined**——它用于「已经决定要用这个
 * 模型，那该按哪套协议跟它对话」这个场景，必须给出答案。识别不出家族但模型能识图时回落到
 * {@link GENERIC_FAMILY}（依据见该常量的注释：`bbox/xy/1000` 是 10 个家族共用的主导协议，
 * 实测未适配的识图模型在其下可正常定位）。
 *
 * 这正是「用户选了 Midscene 名单外的识图模型也能正常使用」的实现点：Midscene 需要
 * `MIDSCENE_MODEL_FAMILY` 才能解析坐标，而名单外的模型没有对应适配器——回落通用家族后
 * 即可工作，无需用户理解家族概念。
 * @param modelId - 实际要使用的模型标识。
 * @returns 家族名（始终有效）。
 */
export function resolveFamily(modelId: string): { readonly family: string, readonly exact: boolean, readonly reason: string } {
  const guess = guessFamily(modelId)
  if (guess !== undefined) return { family: guess.family, exact: true, reason: guess.reason }
  return {
    family: GENERIC_FAMILY,
    exact: false,
    reason: '该模型不在 Midscene 的适配器名单内，使用通用协议（与其他识图模型一致）',
  }
}
