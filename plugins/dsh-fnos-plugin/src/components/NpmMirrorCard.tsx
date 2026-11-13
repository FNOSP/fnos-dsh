import { notifyFailure, notifySuccess } from '../client/notify.ts'
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
  /**
   * 安装是否失败过。
   *
   * 失败时**日志常显**：用户要能回看 npm 到底报了什么，而不是只看到一句
   * 「失败」。成功或未尝试时日志随安装结束收起。
   */
  const [failed, setFailed] = useState(false)
  /** 复制按钮的短暂反馈。 */
  const [copied, setCopied] = useState(false)
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
    setFailed(false)
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
      setFailed(true)
    } finally {
      clearInterval(timer)
      setInstalling(false)
    }
  }, [load])

  /** 复制整份安装日志。 */
  const copyLog = useCallback(() => {
    void globalThis.navigator?.clipboard?.writeText(installLog).then(() => {
      setCopied(true)
      globalThis.setTimeout(() => { setCopied(false) }, 1500)
    })
  }, [installLog])

  const switchTo = useCallback(async (name: string) => {
    setBusy(name)
    try {
      await switchNpmMirror(name)
      await load()
      setError(undefined)
      notifySuccess(t('mirrorSwitched'))
    } catch (cause) {
      notifyFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }, [load, t])

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
          {/*
            与「修复安装异常」的按钮同一形态：default 尺寸 + solid primary。
            早前这里是 `size="small"`，同屏两个主操作按钮一大一小，看着像从两个
            组件库里拼出来的。
          */}
          <DshButton
            htmlType="button"
            theme="solid"
            type="primary"
            loading={installing}
            onClick={() => { void install() }}
          >
            {/* 失败过就说「重新安装」——「安装」会让人以为上次根本没执行。 */}
            {installing ? t('mirrorInstalling') : failed ? t('mirrorReinstall') : t('mirrorInstall')}
          </DshButton>
          {/*
            安装日志：固定 140px 高的代码框，可复制。

            - **固定高度**：npm 输出长度不可预期，撑开会把下面的内容顶走；固定后
              用户知道「这里是日志区」，滚动只发生在这个框里。
            - **失败时常显**：用户要能回看 npm 到底报了什么，而不是只看到「失败」。
              成功或未尝试时随安装结束收起，不占地方。
            - **可复制**：报错要拿去搜或贴进 issue，不能只让用户手动选中。
          */}
          {installLog === '' || (!installing && !failed) ? null : (
            <div className="dsh-fnos-mirror-logbox">
              <div className="dsh-fnos-mirror-logbar">
                <span>{t('pluginInstallLog')}</span>
                <DshButton htmlType="button" size="small" theme="borderless" type="tertiary" onClick={copyLog}>
                  {copied ? t('copied') : t('copy')}
                </DshButton>
              </div>
              <pre className="dsh-fnos-mirror-log">{installLog}</pre>
            </div>
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
