/**
 * 基于 Iconify 数据的离线图标组件。
 *
 * ## 为什么要它
 *
 * 官方 primitives 只有 241 个图标，且「刷新」与「重启」在其中只能是同一个
 * `IconRefreshOutlineRegular`——两个动作看起来一样，用户无法凭图标分辨。Semi
 * 图标集里也没有真正的电源/重启字形（`IconRestart` 实际是「跳过/重播」的三角形
 * 加竖条，语义不符）。
 *
 * ## 为什么是离线内联
 *
 * iconify 的常规用法有两种：运行时向 api.iconify.design 拉取，或用官方 web
 * 组件按需请求。两种都会让 **fnOS iframe 里的图标依赖外网**——NAS 常常没有外网，
 * 图标会静静地不显示，而界面不会报错。这里改为构建期把它们内联进产物，运行时零请求。
 *
 * ## 为什么只内联用到的图标
 *
 * 直接 `import icons.json` 会把整套 lucide（1600+ 图标）打进客户端产物，实测
 * 体积从 2.46MB 涨到 3.12MB——为一个电源图标多背 660KB 不可接受。因此图标按需
 * 声明：新增一个图标要在 `ICONS` 表里登记，构建期只取这些名字的 body。
 *
 * ## auto：按名字查找
 *
 * 调用方只写 `name="lucide:power"`，不做 import；集名与图标名在登记表里解析。
 * 缺登记时渲染 `null` 而不是占位盒子，并在开发期由测试兜住（见
 * `tests/client/iconify-icon.spec.ts`）。
 *
 * @module dsh-fnos/components/IconifyIcon
 */

import { ICON_BODIES, ICON_BOX } from '../generated/icons.ts'

/**
 * 本插件可用的图标名。
 *
 * 这份清单与构建配置里的 `ICON_NAMES` 必须一致：前者决定类型，后者决定打包进
 * 产物的 body。两者不一致时测试会报错（见 `tests/client/iconify-icon.spec.ts`）。
 */
export type UsedIconName = 'lucide:power' | 'lucide:refresh-cw'

/** 默认尺寸（px）；菜单行图标按官方 16px 对齐。 */
const DEFAULT_SIZE = 16

export interface IconifyIconProps {
  /** 图标名，`<集名>:<图标名>`，例如 `lucide:power`。 */
  readonly name: UsedIconName
  /** 边长（px），默认 16。 */
  readonly size?: number
  /** 额外类名。 */
  readonly className?: string
}

/**
 * 渲染一个 Iconify 图标。
 * @param props - 组合后的 props。
 * @param props.name - `<集名>:<图标名>`。
 * @param props.size - 边长（px），默认 16。
 * @param props.className - 额外类名。
 * @returns 内联 SVG 元素，或 `null`（图标缺失）。
 */
export function IconifyIcon({ name, size = DEFAULT_SIZE, className }: IconifyIconProps): React.ReactNode {
  const body = ICON_BODIES[name]
  if (body === undefined) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${String(ICON_BOX.width)} ${String(ICON_BOX.height)}`}
      fill="none"
      // 图标是纯装饰：文案已经说明动作，重复朗读只会让读屏更吵。
      aria-hidden="true"
      focusable="false"
      // body 是构建期从图标集包读取的静态数据（见 tsdown.config.ts 的 generateIcons），
      // 不含脚本与用户输入；内联渲染是 iconify 的标准用法。
      // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}
