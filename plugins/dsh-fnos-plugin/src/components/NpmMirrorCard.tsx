/**
 * 「npm 镜像管理」卡片：检测 nrm、列出加速源、切换当前源。
 *
 * ## 未安装时不代装
 *
 * 安装 nrm 是 `npm i -g`（全局写入用户的 node_modules）。这种跨项目的改动不该
 * 由应用替用户决定，界面给出命令、用户自己执行，然后重新检测。
 *
 * ## 为什么列全部源而不是只给推荐
 *
 * nrm 的源列表是用户自己维护的（他可以 `nrm add`）。界面照着 `nrm ls` 输出展示
 * 才和他的环境一致；替他筛「推荐几个」会让自定义的源消失。
 *
 * @module dsh-fnos/components/NpmMirrorCard
 */

import { useCallback, useEffect, useState } from 'react'
import { DshButton } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchNpmMirrorStatus, switchNpmMirror, type NpmMirrorStatus } from '../client/services/npm-mirror-client.ts'

type Translate = (key: FnosLocaleKey) => string

/** 安装 nrm 的命令：给用户照着执行。 */
const NRM_INSTALL_COMMAND = 'npm install -g nrm'

/** 组件参数。 */
export interface NpmMirrorCardProps {
  readonly t: Translate
}

/**
 * npm 镜像管理。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 卡片元素。
 */
export function NpmMirrorCard({ t }: NpmMirrorCardProps): React.ReactNode {
  const [status, setStatus] = useState<NpmMirrorStatus>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      setStatus(await fetchNpmMirrorStatus())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const switchTo = useCallback(async (name: string) => {
    setBusy(name)
    try {
      await switchNpmMirror(name)
      await load()
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }, [load])

  const copyCommand = useCallback(() => {
    void globalThis.navigator?.clipboard?.writeText(NRM_INSTALL_COMMAND)
  }, [])

  return (
    <section className="dsh-fnos-mirror">
      <header className="dsh-fnos-mirror-head">
        <strong className="dsh-fnos-mirror-title">{t('mirrorTitle')}</strong>
        {status?.version === undefined ? null : (
          <span className="dsh-fnos-installed-badge">{`nrm ${status.version}`}</span>
        )}
      </header>

      {status === undefined ? <p className="dsh-fnos-repair-muted">{t('mirrorLoading')}</p> : null}

      {/* 未安装：给出命令，让用户自己装（全局操作不由应用代做）。 */}
      {status !== undefined && !status.available ? (
        <div className="dsh-fnos-mirror-missing">
          <p className="dsh-fnos-repair-muted">
            {status.reason === 'nrm-failed' ? t('mirrorNrmFailed') : t('mirrorNrmMissing')}
          </p>
          {status.reason === 'nrm-failed' && status.error !== undefined ? (
            <pre className="dsh-fnos-mirror-error">{status.error}</pre>
          ) : null}
          <div className="dsh-fnos-mirror-command">
            <code>{NRM_INSTALL_COMMAND}</code>
            <DshButton htmlType="button" size="small" theme="borderless" type="tertiary" onClick={copyCommand}>
              {t('copy')}
            </DshButton>
          </div>
          <DshButton htmlType="button" size="small" theme="light" type="primary" onClick={() => { void load() }}>
            {t('refresh')}
          </DshButton>
        </div>
      ) : null}

      {/* 已安装：列出全部源，当前源高亮，其余可切换。 */}
      {status?.available === true ? (
        <ul className="dsh-fnos-mirror-list">
          {status.mirrors.map(mirror => (
            <li key={mirror.name} className={`dsh-fnos-mirror-item${mirror.current ? ' dsh-fnos-mirror-item--current' : ''}`}>
              <div className="dsh-fnos-mirror-item-main">
                <span className="dsh-fnos-mirror-name">{mirror.name}</span>
                <code className="dsh-fnos-mirror-registry" title={mirror.registry}>{mirror.registry}</code>
              </div>
              {mirror.current ? (
                <span className="dsh-fnos-installed-badge dsh-fnos-installed-badge--ok">{t('mirrorCurrent')}</span>
              ) : (
                <DshButton
                  htmlType="button"
                  size="small"
                  theme="light"
                  type="primary"
                  loading={busy === mirror.name}
                  disabled={busy !== undefined}
                  onClick={() => { void switchTo(mirror.name) }}
                >
                  {t('mirrorUse')}
                </DshButton>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error === undefined ? null : <p className="dsh-fnos-repair-error" role="alert">{error}</p>}
    </section>
  )
}
