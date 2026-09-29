
import type { ConnectionRpc } from '../../client/rpc.ts'
import type { StatsDimension as StatsDimensionFromUi } from '../../client/ui/dimension-toggle.tsx'
import type { Translate } from './panel-types'
export type { TokenUsageChartProps } from './ui/token-usage-chart'

export type StatsDimension = StatsDimensionFromUi
/* ============================================================================
 * 插件详情页区块：CodeBuddyDetailSection
 *
 * 原先是全页面管理面板（`shell.overlay` + `#/codebuddy/*` hash 路由隔离）。
 * 现在两块内容直接内联在插件管理页的 CodeBuddy 组合包详情页里，因此不再有
 * `route`（hash 控制器已删除）；详情页为普通纵向滚动容器，切走即卸载。
 * ========================================================================== */

export interface CodeBuddyDetailProps {
  rpc: ConnectionRpc
  t: Translate
}

/**
 * 详情页「自定义区块」座位的 owner props：`plugins.detail.section` 会把当前
 * 打开页面的 subject 传进来（组合包 / 某一行 / 官方插件之一）。
 *
 * 本插件只对**自己的**组合包渲染内容，其它 subject 一律返回 `null`——该座位
 * 是 list、由页面按页渲染，不筛选就会出现在别的插件详情页里。
 */
export interface CodeBuddyDetailSubjectProps {
  rpc: ConnectionRpc
  t: Translate
  /**
   * 当前打开页面的主题；只认 `kind: 'bundle'` 且包名匹配。
   *
   * 写成 `| undefined` 而不是可选：本仓库开启 `exactOptionalPropertyTypes`，
   * 而调用方（`ctx.slots.register` 的回调）总是显式传一个可能为 `undefined`
   * 的值——纯粹的 `?` 会因此拒收。
   */
  subject?: { readonly kind: string, readonly pkg?: { readonly name?: string } } | undefined
}
