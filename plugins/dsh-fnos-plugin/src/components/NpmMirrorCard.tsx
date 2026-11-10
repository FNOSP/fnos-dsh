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

import { useCallback, useEffect, useRef, useState } from 'react'
import { DshButton } from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { fetchNpmMirrorStatus, installNrm, switchNpmMirror, type NpmMirrorStatus } from '../client/services/npm-mirror-client.ts'
import { fetchInstallLog } from '../client/services/gateway-proxy-client.ts'

type Translate = (key: FnosLocaleKey) => string

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
  /** 正在安装 nrm。 */
  const [installing, setInstalling] = useState(false)
  /** 安装失败的原因（成功时清空）。 */
  const [installError, setInstallError] = useState<string>()
  /** 安装过程的实时日志。 */
  const [installLog, setInstallLog] = useState('')
  /** 日志轮询的字节偏移。 */
  const logOffsetRef = useRef(0)
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

  /**
   * 安装 nrm：`npm i -g nrm`，过程实时展示日志。
   *
   * 安装要几十秒，只显示一个「正在安装…」用户无法判断是在下载还是卡住了。
   * 日志与「插件安装」共用同一个文件与 offset 增量接口，不另建一套。
   */
  const install = useCallback(async () => {
    setInstalling(true)
    setInstallLog('')
    setInstallError(undefined)
    logOffsetRef.current = 0

    const timer = setInterval(() => {
      void fetchInstallLog(logOffsetRef.current).then(next => {
        if (next.text === '') return
        logOffsetRef.current = next.offset
        setInstallLog(previous => previous + next.text)
      })
    }, 800)

    try {
      await installNrm()
      // 结束时再拉一次：最后几行可能在停止轮询之后才落盘。
      const tail = await fetchInstallLog(logOffsetRef.current)
      if (tail.text !== '') {
        logOffsetRef.current = tail.offset
        setInstallLog(previous => previous + tail.text)
      }
      await load()
    } catch (cause) {
      setInstallError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      clearInterval(timer)
      setInstalling(false)
    }
  }, [load])

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

  return (
    <section className="dsh-fnos-mirror">
      <header className="dsh-fnos-mirror-head">
        <strong className="dsh-fnos-mirror-title">{t('mirrorTitle')}</strong>
        {status?.version === undefined ? null : (
          <span className="dsh-fnos-installed-badge">{`nrm ${status.version}`}</span>
        )}
      </header>

      {status === undefined ? <p className="dsh-fnos-repair-muted">{t('mirrorLoading')}</p> : null}

      {/*
        未安装：只给一个「安装」按钮，不解释。

        安装 nrm 是 `npm i -g`（全局写入、跨项目生效）。这类跨项目的改动不该由
        应用替用户决定，所以不代装——但也不必把命令、原因、刷新串成一段话：
        按钮点下去就是执行「安装 nrm 并刷新状态」，用户不需要先读懂它。
        装了之后这一块整块消失，直接展示镜像列表。
      */}
      {status !== undefined && !status.available ? (
        <div className="dsh-fnos-mirror-missing">
          <DshButton
            htmlType="button"
            size="small"
            theme="solid"
            type="primary"
            loading={installing}
            onClick={() => { void install() }}
          >
            {installing ? t('mirrorInstalling') : t('mirrorInstall')}
          </DshButton>
          {/* 安装过程日志：与插件安装共用同一份输出。 */}
          {installLog === '' ? null : (
            <pre className="dsh-fnos-mirror-log">{installLog}</pre>
          )}
          {installError === undefined ? null : (
            <pre className="dsh-fnos-mirror-error">{installError}</pre>
          )}
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
