/**
 * 「依赖修复」卡片：应用内装不上插件时的自助修复入口。
 *
 * 只有一个动作按钮：点它就修复。曾经拆成「检查 / 修复」两步，但这一步的收益
 * 不成立——检查结果对用户没有第二种用法（看到失效条目也还是要点修复），
 * 却让排障多一次点击。诊断改为修复的执行前置：进入修复时先算一次，没有失效
 * 条目就直接报「状态正常」，不白重建依赖。
 *
 * @module dsh-fnos/components/DependencyRepairCard
 */

import { useCallback, useState } from 'react'
import { DshButton, DshIconInfoCircle, DshModal, DshTooltip } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import {
  diagnoseDependencyRepair,
  runDependencyRepair,
} from '../client/services/dependency-repair-client.ts'
import type {
  DependencyRepairDiagnosis,
  DependencyRepairEntry,
  DependencyRepairResult,
} from '../contracts/dependency-repair-contract.ts'

type Translate = (key: FnosLocaleKey) => string

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
 * 一条失效条目的人话说明。
 *
 * 目标版本不拼进句子：本插件的翻译函数只做静态键查表，没有占位符替换。把版本
 * 作为独立片段放在说明后面，既避免了引入一套参数机制，也让长版本号不必挤在
 * 一句中文里读。
 */
function entryReason(entry: DependencyRepairEntry, t: Translate): string {
  if (entry.reason === 'pipe-union') return t('dependencyRepairReasonPipe')
  return entry.targetVersion === undefined
    ? t('dependencyRepairReasonStale')
    : `${t('dependencyRepairReasonStale')} → ${entry.targetVersion}`
}

/**
 * 依赖修复卡片。
 * @returns 卡片元素。
 */
export function DependencyRepairCard({ t }: DependencyRepairCardProps): React.ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [entries, setEntries] = useState<readonly DependencyRepairEntry[]>([])
  const [unavailable, setUnavailable] = useState(false)

  /**
   * 点「修复依赖」：先诊断，再决定要不要弹确认框。
   *
   * **顺序是关键**：确认框必须在诊断之后。反过来的话，健康的 profile 也会先看到
   * 「将清理依赖」的破坏性警告，点确认后才被告知「无需修复」——用户被无谓地吓了
   * 一次，还会怀疑按钮到底做了什么。
   */
  const requestRepair = useCallback(async () => {
    setPhase({ kind: 'running' })
    try {
      // 诊断决定「要不要重建」：重建会清 lockfile 与 node_modules，对一个本来就
      // 健康的 profile 做这件事纯属破坏。
      const diagnosis: DependencyRepairDiagnosis = await diagnoseDependencyRepair()
      if (!diagnosis.available) {
        setUnavailable(true)
        setEntries([])
        setPhase({ kind: 'idle' })
        return
      }
      if (diagnosis.entries.length === 0) {
        setUnavailable(false)
        setEntries([])
        setPhase({ kind: 'done', result: { ok: true, steps: [], removed: [], durationMs: 0 } })
        return
      }
      // 确实有失效条目：展示出来并请用户确认。
      setUnavailable(false)
      setEntries(diagnosis.entries)
      setPhase({ kind: 'idle' })
      setConfirmOpen(true)
    } catch (error) {
      setPhase({ kind: 'error', message: describe(error) })
    }
  }, [])

  /** 确认框点了「修复依赖」：执行重建。 */
  const repair = useCallback(async () => {
    setConfirmOpen(false)
    setPhase({ kind: 'running' })
    try {
      setPhase({ kind: 'done', result: await runDependencyRepair() })
    } catch (error) {
      setPhase({ kind: 'error', message: describe(error) })
    }
  }, [])

  const healthy = phase.kind === 'done' && phase.result.ok && phase.result.steps.length === 0
  const busy = phase.kind === 'running'

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
            disabled={busy}
            loading={busy}
            onClick={() => { void requestRepair() }}
          >
            {busy ? t('dependencyRepairRunning') : t('dependencyRepairRun')}
          </DshButton>
        </div>
      </header>

      <div className="dsh-fnos-authorized-card-body">
        {phase.kind === 'error' ? (
          <p className="dsh-fnos-repair-error" role="alert">{`${t('dependencyRepairFailed')}${phase.message}`}</p>
        ) : null}

        {unavailable ? (
          <p className="dsh-fnos-repair-muted">{t('dependencyRepairUnavailable')}</p>
        ) : null}

        {healthy ? (
          <p className="dsh-fnos-repair-ok">{t('dependencyRepairHealthy')}</p>
        ) : null}

        {entries.length > 0 ? (
          <>
            <p className="dsh-fnos-repair-muted">{t('dependencyRepairStaleCount')}</p>
            <ul className="dsh-fnos-repair-list">
              {entries.map(entry => (
                <li key={`${entry.name}@${entry.range}`} className="dsh-fnos-repair-entry">
                  <code className="dsh-fnos-repair-code">{`${entry.name}@${entry.range}`}</code>
                  <span className="dsh-fnos-repair-muted">{entryReason(entry, t)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {phase.kind === 'done' && phase.result.steps.length > 0 ? (
          <div className="dsh-fnos-repair-result" role="status">
            <p className={phase.result.ok ? 'dsh-fnos-repair-ok' : 'dsh-fnos-repair-error'}>
              {phase.result.ok
                ? `${t('dependencyRepairDone')}${(phase.result.durationMs / 1000).toFixed(1)}s`
                : `${t('dependencyRepairFailed')}${phase.result.message ?? ''}`}
            </p>
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
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <DshModal
        visible={confirmOpen}
        title={t('dependencyRepairConfirmTitle')}
        onCancel={() => setConfirmOpen(false)}
        onOk={() => { void repair() }}
        okText={t('dependencyRepairRun')}
        cancelText={t('dependencyRepairCancel')}
      >
        <p className="dsh-fnos-repair-muted">{t('dependencyRepairConfirmBody')}</p>
        <ol className="dsh-fnos-repair-steps">
          <li>{t('dependencyRepairStepClear')}</li>
          <li>{t('dependencyRepairStepRebuild')}</li>
          <li>{t('dependencyRepairStepReinstall')}</li>
        </ol>
        <p className="dsh-fnos-repair-muted">{t('dependencyRepairConfirmSafe')}</p>
      </DshModal>
    </section>
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
