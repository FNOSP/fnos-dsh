/**
 * 任务日志浮层：右下角可拖动的小窗，只显示「当前这一次任务」的日志。
 *
 * ## 为什么自己写拖动而不是用 Semi 的 DragMove
 *
 * `DragMove` 要求 `handler` 返回节点、`constrainer` 指定约束容器，它按 Semi 自己的
 * DOM 结构假设定位。本浮层只需要「按住头部 → 平移整体 → 夹在视口内」这一种手势，
 * 自实现约几十行，还能完全控制边界夹取与窗口缩放后的重夹。
 *
 * ## 为什么位置用 state 而不是 transform
 *
 * 位置要参与边界计算（夹取依赖元素尺寸），用 `left` / `top` 定位最直接；
 * 拖动过程中每次 `pointermove` 更新一次，量级远低于掉帧阈值。
 *
 * @module dsh-fnos/components/LogFeedbackPanel
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import {
  DshIconButton, DshIconClose, DshIconMinus, DshIconRefresh, DshSpin, DshTooltip,
} from '@tnnevol/dsh-semi-ui'
import type { FnosLocaleKey } from '../client/locales.ts'
import { IconifyIcon, type UsedIconName } from './IconifyIcon.tsx'
import {
  logPanelStore, useLogPanelState,
  type LogPanelPosition, type TaskLogLine,
} from '../client/log-panel-store.ts'

gsap.registerPlugin(useGSAP)

type Translate = (key: FnosLocaleKey) => string

/** 吸附标签停靠的屏幕侧。 */
type DockedSide = 'left' | 'right'

/**
 * 吸附标签的位置，模块级保存。
 *
 * 用可变变量而不是 state：收起 → 展开 → 再收起时组件会整棵重挂载，state 会
 * 回到初值；模块级值跨重挂载保留，标签因此停在用户放下的地方。
 */
let dockedSide: DockedSide = 'right'
let dockedRatio = 0.72

/**
 * 按停靠侧与纵向比例算出标签的**贴边点**坐标。
 *
 * ## 横向语义：`left` 是贴边的那条竖线
 *
 * 纵向由 CSS 的 `translateY(-50%)` 居中，横向由 `data-side` 决定：
 * - 左贴：`left = 0`，元素 `translateX(0)`，左边缘正好在屏幕左缘；
 * - 右贴：`left = innerWidth`，元素 `translateX(-100%)`，右边缘正好在屏幕右缘。
 *
 * 这样「贴哪一侧」完全由 CSS 的 `data-side` 表达，JS 只给坐标，两者不互相覆盖；
 * GSAP 回弹也就不必写内联 `transform`（那会把 `data-side` 的偏移一起冲掉）。
 * @returns 视口坐标（贴边点）。
 */
function tabPosition(): TabPosition {
  const height = window.innerHeight
  const y = Math.min(Math.max(48, dockedRatio * height), Math.max(48, height - 48))
  return {
    x: dockedSide === 'left' ? 0 : window.innerWidth,
    y,
  }
}

/** 浮层与视口边缘的默认间距。 */
const EDGE_GAP = 20
/** 浮层宽度上限；窄屏按视口收窄。 */
const PANEL_WIDTH = 420
/**
 * 日志区固定高度。
 *
 * **固定而不是上限**：内容从 0 行涨到几十行时，卡片高度如果跟着长，用户盯着
 * 的那行字会不断被顶走，「正在看第 3 行」这件事就失去意义；而且浮层贴底，
 * 高度变化会把顶边一路上推，视觉上是整块在跳。固定高度后只有内容在滚。
 */
const LOG_HEIGHT = 260

/**
 * 卡片与吸附标签共用的日志图标。
 *
 * 两处**必须同源**：同一个任务的展开态与收起态，用两个不同图标会让人以为
 * 是两件东西。
 *
 * 为什么不按任务类型分图标（安装=下载、镜像=刷新、修复=扳手）：收起态只有
 * 34px 宽，用户要认的是「这是日志」，而扳手会被读成工具面板入口；「哪类任务」
 * 由标题文字表达就够了，图标的职责是标示**这个面板是什么**。
 *
 * 选卷轴而非 `logs`（三条横线，像列表）或 `file-text`（像文档）：
 * 卷轴的「滚动记录」语义与日志最贴。
 */
const LOG_ICON: UsedIconName = 'lucide:scroll-text' 

/**
 * 计算默认位置：右下角。
 * @param width - 浮层宽度。
 * @param height - 浮层高度。
 * @returns 视口坐标。
 */
function defaultPosition(width: number, height: number): LogPanelPosition {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  return {
    left: Math.max(EDGE_GAP, viewportWidth - width - EDGE_GAP),
    top: Math.max(EDGE_GAP, viewportHeight - height - EDGE_GAP),
  }
}

/**
 * 把位置夹到「浮层完全在视口内」的合法区间。
 * @param position - 期望位置。
 * @param width - 浮层宽度。
 * @param height - 浮层高度。
 * @returns 夹取后的位置。
 */
function clampPosition(position: LogPanelPosition, width: number, height: number): LogPanelPosition {
  const maxLeft = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)
  const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)
  return {
    left: Math.min(Math.max(EDGE_GAP, position.left), maxLeft),
    top: Math.min(Math.max(EDGE_GAP, position.top), maxTop),
  }
}

/** 时刻格式：只到秒。 */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
}

/**
 * 日志浮层。
 * @param props - 组合后的 props。
 * @param props.t - 翻译函数。
 * @returns 浮层（隐藏时不渲染）。
 */
export function LogFeedbackPanel({ t }: { readonly t: Translate }): React.ReactNode {
  const state = useLogPanelState(logPanelStore)
  const { mode, task, position } = state
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ startX: number, startY: number, originLeft: number, originTop: number } | undefined>(undefined)
  /** 用户是否停在底部：只有停着时才自动跟随新行，避免打断向上翻阅。 */
  const [following, setFollowing] = useState(true)

  const visible = mode === 'expanded' && task !== undefined
  /** 当前任务的日志行数：贴底与跟随都靠它触发重算。 */
  const linesLength = task?.lines.length ?? 0

  /**
   * 进场动画：从右侧滑入 + 淡入。
   *
   * 用 GSAP 的 `useGSAP` 而不是手写 transition：进场还要同时处理「收起→展开」
   * 与「新一轮任务替换内容」两种情况，前者要位移、后者只需要一次轻微的缩放强调，
   * 时间线比 CSS 类切换更好表达。`scope` 保证选择器只作用于本卡片。
   *
   * `prefers-reduced-motion` 下 `gsap.matchMedia` 直接跳过——动画是装饰，
   * 可访问性优先。
   */
  useGSAP(() => {
    const element = panelRef.current
    if (element === null) return
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(element,
        { autoAlpha: 0, x: 24 },
        { autoAlpha: 1, x: 0, duration: 0.22, ease: 'power2.out' },
      )
    })
    return () => { mm.revert() }
  }, { dependencies: [visible], scope: panelRef })

  /*
    新一轮任务替换内容时给一次轻微的「内容刷新」强调。

    与进场区分开：位置不变，只让用户注意到内容换了一批。同样受 reduced-motion 约束。
  */
  useGSAP(() => {
    const body = listRef.current
    if (body === null || task === undefined) return
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(body, { autoAlpha: 0.55 }, { autoAlpha: 1, duration: 0.18, ease: 'power1.out' })
    })
    return () => { mm.revert() }
  }, { dependencies: [task?.taskId], scope: panelRef })

  /* 首次显示时把位置落到右下角；已有位置则沿用并夹一次。 */
  useLayoutEffect(() => {
    if (!visible) return
    const element = panelRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const next = clampPosition(position ?? defaultPosition(rect.width, rect.height), rect.width, rect.height)
    if (position === undefined || next.left !== position.left || next.top !== position.top) {
      logPanelStore.setPosition(next)
    }
  }, [visible, position])

  /*
    内容变高后**重新贴底**，否则浮层会长出视口。

    浮层刚出现时日志还是空的，高度只有头部；按那个高度算出的 `top` 之后不会变，
    而内容一路追加把高度撑大，底部就溢出视口（实测溢出 198px，最后几行看不见）。
    这里只在「用户没有拖动过、且仍贴着底边」时跟随，用户手动摆过位置就不再干预。
  */
  const [pinnedToBottom, setPinnedToBottom] = useState(true)
  useLayoutEffect(() => {
    if (!visible || !pinnedToBottom) return
    const element = panelRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const bottom = window.innerHeight - EDGE_GAP
    const nextTop = Math.max(EDGE_GAP, bottom - rect.height)
    const current = logPanelStore.getSnapshot().position
    if (current === undefined) return
    if (Math.abs(current.top - nextTop) < 1) return
    logPanelStore.setPosition({ left: current.left, top: nextTop })
  }, [visible, pinnedToBottom, linesLength])

  /* 窗口尺寸变化后重新夹取，避免浮层留在视口外。 */
  useEffect(() => {
    if (!visible) return
    const onResize = (): void => {
      const element = panelRef.current
      if (element === null) return
      const rect = element.getBoundingClientRect()
      const current = logPanelStore.getSnapshot().position
      if (current === undefined) return
      const next = clampPosition(current, rect.width, rect.height)
      if (next.left !== current.left || next.top !== current.top) logPanelStore.setPosition(next)
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [visible])

  /* 拖动：只认指针，鼠标与触摸统一。 */
  useEffect(() => {
    if (drag === undefined) return
    const onMove = (event: PointerEvent): void => {
      const element = panelRef.current
      const rect = element?.getBoundingClientRect()
      const next = clampPosition({
        left: drag.originLeft + (event.clientX - drag.startX),
        top: drag.originTop + (event.clientY - drag.startY),
      }, rect?.width ?? PANEL_WIDTH, rect?.height ?? 0)
      logPanelStore.setPosition(next)
    }
    const onUp = (): void => { setDrag(undefined) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag])

  /* 停在底部时跟随最新一行。 */
  useEffect(() => {
    if (!visible || !following) return
    const list = listRef.current
    if (list === null) return
    list.scrollTop = list.scrollHeight
  }, [visible, following, linesLength])

  const onScroll = useCallback((): void => {
    const list = listRef.current
    if (list === null) return
    // 距底部 24px 内视作「停在底部」。
    setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight < 24)
  }, [])

  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    // 头部按钮上的按下不算拖动。
    if ((event.target as HTMLElement).closest('button') !== null) return
    if (event.button !== 0) return
    const current = logPanelStore.getSnapshot().position
    if (current === undefined) return
    event.preventDefault()
    /* 用户一旦自己摆了位置，就不再自动贴底——否则内容一长浮层会跳回底部。 */
    setPinnedToBottom(false)
    setDrag({ startX: event.clientX, startY: event.clientY, originLeft: current.left, originTop: current.top })
  }, [])

  if (!visible || task === undefined) return null

  const statusKey: FnosLocaleKey = task.status === 'running'
    ? 'logPanelRunning'
    : task.status === 'ok' ? 'logPanelSucceeded' : 'logPanelFailed'

  /*
    **必须 portal 到 `body` 直下。**

    浮层挂在 `shell.overlay` 槽位里，那个容器是 `.overlayLayer`（`z-index: 20`），
    它相对 `body` 只算 20；官方设置弹框（Semi `Modal`）的 `semi-portal` 是
    `body` 直下、`z-index: 1000`。留在槽位里时，浮层上的 `z-index` 只在容器内部
    有效，写多大都出不了这一层，必然被弹框盖住。

    portal 出去后浮层直接与弹框同级比较，`CSS` 里的 `z-index` 才真正生效。
  */
  return createPortal(
    <div
      ref={panelRef}
      className="dsh-fnos-logpanel"
      data-status={task.status}
      role="dialog"
      aria-label={t('logPanelTitle')}
      style={{ left: `${String(position?.left ?? EDGE_GAP)}px`, top: `${String(position?.top ?? EDGE_GAP)}px` }}
    >
      <div
        className="dsh-fnos-logpanel-head"
        data-dragging={drag !== undefined}
        onPointerDown={startDrag}
      >
        {/* 功能图标：告诉用户这是哪类任务。 */}
        <span className="dsh-fnos-logpanel-glyph" aria-hidden="true">
          <IconifyIcon name={LOG_ICON} />
        </span>
        <div className="dsh-fnos-logpanel-titles">
          <DshTooltip content={task.title}>
            <span className="dsh-fnos-logpanel-title">{task.title}</span>
          </DshTooltip>
          {/*
            状态用**一个圆点**表示，不写文字。
            圆点旁保留 `role="status"` 的无障碍名称：视觉上省掉一行字，读屏仍能听到。
          */}
          <span className="dsh-fnos-logpanel-status" data-status={task.status} role="status">
            <span className="dsh-fnos-logpanel-dot" data-status={task.status} aria-hidden="true" />
            <span className="dsh-fnos-logpanel-sr">{t(statusKey)}</span>
          </span>
        </div>
        <div className="dsh-fnos-logpanel-actions">
          <DshTooltip content={t('logPanelCollapse')}>
            <DshIconButton
              size="small"
              theme="borderless"
              icon={<DshIconMinus aria-hidden="true" />}
              aria-label={t('logPanelCollapse')}
              onClick={() => { logPanelStore.collapse() }}
            />
          </DshTooltip>
          {task.status === 'failed'
            ? (
              <DshTooltip content={t('logPanelRetry')}>
                <DshIconButton
                  size="small"
                  theme="borderless"
                  icon={<DshIconRefresh aria-hidden="true" />}
                  aria-label={t('logPanelRetry')}
                />
              </DshTooltip>
            )
            : null}
          <DshTooltip content={t('logPanelClose')}>
            <DshIconButton
              size="small"
              theme="borderless"
              icon={<DshIconClose aria-hidden="true" />}
              aria-label={t('logPanelClose')}
              onClick={() => { logPanelStore.close() }}
            />
          </DshTooltip>
        </div>
      </div>

      <div
        ref={listRef}
        className="dsh-fnos-logpanel-body"
        role="log"
        aria-live="polite"
        style={{ height: `${String(LOG_HEIGHT)}px` }}
        onScroll={onScroll}
      >
        {task.lines.length === 0
          ? (
            /* 空态用转圈而不是「等待输出…」文字：还没输出是**进行中**的表达，
               转圈本身就说明「在等」，话术反而要在多语言里各写一遍。 */
            <div className="dsh-fnos-logpanel-empty" role="status">
              <DshSpin size="small" />
            </div>
          )
          : task.lines.map((line: TaskLogLine) => (
            <div key={line.seq} className={`dsh-fnos-logpanel-line dsh-fnos-logpanel-line--${line.level}`}>
              <span className="dsh-fnos-logpanel-time">{clock(line.at)}</span>
              <span className="dsh-fnos-logpanel-text">{line.text}</span>
            </div>
          ))}
      </div>

      {/*
        失败时**不再加一条底部提示**。

        它会额外占掉 45px，让整卡高度从 373 跳到 418——而「高度固定」正是这轮的
        要求。状态已由头部圆点（红色 + 无障碍名称「失败」）表达，重试按钮移到
        头部操作区，整卡高度因此恒为「头部 + 日志区 + 演示页脚」。
      */}
    </div>,
    document.body,
  )
}

/** 标签在视口中的位置（px）。拖动时两轴都跟手。 */
interface TabPosition {
  readonly x: number
  readonly y: number
}

/** 一次拖动会话的状态。`moved` 在位移超过阈值后置真，用于区分点击与拖动。 */
interface DragState {
  readonly startX: number
  readonly startY: number
  readonly originX: number
  readonly originY: number
  moved: boolean
}

/**
 * 收起态的吸附标签：可在整个界面上自由拖动，松手后自动吸回最近的侧边。
 *
 * ## 为什么是侧边竖条
 *
 * 收起态的含义是「我暂时不想看，但随时能拿回来」。漂浮在页面中间的按钮会挡住
 * 内容、又没有「停靠」的语义；贴边的竖条占住屏幕边缘这条天然空带，不压正文，
 * 读起来像「收进抽屉」而不是「多了一个按钮」。
 *
 * ## 拖动为什么自己写
 *
 * 需求是「自由拖动 + 松手贴边 + 松手回弹」。现成库（`react-draggable` 等）只给
 * 位移，贴边判定、换边重排与回弹补间仍要自己写；而回弹正好交给 GSAP——它是本插件
 * 的已有依赖（浮层进场动画在用），不额外引库。
 *
 * ## 位置如何跨重挂载保持
 *
 * 收起 → 展开 → 再收起时组件整棵重挂载，`useState` 会回到初值。因此停靠侧与
 * 纵向比例记在**模块级变量**里；纵向存比例而非绝对像素，窗口高度变化后标签
 * 仍落在用户放置的相对位置。
 * @param props - 组合后的 props。
 * @param props.wide - 保留给注册契约（本组件不使用）。
 * @param props.t - 翻译函数。
 * @returns 吸附标签（非收起态不渲染）。
 */
export function LogFeedbackAnchor({ t }: { readonly wide?: boolean, readonly t: Translate }): React.ReactNode {
  const state = useLogPanelState(logPanelStore)
  const [docked, setDocked] = useState<DockedSide>(() => dockedSide)
  const [pos, setPos] = useState<TabPosition>(() => tabPosition())
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  /** 拖动状态放在 ref 里给 window 监听读，避免因 state 变化反复重挂监听。 */
  const dragRef = useRef<DragState | undefined>(undefined)
  /** 当前位置的镜像，供事件处理器同步读取（state 在回调里是旧值）。 */
  const posRef = useRef(pos)
  posRef.current = pos

  const collapsed = state.mode === 'collapsed'

  /*
    停靠侧变化时把位置拉回该侧的停靠位。

    **不用 effect 同步 setState**：那会在挂载后立刻触发一次额外渲染（lint 的
    `react/set-state-in-effect` 正是针对这一点）。改为在渲染期比较「上次停靠侧」，
    发现变化才在同一次渲染里落位——React 允许渲染期调整自己组件的 state，
    只要它是幂等的（这里由 `lastDockRef` 保证只调整一次）。
  */
  const lastDockRef = useRef<DockedSide>(docked)
  if (lastDockRef.current !== docked) {
    lastDockRef.current = docked
    setPos(tabPosition())
  }

  useEffect(() => {
    if (!collapsed) return
    const onResize = (): void => { setPos(tabPosition()) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [collapsed])

  /**
   * 指针按下：记录起点，但**不**立即开始拖动。
   * @param event - 指针事件。
   */
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    /* 阻断原生拖拽与文本选区；冒泡保持开启，window 的 capture 监听不依赖它。 */
    event.preventDefault()
    /*
      按下瞬间把「贴边点」换算成「中心点」，因为拖动期元素以中心对齐。

      不换算的话，右贴时 `left = innerWidth`、元素实际右边缘在屏外，一按下
      标签就会瞬移到屏幕外，手感突兀。
    */
    const rect = ref.current?.getBoundingClientRect()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect === undefined ? posRef.current.x : rect.left + rect.width / 2,
      originY: rect === undefined ? posRef.current.y : rect.top + rect.height / 2,
      moved: false,
    }
    setDragging(true)
  }, [])

  /**
   * 拖动会话：**capture 阶段**挂在 window 上。
   *
   * ## 为什么必须是 capture
   *
   * 曾用默认冒泡阶段，并在按钮上写了 `onPointerUp={e => e.stopPropagation()}`。
   * React 的事件委托挂在根容器上，那个 `stopPropagation` 会让原生 `pointerup`
   * 到不了 `window`——于是本回调永不执行：`dragRef` 不清、`suppressClickRef`
   * 不置位，浏览器随后补发的 `click` 就照常展开浮层，表现为「一拖就弹出来」。
   *
   * capture 阶段在目标元素之前触发，任何冒泡期的 `stopPropagation` 都影响不到它。
   *
   * ## 为什么决策放在这里而不是 `click`
   *
   * 「拖动」与「点击」由**位移**区分，而位移只有本回调知道。把判断留在 `click`
   * 里就得跨回调传状态，正是上一版出错的根源。现在 `pointerup` 直接决定：
   * 没移动 → 展开；移动过 → 吸附贴边。`click` 只保留键盘通路。
   */
  useEffect(() => {
    if (!dragging) return

    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (drag === undefined) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true
      const rect = ref.current?.getBoundingClientRect()
      const height = rect?.height ?? 0
      const width = rect?.width ?? 0
      /*
        拖动期间元素用 `translate(-50%, -50%)`（见 CSS 的 `data-dragging`），
        所以 `left`/`top` 是**中心点**。夹取范围按中心点算，保证整块标签不出屏。
      */
      setPos({
        x: Math.min(Math.max(width / 2, drag.originX + dx), Math.max(width / 2, window.innerWidth - width / 2)),
        y: Math.min(Math.max(height / 2, drag.originY + dy), Math.max(height / 2, window.innerHeight - height / 2)),
      })
    }

    const onUp = (event: PointerEvent): void => {
      const drag = dragRef.current
      dragRef.current = undefined
      setDragging(false)
      if (drag === undefined) return

      /* 没移动：这是一次点击，展开浮层。 */
      if (!drag.moved) {
        logPanelStore.expand()
        return
      }

      /* 移动过：按指针位置决定停靠侧，并回弹贴边。 */
      const side: DockedSide = event.clientX < window.innerWidth / 2 ? 'left' : 'right'
      const height = ref.current?.getBoundingClientRect().height ?? 0
      const usable = Math.max(1, window.innerHeight - height)
      dockedSide = side
      dockedRatio = Math.min(Math.max(0, posRef.current.y / usable), 1)
      setDocked(side)

      const target = tabPosition()

      /*
        回弹：**驱动 CSS 变量而不是内联 transform**。

        `transform` 里已经有 `data-side` 决定的贴边偏移（左贴 `0`、右贴 `-100%`）。
        GSAP 若直接写内联 `transform`，会把那一段一起覆盖，标签瞬间跑到屏外。
        因此动画只改 `--dsh-fnos-snap-x`，由 `translateX(var(...))` 叠加位移；
        结束后该值归 0，贴边定位始终由 `data-side` 掌握。
      */
      setPos(target)
      const element = ref.current
      if (element === null) return
      const from = posRef.current.x - target.x
      gsap.killTweensOf(element)
      gsap.fromTo(element,
        { '--dsh-fnos-snap-x': `${String(from)}px` },
        {
          '--dsh-fnos-snap-x': '0px',
          duration: 0.32,
          ease: 'power3.out',
          onComplete: () => { gsap.set(element, { '--dsh-fnos-snap-x': '0px' }) },
        },
      )
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [dragging])

  if (!collapsed) return null

  const failed = state.task?.status === 'failed'
  /*
    吸附标签用**固定的日志图标**，不跟任务类型走。

    曾让它跟随卡片头部（安装=下载、修复=扳手）。但收起态只有一个 34px 宽的
    竖条，用户扫一眼要认出的是「这是日志」，不是「上一次跑的是哪类任务」——
    跟着任务换图标后，修复任务的扳手看起来像个工具面板入口，反而认不出它是
    日志。「哪类任务」由展开后的卡片头部表达就够了。
  */
  const icon: UsedIconName = LOG_ICON

  /* 与浮层同理：portal 到 `body` 直下，否则 `z-index` 出不了槽位那一层。 */
  return createPortal(
    /*
      收起态不挂 Tooltip。它是个「点一下就回来」的把手：文字已经竖排写着
      「任务日志」，悬浮再弹一个「展开任务日志」既是重复信息，又会盖住标签
      本身——深色页面上尤其明显。
    */
    <button
        ref={ref}
        type="button"
        className="dsh-fnos-loganchor"
        data-side={docked}
        data-dragging={dragging}
        data-tone={failed ? 'error' : 'normal'}
        aria-label={t('logPanelExpand')}
        /* `left`/`top` 是中心点，`translate(-50%,-50%)` 把它换算成元素对齐。 */
        style={{ left: `${String(pos.x)}px`, top: `${String(pos.y)}px` }}
        onPointerDown={onPointerDown}
        onClick={(event) => {
          /*
            指针产生的 click **一律忽略**：展开已在 `pointerup` 里按位移判定过，
            这里再处理会变成「同一个意图执行两次」。
            只有键盘触发的 click（`detail === 0`）才走展开，保证 Enter / Space 可用。
          */
          event.preventDefault()
          if (event.detail === 0) logPanelStore.expand()
        }}
      >
        <span className="dsh-fnos-loganchor-glyph" aria-hidden="true">
          <IconifyIcon name={icon} />
        </span>
        <span className="dsh-fnos-loganchor-text">{t('logPanelTitle')}</span>
        {failed ? <span className="dsh-fnos-loganchor-dot" data-tone="error" aria-hidden="true" /> : null}
    </button>,
    document.body,
  )
}

/** 供注册处复用的 store 引用。 */
export { logPanelStore }
