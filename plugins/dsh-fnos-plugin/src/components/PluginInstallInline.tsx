/**
 * 卡片内联的安装/更新进度条（**不含日志**）。
 *
 * ## 职责边界
 *
 * 这里只表达三件事：正在装、装好了、装失败了。**日志不在这里显示** ——
 * 它由任务日志浮层（右下角，实时滚动）与运行日志中心（全量历史，可搜可导出）
 * 承担。两者同源，卡片不再保存整份日志。
 *
 * 为什么删掉原来的可展开日志区：
 *
 * - **信息重复**：同一份 pnpm 输出在卡片、浮层、日志中心各存一份，三处可能不同步；
 * - **高度抖动**：安装输出长度不可预期，展开会把下面的卡片顶走；
 * - **留不住**：卡片随列表刷新卸载，日志跟着没了，而日志中心不会。
 *
 * ## 为什么不再用弹框
 *
 * 弹框会「弹中弹」（配置弹框里再叠一层）、挡住列表、关掉即失——这三点内联进度条
 * 都能避开，因此保留内联形态、只把日志移出去。
 *
 * @module dsh-fnos/components/PluginInstallInline
 */

import { useCallback, useEffect, useRef } from 'react'
import { IconifyIcon } from './IconifyIcon.tsx'
import { fetchInstallLog, fetchInstallState, startPluginInstall } from '../client/services/gateway-proxy-client.ts'
import type { FnosLocaleKey } from '../client/locales.ts'
import { logPanelStore } from '../client/log-panel-store.ts'
import { reconcileInstallSlot, taskStore, useTaskSlot } from '../client/task-store.ts'

/**
 * 按行内容推断级别。
 *
 * pnpm 输出是纯文本，没有级别字段；只做最小判断——含「失败 / 错误 / error」
 * 的算错误，含「警告 / warn」的算警告，其余按信息。宁可少标也不要误标。
 * @param line - 日志行。
 * @returns 级别。
 */
function levelOfInstallLine(line: string): 'info' | 'warn' | 'error' {
  if (/失败|错误|error|failed/i.test(line)) return 'error'
  if (/警告|warn/i.test(line)) return 'warn'
  return 'info'
}

type Translate = (key: FnosLocaleKey) => string

/** 拉日志的间隔（毫秒）。与弹框版一致。 */
const LOG_POLL_MS = 800

/** 组件参数。 */
export interface PluginInstallInlineProps {
  readonly name: string
  /**
   * 这次是更新而不是首次安装。
   *
   * 只影响任务浮层的标题（「更新插件」 vs 「安装插件」）——同一个 `dsh plugin add`
   * 命令承担两件事，但对用户而言是两种操作。
   */
  readonly isUpdate: boolean
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
 * @param props.isUpdate - 是否为更新。
 * @param props.t - 翻译函数。
 * @param props.onSettled - 结束回调。
 * @param props.onDismiss - 收起回调。
 * @returns 内联进度与日志。
 */
export function PluginInstallInline({ name, isUpdate, t, onSettled, onDismiss }: PluginInstallInlineProps): React.ReactNode {
  /**
   * 运行态放模块级 store：弹框关闭会卸载本组件，`useState` 随之归零，重开时
   * 按钮又回到「安装」而宿主侧可能还在装。
   */
  const task = useTaskSlot('plugin-install')
  const status = task.running ? 'running' : task.outcome === 'ok' ? 'succeeded' : task.outcome === 'failed' ? 'failed' : 'running'
  const error = task.error
  const offsetRef = useRef(0)

  /**
   * 拉一段增量日志并推进任务浮层。
   *
   * 日志不再存在本组件里：它进任务浮层与运行日志中心，卡片只保留进度与结果。
   * 偏移量仍需保留——接口按字节增量返回。
   */
  const pull = useCallback(async (): Promise<void> => {
    const next = await fetchInstallLog(offsetRef.current)
    if (next.text === '') return
    offsetRef.current = next.offset
    for (const line of next.text.split('\n')) {
      if (line.trim() !== '') logPanelStore.append(levelOfInstallLine(line), line)
    }
  }, [])

  /*
    挂载时先用宿主状态校准一次。

    store 是浏览器侧的记忆，宿主才是事实来源：宿主重启、或安装在本卡片卸载
    期间结束时，store 里可能还挂着「正在跑」。不校准的话按钮会永久转圈。
  */
  useEffect(() => {
    void reconcileInstallSlot('plugin-install', fetchInstallState)
  }, [])

  useEffect(() => {
    let cancelled = false
    /* 新一轮任务：浮层整体替换内容并展开。 */
    taskStore.begin('plugin-install', name)
    logPanelStore.beginTask({ feature: 'install', title: `${t(isUpdate ? 'pluginUpdateTask' : 'pluginInstallTask')} ${name}` })
    const timer = setInterval(() => { void pull() }, LOG_POLL_MS)

    void startPluginInstall(name).then(async (result) => {
      // 结束时再拉一次：最后几行可能在关闭轮询之后才落盘。
      await pull()
      /*
        **收尾状态一定要写，`cancelled` 只挡 UI 回调。**

        组件可能在安装期间被卸载（用户关掉弹框）。此前的写法是 `cancelled` 为真
        就整个 return——`logPanelStore.finish()` 也一起被跳过，于是任务浮层永远
        停在「执行中」的蓝色脉冲点，即便日志里早已写着「安装成功」。

        浮层与 `taskStore` 都在模块作用域里，卸载后仍可安全写入。
      */
      const ok = result.status === 'succeeded'
      if (result.error !== undefined) logPanelStore.append('error', result.error)
      logPanelStore.finish(ok ? 'ok' : 'failed')
      taskStore.finish('plugin-install', ok ? 'ok' : 'failed', result.error)
      clearInterval(timer)
      if (!cancelled) onSettled(ok)
    }).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
      taskStore.finish('plugin-install', 'failed', message)
      clearInterval(timer)
      if (!cancelled) onSettled(false)
    })

    return () => { cancelled = true; clearInterval(timer) }
  }, [name, pull, onSettled, t])

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
        {status === 'running' ? null : (
          <button type="button" className="dsh-fnos-install-inline-close" aria-label={t('close')} onClick={onDismiss}>
            <IconifyIcon name="lucide:x" />
          </button>
        )}
      </div>
      {error === undefined ? null : <p className="dsh-fnos-install-inline-error">{error}</p>}
    </div>
  )
}
