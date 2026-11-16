/**
 * 插件安装弹框：显示安装进度与实时日志。
 *
 * ## 为什么是弹框
 *
 * 安装要几十秒到几分钟，且期间禁止重复操作。弹框把过程「锁」在一个明确的上下文里：
 * 用户看到进度、日志、以及最后的成功/失败，而不是回列表里猜刚才点了什么。
 * 这与官方插件页的交互一致。
 *
 * ## 日志为什么轮询
 *
 * 安装走 HTTP POST，服务端无法持续推送。前端按字节 offset 增量拉日志
 * （`?offset=`），每次只取新增部分——整份重传在长日志下会越来越慢。
 *
 * @module dsh-fnos/components/PluginInstallDialog
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshModal } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchInstallLog, startPluginInstall } from '../client/services/gateway-proxy-client.ts'

type Translate = (key: FnosLocaleKey) => string

/** 日志轮询间隔（毫秒）。比运行页更快：用户在盯着它。 */
const LOG_POLL_MS = 800

/** 组件参数。 */
export interface PluginInstallDialogProps {
  readonly visible: boolean
  /** 要安装的包名；undefined 表示未选择。 */
  readonly name?: string
  readonly t: Translate
  readonly onClose: () => void
  /** 安装结束后回调（成功时刷新列表）。 */
  readonly onSettled?: (ok: boolean) => void
}

/**
 * 安装弹框。
 * @param props - 组合后的 props。
 * @param props.visible - 是否可见。
 * @param props.name - 包名。
 * @param props.t - 翻译函数。
 * @param props.onClose - 关闭回调。
 * @param props.onSettled - 结束回调。
 * @returns 弹框元素。
 */
export function PluginInstallDialog({ visible, name, t, onClose, onSettled }: PluginInstallDialogProps): React.ReactNode {
  const [log, setLog] = useState('')
  const [status, setStatus] = useState<'running' | 'succeeded' | 'failed'>('running')
  const [error, setError] = useState<string>()
  const offsetRef = useRef(0)
  const logRef = useRef<HTMLPreElement>(null)

  /** 拉一次增量日志。 */
  const pull = useCallback(async (): Promise<void> => {
    const next = await fetchInstallLog(offsetRef.current)
    if (next.text !== '') {
      offsetRef.current = next.offset
      setLog(previous => previous + next.text)
    }
  }, [])

  useEffect(() => {
    if (!visible || name === undefined) return
    /*
      重置状态放在 effect 里同步做会触发一次额外渲染（react/set-state-in-effect）。
      改为**由调用方用 key 重挂载**：每次安装是一个新实例，状态天然是干净的初值，
      这里不必再写一遍重置。
    */
    offsetRef.current = 0

    let cancelled = false
    const timer = setInterval(() => { void pull() }, LOG_POLL_MS)

    void startPluginInstall(name).then(result => {
      if (cancelled) return
      // 结束时再拉一次：最后几行可能在关闭轮询之后才落盘。
      void pull()
      setStatus(result.status === 'succeeded' ? 'succeeded' : 'failed')
      if (result.error !== undefined) setError(result.error)
      clearInterval(timer)
      onSettled?.(result.status === 'succeeded')
    }).catch((cause: unknown) => {
      if (cancelled) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
      clearInterval(timer)
    })

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [visible, name, pull, onSettled])

  // 日志自动滚到底：用户关心的是最新一行。
  useEffect(() => {
    const element = logRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [log])

  const title = status === 'running'
    ? t('pluginInstallRunning')
    : status === 'succeeded' ? t('pluginInstallSucceeded') : t('pluginInstallFailed')

  return (
    <DshModal
      visible={visible}
      title={title}
      onCancel={status === 'running' ? undefined : onClose}
      footer={null}
      width={640}
      /*
        `modalContentClass` 是唯一会被拼进 `.semi-modal-content` 的入口：
        `className` 落在 `.semi-modal`、`contentClassName` 会被 Modal 内部覆盖。
        样式据此在窄屏收住 640 的内联宽度。
      */
      modalContentClass="dsh-fnos-install-dialog"
    >
      <div className="dsh-fnos-install">
        {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{error}</p>}
        <pre ref={logRef} className="dsh-fnos-install-log">{log === '' ? t('pluginInstallWaiting') : log}</pre>
      </div>
    </DshModal>
  )
}
