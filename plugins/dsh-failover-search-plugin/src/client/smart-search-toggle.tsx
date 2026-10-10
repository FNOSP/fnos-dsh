/**
 * 消息框左下角的「智能搜索」药丸按钮（FNOS-010-12 / FNOS-012-06）。
 *
 * 位置：`conversation.input.left` 座位（消息框左下角，与「深度思考」同一行区域）。
 * 该座位是 **list**（非 keyed）且 `scope: session`——页面会给每个会话渲染，控件因此
 * 按**会话**读写开关状态，而不是读写全局配置。
 *
 * 形态（FNOS-012-06）：一个药丸按钮，可见文案固定为「智能搜索」——状态不进文案，
 * 只靠激活态/普通态样式区分；原 Switch 与「智能搜索已关」类状态文案不再出现。
 * 可访问名称是例外：读屏用户无法感知样式，名称仍须含状态描述。
 *
 * 语义：开启（默认）时该会话接入本插件（三方搜索优先、官方兜底；三方抓取兜底）；
 * 关闭时该会话完全不接入本插件，搜索与抓取回落官方、三方账号零消耗（AC-03）。
 *
 * 状态所有权：宿主侧的状态容器是真源（provider 每次调用现读它），客户端持有的是
 * 该会话状态的镜像——点击时先乐观更新以获得即时反馈，再用端点返回的结果校正；失败
 * 则回滚，避免界面显示与宿主不一致（那种不一致会让用户以为改了、实际没改）。
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { toggleAccessibleName } from './toggle-view.ts'
import type { ToggleSnapshot } from '../contracts/usage-rpc.ts'
import type { UsageLocaleKey } from './locales.ts'

/** 会话级开关组件的参数。 */
export interface SmartSearchToggleProps {
  /** 本地化函数。 */
  readonly t: (key: UsageLocaleKey) => string
  /** 读取该会话的开关状态。 */
  readonly load: () => Promise<ToggleSnapshot>
  /** 写入该会话的开关状态；返回写入后的实际状态。 */
  readonly set: (enabled: boolean) => Promise<ToggleSnapshot>
}

/**
 * 智能搜索药丸按钮。
 *
 * @param props - 组件参数。
 * @param props.t - 本地化函数（可见文案固定取 `toggleOn`，即「智能搜索」）。
 * @param props.load - 读取该会话状态。
 * @param props.set - 写入该会话状态。
 * @returns 开关控件。
 */
export function SmartSearchToggle({ t, load, set }: SmartSearchToggleProps): ReactNode {
  // 初始为开启：这是产品的默认值（AC-01）。首屏用它渲染，避免读状态期间出现
  // 空白或闪烁；读到真实值后按需纠正。
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void load().then(
      snapshot => { if (live) setEnabled(snapshot.enabled) },
      // 读取失败保持默认开启：宁可多走一次插件（用户可见），也不静默降级为关闭
      // （会让用户以为三方能力消失）。
      () => {},
    )
    return () => { live = false }
  }, [load])

  const toggle = useCallback((): void => {
    if (busy) return
    const next = !enabled
    setBusy(true)
    setEnabled(next) // 乐观更新：按钮状态必须立刻跟手
    void set(next).then(
      snapshot => { setEnabled(snapshot.enabled) },
      () => { setEnabled(!next) }, // 回滚：写入失败时不能让界面撒谎
    ).finally(() => { setBusy(false) })
  }, [busy, enabled, set])

  return (
    <button
      type="button"
      className={enabled ? 'dsh-failover-pill dsh-failover-pill--active' : 'dsh-failover-pill'}
      aria-pressed={enabled}
      aria-label={toggleAccessibleName(enabled)}
      disabled={busy}
      onClick={toggle}
    >
      <span className="dsh-failover-pill__glyph" aria-hidden>
        <IconGlobeOutlineRegular size={14} />
      </span>
      {t('toggleOn')}
    </button>
  )
}
