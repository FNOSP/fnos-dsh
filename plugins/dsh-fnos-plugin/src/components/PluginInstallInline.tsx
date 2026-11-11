/**
 * 卡片内联的安装/更新进度与日志。
 *
 * ## 为什么不再用弹框
 *
 * 原先点「更新」会弹一个二级弹框，里面塞满 pnpm 输出。问题是：
 *
 * - **弹中弹**：用户已经在配置弹框里，再叠一层，视觉上像出了错；
 * - **挡住列表**：看不到其它插件的状态，也无法在等待时做别的事；
 * - **关掉即失**：成功/失败没有留下任何痕迹，想回看日志得重装一次。
 *
 * 现在日志就长在**卡片下方**：过程可见、结果留在原地、默认折叠不占版面。
 *
 * ## 三行固定高度
 *
 * 折叠时只显示进度条与状态；展开后日志区固定显示约三行（`3 × 16px + padding`），
 * 更长的内容在框内滚动。固定高度而不是自适应：安装输出长度不可预期，撑开会把
 * 下面的卡片顶走。
 *
 * @module dsh-fnos/components/PluginInstallInline
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconifyIcon } from './IconifyIcon.tsx'
import { fetchInstallLog, startPluginInstall } from '../client/services/gateway-proxy-client.ts'
import type { FnosLocaleKey } from '../client/locales.ts'

type Translate = (key: FnosLocaleKey) => string

/** 拉日志的间隔（毫秒）。与弹框版一致。 */
const LOG_POLL_MS = 800

/** 组件参数。 */
export interface PluginInstallInlineProps {
  readonly name: string
  readonly t: Translate
  /** 结束时回调；`ok` 表示是否成功。 */
  readonly onSettled: (ok: boolean) => void
  /** 用户收起这一块（成功后自动收，失败由用户决定）。 */
  readonly onDismiss: () => void
}

/**
 * 卡片内的安装进度条 + 可展开日志。
 * @param props - 组合后的 props。
 * @param props.name - 包名。
 * @param props.t - 翻译函数。
 * @param props.onSettled - 结束回调。
 * @param props.onDismiss - 收起回调。
 * @returns 内联进度与日志。
 */
export function PluginInstallInline({ name, t, onSettled, onDismiss }: PluginInstallInlineProps): React.ReactNode {
  const [log, setLog] = useState('')
  const [status, setStatus] = useState<'running' | 'succeeded' | 'failed'>('running')
  const [error, setError] = useState<string>()
  /** 日志是否展开。默认折叠——折叠时整块只有一行。 */
  const [expanded, setExpanded] = useState(false)
  const offsetRef = useRef(0)

  const pull = useCallback(async (): Promise<void> => {
    const next = await fetchInstallLog(offsetRef.current)
    if (next.text !== '') {
      offsetRef.current = next.offset
      setLog(previous => previous + next.text)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = setInterval(() => { void pull() }, LOG_POLL_MS)

    void startPluginInstall(name).then(result => {
      if (cancelled) return
      // 结束时再拉一次：最后几行可能在关闭轮询之后才落盘。
      void pull()
      setStatus(result.status === 'succeeded' ? 'succeeded' : 'failed')
      if (result.error !== undefined) setError(result.error)
      clearInterval(timer)
      onSettled(result.status === 'succeeded')
    }).catch((cause: unknown) => {
      if (cancelled) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
      clearInterval(timer)
      onSettled(false)
    })

    return () => { cancelled = true; clearInterval(timer) }
  }, [name, pull, onSettled])

  /*
    成功自动收起（延迟一点让用户看到绿条），失败**常驻**——失败需要用户处理，
    自动消失等于把问题藏起来。
  */
  useEffect(() => {
    if (status !== 'succeeded') return
    const timer = setTimeout(onDismiss, 3000)
    return () => { clearTimeout(timer) }
  }, [status, onDismiss])

  const statusText = status === 'running'
    ? t('installStatusRunning')
    : status === 'succeeded' ? t('installStatusSucceeded') : t('installStatusFailed')

  return (
    <div className={`dsh-fnos-install-inline dsh-fnos-install-inline--${status}`}>
      <div className="dsh-fnos-install-inline-bar">
        {/*
          状态用**图标 + 文字 + 颜色**三重表达，不只靠颜色：色盲用户也要能分辨
          成功与失败。
        */}
        <span className="dsh-fnos-install-inline-icon" aria-hidden="true">
          <IconifyIcon name={
            status === 'running' ? 'lucide:loader' : status === 'succeeded' ? 'lucide:circle-check' : 'lucide:circle-x'
          } />
        </span>
        <span className="dsh-fnos-install-inline-text">{statusText}</span>
        <button
          type="button"
          className="dsh-fnos-install-inline-toggle"
          aria-expanded={expanded}
          onClick={() => { setExpanded(value => !value) }}
        >
          {expanded ? t('collapse') : t('pluginInstallLog')}
        </button>
        {status === 'running' ? null : (
          <button type="button" className="dsh-fnos-install-inline-close" aria-label={t('close')} onClick={onDismiss}>
            <IconifyIcon name="lucide:x" />
          </button>
        )}
      </div>
      {error === undefined ? null : <p className="dsh-fnos-install-inline-error">{error}</p>}
      {expanded ? (
        <pre className="dsh-fnos-install-inline-log">{log}</pre>
      ) : null}
    </div>
  )
}
