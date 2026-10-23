/**
 * 座位注册契约：插件包名、座位 id/优先级与详情页 subject 判定。
 *
 * `plugins.detail.section` 是 **list**（非 keyed）座位：页面会给打开的每个
 * 详情页都渲染它，因此注册的组件必须先判断 `subject`——不是本插件的组合包
 * 就返回 `null`，否则这段界面会出现在别的插件详情页上。
 *
 * 单独成模块是为了可测：组件文件一旦 import 就会拉起 Semi 组件，纯判定与
 * 常量放在这里可以直接断言。
 *
 * @module dsh-opencode/client/registration
 */

/** 本插件在组合包列表里的包名（与 package.json 的 name 一致）。 */
export const OPENCODE_PACKAGE_NAME = '@tnnevol/dsh-opencode'

/** 文案命名空间；译文由 `lib/client.js` 内的 locale 字典提供。 */
export const OPENCODE_LOCALE_NAMESPACE = 'settings.dsh-opencode'

/** 插件详情页区块的座位。 */
export const OPENCODE_DETAIL_SLOT = 'plugins.detail.section'
/** 详情页区块的 list 座位 id。 */
export const OPENCODE_DETAIL_ID = 'opencode-account'
/** 与 Codex（50）、CodeBuddy（60）、Failover（70）错开，保持稳定的展示顺序。 */
export const OPENCODE_DETAIL_ORDER = 80

/** 输入区右侧用量胶囊的座位。 */
export const OPENCODE_USAGE_SLOT = 'conversation.input.right'
/** 用量胶囊的 list 座位 id。 */
export const OPENCODE_USAGE_ID = 'opencode-usage'
/** 与 Codex（1）、CodeBuddy（2）错开。 */
export const OPENCODE_USAGE_ORDER = 3

/**
 * `plugins.detail.section` 传入的 owner props 子集。
 *
 * 只声明本判定用到的字段；真实对象（`PluginDetailProps['subject']`）可以直接
 * 传进来，不直接引用上游类型是为了让判定不随插件管理页类型迁移而失效。
 */
export interface OpenCodePluginSubject {
  readonly kind?: string | undefined
  readonly pkg?: { readonly name?: string | undefined } | undefined
}

/**
 * 当前打开的详情页是否属于本插件的组合包。
 * @param subject - 座位 owner props 里的 `subject`。
 * @returns 是 `bundle` 且包名匹配时为 true。
 */
export function isOpenCodeBundleSubject(subject: OpenCodePluginSubject | undefined): boolean {
  if (subject === undefined) return false
  if (subject.kind !== 'bundle') return false
  return subject.pkg?.name === OPENCODE_PACKAGE_NAME
}
