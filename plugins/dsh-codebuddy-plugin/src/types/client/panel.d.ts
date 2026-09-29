
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
