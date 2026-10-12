/**
 * Midscene 接入配置的自动推导（FNOS-013-05、13）。
 *
 * Midscene 强制要求四个模型环境变量，其中 `MIDSCENE_MODEL_FAMILY` 决定它用哪套
 * 提示词模板与坐标解析协议——**它是接入能否成立的关键**（需求调研结论里标为
 * 「待核实 R2」）。本模块把「用户要自己查官方文档、自己填 family」这件事从用户
 * 身上移到插件身上：桥知道 DSH 里有哪些模型，就能给出可直接使用的接入配置。
 *
 * 设计取舍：family 只能按模型标识**推断**（DSH 的模型元数据里没有 Midscene 的
 * 家族概念，也不该有——那是 Midscene 的私有协议维度）。因此这里给出的是**建议
 * 值**，推断不出时明确返回 `undefined` 让调用方如实呈现「该模型未匹配到已知
 * 家族」，而不是编一个看起来能用的值——错的 family 会让定位静默失准，比报错更难
 * 排查。
 */

/**
 * 家族推断规则：按优先级从模型标识里匹配已知的 Midscene 家族。
 *
 * 规则来自 Midscene 官方「支持的模型与配置」文档列出的家族取值。顺序有讲究：
 * 更具体的模式必须排在更宽泛的前面（如 `glm-v` 之于 `glm`、`gpt-6` 之于 `gpt-5`）。
 */
const FAMILY_RULES: readonly { readonly pattern: RegExp, readonly family: string }[] = [
  // AutoGLM 必须在 GLM 之前：它名字里也含 `glm`，但 Midscene 用的是另一套家族
  // （`auto-glm*`，面向移动端），被 `glm-v` 吃掉会让定位协议用错。
  { pattern: /autoglm.*multilingual/i, family: 'auto-glm-multilingual' },
  { pattern: /autoglm|auto-glm/i, family: 'auto-glm' },
  // 智谱 GLM 系列。`glm-v` 是智谱**视觉家族的协议名**（Midscene 侧的 family 取值），
  // 不是「模型名必须含 V」——实测 CodeBuddy 目录里的 `glm-5.3` / `glm-5.3-flash`
  // 都声明了图片能力，走的正是这套视觉协议，因此整个 GLM 系列都归到 `glm-v`。
  { pattern: /glm/i, family: 'glm-v' },
  // DeepSeek（Midscene v1.12.0 起支持）。
  { pattern: /deepseek/i, family: 'deepseek' },
  // OpenAI GPT：UI 定位要求 GPT-5.4+，故按代次给具体家族。
  { pattern: /gpt-6/i, family: 'gpt-6' },
  { pattern: /gpt-5/i, family: 'gpt-5' },
  { pattern: /gpt-4/i, family: 'gpt-4' },
  // Google Gemini。
  { pattern: /gemini/i, family: 'gemini' },
  // 千问 Qwen：3.x 用 qwen3，2.x 用 qwen2。
  { pattern: /qwen3/i, family: 'qwen3' },
  { pattern: /qwen2/i, family: 'qwen2' },
  { pattern: /qwen/i, family: 'qwen3' },
  // 字节豆包 Seed。
  { pattern: /doubao.*seed|seed.*doubao/i, family: 'doubao-seed' },
  // 月之暗面 Kimi。
  { pattern: /kimi.*k3/i, family: 'kimi3' },
  { pattern: /kimi/i, family: 'kimi' },
  // 小米 MiMo。
  { pattern: /mimo/i, family: 'xiaomi-mimo' },
  // UI-TARS。
  { pattern: /ui-?tars.*doubao|doubao.*ui-?tars.*1\.5/i, family: 'vlm-ui-tars-doubao-1.5' },
  { pattern: /ui-?tars/i, family: 'vlm-ui-tars' },
]

/**
 * 按模型标识推断 Midscene 家族。
 *
 * 匹配对象是「提供方/模型」标识与模型可读名的拼接——只匹配 id 会漏掉「id 是内部
 * 代号、name 才带系列名」的情况（如 id `hy3`、name `Hunyuan`）。
 * @param model - 对外模型标识与可读名。
 * @param model.id - 「提供方/模型」标识。
 * @param model.name - 模型可读名（id 为内部代号时靠它匹配系列）。
 * @returns 家族建议值；无匹配时为 `undefined`。
 */
export function inferMidsceneFamily(model: { readonly id: string, readonly name?: string }): string | undefined {
  const haystack = `${model.id} ${model.name ?? ''}`
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(haystack)) return rule.family
  }
  return undefined
}

/** 生成接入配置所需的信息。 */
export interface MidsceneEnvInput {
  /** 桥对外基址（含 `/v1`）。 */
  readonly baseUrl: string
  /** 选中的模型标识与可读名。 */
  readonly model: { readonly id: string, readonly name?: string }
}

/** 一份可直接写入 `.env` 的接入配置。 */
export interface MidsceneEnv {
  /** 可直接复制到 `.env` 的文本（不含导出语句，与 Midscene 的 .env 约定一致）。 */
  readonly content: string
  /** 四个变量的结构化形式，便于调用方单独使用。 */
  readonly variables: {
    readonly MIDSCENE_MODEL_BASE_URL: string
    readonly MIDSCENE_MODEL_API_KEY: string
    readonly MIDSCENE_MODEL_NAME: string
    readonly MIDSCENE_MODEL_FAMILY?: string
  }
  /**
   * 未匹配到家族时的说明；匹配到时省略。
   *
   * 如实呈现而不是编一个值：错的 family 会让坐标定位静默失准，比缺值更难排查。
   */
  readonly familyWarning?: string
}

/**
 * 构造一份接入配置。
 *
 * `API_KEY` 固定为占位值：桥不做鉴权（回环绑定 + 本机使用），真实凭据由 DSH 的
 * 各提供方插件持有，桥与 Midscene 都不需要知道。文档与技能都明确要求**不要**往
 * 这里填真实密钥——填了也不会被转发。
 * @param input - 基址与选中模型。
 * @param input.baseUrl - 桥对外基址（含 `/v1`）。
 * @param input.model - 选中的模型标识与可读名。
 * @returns 接入配置。
 */
export function buildMidsceneEnv(input: MidsceneEnvInput): MidsceneEnv {
  const family = inferMidsceneFamily(input.model)
  const lines = [
    '# DSH Midscene Bridge 接入配置（由插件生成，无需填入任何真实密钥）',
    `MIDSCENE_MODEL_BASE_URL="${input.baseUrl}"`,
    'MIDSCENE_MODEL_API_KEY="local-bridge"',
    `MIDSCENE_MODEL_NAME="${input.model.id}"`,
    ...family === undefined ? [] : [`MIDSCENE_MODEL_FAMILY="${family}"`],
  ]
  return {
    content: `${lines.join('\n')}\n`,
    variables: {
      MIDSCENE_MODEL_BASE_URL: input.baseUrl,
      MIDSCENE_MODEL_API_KEY: 'local-bridge',
      MIDSCENE_MODEL_NAME: input.model.id,
      ...family === undefined ? {} : { MIDSCENE_MODEL_FAMILY: family },
    },
    ...family === undefined
      ? {
          familyWarning:
            `模型「${input.model.id}」未匹配到已知的 Midscene 家族，配置中未写入 MIDSCENE_MODEL_FAMILY。`
            + '该变量是必需的且决定 Midscene 的提示词模板与坐标解析，请从 Midscene 文档的家族列表里为这个模型补一个值'
            + '（也可能该模型本就不适合做视觉定位，改选 /v1/models 里 vision 为 true 的已知系列模型更稳）。',
        }
      : {},
  }
}

/**
 * 挑选一个适合 Midscene 的默认模型。
 *
 * 选择优先级（逐级回落，保证结果稳定可复现）：
 * 1. **有图片能力 + 家族可推断**——最理想：Midscene 靠截图理解页面（需要图片输入），
 *    且家族决定它的提示词模板与坐标解析协议（推断不出就只能靠用户自己补）。
 * 2. 有图片能力（家族待用户确认）。
 * 3. 目录第一个模型——目录里连图片模型都没有时，让调用方如实呈现不适用，
 *    而不是假装可用。
 * @param models - 目录条目。
 * @returns 选中的模型；目录为空时为 `undefined`。
 */
export function pickDefaultModel<T extends { readonly id: string, readonly name?: string, readonly vision?: boolean }>(
  models: readonly T[],
): T | undefined {
  const visionModels = models.filter(model => model.vision === true)
  return visionModels.find(model => inferMidsceneFamily(model) !== undefined)
    ?? visionModels[0]
    ?? models[0]
}
