/**
 * 「修复插件安装异常」卡片：应用内装不上插件时的自助修复入口。
 *
 * ## 为什么是一个动作、没有「检查」
 *
 * 检查结果对用户没有第二种用法（看到失效条目也还是要点修复），却让排障多一次
 * 点击，因此只留「修复」，点它就执行。
 *
 * ## 为什么不再检测、也不再列出匹配到的条目
 *
 * 这里曾先诊断、再按「有没有失效条目」分叉：健康就报「状态正常」，有条目才弹确认
 * 并逐条列出。但这是**强制修复**动作，不是需要用户判断的业务流程——列出
 * `name@range` 这类内部标识只是把实现细节摊给用户看，对「我要不要修」这个决定
 * 没有任何帮助。现在直接执行，界面只说明「会重建什么、不会动什么」。
 *
 * 宿主侧仍然保留「无失效条目则跳过重建」的保护（见 dependency-repair-routes.ts）：
 * 那是防止对健康 profile 做无谓破坏的安全网，不是给用户看的判断分支。
 *
 * @module dsh-fnos/components/DependencyRepairCard
 */

import { useCallback, useEffect, useState } from 'react'
import { DshButton, DshIconInfoCircle, DshModal, DshToast, DshTooltip } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { runDependencyRepairStreaming } from '../client/services/dependency-repair-client.ts'
import { logPanelStore } from '../client/log-panel-store.ts'
import { taskStore, useTaskSlot } from '../client/task-store.ts'
import {
  cleanupAgentSkillsRemote,
  fetchAgentSkillsStatus,
  type AgentSkillsStatus,
} from '../client/services/agent-skills-client.ts'
import type { DependencyRepairResult } from '../contracts/dependency-repair-contract.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 按行内容推断级别。
 *
 * 修复日志是纯文本行，没有级别字段；这里只做最小判断——含「失败 / 错误 / error」
 * 的算错误，含「失效 / 跳过 / warn」的算警告，其余按信息。宁可少标也不要误标：
 * 级别配色只是帮助扫读，判错反而误导。
 * @param line - 日志行。
 * @returns 级别。
 */
function levelOfLine(line: string): 'info' | 'warn' | 'error' {
  if (/失败|错误|error|failed/i.test(line)) return 'error'
  if (/失效|警告|warn/i.test(line)) return 'warn'
  return 'info'
}

/** 卡片参数。 */
export interface DependencyRepairCardProps {
  readonly t: Translate
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly result: DependencyRepairResult }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 修复插件安装异常卡片。
 * @returns 卡片元素。
 */
export function DependencyRepairCard({ t }: DependencyRepairCardProps): React.ReactNode {
  /*
    结果（`done` 里的 `result`）仍留在本地：它是体积较大的结构，store 只记
    「跑没跑、成没成」。两者互补——重挂载后 store 让按钮知道该不该转圈，本地
    state 负责渲染具体结论。

    **运行中必须来自 store**：弹框关闭会卸载本组件、`useState` 归零，而宿主侧
    修复可能还在跑。
  */
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const task = useTaskSlot('repair')
  /* store 说在跑、本地已不是 running（重挂载）时以 store 为准。 */
  const running = task.running || phase.kind === 'running'
  // 点击语义化路径后短暂提示「已复制」。
  const [copied, setCopied] = useState<string | undefined>(undefined)

  /** 执行修复。 */
  const repair = useCallback(async () => {
    taskStore.begin('repair')
    setPhase({ kind: 'running' })
    /*
      日志**只写浮层这一处**。

      浮层内部会把每行同时写进运行日志中心，因此卡片不必再存一份——早前三处
      （卡片、SSE、日志中心）各存一次，既占内存也容易不同步。
    */
    logPanelStore.beginTask({ feature: 'repair', title: t('dependencyRepairTitle') })
    try {
      // 流式：每行日志到达就追加，用户能看到进度而不是干等。
      const result = await runDependencyRepairStreaming((line) => {
        logPanelStore.append(levelOfLine(line), line)
      })
      setPhase({ kind: 'done', result })
      logPanelStore.finish(result.ok ? 'ok' : 'failed')
      taskStore.finish('repair', result.ok ? 'ok' : 'failed')
    } catch (error) {
      const message = describe(error)
      setPhase({ kind: 'error', message })
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
      taskStore.finish('repair', 'failed', message)
    }
  }, [t])

  /*
    agent skill 清理：**并进「修复插件安装异常」**。

    它和「修复」是同一类事：把安装环境重置回可用状态。单独一张卡片会让工具箱
    变成一列互不相关的小工具，而这两件事的触发时机几乎总是相邻的——装不上插件
    时，先看 skill 有没有重复内置，再决定要不要重建依赖。
  */
  const [skills, setSkills] = useState<AgentSkillsStatus>()
  const [skillsError, setSkillsError] = useState<string>()
  const [confirmSkills, setConfirmSkills] = useState(false)
  const skillsTask = useTaskSlot('agent-skills')
  const skillsPresent = skills?.present ?? []

  useEffect(() => {
    void fetchAgentSkillsStatus().then(setSkills).catch((cause: unknown) => {
      setSkillsError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])

  const cleanupSkills = useCallback(async (): Promise<void> => {
    setConfirmSkills(false)
    setSkillsError(undefined)
    taskStore.begin('agent-skills')
    logPanelStore.beginTask({ feature: 'skills', title: t('agentSkillsCleanupTask') })
    logPanelStore.append('info', `${t('agentSkillsFound')}${skillsPresent.join(', ')}`)
    try {
      const result = await cleanupAgentSkillsRemote()
      for (const name of result.removed) logPanelStore.append('info', `${t('agentSkillsRemoved')}${name}`)
      for (const item of result.failed) logPanelStore.append('error', `${item.name}: ${item.message}`)
      setSkills(result.status)
      if (result.failed.length === 0) {
        logPanelStore.finish('ok')
        taskStore.finish('agent-skills', 'ok')
        DshToast.success({ content: t('agentSkillsCleanupDone') })
      } else {
        logPanelStore.finish('failed')
        taskStore.finish('agent-skills', 'failed', result.failed.map(item => item.name).join(', '))
        setSkillsError(result.failed.map(item => `${item.name}: ${item.message}`).join('; '))
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
      taskStore.finish('agent-skills', 'failed', message)
      setSkillsError(message)
    }
  }, [skillsPresent, t])



  /**
   * 复制完整路径。
   *
   * 界面显示的是语义化路径（`备份/…`），复制出去的必须是能直接粘进终端的
   * 绝对路径；两者分工，避免把 `/vol2/@appshare/...` 这种部署路径摊在卡片上。
   */
  const copyPath = useCallback(async (fullPath: string) => {
    try {
      await navigator.clipboard.writeText(fullPath)
      setCopied(fullPath)
      setTimeout(() => { setCopied(undefined) }, 1500)
    } catch {
      // 剪贴板不可用（非安全上下文）时退回选中提示，不弹错误打断修复结果。
      setCopied(undefined)
    }
  }, [])

  const busy = running

  return (
    <section className="dsh-fnos-authorized-card" aria-labelledby="dsh-fnos-dependency-repair-title">
      <header className="dsh-fnos-authorized-card-header">
        <div className="dsh-fnos-authorized-card-head-text">
          <h3 id="dsh-fnos-dependency-repair-title" className="dsh-fnos-authorized-card-name">
            {t('dependencyRepairTitle')}
            {/*
              tip 必须同时说清「能解决什么」与「不会动什么」：前者告诉用户什么时候
              该想到这个按钮，后者决定他敢不敢点——修复会删 node_modules。
            */}
            <DshTooltip className="dsh-fnos-gateway-tip-content" content={t('dependencyRepairTip')}>
              <span
                className="dsh-fnos-authorized-gateway-tip"
                tabIndex={0}
                aria-label={t('dependencyRepairTip')}
              >
                <DshIconInfoCircle />
              </span>
            </DshTooltip>
          </h3>
          <p className="dsh-fnos-authorized-card-description">{t('dependencyRepairDescription')}</p>
        </div>
        <div className="dsh-fnos-repair-actions">
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            /*
              **只给 `loading`，不给 `disabled`。**

              两者同时给时，`disabled` 会先把按钮压成灰底不可点态，`loading` 的
              转圈反而被压掉——移动端用户看到的是「按钮坏了」，而不是「正在执行」。
              Semi 的 `loading` 本身就拦住了重复点击（`onClick` 不会再触发），
              不需要 `disabled` 再兜一层。

              执行中还需要让用户知道进度：修复要清 lockfile、重建 node_modules，
              在移动端可能等十几秒。只转圈不说话等于「没日志」，所以下面另外渲染
              一行进行中的说明。
            */
            loading={busy}
            /*
              **直接执行，不再二次确认。**

              确认弹框里的三行说明已经移到卡片自身的 tip 与描述里——用户点按钮前
              就能读到「会重建什么、不会动什么」。既然信息在场上，再弹一次只是
              多一次点击；而这一步本身可重入、不含不可撤销的数据删除（只清可重建
              产物）。
            */
            onClick={() => { void repair() }}
          >
            {/*
              **文案始终是「修复」，执行中不换字。**

              之前执行中换成「正在修复…」，配上 `loading` 的转圈后，按钮宽度
              会被「正在修复…」撑开、又被截断成「正在修…」，看起来像坏掉；
              而转圈本身已经表达了「在做了」。文字保持不变，进度交给下面的日志。
            */}
            {t('dependencyRepairRun')}
          </DshButton>
        </div>
      </header>

      <div className="dsh-fnos-authorized-card-body">


        {phase.kind === 'error' ? (
          <p className="dsh-fnos-repair-error" role="alert">{`${t('dependencyRepairFailed')}${phase.message}`}</p>
        ) : null}

        {/*
          结果按 `outcome` 分叉，**每一种结论都要留在屏幕上**。

          这里曾按 `steps.length > 0` 决定要不要渲染结果。可健康的 profile 走
          「无失效条目，跳过重建」分支返回空 `steps`，于是点完修复只有进度行
          闪一下就没了：用户既不知道修没修，也不知道判定是什么——「点了一下，
          什么都消失了」。现在「无需修复」本身就是要展示的结论。
        */}
        {phase.kind === 'done' ? (
          <div className="dsh-fnos-repair-result" role="status" aria-live="polite">
            <p className={
              phase.result.outcome === 'repaired' || phase.result.outcome === 'healthy'
                ? 'dsh-fnos-repair-ok'
                : 'dsh-fnos-repair-error'
            }>
              {phase.result.outcome === 'healthy'
                ? t('dependencyRepairHealthy')
                : phase.result.outcome === 'unavailable'
                  ? t('dependencyRepairUnavailable')
                  : phase.result.outcome === 'repaired'
                    ? `${t('dependencyRepairDone')}${(phase.result.durationMs / 1000).toFixed(1)}s`
                    : `${t('dependencyRepairFailed')}${phase.result.message ?? ''}`}
            </p>
            {/* 没有执行任何步骤时不再渲染空列表。 */}
            {phase.result.steps.length === 0 ? null : (
              <ul className="dsh-fnos-repair-list">
                {phase.result.steps.map(step => (
                  <li key={step.id} className="dsh-fnos-repair-entry">
                    <code className="dsh-fnos-repair-code">{step.id}</code>
                    <span className="dsh-fnos-repair-muted">
                      {step.status === 'ok' ? t('dependencyRepairStepOk') : null}
                      {step.status === 'skipped' ? t('dependencyRepairStepSkipped') : null}
                      {step.status === 'failed' ? t('dependencyRepairStepFailed') : null}
                      {step.detail === undefined ? '' : ` · ${step.detail}`}
                    </span>
                    {/*
                      备份路径：**显示语义化路径，点击复制完整路径。**

                      `/vol2/@appshare/fn-deepseek-harness/备份/pnpm-workspace-….yaml`
                      这种部署路径摊在卡片上既长又难读；而用户真正要的是「能粘进
                      文件管理器/终端」的绝对路径。所以显示 `备份/…`，点击才把
                      完整路径写进剪贴板。
                    */}
                    {step.backupDisplayPath === undefined || step.backupPath === undefined ? null : (
                      <button
                        type="button"
                        className="dsh-fnos-repair-backup"
                        title={t('dependencyRepairBackupCopy')}
                        onClick={() => { void copyPath(step.backupPath!) }}
                      >
                        {copied === step.backupPath ? t('dependencyRepairBackupCopied') : step.backupDisplayPath}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {/*
          agent skill 清理：与「修复」同属「重置安装环境」，因此并进这张卡片。

          单独成卡会让工具箱变成一列互不相关的小工具；而且这两件事的触发时机
          几乎总是相邻的——装不上插件时，先看 skill 有没有重复内置，再决定要不要
          重建依赖。
        */}
        <div className="dsh-fnos-repair-divider" />
        <div className="dsh-fnos-repair-subhead">
          <strong>{t('agentSkillsTitle')}</strong>
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            loading={skillsTask.running}
            disabled={skillsTask.running || skillsPresent.length === 0}
            onClick={() => { setConfirmSkills(true) }}
          >
            {t('agentSkillsCleanup')}
          </DshButton>
        </div>
        <p className="dsh-fnos-repair-muted">
          {skillsPresent.length === 0 ? t('agentSkillsNone') : `${t('agentSkillsFound')}${skillsPresent.join(', ')}`}
        </p>
        {/*
          **必须说明为什么值得清理。**

          用户会想「多一个 skill 有什么坏处」。实际坏处很具体：`@fnnas-labs/fnos-cli`
          插件自带同名 skill，两份同时存在会让 OAuth 凭据的读写走到不同的目录，
          表现为登录状态异常地反复失效。
        */}
        <p className="dsh-fnos-repair-note">{t('agentSkillsDuplicateHint')}</p>
        {skillsError === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{skillsError}</p>}
      </div>

      {/* 清理前二次确认：会真的删目录，不可撤销。 */}
      <DshModal
        visible={confirmSkills}
        title={t('agentSkillsCleanup')}
        okText={t('ok')}
        cancelText={t('cancel')}
        onOk={() => { void cleanupSkills() }}
        onCancel={() => { setConfirmSkills(false) }}
      >
        <p>{t('agentSkillsConfirm')}</p>
        {/*
          列出**完整绝对路径**，不只给目录名。

          `fnos-cli` 这个名字看不出它在哪块存储、哪个账号下；而这是不可撤销的删除，
          用户有权在按下确定之前看清到底删哪个位置。语义化形式（`存储空间2/...`）
          由宿主经 `trim.file.convertPath` 给出，拿不到时退回内部路径。
        */}
        <ul className="dsh-fnos-repair-skill-list">
          {(skills?.entries ?? []).map(item => (
            <li key={item.path}>
              <code className="dsh-fnos-repair-code">{item.displayPath}</code>
            </li>
          ))}
        </ul>
      </DshModal>

    </section>
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
