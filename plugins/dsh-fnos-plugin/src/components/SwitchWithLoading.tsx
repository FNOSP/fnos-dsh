/**
 * 带 loading 态的开关。
 *
 * ## 为什么切换时要换成 loading
 *
 * 启用/禁用是写 `dsh.profile.bundles` 再读回状态，往返几百毫秒。这期间原开关
 * 仍显示旧状态且可点——用户会以为「没点中」再点一次，两次写入相互覆盖。
 *
 * 早前只是把 `disabled` 置上：开关变灰但形状不变，看起来仍是个可操作的开关，
 * 只是「坏了」。换成 `Spin` 明确表达「正在处理」，也顺便杜绝重复点击。
 *
 * @module dsh-fnos/components/SwitchWithLoading
 */

import { DshSpin, DshSwitch } from '@tnnevol/dsh-semi-ui'

/** 组件参数。 */
export interface SwitchWithLoadingProps {
  readonly checked: boolean
  /** 为 true 时渲染加载指示器，替代开关本身。 */
  readonly loading: boolean
  /** 是否禁用（内置插件等）。 */
  readonly disabled?: boolean
  readonly onChange: (next: boolean) => void
}

/**
 * 开关；`loading` 时替换为加载指示器。
 * @param props - 组合后的 props。
 * @param props.checked - 当前状态。
 * @param props.loading - 是否正在切换。
 * @param props.disabled - 是否禁用。
 * @param props.onChange - 状态变更回调。
 * @returns 开关或加载指示器。
 */
export function SwitchWithLoading({ checked, loading, disabled, onChange }: SwitchWithLoadingProps): React.ReactNode {
  if (loading) {
    /*
      容器尺寸与开关一致（40×24），否则替换瞬间整行会跳一下。
      `aria-busy` 让读屏软件知道这里正在处理，而不是「控件消失了」。
    */
    return (
      <span className="dsh-fnos-switch-loading" aria-busy="true">
        <DshSpin size="small" />
      </span>
    )
  }
  return (
    <DshSwitch
      checked={checked}
      {...(disabled === undefined ? {} : { disabled })}
      onChange={onChange}
    />
  )
}
