/**
 * 工具箱：清理应用曾经代装的 agent skill。
 *
 * ## 为什么需要这个卡片
 *
 * 应用早前把 `trim-cli` 与 `fnos-cli` 两个 skill 写进用户的 `~/.agents/skills`。
 * 那是用户的 agent 环境，不该由应用单方面写入。新版安装流程不再写、升级时也会
 * 顺手删一次，但那只覆盖「升级时恰好存在」——用户在其它版本装过、或那次删失败，
 * 都需要一个可重复执行的入口。
 *
 * ## 按钮只在检测到时可用
 *
 * 没有可清理的目录时按钮置灰：一个永远点得动却什么也不做的按钮，比没有按钮更
 * 让人困惑。
 *
 * ## 清理是破坏性操作
 *
 * 执行前弹确认；执行过程逐行进任务日志（同时写入运行日志中心），因此用户在
 * 「日志」页能查到这一次到底删了什么。
 *
 * @module dsh-fnos/components/AgentSkillsCard
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DshButton, DshModal, DshToast } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { logPanelStore } from '../client/log-panel-store.ts'
import { taskStore, useTaskSlot } from '../client/task-store.ts'
import {
  cleanupAgentSkillsRemote,
  fetchAgentSkillsStatus,
  type AgentSkillsStatus,
} from '../client/services/agent-skills-client.ts'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface AgentSkillsCardProps {
  readonly t: Translate
}

/**
 * agent skill 清理卡片。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 卡片元素。
 */
export function AgentSkillsCard({ t }: AgentSkillsCardProps): React.ReactNode {
  const [status, setStatus] = useState<AgentSkillsStatus>()
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const task = useTaskSlot('agent-skills')
  const busy = task.running

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchAgentSkillsStatus())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /* 用 memo 稳定引用：`?? []` 每次渲染都是新数组，会让依赖它的回调跟着重建。 */
  const present = useMemo(() => status?.present ?? [], [status])
  const available = present.length > 0

  const run = useCallback(async (): Promise<void> => {
    setConfirming(false)
    taskStore.begin('agent-skills')
    logPanelStore.beginTask({ feature: 'skills', title: t('agentSkillsCleanupTask') })
    logPanelStore.append('info', `${t('agentSkillsFound')}${present.join(', ')}`)
    try {
      const result = await cleanupAgentSkillsRemote()
      for (const name of result.removed) logPanelStore.append('info', `${t('agentSkillsRemoved')}${name}`)
      for (const item of result.failed) logPanelStore.append('error', `${item.name}: ${item.message}`)
      setStatus(result.status)
      if (result.failed.length === 0) {
        logPanelStore.finish('ok')
        taskStore.finish('agent-skills', 'ok')
        DshToast.success({ content: t('agentSkillsCleanupDone') })
      } else {
        /* 有失败项：整体按失败结算，让用户知道还有残留。 */
        logPanelStore.finish('failed')
        taskStore.finish('agent-skills', 'failed', result.failed.map(item => item.name).join(', '))
        setError(result.failed.map(item => `${item.name}: ${item.message}`).join('; '))
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
      taskStore.finish('agent-skills', 'failed', message)
      setError(message)
    }
  }, [present, t])

  return (
    <section className="dsh-fnos-mirror">
      <header className="dsh-fnos-mirror-head">
        <div className="dsh-fnos-mirror-head-text">
          <strong className="dsh-fnos-mirror-title">{t('agentSkillsTitle')}</strong>
        </div>
        <DshButton
          htmlType="button"
          theme="light"
          type="primary"
          loading={busy}
          disabled={busy || !available}
          onClick={() => { setConfirming(true) }}
        >
          {t('agentSkillsCleanup')}
        </DshButton>
      </header>
      <p className="dsh-fnos-repair-muted">
        {available ? `${t('agentSkillsFound')}${present.join(', ')}` : t('agentSkillsNone')}
      </p>
      {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{error}</p>}
      <DshModal
        visible={confirming}
        title={t('agentSkillsCleanup')}
        okText={t('ok')}
        cancelText={t('cancel')}
        onOk={() => { void run() }}
        onCancel={() => { setConfirming(false) }}
      >
        <p>{`${t('agentSkillsConfirm')}${present.join(', ')}`}</p>
      </DshModal>
    </section>
  )
}
