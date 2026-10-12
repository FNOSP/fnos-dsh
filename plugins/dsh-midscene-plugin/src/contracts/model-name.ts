/**
 * 「提供方/模型」命名解析（FNOS-013-02 / 桥接服务行为细则第 1 条）。
 *
 * 桥对外的模型标识是 `提供方/模型` 形式（如 `codebuddy/glm-5.3-flash`），
 * 因为 DSH 内多个提供方可能有同名模型，裸名无法定位路由。
 *
 * 难点是**模型 id 自含 `/`**（OpenRouter 风格的 `vendor/model` 是常见形态）。
 * 因此不能简单地按第一个 `/` 切分，采用两条规则：
 *
 * 1. **已注册提供方的最长前缀匹配**：在已知提供方列表里找最长的、能作为
 *    路径前缀匹配上的提供方 id，其后必须是 `/`；余下部分是模型 id。这天然
 *    支持提供方 id 含 `/` 与模型 id 含 `/` 两种情况（如提供方 `openrouter`
 *    配模型 `deepseek/deepseek-chat` → `openrouter/deepseek/deepseek-chat`）。
 * 2. **未命中已知提供方时**：退化为「第一个 `/` 之前是提供方」。这样即便
 *    目录缓存尚未刷新（新装提供方插件），请求仍能解析出提供方并交给宿主
 *    模型层做权威判定（未注册路由由宿主给出明确错误）。
 *
 * 裸模型名（不带 `/`）按插件配置的 `defaultProvider` 处理；未配置默认提供方
 * 时解析失败并返回明确错误——比猜一个提供方安全。
 */

/** 解析结果：定位到一个具体路由。 */
export interface ResolvedModel {
  /** 提供方路由键。 */
  readonly provider: string
  /** 模型 id（可自含 `/`）。 */
  readonly model: string
}

/**
 * 解析模型标识为「提供方 + 模型」。
 *
 * @param raw - 请求中的模型字段（`提供方/模型` 或裸模型名）。
 * @param knownProviders - 宿主已注册的提供方路由键；用于最长前缀匹配。
 * @param defaultProvider - 裸模型名回落的提供方；空串表示不接受裸名。
 * @returns 解析结果；无法解析时为 `undefined`。
 */
export function resolveModelName(
  raw: string,
  knownProviders: readonly string[],
  defaultProvider: string,
): ResolvedModel | undefined {
  const value = raw.trim()
  if (value.length === 0) return undefined

  // 裸模型名：无 `/` 时只能靠配置的默认提供方。
  if (!value.includes('/')) {
    return defaultProvider.length === 0 ? undefined : { provider: defaultProvider, model: value }
  }

  // 规则 1：已知提供方的最长前缀匹配（提供方 id 自身也可能含 `/`）。
  const candidates = knownProviders
    .filter(provider => provider.length > 0 && value.startsWith(`${provider}/`))
    .sort((left, right) => right.length - left.length)
  const longest = candidates[0]
  if (longest !== undefined) {
    return { provider: longest, model: value.slice(longest.length + 1) }
  }

  // 规则 2：目录缓存未命中时按第一个 `/` 切分，把判定交给宿主模型层。
  const separator = value.indexOf('/')
  const provider = value.slice(0, separator)
  const model = value.slice(separator + 1)
  if (provider.length === 0 || model.length === 0) return undefined
  return { provider, model }
}

/**
 * 反向拼装：把路由表示为对外模型标识。
 *
 * @param provider - 提供方路由键。
 * @param model - 模型 id。
 * @returns `提供方/模型` 形式的对外标识。
 */
export function formatModelName(provider: string, model: string): string {
  return `${provider}/${model}`
}
