/**
 * 侧栏底部（`sidebar.footer.action`）的「飞牛 OS」入口与其下拉菜单。
 *
 * ## 为什么在这里
 *
 * 这个座位紧挨设置行上方，是侧栏里唯一「与整个应用相关、且可叠加」的位置。
 * 入口原先放在「更多」菜单（`sidebar.panellist.actions`）里，那里属于「全局
 * 面板」分组，而飞牛 OS 不是面板，语义不对；搬到侧栏底部后与设置同级，符合
 * 「应用级入口」的定位。
 *
 * ## 为什么是下拉菜单而不是直接开弹框
 *
 * 设置、刷新、重启是同一层级的三个应用级动作。把它们收进一个菜单，与侧栏
 * 「更多」的交互形态一致——用户不必记住「哪个动作在哪个菜单里」。
 *
 * ## 复用官方 Menu 原语
 *
 * 下拉用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu` + `MenuItemButton`，
 * 与侧栏「更多」菜单是同一套实现：行高、图标列、键盘（方向键/Escape/Tab）
 * 与浮层定位都不必自己重写，也不会与官方菜单产生视觉漂移。
 *
 * @module dsh-fnos/components/FnosFooterEntry
 */

import { useCallback, useRef, useState } from 'react'
import { Menu, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FnosLocaleKey } from '../client/locales.ts'
import { configDialogStore } from '../client/config-dialog-store.ts'
import { getFnosWebActions } from '../client/services/web-actions.ts'
import { FnosMonoLogo } from './FnosLogo.tsx'
import { IconifyIcon } from './IconifyIcon.tsx'

type Translate = (key: FnosLocaleKey) => string

/** 组件参数。 */
export interface FnosFooterEntryProps {
  /** 侧栏是否为展开态（折叠时只显示图标）。 */
  readonly wide: boolean
  readonly t: Translate
}

/**
 * 侧栏底部的「飞牛 OS」入口。
 *
 * 宽高与设置行对齐：展开态 42px 高、占满整行宽、圆角 `--dsw-radius-md`；
 * 折叠态 36×36 方形，与其它 rail 控件一致。这些数值取自官方设置触发器
 * （`SettingsRoot.module.css` 的 `.trigger` / `.trigger.rail`），不另立一套。
 *
 * @param props - 组合后的 props。
 * @param props.wide - 侧栏是否展开。
 * @param props.t - 翻译函数。
 * @returns 入口按钮与其下拉菜单。
 */
export function FnosFooterEntry({ wide, t }: FnosFooterEntryProps): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const actions = getFnosWebActions()

  const dismiss = useCallback(() => { setOpen(false) }, [])

  const openConfig = useCallback(() => {
    // 先关菜单再开弹框：菜单是 portaled 浮层，留着会和弹框抢焦点。
    dismiss()
    configDialogStore.set(true)
  }, [dismiss])

  const restart = useCallback(async (): Promise<void> => {
    if (actions.restart === undefined) return
    setRestarting(true)
    setRestartFailed(false)
    dismiss()
    try {
      await actions.restart()
    } catch {
      setRestartFailed(true)
    } finally {
      setRestarting(false)
    }
  }, [actions, dismiss])

  const restartLabel = restartFailed
    ? t('webRestartFailed')
    : restarting ? t('webRestarting') : t('webRestart')

  return (
    <Menu
      open={open}
      onClose={dismiss}
      portal
      autoFocus
      side="top"
      align="start"
      returnFocus={() => triggerRef.current}
      className="dsh-fnos-footer-anchor"
      listClassName="dsh-fnos-footer-menu"
      anchor={(
        <button
          ref={triggerRef}
          type="button"
          /*
            折叠态必须给 aria-label：图标按钮没有可见文字，缺了它读屏软件只会
            念「按钮」。
          */
          aria-label={t('configMenuEntry')}
          aria-haspopup="menu"
          aria-expanded={open}
          className={wide ? 'dsh-fnos-footer-trigger' : 'dsh-fnos-footer-trigger dsh-fnos-footer-trigger--rail'}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className="dsh-fnos-footer-glyph" aria-hidden="true">
            <FnosMonoLogo size={wide ? 16 : 18} />
          </span>
          {wide && <span className="dsh-fnos-footer-title">{t('configMenuEntry')}</span>}
        </button>
      )}
    >
      <MenuItemButton
        icon={<IconifyIcon name="lucide:settings" />}
        onSelect={openConfig}
      >
        {t('configDialogTitle')}
      </MenuItemButton>
      {/* 刷新与重启只在应用网关下提供：本地开发既不经过网关，也没有可重启的进程。 */}
      {actions.refresh !== undefined && (
        <MenuItemButton
          icon={<IconifyIcon name="lucide:refresh-cw" />}
          onSelect={() => { dismiss(); actions.refresh?.() }}
        >
          {t('refresh')}
        </MenuItemButton>
      )}
      {actions.restart !== undefined && (
        <MenuItemButton
          icon={<IconifyIcon name="lucide:power" />}
          disabled={restarting}
          onSelect={() => { void restart() }}
        >
          {restartLabel}
        </MenuItemButton>
      )}
    </Menu>
  )
}
