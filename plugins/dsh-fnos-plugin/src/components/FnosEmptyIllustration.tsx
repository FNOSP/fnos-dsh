/**
 * 缺省页插画。
 *
 * ## 为什么自己画
 *
 * 缺省页是「这里现在没有内容」的通用表达，它出现在**非 fnOS 环境**下，与 fnOS
 * 品牌无关。用组件库自带的插画会带进别人的视觉语言（人偶、设备线稿），与这个
 * 面板的克制风格不搭；去外部图库取图又要处理许可、署名与暗色适配。
 *
 * 自己画一张几何线稿：只有圆角矩形、圆、虚线三条元素，`stroke="currentColor"`
 * 自动跟随主题（不用维护亮暗两套），尺寸由 `size` 控制，随时可调。
 *
 * ## 语义
 *
 * 「一个空容器 + 一条断开的连线」——这里本该有内容，但当前环境拿不到。比单纯的
 * 空盒子更能说明原因，也比问号类图标少一点「出错了」的意味（这不是错误）。
 *
 * @module dsh-fnos/components/FnosEmptyIllustration
 */

/** 组件参数。 */
export interface FnosEmptyIllustrationProps {
  /** 边长（px）。缺省页里通常用 120–160。 */
  readonly size?: number
  /** 额外类名。 */
  readonly className?: string
}

/**
 * 缺省页插画。
 *
 * @param props - 组件参数。
 * @param props.size - 边长，默认 140。
 * @param props.className - 额外类名。
 * @returns 插画元素。
 */
export function FnosEmptyIllustration({ size = 140, className }: FnosEmptyIllustrationProps): React.ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      fill="none"
      className={className}
      role="img"
      aria-hidden="true"
      /*
        `currentColor` 让整张图跟随所在处的文字颜色：暗色主题下自动变浅，不需要
        维护第二份配色。描边宽度按 140 画布定，放大缩小都保持视觉粗细一致。
      */
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 底板：一个「空容器」的轮廓，圆角与弹框卡片呼应。 */}
      <rect x="26" y="40" width="88" height="62" rx="10" opacity="0.55" />
      {/* 容器的「开口」：两道短线，暗示里面是空的。 */}
      <path d="M40 58h26M40 70h16" opacity="0.35" />
      {/* 断开的连线：说明「本该有内容，但当前环境拿不到」。 */}
      <path d="M78 84h10" opacity="0.55" />
      <circle cx="97" cy="84" r="4" opacity="0.55" />
      {/* 顶部的小圆点：与面板里其它留白呼应，避免上方太空。 */}
      <circle cx="70" cy="24" r="3.5" opacity="0.35" />
    </svg>
  )
}
