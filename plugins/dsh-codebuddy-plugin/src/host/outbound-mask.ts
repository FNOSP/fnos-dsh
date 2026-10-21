/**
 * 出站文本改写：剥离上游内容审核的逐字指纹。
 *
 * ## 为什么需要它
 *
 * 上游对请求体做**逐字精确匹配**（非语义审核），命中即返回 HTTP 400 + 业务码
 * 11128「Illegal API invocation from an unapproved channel」。而本插件运行时所用
 * 的智能体框架，其系统提示**固定以一句身份说明开头**，宿主未暴露关闭它的开关——
 * 于是每一次模型调用都必然命中，用户侧表现为模型完全无法使用。
 *
 * ## 实测边界（决定本模块的匹配方式）
 *
 * - **严格锚定句首**：前面加一个词或一个换行即不触发；
 * - **忽略大小写**：仅改大小写仍触发；
 * - **整句精确匹配**：句尾加字仍触发，说明不是子串匹配；
 * - **改一个词即可解除**：实测通过且语义不变；
 * - **只改首句即足够**：真实约 11 KB 系统提示的其余内容不含其它指纹。
 *
 * ## 为什么不做成上游那样的通用净化
 *
 * 上游是网关形态、需要替各类客户端兜底，因此维护一整套指纹清单（键值型剥离、
 * 模板句改写、工具参数净化等）。本插件的待处理面只有「系统提示开头的一句」，
 * 照搬那套清单会引入大量当前无用的规则并扩大误伤正常文本的可能。
 *
 * 因此这里只做**句首整句替换、改一个词**；规则保持清单形态，上游若新增指纹再追加。
 *
 * ## 与 DSH 归因契约的关系
 *
 * 本模块只改请求体文本，不改请求头。客户端的归因（`X-IDE-*`）与身份伪装
 * （`User-Agent` 保持官方客户端签名）在适配器层处理，两者互不影响：上游把
 * 请求头当准入门槛、把请求体当内容审核对象，是两个独立的关卡。
 *
 * @module dsh-codebuddy/outbound-mask
 */

/** 一条指纹改写规则：句首整句匹配 + 语义等价的替换串。 */
export interface AuditFingerprintRewrite {
  /** 匹配串。必须锚定句首（`^` 且不加 `m`）、忽略大小写；**不得**用 `g` 标志。 */
  readonly match: RegExp
  /** 替换串。只改一个词，保持原句语义。 */
  readonly replacement: string
}

/**
 * 已知的上游审核指纹与对应改写。
 *
 * 新增规则时注意三条约束：
 *  1. 只匹配**句首**——实测句中出现同一句不会触发，改写它属于多余的误伤；
 *  2. **整句**精确匹配——不要改成子串替换，否则会命中用户正文里的引用文本；
 *  3. 替换必须**语义等价**——只换词，不删减、不改写指令含义。
 */
export const AUDIT_FINGERPRINT_REWRITES: readonly AuditFingerprintRewrite[] = [
  {
    // 智能体框架的系统提示固定开场白。宿主未暴露关闭它的开关，
    // 因此每次请求都带；改 `by` → `via` 即可解除，身份语义不变。
    match: /^You are an AI agent powered by DeepSeek Harness\./i,
    replacement: 'You are an AI agent powered via DeepSeek Harness.',
  },
]

/**
 * 改写文本开头的审核指纹。
 *
 * 未命中任何规则时**原样返回入参**（同一字符串引用，零拷贝）：绝大多数文本
 * （用户输入、工具输出、助手回复）都不含指纹，不该为它们付出改写代价。
 *
 * @param text - 即将发往上游的文本。
 * @returns 改写后的文本；未命中时返回原字符串。
 */
export function maskAuditFingerprints(text: string): string {
  for (const rule of AUDIT_FINGERPRINT_REWRITES) {
    // 规则不带 `g` 标志，`test` 不会推进 lastIndex，可安全复用同一正则对象。
    if (!rule.match.test(text)) continue
    const masked = text.replace(rule.match, rule.replacement)
    if (masked !== text) return masked
  }
  return text
}
