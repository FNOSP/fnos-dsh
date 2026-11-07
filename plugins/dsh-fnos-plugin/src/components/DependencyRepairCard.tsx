/**
 * 「依赖修复」卡片：应用内装不上插件时的自助修复入口。
 *
 * 交互刻意分成两步：「检查」只读、先让用户看到到底哪几条豁免失效；「修复依赖」
 * 才动手，且需要二次确认。合并成一步会让排障变成一个盲目的破坏性按钮。
 *
 * @module dsh-fnos/components/DependencyRepairCard
 */

import { useCallback, useEffect, useState } from 'react'
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
  | { readonly kind: 'checking' }
  | { readonly kind: 'checked'; readonly diagnosis: DependencyRepairDiagnosis }
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

  // 进入页面先做一次只读诊断：用户还没点任何按钮就知道状态，不必先点「检查」。
  useEffect(() => {
    let active = true
    void (async () => {
      setPhase({ kind: 'checking' })
      try {
        const diagnosis = await diagnoseDependencyRepair()
        if (active) setPhase({ kind: 'checked', diagnosis })
      } catch (error) {
        if (active) setPhase({ kind: 'error', message: describe(error) })
      }
    })()
    return () => { active = false }
  }, [])

  const check = useCallback(async () => {
    setPhase({ kind: 'checking' })
    try {
      setPhase({ kind: 'checked', diagnosis: await diagnoseDependencyRepair() })
    } catch (error) {
      setPhase({ kind: 'error', message: describe(error) })
    }
  }, [])

  const repair = useCallback(async () => {
    setConfirmOpen(false)
    setPhase({ kind: 'running' })
    try {
      setPhase({ kind: 'done', result: await runDependencyRepair() })
    } catch (error) {
      setPhase({ kind: 'error', message: describe(error) })
    }
  }, [])

  const diagnosis = phase.kind === 'checked' ? phase.diagnosis : undefined
  const entries = diagnosis?.entries ?? []
  const unavailable = diagnosis !== undefined && !diagnosis.available
  const busy = phase.kind === 'checking' || phase.kind === 'running'

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
          <DshButton htmlType="button" theme="borderless" type="tertiary" disabled={busy} onClick={() => { void check() }}>
            {phase.kind === 'checking' ? t('dependencyRepairChecking') : t('dependencyRepairCheck')}
          </DshButton>
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            disabled={busy || entries.length === 0}
            loading={phase.kind === 'running'}
            onClick={() => setConfirmOpen(true)}
          >
            {phase.kind === 'running' ? t('dependencyRepairRunning') : t('dependencyRepairRun')}
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

        {diagnosis !== undefined && diagnosis.available && entries.length === 0 ? (
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

        {phase.kind === 'done' ? (
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
