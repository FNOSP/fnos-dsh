/**
 * 本应用进程树：列出进程并允许结束 / 强制结束。
 *
 * ## 这里展示的到底是什么
 *
 * 是**操作系统进程**，不是 DSH 的会话任务。原因见 `host/runtime-processes.ts`：
 * 宿主没有提供跨会话枚举任务的接口。界面上的 tip 如实写明这一点，避免用户以为
 * 「列表里没有就代表没有后台任务」。
 *
 * ## 为什么「强制」要二次确认而「结束」也要
 *
 * 结束一个进程会连带它的子进程，用户可能只是想停掉一个卡住的命令，却顺手把
 * 正在跑的构建一起带走；强制结束更是会丢未保存的数据。两个动作都弹确认，
 * 文案分别说明各自的后果。
 *
 * @module dsh-fnos/components/RuntimeProcessList
 */

import { useCallback, useState } from 'react'
import { DshButton, DshIconInfoCircle, DshModal, DshTooltip, DshTypography } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { killRuntimeProcess } from '../client/services/runtime-status-client.ts'
import type { RuntimeProcess } from '../contracts/runtime-status-contract.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * Semi 的 `Typography.Text`。
 *
 * `@tnnevol/dsh-semi-ui` 把整个 Typography 作为命名空间对象导出（`DshTypography`），
 * 而这里只需要 `Text` 这一个变体——解构出来用，避免每次写 `<DshTypography.Text>`。
 */
const DshTypographyText = DshTypography.Text

/** 组件参数。 */
export interface RuntimeProcessListProps {
  readonly t: Translate
  readonly processes: readonly RuntimeProcess[]
  /** 当前环境是否能枚举进程树；false 时给一句可读原因。 */
  readonly available: boolean
}

/** 把字节压成 MB 文本。 */
function mib(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 进程列表。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @param props.processes - 当前进程树。
 * @param props.available - 当前环境是否能枚举进程树。
 * @returns 列表元素。
 */
export function RuntimeProcessList({ t, processes, available }: RuntimeProcessListProps): React.ReactNode {
  const [pending, setPending] = useState<number>()
  const [error, setError] = useState<string>()
  /*
    待确认的操作。

    不用 `window.confirm`：本项目 lint 禁止 `no-alert`，而且原生弹框在 iframe 里
    样式与主题脱节。改用与「依赖修复」一致的 DshModal，破坏性动作的确认框与
    其它弹框同源。
  */
  const [confirming, setConfirming] = useState<{ item: RuntimeProcess, signal: 'SIGTERM' | 'SIGKILL' }>()

  /** 执行结束（确认之后）。 */
  const kill = useCallback(async (item: RuntimeProcess, signal: 'SIGTERM' | 'SIGKILL') => {
    setPending(item.pid)
    setError(undefined)
    try {
      await killRuntimeProcess(item.pid, signal)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }, [])

  const header = (
    <div className="dsh-fnos-runtime-proc-head">
      <h4 className="dsh-fnos-runtime-proc-title">
        {t('runtimeProcesses')}
        <DshTooltip className="dsh-fnos-gateway-tip-content" content={t('runtimeProcessesTip')}>
          <span className="dsh-fnos-authorized-gateway-tip" tabIndex={0} aria-label={t('runtimeProcessesTip')}>
            <DshIconInfoCircle />
          </span>
        </DshTooltip>
      </h4>
    </div>
  )

  if (!available) {
    return (
      <section className="dsh-fnos-runtime-proc">
        {header}
        <p className="dsh-fnos-repair-muted">{t('runtimeProcessUnavailable')}</p>
      </section>
    )
  }

  return (
    <section className="dsh-fnos-runtime-proc">
      {header}
      {error === undefined ? null : (
        <p className="dsh-fnos-repair-error" role="alert">{`${t('runtimeKillFailed')}${error}`}</p>
      )}
      <ul className="dsh-fnos-runtime-proc-list">
        {processes.map(item => (
          <li key={item.pid} className="dsh-fnos-runtime-proc-item">
            <div className="dsh-fnos-runtime-proc-main">
              <span className="dsh-fnos-runtime-proc-name">
                {item.name}
                {item.isRoot ? <em className="dsh-fnos-runtime-proc-badge">{t('runtimeProcessRoot')}</em> : null}
              </span>
              {/*
                命令行用 Semi 的 Typography ellipsis，而不是自己写 `text-overflow`。

                区别在**悬浮提示**：自写的省略号只有 `title` 属性（原生提示，延迟约
                1 秒、样式不受控、暗色主题下是系统气泡），而 Semi 的
                `ellipsis={{ showTooltip: true }}` 用站内 Tooltip，悬浮即出、
                跟随主题，且**只在真的被截断时才显示**——没截断的短命令不会弹一个
                和正文一样的提示。

                `children` 必须是纯字符串：Semi 的 ellipsis 不支持 reactNode。
              */}
              <DshTypographyText
                className="dsh-fnos-runtime-proc-cmd"
                ellipsis={{ showTooltip: true }}
              >
                {item.command}
              </DshTypographyText>
            </div>
            <div className="dsh-fnos-runtime-proc-meta">
              <span>PID {item.pid}</span>
              <span>{mib(item.rssBytes)}</span>
              <span className="dsh-fnos-runtime-proc-state">{item.state}</span>
            </div>
            {/*
              按钮**始终渲染**，只是不可杀时置灰。

              之前是无条件隐藏：主进程受保护 → 面板里一个按钮都没有 → 用户以为
              「这个功能坏了」。置灰 + 旁边一句原因，才说得清「不是不能做，是这条
              不允许做」。
            */}
            <div className="dsh-fnos-runtime-proc-actions">
              {item.canKill ? (
                <>
                  <DshButton
                    htmlType="button"
                    size="small"
                    theme="borderless"
                    type="tertiary"
                    disabled={pending === item.pid}
                    onClick={() => { setConfirming({ item, signal: 'SIGTERM' }) }}
                  >
                    {t('runtimeKill')}
                  </DshButton>
                  <DshButton
                    htmlType="button"
                    size="small"
                    theme="borderless"
                    type="danger"
                    disabled={pending === item.pid}
                    onClick={() => { setConfirming({ item, signal: 'SIGKILL' }) }}
                  >
                    {t('runtimeKillForce')}
                  </DshButton>
                </>
              ) : (
                <span className="dsh-fnos-runtime-proc-protected" title={t('runtimeProcessProtectedTip')}>
                  {t('runtimeProcessProtected')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <DshModal
        visible={confirming !== undefined}
        title={confirming?.signal === 'SIGKILL' ? t('runtimeKillForce') : t('runtimeKill')}
        onCancel={() => { setConfirming(undefined) }}
        onOk={() => {
          const target = confirming
          setConfirming(undefined)
          if (target !== undefined) void kill(target.item, target.signal)
        }}
        okText={confirming?.signal === 'SIGKILL' ? t('runtimeKillForce') : t('runtimeKill')}
        cancelText={t('dependencyRepairCancel')}
      >
        <p className="dsh-fnos-repair-muted">
          {confirming?.signal === 'SIGKILL' ? t('runtimeKillForceConfirm') : t('runtimeKillConfirm')}
        </p>
        <code className="dsh-fnos-runtime-proc-cmd">
          {`${confirming?.item.name ?? ''} (PID ${String(confirming?.item.pid ?? '')})`}
        </code>
      </DshModal>
    </section>
  )
}
