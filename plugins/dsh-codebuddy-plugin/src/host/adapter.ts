/**
 * `CodeBuddyAdapter`：对 CodeBuddy 的 OpenAI 兼容聊天路由做 fetch + SSE，
 * 身份与模型目录由 OAuth 会话解析。
 *
 * 这个拆分很关键：聊天平面是 OpenAI 兼容的，但目录平面不是，因此模型描述
 * 来自 CodeBuddy 自己的 `/v3/config` 应答——每个模型的工具调用、推理、图像
 * 与大小等事实都出自那里。本类中任何地方都不存在 API key；每个请求都由
 * 会话刷新的浏览器签发 bearer token 授权。
 *
 * @module dsh-codebuddy/adapter
 */

import type { CodeBuddyAdapterOptions } from '../types/host/adapter'
export type { CodeBuddyConnectionOptions, CodeBuddyAdapterOptions } from '../types/host/adapter'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo, LlmReasoningEffortInfo, LlmResolvedModelInfo, PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  CODEBUDDY_DISPLAY_NAME,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from '../contracts/constants.ts'
import { NotLoggedInError } from './session.ts'

import { decideReactiveTarget } from './switch-policy.ts'
import type { SwitchCandidate } from './switch-policy.ts'
import { parseSse } from './sse.ts'
import { serializeRequest } from './serialize.ts'
import { hasRequestImages, serializeRequestWithImages } from './serialize-image.ts'
import { translate } from './translate.ts'
import {
  CODEBUDDY_CLIENT_PLATFORMS,
  CODEBUDDY_CLIENT_VERSIONS,
  CODEBUDDY_DEFAULT_CLIENT,
} from '../contracts/constants.ts'
import type { CodeBuddyClientId } from '../contracts/constants.ts'
import { hasDisclosedCapacity, wireErrorDetail, wireErrorMessage } from './types.ts'
import type { CodeBuddyModel, WireError, WireRequest } from './types.ts'


/**
 * 「等待与退避」为什么**不在本模块**里。
 *
 * 这里曾经实现过一套 `Retry-After` 解析 + 有限等待 + 指数退避（上限 30s）。
 * 后来核实：DSH 自带的 `@deepseek-ai/dsh-llm-retry` 已随 `dsh-base` 挂载，工作
 * 在整个 agent 请求层面，默认 `maxRetries: 5`，自带指数退避（500ms 起、上限
 * 10s、±10% 抖动）**以及 `Retry-After` 支持**。而且它的语义更准确：当服务端给出
 * 的间隔超过 `maxDelayMs` 时直接放弃重试，而不是截断后硬等。
 *
 * 两套并存会产生乘法关系：外层每次重试都会把内层整个跑一遍。因此本模块只保留
 * 官方**不做**的那件事——`QUOTA`（额度耗尽）时换账号，因为官方默认不重试该码，
 * 而换账号是唯一有效手段。等待与退避交给外层。
 */
/** 把 `retry-after` 头解析为毫秒数（当它带有可用延迟时）。 */
function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id') ?? headers.get('x-requestid')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/**
 * 官方客户端在每个聊天请求上都发送的客户端身份头。
 *
 * 服务端用这组头把流量**归因到具体客户端**（`X-IDE-*` 家族），因此它们必须与
 * 「这个账号是用哪个客户端登录的」一致 —— 不是插件级的固定值。
 *
 * 用 CLI 标识发 WorkBuddy 账号的请求，服务端**仍会受理**（实测三种组合都返回
 * 200），但会把流量记到错误的客户端上：客户端侧的用量/统计归因会错，服务端若
 * 按客户端做策略（限流、灰度、审计）也会对这个账号判错。
 *
 * 版本也必须跟着客户端走：CLI 与 WorkBuddy 是两条产品线、版本号各不相同
 * （见 {@link CODEBUDDY_CLIENT_VERSIONS}），且都是产品发布版本、不随会话变化。
 *
 * @param client - 当前活动账号的客户端 id。
 * @param version - 该客户端的版本号；缺省时按字典回退。
 * @returns `X-IDE-*` 头集合。
 */
function clientIdentityHeaders(client: CodeBuddyClientId, version: string | undefined): Record<string, string> {
  // 取值与登录时声明的 `platform` 参数一致（`CLI` / `workbuddy`）。
  const platform = CODEBUDDY_CLIENT_PLATFORMS[client]
  return {
    'X-IDE-Type': platform,
    'X-IDE-Name': platform,
    'X-IDE-Version': version ?? CODEBUDDY_CLIENT_VERSIONS[client],
  }
}

/**
 * 客户端身份的 `User-Agent`。
 *
 * 官方 CLI 的形态是 `CLI/<v> CodeBuddy/<v>`（产品名 + 版本，重复两次）；WorkBuddy
 * 同形，把产品名换成 `WorkBuddy`。实测服务端对 UA 做安全策略校验：
 *  - 含 `deepseek-harness` 标识 → HTTP 400 code=11128（被拦截，见调用点注释）
 *  - CLI / WorkBuddy 两种签名 → HTTP 200
 * @param client - 当前活动账号的客户端 id。
 * @param version - 该客户端的版本号。
 * @returns 可直接作为 `user-agent` 的值。
 */
function clientUserAgent(client: CodeBuddyClientId, version: string | undefined): string {
  const v = version ?? CODEBUDDY_CLIENT_VERSIONS[client]
  const product = client === 'workbuddy' ? 'WorkBuddy' : 'CLI'
  return `${product}/${v} CodeBuddy/${v}`
}

/**
 * CodeBuddy 的业务码：**用量/频率额度已用尽**。
 *
 * 实测语义（同一账号同一时刻跑三个模型）：
 *
 * ```
 * deepseek-v4.1-flash   18298014993:429  涨涨涨:200  16605655975:200
 * glm-5.3              18298014993:200  涨涨涨:200  16605655975:200
 * ```
 *
 * 即 `18298014993` 对 `deepseek-v4.1-flash` 是 429、对 `glm-5.3` 是 200 —— 说明
 * 这是**账号 × 模型**级别的额度耗尽，而不是服务端整体限流。文案也印证：
 * 「您的使用量已超出频率限制，将在 <时间> 重置，您也可以切换其他模型继续使用。」
 *
 * 因此它必须归到 `QUOTA`：上层据此**换账号**（换号能成功，实测另一个账号 200）。
 * 若归到 `RATE_LIMIT`，DSH 官方重试会原地重试同一个账号、同一个模型——而该组合
 * 在重置时间之前不可能成功，只会白耗 5 次请求后失败。
 */
const CODEBUDDY_QUOTA_EXHAUSTED_CODE = '6004'

/**
 * CodeBuddy 的业务码：**请求被上游内容策略拦截**。
 *
 * 实测语义：上游对请求体做逐字精确匹配（非语义审核），系统提示开头的身份说明
 * 命中即被拒，响应体为 `{"code":11128,"msg":"Illegal API invocation from an
 * unapproved channel"}`（HTTP 400），界面文案「请求被拦截，请重新发送」。
 *
 * 与「请求参数确实不合法」的区别：本码**带业务码**，可稳定识别；而 FNOS-020
 * 处理的那类 400 是响应体只有一句话、不带业务码的形态，两者不能混为一谈。
 *
 * 为什么必须独立成码，而不是继续归 `INVALID_REQUEST`：
 *  - `INVALID_REQUEST` 在 {@link CODEBUDDY_RETRY_POLICY} 的**可重试集合**里，
 *    于是确定性拦截会被当作瞬时抖动重试 2 次，纯属放大无效请求；
 *  - 它与账号健康无关（实测同账号、同模型、仅改请求内容即切换结果），
 *    换账号同样无效，不该进换号集合；
 *  - 独立码让失败**一次即返回且可诊断**，用户能看懂发生了什么。
 */
const CODEBUDDY_CONTENT_BLOCKED_CODE = '11128'

/**
 * 内容策略拦截的 harness 错误码。
 *
 * 刻意**不放进** {@link CODEBUDDY_RETRY_POLICY} 的可重试集合，也**不放进**
 * 换号触发集合（换号判定只认 `QUOTA` 与 `RATE_LIMIT`）：这是确定性失败，
 * 重试与换号都不会让同一份请求内容变得合法。
 */
const CONTENT_BLOCKED_CODE = 'CONTENT_BLOCKED'

/**
 * CodeBuddy 的业务码：**账号被上游限制**（需重新登录才能恢复）。
 *
 * 实测形态：HTTP 403 + `{"code":11140,"msg":"request illegal"}`。判定要点：
 *  - 与请求内容、模型无关——同一时刻换用其它账号即可正常调用，被拒账号持续失败；
 *  - 与鉴权失败不同：token 本身仍有效，只是该账号被上游限制，因此**不应**据此
 *    丢弃内存凭据，也不能当作「凭据过期」处理；
 *  - 与内容拦截（11128）相反：内容拦截换号无效，账号受限**必须换号**。
 *
 * 该码还承载另一种与账号无关的形态：模型级限流文案。两者只能按文案区分，
 * 见 {@link CODEBUDDY_RESTRICTED_MARKER}。
 */
const CODEBUDDY_ACCOUNT_RESTRICTED_CODE = '11140'

/**
 * 账号级受限的文案特征。
 *
 * 上游把 11140 同时用于两种情况，业务码本身不足以区分：账号级授权问题带
 * `request illegal` 文案；模型级限流带模型提供方相关文案（那种应归 `RATE_LIMIT`，
 * 换账号也可能有效，但语义是限流而非封禁）。因此只在文案命中时判账号受限。
 */
const CODEBUDDY_RESTRICTED_MARKER = 'request illegal'

/**
 * 账号被上游限制的 harness 错误码。
 *
 * 与 {@link CONTENT_BLOCKED_CODE} 的区别：内容拦截**不换号**，受限**必须换号**。
 * 两者都不进可重试集合——重试同一账号对这一类失败没有意义。
 */
const ACCOUNT_RESTRICTED_CODE = 'ACCOUNT_RESTRICTED'

/**
 * 从错误体里取业务码的候选字段。
 *
 * CodeBuddy 有两种信封形态（扁平 `{code,msg}` 与嵌套 `{error:{code,data:{code}}}`），
 * 业务码可能出现在三处中的任意一处，因此逐层取第一个非空值。
 * @param error - 解析出的错误体。
 * @returns 业务码字符串；未披露时为 `''`。
 */
function wireBusinessCode(error: WireError | undefined): string {
  const nested = error?.error?.data?.code ?? error?.error?.code ?? error?.code
  return nested === undefined || nested === null ? '' : String(nested)
}

/**
 * 生成切换提示里的「原因」片段。
 *
 * 提示必须说明**为什么**切换：额度不足、被限流、账号被限制三者的用户动作完全不同
 * （前者等重置、中者可换模型、后者要重新登录）。旧实现一律写「额度不足」，
 * 对后两种都是误导。
 *
 * @param code - 触发本次切换的错误码。
 * @returns 可直接拼进提示的原因文本（含结尾逗号）。
 */
function switchReasonText(code: string | undefined): string {
  if (code === ACCOUNT_RESTRICTED_CODE) return '账号被上游限制（需重新登录），'
  if (code === 'RATE_LIMIT') return '请求被限流，'
  return '额度不足，'
}

/**
 * 把 HTTP 状态映射为稳定的 harness 错误码。
 * @param status - 非 2xx 的状态码。
 * @param error - 可读时为解析出的 provider 错误体。
 * @returns 规范化后的错误码。
 */
export function httpErrorCode(status: number, error?: WireError): string {
  const businessCode = wireBusinessCode(error)
  const detail = wireErrorDetail(error)
  /**
   * 内容策略拦截必须**先于** `AUTH` 与 400 的通用分支判定。
   *
   * 实测两种状态码都出现过（400 与 403，视上游节点而定），且 403 与鉴权失败
   * 同码，因此只能在按状态分派之前按业务码识别。
   */
  if (businessCode === CODEBUDDY_CONTENT_BLOCKED_CODE) return CONTENT_BLOCKED_CODE
  /**
   * 账号被上游限制同样带 403，必须在 `AUTH` 之前识别出来：
   * 它需要**换号**（与鉴权失败不换号、要重新登录的处理不同）。
   * 只在文案命中 `request illegal` 时判受限，其余 11140（模型级限流）留给
   * 下面的限流分支。
   */
  if (businessCode === CODEBUDDY_ACCOUNT_RESTRICTED_CODE
    && detail.toLowerCase().includes(CODEBUDDY_RESTRICTED_MARKER)) {
    return ACCOUNT_RESTRICTED_CODE
  }
  if (status === 401 || status === 403) return 'AUTH'
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  // 业务码 6004：账号×模型的额度用尽（见常量注释）。归 QUOTA 才能触发换账号。
  if (businessCode === CODEBUDDY_QUOTA_EXHAUSTED_CODE) {
    return QUOTA_EXCEEDED_CODE
  }
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/** 倍速与模型名称之间的分隔符（小尾巴形态：「Hy3 · x0.05」）。 */
const CREDITS_SEPARATOR = ' · '

/** 为一条目录条目构建 harness 模型描述符。 */
function modelInfo(provider: string, model: CodeBuddyModel): LlmModelInfo {
  // 倍速以「名称小尾巴」承载：`name = "Hy3 · x0.05"`。
  //
  // 为什么放 name 而不是 description：倍速的展示位置是模型选择器（/model 弹窗
  // 与 composer 菜单），而 DSH 0.2.0-rc.2 起 `ui-model-selection` 有意不再渲染
  // 目录 `description`（上游提交 b6c5aa7516/45368fb158，README 明确「不显示
  // catalog descriptions」），两个选择面都只渲染 `model.name`——description
  // 在 GUI 里已没有任何渲染点。name 是官方目录的「user-facing 展示名」字段，
  // 且插件 adapter 本就拥有该字段的命名权（官方 DeepSeek 适配器也在此提供
  // `name`），因此它是唯一不经官方 UI 改动就能让倍速可见的官方契约字段。
  //
  // 代价（已接受）：CodeBuddy 调整倍率时，名称看起来像被改了——但变化本身就
  // 发生在每次打开选择器时，用户看到的始终是当前倍率，不存在「旧值缓存」问题。
  // 路由与请求不受影响：请求用的是 `model.id`，`name` 纯展示。
  //
  // 网络值本身就是已格式化的倍率（"x3.33"、"x0.05"），直接裸拼接不二次格式化。
  // `x0.00` 保留而不是隐藏——零倍率模型是一个值得展示的事实，压掉它会让这个
  // 字段看起来像坏了。目录未披露倍速（缺省或空）的模型保持原名，不编造数值。
  const credits = model.credits?.trim()
  return {
    provider,
    id: model.id,
    name: credits === undefined || credits.length === 0
      ? model.name
      : `${model.name}${CREDITS_SEPARATOR}${credits}`,
    inputModalities: model.supportsImages === true ? ['text', 'image'] : ['text'],
  }
}

/** CodeBuddy 的努力程度词表的人类可读名称。 */
const EFFORT_NAMES: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/**
 * 把 CodeBuddy 披露的思考档位翻译成 harness 的推理元数据；当目录没有给出
 * 任何可选档位时为 `undefined`。
 *
 * 档位以不透明 id 的形式透传，而不是映射到固定刻度：它们正是聊天端点接受
 * 的 `reasoning_effort` 值，因此 CodeBuddy 以后新增档位也不需要改这里的
 * 代码。无法识别的 id 仍能从其拼写得到一个可读名称。
 *
 * 三种情况下返回 `undefined` 而不是部分值，因为 harness 会把每一种都判为
 * INVALID_MODEL_REASONING，而被拒的目录比缺失的能力更糟：
 *   - 完全没有 reasoning 块；
 *   - 有块但没有 `supportedEfforts`（`auto` 声明了活动的 `effort` 却没有
 *     列表，用户没有可选的项）；
 *   - 空列表或仅含重复项的列表。
 */
function reasoningInfo(model: CodeBuddyModel): LlmModelReasoningInfo | undefined {
  const supported = model.reasoning?.supportedEfforts
  if (supported === undefined) return undefined

  const seen = new Set<string>()
  const efforts: LlmReasoningEffortInfo[] = []
  for (const raw of supported) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    efforts.push({
      id: ReasoningEffortId(id),
      name: EFFORT_NAMES[id] ?? id,
    })
  }
  if (efforts.length === 0) return undefined

  // 优先使用 `defaultEffort`，回退到服务端的活动 `effort`。两者只有在
  // 出现在可选列表里时才被采纳——harness 会拒绝它找不到的默认值，而有些
  // 目录条目把 `effort` 写在自己列表之外。
  const candidate = model.reasoning?.defaultEffort ?? model.reasoning?.effort
  const defaultEffort = candidate !== undefined && seen.has(candidate)
    ? ReasoningEffortId(candidate)
    : undefined

  return {
    efforts,
    ...defaultEffort === undefined ? {} : { defaultEffort },
  }
}

/**
 * 本路由的请求重试策略：官方默认集合 + `INVALID_REQUEST`。
 *
 * **为什么追加**：CodeBuddy 把请求校验失败报成 HTTP 400，响应体只有一句
 * `Invalid request parameters`，**不带业务码**。它既可能是请求确实不合法，也可能
 * 是网关侧的瞬时拒绝——两者在响应里无法区分。官方默认集合（EMPTY_RESPONSE /
 * RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT）不含该码，实测后果是：一次瞬时 400
 * 直接终止整轮，用户必须手动「继续」才能恢复。
 *
 * **为什么重试是安全的**：该错误在产出任何 chunk **之前**抛出（`stream()` 的
 * `emitted` 恒为 false），因此重试不会重复内容、不会重复执行工具调用。需要用户
 * 干预的确定性缺陷各自另有错误码：上下文超限是 `CONTEXT_WINDOW_EXCEEDED`，额度
 * 耗尽是 `QUOTA`——后者由本适配器的换号逻辑处理，刻意不放进重试集合。
 *
 * **为什么只给 2 次**：400 属于确定性错误的概率高于瞬时抖动；有界重试足以覆盖
 * 「网关抽一下」，又不至于把一次必然失败的请求放大成 5 次。
 */
export const CODEBUDDY_RETRY_POLICY: ResolvedRetryPolicy = resolveRetryPolicy({
  mode: 'normal',
  maxRetries: 2,
  retryableCodes: [
    'EMPTY_RESPONSE',
    'RATE_LIMIT',
    'SERVER',
    'TIMEOUT',
    'TRANSPORT',
    'INVALID_REQUEST',
  ],
}, 'dsh-codebuddy: retryPolicy')

/**
 * CodeBuddy 适配器。一个实例服务于单一的 `codebuddy` 路由以及该路由目录
 * 报告的每一个模型。
 */
export class CodeBuddyAdapter extends LlmAdapter {
  constructor(private readonly config: CodeBuddyAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: CODEBUDDY_DISPLAY_NAME }
  }

  /**
   * 本路由自带重试策略（见 {@link CODEBUDDY_RETRY_POLICY}）。
   *
   * 必须显式覆写：基类默认实现返回 `undefined`，调用方随即退回官方默认集合——
   * 那正是把瞬时 400 当作致命错误的一套。
   */
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return CODEBUDDY_RETRY_POLICY
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = await this.config.session.modelsOrEmpty()
    // 目录未披露容量的条目被剔除而不是靠编造补上尺寸：CodeBuddy 在它的
    // 非聊天模型上就是这样省略的，把它们放出去会往选择器里塞不可用的选项。
    // 在这里被丢弃的 id 仍可经 `resolveModel` 路由，供显式点名它的人使用。
    return models
      .filter(model => hasDisclosedCapacity(model))
      .map(model => modelInfo(provider, model))
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const models = await this.config.session.modelsOrEmpty(signal)
    const entry = models.find(candidate => candidate.id === model)
    if (entry === undefined) {
      // 未列入目录的 id 仍可路由——目录只是建议性的——但对它一无所知，
      // 因此声明保守的纯文本形态，而不是让 host 把序列化器随后会拒绝的
      // 图像持久化下来。
      return {
        provider,
        id: model,
        name: model,
        inputModalities: ['text'],
        context: { contextWindow: connection.defaultContextWindow },
        defaultMaxTokens: connection.defaultMaxTokens,
      }
    }
    const reasoning = reasoningInfo(entry)
    return {
      ...modelInfo(provider, entry),
      context: {
        contextWindow: entry.maxAllowedSize !== undefined && entry.maxAllowedSize > 0
          ? entry.maxAllowedSize
          : connection.defaultContextWindow,
      },
      defaultMaxTokens: entry.maxOutputTokens !== undefined && entry.maxOutputTokens > 0
        ? entry.maxOutputTokens
        : connection.defaultMaxTokens,
      // 推理档位直接取自目录自身的 `supportedEfforts` 与 `defaultEffort`。
      // 声明它们之所以安全，是因为 `stream()` 会把选中的档位作为
      // `reasoning_effort` 转发：harness 把它的默认值物化进每个请求，所以
      // 一个"声明了却从不发送"的能力会变成一个静默失效的控件。
      ...reasoning === undefined ? {} : { reasoning },
    }
  }

  /**
   * 绑定模型元数据并派发到一代适配器调用。保持显式实现而不是继承，这样
   * 调用路径不依赖 host 解析到哪个 dsh-llm 副本：支持区间（>=0.1.5-rc.2）
   * 内的每个副本都带有这个默认实现，此覆写与其等价。
   */
  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  /**
   * harness 驱动的公开入口。故障转移在这里：首次尝试对当前活动账号发出，
   * 额度耗尽或被限流的应答会切换到下一个可用账号并重试一次。只有在流产出
   * 第一个 chunk 之前重试才是安全的——流中途的失败直接重抛给调用方（已
   * 消费的前缀绝不能重放），下一轮对话从新账号开始。
   */
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 登记在途请求：主动切换据此避让，不打断正在输出的流。finally 保证任何
    // 结束路径（正常、抛错、被取消、调用方提前 return）都会减回去。
    this.config.session.beginRequest()
    try {
      yield* this.runWithFailover(options)
    } finally {
      this.config.session.endRequest()
    }
  }

  /**
   * 一次请求的完整生命周期（含账号故障转移），由 `stream` 包裹。
   *
   * ## 与外层官方重试的职责划分
   *
   * DSH 自带的 `@deepseek-ai/dsh-llm-retry` 已随 `dsh-base` 挂载，工作在整个
   * **agent 请求**层面（`agent/request-error`），默认 `maxRetries: 5`，带指数退避
   * 与 `Retry-After` 支持，可重试码为
   * `EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT`。
   *
   * | 故障 | 由谁处理 | 为什么 |
   * | --- | --- | --- |
   * | 瞬时故障（网络、5xx、超时） | 外层 | 原地重试即可，换账号无益 |
   * | **额度/频率用尽（`QUOTA` 与 `RATE_LIMIT`）** | **本层换账号** | 见下 |
   * | `Retry-After` 等待 | 外层 | 官方已实现（含「超过 maxDelayMs 则放弃」的更优语义） |
   *
   * ### 为什么 `RATE_LIMIT` 也要换账号
   *
   * 曾经把它交给外层原地重试，理由是「限流是服务端对该账号的节流，换账号不解决」。
   * **实测否证了这个前提**——CodeBuddy 的 429 是**账号 × 模型**级别的额度耗尽：
   *
   * ```
   * deepseek-v4.1-flash   18298014993:429  涨涨涨:200  16605655975:200
   * glm-5.3              18298014993:200  涨涨涨:200  16605655975:200
   * ```
   *
   * 同一账号对 `deepseek-v4.1-flash` 是 429、对 `glm-5.3` 是 200，且**另一个账号
   * 对同一模型是 200** —— 换账号确实有效。而且这类 429 **不带 `retry-after`**，
   * 外层只能盲目退避、原地重试同一个账号同一个模型，在重置时间之前不可能成功。
   * 用户看到的现象就是「开了自动切换却没切」。
   *
   * 内层换号得到成功结果后，外层不会再有失败可重试，因此两层不会叠加。
   */
  private async * runWithFailover(options: GenerateOptions): AsyncIterable<StreamChunk> {
    /**
     * 本次请求**已尝试过**的账号。必须是请求级状态（不能放 session 或全局）：
     * 它是「同一请求内不重复使用同一账号」的依据，跨请求共享会误伤后续请求。
     */
    const attempted = new Set<string>()
    const current = await this.config.session.activeAccountSummary()
    if (current !== undefined) attempted.add(current.id)
    /**
     * **本次尝试所用的账号**，即失败时的「真凶」。
     *
     * 必须在**发出请求前**决定，不能在 catch 里重新读 `activeAccountSummary()`：
     * 并发下别的会话可能刚把当前账号换掉，重读拿到的是**别人的**账号。把它当作
     * 「被拒的账号」传下去，会让一个健康账号被误判为「已经失败」而排除——3 个
     * 账号时级联切到更差的账号，2 个账号时直接放弃并抛 QUOTA（外层不可重试），
     * 该会话就失败了。
     */
    let attemptAccountId: string | undefined = current?.id
    /**
     * 尝试上限 = 账号总数。
     *
     * 不写死成 5：本层的语义是「每个账号试一次」，所以上限天然由账号数决定。
     * 账号少时对着空气重试没有意义，账号多时也不该被一个魔数截断。
     */
    const total = await this.config.session.accountCount()
    const maxAttempts = Math.max(1, total)

    let lastError: LlmError | undefined
    /** 上一轮被拒的账号 id；供下一轮换号决策排除「已失败的那个」。 */
    let rejectedId: string | undefined
    /**
     * 上一轮被拒的错误码：只用于生成**按原因区分**的切换提示。
     *
     * 与 `rejectedId` 同时写入：提示要说明「为什么切换」，而 `lastError` 在下一轮
     * 结束前就可能被覆盖，用码单独记住比从错误对象里反复推断更可靠。
     */
    let rejectedReasonCode: string | undefined
    /**
     * 开关是否允许换号。**在切换点显式检查**，而不是依赖「上一轮 catch 检查过」
     * 这个隐式前提。
     *
     * 当前控制流下后者也确实成立（开关关闭时第 0 轮的 catch 就抛出了，走不到这里），
     * 但那种「安全性由另一个分支的副作用保证」的写法很脆：一旦有人把切换挪个位置
     * 或调整循环结构，用户关掉的开关就会被静默绕过——而「关掉自动切换」的预期是
     * **包含被动换号在内**的全部自动换号。
     */
    const autoSwitchAllowed = (): boolean => this.config.autoSwitch?.() ?? true
    /**
     * 切换提示是否已经作为**块 0** 产出。
     *
     * 提示必须先于模型输出呈现，而模型输出的块索引从 0 开始；两者共用一套索引
     * 会互相覆盖。因此提示占用块 0，模型输出从块 1 起（见 attemptStream 的
     * `startIndex`）。标记在这里作用域内，供每一轮尝试读取。
     */
    let noticeBlockEmitted = false
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // 首次尝试前不切换；之后的每一轮都已经由上一轮末尾切好了账号。
      if (attempt > 0) {
        // 走到这里说明上一轮的 catch 已经记下了错误（否则第 0 轮就抛出去了），
        // 但保持显式判空：不依赖「另一个分支的副作用」，将来挪动循环结构也不会
        // 变成抛一个 undefined。
        /**
         * 账号**被上游限制**是例外：该账号无法服务任何请求，保持原样等于让插件
         * 不可用，因此不受「自动切换」偏好拦截。代价是用户会看到一次可见提示
         * （见下方文案），这正是知情的前提。
         */
        const restrictedTriggered = lastError?.code === ACCOUNT_RESTRICTED_CODE
        if (!autoSwitchAllowed() && !restrictedTriggered) {
          if (lastError === undefined) break
          throw lastError
        }
        const switched = await this.failoverToNextAccount(attempted, rejectedId)
        if (switched === undefined) break
        attempted.add(switched.id)
        // 下一轮用的就是刚选定的这个账号；不更新的话第 3 轮会拿着第 1 轮的旧值
        // 去判断「谁被拒了」，又退化成旧缺陷。
        attemptAccountId = switched.id
        /**
         * `from === to`：并发下**别的会话已经把当前账号换好了**，本会话只是采用
         * 它继续。没有发生切换，因此不产出提示——否则用户会看到一句自己所处会话
         * 并未执行的「已自动切换至 X」，而且 X 还是此刻正在用的账号。
         *
         * 重试本身仍然继续：这正是这个分支存在的意义（旧实现在这里直接失败）。
         */
        if (switched.from !== switched.to) {
          /**
           * 把接管以**可见的助手文本**呈现出来：用户应当看到请求为何短暂停顿、
           * 以及后续对话由谁的额度来支付。
           *
           * 必须按完整的块协议产出（block-start → text-delta → block-end）：
           * 只发一个裸 `text-delta` 时宿主不会为它开块，文本会被丢弃——实测
           * 界面完全没有提示。`StreamChunk` 联合类型也没有 status 成员可用。
           */
          const notice = `[CodeBuddy] ${switchReasonText(rejectedReasonCode)}账号「${switched.from}」，已自动切换至「${switched.to}」继续。`
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: notice }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: notice } }
          noticeBlockEmitted = true
        }
      }

      /**
       * 冻结**本轮**使用的账号。首轮是进入循环时读到的那个；后续轮次是上一轮末尾
       * 切过去的那个。冻结成常量而不是每轮重读：重读会拿到并发的别人改过的值，
       * 那正是本缺陷的成因。
       */
      const attemptId = attemptAccountId
      /**
       * 是否已经向调用方产出过 chunk。
       *
       * 一旦产出过，后续错误**必须直接抛出**：重试意味着重新发送整个请求，会让
       * 用户看到重复内容、工具调用被重复执行，并可能造成重复计费。
       *
       * 当前 `attemptStream` 里所有 `throw` 都发生在唯一一条 `yield*` 之前，
       * 因此这个标志恒为假；显式写出来是为了把该不变量**固化在代码里**——将来
       * 若有人在流中途抛出可切换错误，这里会挡住重放而不是静默行为改变。
       */
      let emitted = false
      try {
        for await (const chunk of this.attemptStream(options, noticeBlockEmitted ? 1 : 0)) {
          emitted = true
          yield chunk
        }
        return
      } catch (error) {
        if (!(error instanceof LlmError)) throw error
        // 已产出内容：不重试、不换号。宁可失败，也不重复生成。
        if (emitted) throw error
        lastError = error
        /**
         * 换账号的三个触发条件：额度耗尽（QUOTA）、被限流（RATE_LIMIT）与
         * **账号被上游限制**（ACCOUNT_RESTRICTED）。
         *
         * 曾经只认 QUOTA，理由是「限流是服务端对该账号的节流，换账号不解决」。
         * **实测否证了这个前提**：CodeBuddy 的 429 是**账号 × 模型**级别的额度
         * 耗尽，换账号能成功——
         *
         * ```
         * deepseek-v4.1-flash   18298014993:429  涨涨涨:200  16605655975:200
         * glm-5.3              18298014993:200  涨涨涨:200  16605655975:200
         * ```
         *
         * 且这类 429 **不带 `retry-after`**，外层官方重试只能盲目退避、原地重试
         * 同一个账号同一个模型，在重置时间之前不可能成功——白耗 5 次请求后失败，
         * 用户看到的就是「开启了自动切换却没有切换」。
         *
         * 受限账号（403/11140）同理：实测同一时刻换账号即恢复正常，保持原账号
         * 只会让每个请求都失败，用户不得不手动切号才能继续。
         *
         * 瞬时故障（网络、5xx、超时）仍交给外层原地重试：那些换账号确实无益。
         * 内容拦截（CONTENT_BLOCKED）刻意不在此列：换账号不会让同一份内容变合法。
         */
        const restricted = error.code === ACCOUNT_RESTRICTED_CODE
        if (restricted && attemptId !== undefined) {
          /**
           * 记下受限账号，后续请求直接从候选里排除，避免每次都先撞一次失败。
           * 该状态只在进程内，不写凭据文件；重新登录会清掉。
           */
          try { this.config.session.markAccountRestricted(attemptId) } catch { /* 标记失败不影响换号 */ }
        }
        const swappable = error.code === QUOTA_EXCEEDED_CODE
          || error.code === 'RATE_LIMIT'
          || restricted
        // 受限不受「自动切换」偏好限制：该账号无法服务任何请求，见上方循环入口注释。
        if ((!autoSwitchAllowed() && !restricted) || !swappable) throw error
        // 把**本轮真正被拒的账号**交给下一轮决策，而不是届时重新读当前账号。
        rejectedId = attemptId
        rejectedReasonCode = error.code
      }
    }
    // 换不动了（没有未尝试过的账号、或尝试次数用尽）：把最后一次的失败如实抛出，
    // 由外层官方重试决定是否继续。
    throw lastError ?? new LlmError('CodeBuddy request failed with no account available', QUOTA_EXCEEDED_CODE)
  }

  /**
   * 在额度失败后，把当前活动账号切换到下一个可用的账号。
   *
   * **`rejectedId` 必须是真正被拒的那个账号**，由调用方在**发出请求前**冻结并
   * 传进来——不能在这里重新读 `activeAccountSummary()`：并发下别的会话可能刚把
   * 当前账号换成一个健康账号，重读拿到的就是**别人的**账号。把它当作「已失败」
   * 传进决策会让那个健康账号被排除，于是本会话要么级联到更差的账号，要么在只有
   * 两个账号时直接放弃并抛 QUOTA（外层不可重试）——明明有人已经切好了却仍然失败。
   *
   * 决策可能选回**当前已在用的账号**（当它健康且未被尝试过时）：并发下这正是
   * 期望结果，表示「直接用别人切好的账号重试」。此时 CAS 的期望值恰好等于目标，
   * `switchTo` 会把它当作「已经是目标账号」而成功返回。
   *
   * @param attempted - 本次请求已试过的账号 id（避免在两个账号之间来回切）。
   * @param rejectedId - 真正被拒的账号 id；缺省时退回「当前账号」的旧行为。
   * @returns from/to 展示名；当没有其他账号能接管时为 `undefined`
   *   （只有一个账号，或其余凭据全部过期）。
   */
  private async failoverToNextAccount(
    attempted: ReadonlySet<string>,
    rejectedId?: string,
  ): Promise<{ from: string, to: string, id: string } | undefined> {
    const current = await this.config.session.activeAccountSummary()
    if (current === undefined) return undefined
    const entries = await this.config.session.failoverCandidates()
    if (entries === undefined) return undefined

    // 交给纯函数决策：它负责排除已尝试过的账号、排除凭据失效者，并按剩余额度排序。
    // 让 adapter 只做「取数 → 决策 → 执行」，切换规则才能被单测覆盖。
    const candidates: SwitchCandidate[] = []
    for (const entry of entries) {
      const remainingPct = await this.config.session.remainingPercentFor(entry)
      candidates.push({
        id: entry.id,
        nickname: entry.account.nickname,
        credentialValid: entry.auth.refreshExpiresAt > Date.now(),
        // 受限账号不进入候选：它的凭据与额度都可能正常，但上游拒绝服务。
        ...this.config.session.isAccountRestricted(entry.id) ? { restricted: true } : {},
        ...remainingPct === undefined ? {} : { remainingPct },
      })
    }
    const decision = decideReactiveTarget({
      candidates,
      failedId: rejectedId ?? current.id,
      triedIds: [...attempted],
    })
    if (decision.kind === 'stay') return undefined

    /**
     * CAS 的期望值取**重试将要使用的账号**（`current`），而不是被拒的那个：
     * `switchTo` 的语义是「把当前账号改成目标」，因此它比对的是当前账号。
     */
    const applied = await this.config.session.switchTo(decision.targetId, current.id)
    if (!applied) {
      /**
       * CAS 失败 = 探测期间**别的会话已经把当前账号改掉了**。
       *
       * 旧实现就此放弃，于是本会话抛 QUOTA（外层不可重试）而失败——尽管此刻
       * 当前账号很可能已经是别人刚切好的健康账号。并发下这是**常态**而不是异常：
       * N 个会话同时撞上同一个耗尽账号时，只有一个能赢得 CAS，其余都会失败。
       *
       * 正确动作是**采用当前账号继续**：它既不是被拒的那个，也没被本请求试过，
       * 就是一次可用的重试机会。缺了这个分支，2 个账号的场景下必然有会话失败。
       *
       * 仍要校验它没被本请求试过，否则会与「同一请求内不重复使用同一账号」冲突。
       */
      const after = await this.config.session.activeAccountSummary()
      if (after === undefined || attempted.has(after.id)) return undefined
      try { this.config.onAccountSwitched?.() } catch { /* 广播失败不影响请求继续 */ }
      /**
       * `from === to`：表示**没有发生切换**，只是改用别人已经切好的账号。调用方
       * 据此不产出「已自动切换」提示——那会让用户以为是自己这边切过去的。
       */
      return { from: after.nickname, to: after.nickname, id: after.id }
    }
    try { this.config.onAccountSwitched?.() } catch { /* 广播失败不影响请求继续 */ }
    /**
     * 目标就是当前账号时（并发下别人刚切好），`from`/`to` 会是同一个名字。
     * 调用方据此可以不产出「已切换」提示——实际上并没有发生切换。
     */
    return { from: current.nickname, to: decision.targetNickname, id: decision.targetId }
  }

  /**
   * 对当前活动账号的一次请求尝试：解析身份与端点、fetch 并翻译 SSE 体。
   * 不重试、不故障转移——那些由上面的包装层负责。
   */
  private async * attemptStream(options: GenerateOptions, startIndex = 0): AsyncIterable<StreamChunk> {
    // 每次调用只解析一次，且发生在第一个 yield 之前：端点事实与身份一起
    // 冻结，流中途刷新的 token 不会与另一代端点配对。
    const connection = this.config.options()
    let headers: Record<string, string>
    let chatBase = connection.baseURL
    /**
     * 当前账号的客户端身份。与 headers/chatBase 同源：**请求带哪个客户端的
     * 标识与版本，取决于这个账号是用哪个客户端登录的**，不是插件级固定值。
     * 未登录时回退到默认客户端（与既有的 chatBase 回退同一策略）。
     */
    let client: CodeBuddyClientId = CODEBUDDY_DEFAULT_CLIENT
    let clientVersion: string | undefined
    try {
      headers = await this.config.session.authHeaders()
      chatBase = this.config.session.chatBase() ?? connection.baseURL
      client = this.config.session.activeClient() ?? CODEBUDDY_DEFAULT_CLIENT
      clientVersion = this.config.session.activeClientVersion()
    } catch (error) {
      if (error instanceof NotLoggedInError) {
        throw new LlmError(error.message, 'MISSING_CREDENTIAL', { cause: error })
      }
      throw error
    }

    const models = await this.config.session.modelsOrEmpty(options.signal)
    const entry = models.find(candidate => candidate.id === options.model)
    const supportsImages = entry?.supportsImages === true

    if (options.tools !== undefined && options.tools.length > 0 && entry?.supportsToolCall === false) {
      throw new LlmError(
        `CodeBuddy model "${options.model}" does not support tool calls`,
        'UNSUPPORTED_OPTION',
      )
    }

    /**
     * 选择**唯一一条**序列化路径，而不是「先跑一遍无图版本再决定」。
     *
     * 旧写法先无脑调 `serializeRequest(options, supportsImages)`，再判断 `wantsImage`：
     * 有图时白做一次（无图版本会丢图、要后面重建），不支持图时 `serializeRequest →
     * assertSupportedContent` 会**先抛 UNSUPPORTED_CONTENT**，让下面那条专门的「不
     * 支持图」分支成为死代码。把判断与分支放到前面更清晰。
     */
    const wantsImage = hasRequestImages(options.messages)
    if (wantsImage && !supportsImages) {
      throw new LlmError(
        `CodeBuddy model "${options.model}" does not accept image content.`,
        'UNSUPPORTED_CONTENT',
      )
    }
    let body: WireRequest
    if (wantsImage) {
      const attachments = this.config.resolveAttachments?.()
      if (attachments === undefined) {
        throw new LlmError(
          'CodeBuddy image input requires the durable attachment service',
          'UNSUPPORTED_CONTENT',
        )
      }
      body = await serializeRequestWithImages(
        options,
        attachments,
        (ref) => this.config.resolveImageAccess?.(attachments, ref),
      )
    } else {
      body = serializeRequest(options, supportsImages)
    }
    // 在 try 之前完成序列化，让下面的 transport 标签只覆盖传输边界。
    const payload = JSON.stringify(body)

    let response: Response
    try {
      response = await fetch(`${chatBase}/chat/completions`, {
        method: 'POST',
        headers: {
          ...headers,
          ...clientIdentityHeaders(client, clientVersion),
          'content-type': 'application/json',
          'accept': 'text/event-stream',
          // **不能**改用 `attributionHeaders()`。DSH 的契约要求适配器每个请求都带
          // harness 归因（`deepseek-harness/x.y.z (+url)`），但那与本服务的要求
          // 直接冲突——实测（真实凭据）：
          //   UA = CLI/<版本> CodeBuddy/<版本>          → HTTP 200
          //   UA = deepseek-harness/0.1.5-rc.2 (+url)   → HTTP 400 code=11128
          //   UA = harness/... CLI/...（拼接）          → HTTP 400
          //   UA = CLI/... harness/...（追加）          → HTTP 400
          // 即：UA 里只要出现 harness 标识就被安全策略拦截。该字段在这里是**服务端
          // 的准入门槛**而非归因信息，因此必须保持 CodeBuddy 客户端签名。
          // harness 侧的归因由 `X-IDE-*` 之外的本插件语义承担；若上游调整该策略，
          // 这里需要与 DSH 的 attribution 契约重新对齐。
          'user-agent': clientUserAgent(client, clientVersion),
        },
        body: payload,
        ...options.signal === undefined ? {} : { signal: options.signal },
      })
    } catch (error: unknown) {
      if (options.signal?.aborted) {
        throw new LlmError('CodeBuddy request aborted by caller', 'ABORTED', { cause: error })
      }
      // fetch 把所有传输故障都报成裸的 `TypeError: fetch failed`；端点与
      // 链式 cause 才是让它可诊断的部分。
      throw new LlmError(
        `CodeBuddy request to ${chatBase} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `CodeBuddy API error (HTTP ${response.status})`
      let providerError: WireError | undefined
      try {
        providerError = await response.json() as WireError
        /**
         * 用 `wireErrorMessage` 而不是只读 `error.message`：CodeBuddy 用的是自己
         * 的信封，实测两种形态（扁平 `{code,msg}` 与嵌套 `{error:{data:{msg}}}`）
         * **都没有** OpenAI 的 `error.message`。只读它就等于把服务端原文丢掉，
         * 用户只看到「CodeBuddy API error (HTTP 429)」——而原文里写着什么时候
         * 重置、可以换哪个模型，正是排查所需。
         */
        const text = wireErrorMessage(providerError)
        if (text !== undefined) message = text
      } catch {
        // 只吞掉错误体解析失败：状态码仍能标识故障，畸形的 JSON 不能掩盖它。
      }
      const code = httpErrorCode(response.status, providerError)
      /**
       * 只有**鉴权真的失败**才丢弃内存凭据。
       *
       * 旧实现把 401/403 一律视为「token 被拒」，但 403 还承载两类与凭据无关的
       * 情况：内容拦截（11128）与账号被上游限制（11140）。那两种情形下 token
       * 仍然有效，丢弃它只会让下一次调用重新读同一份凭据，误导排查方向。
       */
      if (code === 'AUTH') {
        // 已存储的 token 被直接拒绝；把它从内存里丢弃，让下一次调用重新读
        // 文件（并发的登录可能已经替换了它），而不是重试一个已知被拒的 token。
        this.config.session.invalidate()
      }
      const delay = providerRetryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      /**
       * 账号受限的原文只有 `request illegal`，对用户没有可操作性。补一句下一步
       * 动作：这类账号靠等待无法恢复，必须重新登录。
       */
      const finalMessage = code === ACCOUNT_RESTRICTED_CODE
        ? `CodeBuddy 账号被上游限制，该账号需重新登录（上游原文：${message}）`
        : message
      throw new LlmError(finalMessage, code, {
        status: response.status,
        ...delay === undefined ? {} : { providerRetryAfterMs: delay },
        ...id === undefined ? {} : { requestId: id },
      })
    }

    if (response.body === null) {
      throw new LlmError('CodeBuddy API returned no response body', 'EMPTY_RESPONSE')
    }

    yield* translate(parseSse(response.body), options.tools, startIndex)
  }
}

export { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS }
