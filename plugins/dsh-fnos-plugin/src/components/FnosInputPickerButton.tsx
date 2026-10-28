/**
 * 工具栏里的 fnOS 选择器开关。
 *
 * 改造后这个按钮**不再承载弹层**：它只翻转让面板展开/收起的会话级 store，
 * 面板本体挂在 `conversation.input.overlay`（与斜杠指令面板同一个槽），
 * 因此位置与宽度天然跟输入卡片一致。
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { usePickerOpen, type PickerOpenStore } from '../client/input-references/picker-store.ts'
import { FnosColorLogo } from './FnosLogo.tsx'

export type InputPickerButtonProps =
  & PropsRuntime<'conversation.input.left'>
  & PropsLocale<'settings.dsh-fnos'>
  & { store: PickerOpenStore }

export function FnosInputPickerButton({ useInput, sessionId, store, t }: InputPickerButtonProps) {
  const phase = useInput((state: InputState) => state.phase)
  const open = usePickerOpen(store, sessionId)
  const busy = phase === 'adjudicating' || phase === 'submitting'

  return (
    <button
      type="button"
      className={`dsh-fnos-input-picker-trigger${busy ? ' is-busy' : ''}`}
      aria-label={t('inputPicker')}
      title={t('inputPicker')}
      aria-expanded={open}
      aria-haspopup="dialog"
      disabled={busy}
      onClick={() => { store.toggle(sessionId as SessionId) }}
    >
      <FnosColorLogo size={17} />
    </button>
  )
}
