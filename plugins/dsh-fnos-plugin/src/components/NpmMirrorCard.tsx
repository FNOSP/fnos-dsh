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
import { logPanelStore } from '../client/log-panel-store.ts'
import { fetchNpmMirrorStatus, installNrm, switchNpmMirror, uninstallNrm, type NpmMirrorStatus } from '../client/services/npm-mirror-client.ts'
import { fetchInstallLog } from '../client/services/gateway-proxy-client.ts'

type Translate = (key: FnosLocaleKey) => string

/**
 * 按行内容推断级别。
 *
 * npm / pnpm 的输出是纯文本，没有级别字段；这里只做最小判断——含「失败 / 错误 /
 * error」的算错误，含「警告 / warn」的算警告，其余按信息。宁可少标也不要误标：
 * 级别配色只是帮助扫读，判错反而误导。
 * @param line - 日志行。
 * @returns 级别。
 */
function levelOfInstallLine(line: string): 'info' | 'warn' | 'error' {
  if (/失败|错误|error|failed/i.test(line)) return 'error'
  if (/警告|warn/i.test(line)) return 'warn'
  return 'info'
}

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
  /**
   * 日志轮询的字节偏移。
   *
   * 日志内容本身不再存在本组件的 state 里——它进任务日志浮层与运行日志中心，
   * 卡片只保留「装/没装/失败」这三个必要状态。这里仍要偏移量，因为轮询接口
   * 按字节增量返回。
   */
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
    setInstallError(undefined)
    setFailed(false)
    logOffsetRef.current = 0

    /*
      日志走任务浮层：开始一轮新任务，随后每拉到一段就追加。

      同一行由 `logPanelStore.append` 同时写进运行日志中心，因此卡片不必再
      保存整份日志，也不必再提供「复制」——需要全文时去日志中心导出。
    */
    logPanelStore.beginTask({ feature: 'mirror', title: t('mirrorInstallTask') })

    const pull = async (): Promise<void> => {
      const next = await fetchInstallLog(logOffsetRef.current, 'mirror')
      if (next.text === '') return
      logOffsetRef.current = next.offset
      for (const line of next.text.split('\n')) {
        if (line.trim() !== '') logPanelStore.append(levelOfInstallLine(line), line)
      }
    }

    const timer = setInterval(() => { void pull() }, 800)

    try {
      await installNrm()
      // 结束时再拉一次：最后几行可能在停止轮询之后才落盘。
      await pull()
      await load()
      logPanelStore.finish('ok')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setInstallError(message)
      setFailed(true)
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
    } finally {
      clearInterval(timer)
      setInstalling(false)
    }
  }, [load, t])

  /**
   * 卸载 nrm：`npm uninstall -g nrm`。
   *
   * 与安装同一套日志链路——写 `mirror-log.txt` 并推进任务浮层，所以卡片上不必
   * 再显示日志框；用户看浮层或日志中心即可。
   */
  const uninstall = useCallback(async () => {
    setInstalling(true)
    setInstallError(undefined)
    setFailed(false)
    logOffsetRef.current = 0
    logPanelStore.beginTask({ feature: 'mirror', title: t('mirrorUninstallTask') })

    const pull = async (): Promise<void> => {
      const next = await fetchInstallLog(logOffsetRef.current, 'mirror')
      if (next.text === '') return
      logOffsetRef.current = next.offset
      for (const line of next.text.split('\n')) {
        if (line.trim() !== '') logPanelStore.append(levelOfInstallLine(line), line)
      }
    }

    const timer = setInterval(() => { void pull() }, 800)
    try {
      await uninstallNrm()
      await pull()
      await load()
      logPanelStore.finish('ok')
      notifySuccess(t('mirrorUninstalled'))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setInstallError(message)
      setFailed(true)
      logPanelStore.append('error', message)
      logPanelStore.finish('failed')
    } finally {
      clearInterval(timer)
      setInstalling(false)
    }
  }, [load, t])

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
        <div className="dsh-fnos-mirror-head-text">
          <strong className="dsh-fnos-mirror-title">{t('mirrorTitle')}</strong>
          {status?.version === undefined ? null : (
            <span className="dsh-fnos-installed-badge">{`nrm ${status.version}`}</span>
          )}
        </div>
        {/*
          「安装」放**右侧**，与「修复插件安装异常」那张卡一致：一列卡片里动作都在
          右边缘，视线不用来回跳。

          未安装时只有一个按钮，原先它掉在标题下面自成一行；移到头部右侧后，这一块
          与其它卡片是同一种排布。
        */}
        {status !== undefined && !status.available ? (
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
        ) : null}
        {/*
          已安装时给「卸载」。

          装得上去不掉，用户只能去终端手动处理——而这个界面已经承担了安装。
          用 borderless 弱化：它是退路，不是主路径，不该与「切换」抢注意力。
        */}
        {status?.available === true ? (
          <DshButton
            htmlType="button"
            theme="borderless"
            type="tertiary"
            loading={installing}
            onClick={() => { void uninstall() }}
          >
            {t('mirrorUninstall')}
          </DshButton>
        ) : null}
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
                  /*
                    **切换中只给 `loading`，不给 `disabled`。**

                    `disabled` 会先把按钮压成灰色不可点态，把 `loading` 的转圈
                    一起压掉——用户看到的是「按钮坏了」。而"别的源正在切换"这一
                    情况并不需要禁掉本行：`loading` 已经拦住重复点击，其余行保持
                    正常外观即可（真被点到也会被 `busy` 判据忽略）。
                  */
                  loading={busy === mirror.name}
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
