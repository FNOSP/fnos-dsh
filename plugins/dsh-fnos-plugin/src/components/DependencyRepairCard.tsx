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

import { useCallback, useState } from 'react'
import { DshButton, DshIconInfoCircle, DshTooltip } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { runDependencyRepair } from '../client/services/dependency-repair-client.ts'
import type { DependencyRepairResult } from '../contracts/dependency-repair-contract.ts'

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
 * 修复插件安装异常卡片。
 * @returns 卡片元素。
 */
export function DependencyRepairCard({ t }: DependencyRepairCardProps): React.ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  /** 执行修复。 */
  const repair = useCallback(async () => {
    setPhase({ kind: 'running' })
    try {
      setPhase({ kind: 'done', result: await runDependencyRepair() })
    } catch (error) {
      setPhase({ kind: 'error', message: describe(error) })
    }
  }, [])

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
            /*
              **直接执行，不再二次确认。**

              确认弹框里的三行说明已经移到卡片自身的 tip 与描述里——用户点按钮前
              就能读到「会重建什么、不会动什么」。既然信息在场上，再弹一次只是
              多一次点击；而这一步本身可重入、不含不可撤销的数据删除（只清可重建
              产物），不值得拦一道。

              按钮在 `busy` 时显示 loading，视觉上就是「已经在做了」。
            */
            onClick={() => { void repair() }}
          >
            {busy ? t('dependencyRepairRunning') : t('dependencyRepairRun')}
          </DshButton>
        </div>
      </header>

      <div className="dsh-fnos-authorized-card-body">
        {phase.kind === 'error' ? (
          <p className="dsh-fnos-repair-error" role="alert">{`${t('dependencyRepairFailed')}${phase.message}`}</p>
        ) : null}

        {/*
          结果按步骤逐条展示：用户点过「修复」之后，比较关心的就是「到底做了什么、
          哪一步没成」。这里展示的是**已执行的动作**，与之前那种「检测到的内部
          标识」不是一回事。
        */}
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

    </section>
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
