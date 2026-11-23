import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PANEL = readFileSync(new URL('../../src/components/LogFeedbackPanel.tsx', import.meta.url), 'utf8')
const STYLE = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
const MIRROR_CARD = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
const MIRROR_HOST = readFileSync(new URL('../../src/host/npm-mirror.ts', import.meta.url), 'utf8')
const INDEX_PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
const INDEX_HOST = readFileSync(new URL('../../src/host/plugin-index-sources.ts', import.meta.url), 'utf8')
const CONTRACT2 = readFileSync(new URL('../../src/contracts/gateway-proxy-contract.ts', import.meta.url), 'utf8')
const CONTRACT = readFileSync(new URL('../../src/contracts/gateway-proxy-contract.ts', import.meta.url), 'utf8')

describe('任务日志浮层的层级', () => {
  it('浮层与吸附标签都 portal 到 body，不留在槽位里', () => {
    /*
      浮层挂在 `shell.overlay`，那层容器是 `.overlayLayer`（z-index: 20），
      相对 `body` 只算 20；官方设置弹框（Semi Modal）的 `semi-portal` 是
      `body` 直下、z-index: 1000。

      留在槽位里时 `z-index` 只在容器内部生效，写多大都出不了这一层——实测
      `elementsFromPoint` 里设置弹框压在最上面。portal 出去后才真正同级比较。
    */
    expect(PANEL).toContain("import { createPortal } from 'react-dom'")
    // 面板与标签各一次。
    const portals = PANEL.match(/createPortal\(/gu) ?? []
    expect(portals.length).toBeGreaterThanOrEqual(2)
    expect(PANEL).toContain('document.body')
  })

  it('层级取自 Semi 的公用变量，不写魔法数字', () => {
    /*
      Semi 把各层定义在 `semi-theme-default/scss/variables.scss`（`$z-modal`、
      `$z-popover`…），是编译期常量——运行时没有对应的 `--semi-z-*` 自定义属性，
      所以插件样式只能 `@use` 进来按需叠加。

      用变量而不是写死 1100：Semi 调整分层时这里自动跟上，也不会撞上 toast(1010)/
      popover(1030) 那些工具层。
    */
    expect(STYLE).toContain("@use '@douyinfe/semi-theme-default/scss/variables' as semi")
    expect(STYLE).toContain('semi.$z-modal + 100')
    // 浮层与吸附标签都引用它，不再出现 1100 字面量。
    const uses = STYLE.match(/z-index:\s*\$dsh-fnos-z-over-modal;/gu) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(2)
    expect(STYLE).not.toMatch(/z-index:\s*1100;/u)
  })
})

describe('nrm 卸载', () => {
  it('宿主实现走 npm uninstall -g，与安装共用 mirror 日志', () => {
    expect(MIRROR_HOST).toContain('export async function uninstallNrm')
    expect(MIRROR_HOST).toContain("'uninstall', '-g', 'nrm'")
    // 装与卸写同一个文件，先装后卸的记录连在一起。
    expect(MIRROR_HOST).toMatch(/installLogPath\('mirror'\)/u)
  })

  it('路由是 POST + 同源，契约与实现一致', () => {
    expect(CONTRACT).toContain("FNOS_NPM_MIRROR_UNINSTALL_ROUTE = '/plugins/dsh-fnos/npm/uninstall-nrm'")
    expect(MIRROR_HOST).toContain('nrm 卸载成功')
    expect(MIRROR_HOST).toContain('nrm 卸载失败')
  })

  it('卡片的卸载按钮只在已安装时出现', () => {
    // 未安装时没有可卸载的东西，按钮不该出现。
    expect(MIRROR_CARD).toContain('status?.available === true')
    expect(MIRROR_CARD).toContain("t('mirrorUninstall')")
    // 卸载也推进任务浮层，卡片不再显示日志框。
    expect(MIRROR_CARD).toContain('logPanelStore.beginTask')
  })
})

describe('自定义插件索引的移除', () => {
  it('宿主按规范化 URL 比对，避免「点了没删掉」', () => {
    expect(INDEX_HOST).toContain('export async function removeIndexSource')
    // 写入时可能带/不带结尾斜杠，比对要统一。
    expect(INDEX_HOST).toContain('replace(/\\/+$/u')
  })

  it('已配置的条目给移除按钮，未配置的不给', () => {
    expect(INDEX_PANEL).toContain('removeIndexSourceRemote')
    expect(INDEX_PANEL).toContain("t('remove')")
    // 原来只是个点不动的 ✓。
    expect(INDEX_PANEL).not.toContain("{configured ? '✓' : '—'}")
  })

  it('移除与添加互为逆操作，同一行按状态二选一', () => {
    /*
      只给「移除」没有「添加」，用户想加回某个源就得去别的入口找——所以每一行
      按当前状态给一个动作：已配置的移除、未配置的添加。
    */
    expect(CONTRACT).toContain("FNOS_PLUGIN_INDEX_REMOVE_ROUTE = '/plugins/dsh-fnos/plugins/index-remove'")
    expect(CONTRACT).toContain("FNOS_PLUGIN_INDEX_ADD_ROUTE = '/plugins/dsh-fnos/plugins/index-add'")
    // UI：两个分支都在。
    expect(INDEX_PANEL).toContain('addIndexSourceRemote')
    expect(INDEX_PANEL).toContain('removeIndexSourceRemote')
    // 宿主：只增删目标那一条，不动其它。
    expect(INDEX_HOST).toContain('status.configured.filter(item => normalize(item) !== target)')
    expect(INDEX_HOST).toContain('indexes: [...status.configured, url]')
  })
})

describe('耗时操作的运行态跨卸载保持', () => {
  it('三张卡片都用模块级 store，不用组件内 useState 记运行态', async () => {
    /*
      飞牛设置弹框一关，右侧内容整棵卸载；`useState` 归零后重开时按钮又变回
      「安装」，看起来像根本没执行过——而宿主侧命令可能还在跑。
    */
    const { createTaskStore } = await import('../../src/client/task-store.ts')
    const store = createTaskStore()
    store.begin('nrm')
    expect(store.getSnapshot().slots.nrm.running).toBe(true)
    store.finish('nrm', 'failed', 'boom')
    expect(store.getSnapshot().slots.nrm).toMatchObject({ running: false, outcome: 'failed', error: 'boom' })
    // 重新开始要清掉上一次的结论，否则按钮会同时显示「转圈」和「失败」。
    store.begin('nrm')
    expect(store.getSnapshot().slots.nrm.outcome).toBeUndefined()
  })

  it('三个槽互相独立', async () => {
    const { createTaskStore } = await import('../../src/client/task-store.ts')
    const store = createTaskStore()
    store.begin('nrm')
    expect(store.getSnapshot().slots['plugin-install'].running).toBe(false)
    expect(store.getSnapshot().slots.repair.running).toBe(false)
  })

  it('宿主校准：不一致才提交，避免挂载时空转一次重渲', async () => {
    const { createTaskStore } = await import('../../src/client/task-store.ts')
    const store = createTaskStore()
    let emits = 0
    store.subscribe(() => { emits += 1 })

    // 首次校准：从「空闲」到「宿主在跑」，必须提交。
    store.reconcile('plugin-install', true, undefined)
    expect(emits).toBe(1)

    // 再校准同一状态：不提交。
    store.reconcile('plugin-install', true, undefined)
    expect(emits).toBe(1)

    // 宿主已结束：提交。
    store.reconcile('plugin-install', false, 'ok')
    expect(emits).toBe(2)
  })

  it('卡片确实接入了 store，而不是留着本地状态', () => {
    const INSTALL = readFileSync(new URL('../../src/components/PluginInstallInline.tsx', import.meta.url), 'utf8')
    const REPAIR = readFileSync(new URL('../../src/components/DependencyRepairCard.tsx', import.meta.url), 'utf8')
    for (const src of [INSTALL, REPAIR, MIRROR_CARD]) {
      expect(src).toContain('useTaskSlot')
      expect(src).toContain('taskStore.')
    }
    // 安装卡片挂载时向宿主校准，否则宿主重启后按钮会永久转圈。
    expect(INSTALL).toContain('reconcileInstallSlot')
  })
})

describe('客户端统一日志', () => {
  it('一条日志同时进控制台与日志中心', () => {
    /*
      控制台保留是给开发看堆栈的；日志中心是给用户在 NAS 上排障的——那边打不开
      DevTools，只能看「日志」页。

      之前各处直接用 `console.*`，记录从未出现在日志中心。
    */
    const LOGGER = readFileSync(new URL('../../src/client/logger.ts', import.meta.url), 'utf8')
    // 控制台。
    expect(LOGGER).toContain('console.error')
    expect(LOGGER).toContain('console.warn')
    expect(LOGGER).toContain('console.debug')
    // 日志中心。
    expect(LOGGER).toContain('postTaskLog')
  })

  it('不 patch console，只转发主动调用', () => {
    /*
      第三方（Semi、React）的 console 输出量很大。全量转发会把环形缓冲冲干净，
      真正的插件日志反而被挤掉。
    */
    const LOGGER = readFileSync(new URL('../../src/client/logger.ts', import.meta.url), 'utf8')
    expect(LOGGER).not.toMatch(/console\.\w+\s*=/u)
    expect(LOGGER).not.toContain('overrideConsole')
  })

  it('客户端代码不再直接调 console', () => {
    // 直接调 console 的记录进不了日志中心，等于用户看不到。
    const files = [
      '../../src/client/index.ts',
      '../../src/client/services/open-url.ts',
      '../../src/client/services/theme-bridge.ts',
      '../../src/client/services/sdk.ts',
      '../../src/components/AuthorizedDirectoriesCard.tsx',
    ]
    for (const file of files) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src).toContain("from '")
      expect(src).not.toMatch(/^\s*console\.\w+\(/mu)
    }
  })
})

describe('已安装插件：流式查更新', () => {
  it('宿主每查完一批就推一次，不等全部完成', () => {
    /*
      每个插件一次 registry 请求。全查完再返回的话，界面要一起等最慢的那个——
      十几个插件里只要有一个超时，整屏绿标都不出现。
    */
    const UPDATES = readFileSync(new URL('../../src/host/plugin-updates.ts', import.meta.url), 'utf8')
    expect(UPDATES).toContain('export async function streamPluginUpdates')
    // 每批回调，而不是攒到最后。
    expect(UPDATES).toContain('onBatch(await Promise.all(')
    // 四路一批：既够快，也不至于把 registry 打满。
    expect(UPDATES).toContain('concurrency = 4')
  })

  it('SSE 先推本地清单再推更新批次', () => {
    // 先出清单，卡片立刻能渲染；更新结果随后逐批补。
    const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
    expect(ROUTES).toContain("emit('snapshot'")
    expect(ROUTES).toContain("emit('updates'")
    expect(ROUTES).toContain("emit('done'")
    expect(CONTRACT2).toContain("FNOS_INSTALLED_PLUGINS_UPDATES_STREAM_ROUTE = '/plugins/dsh-fnos/plugins/installed-updates-stream'")
  })

  it('进入面板就自动补查，且刷新也走流式', () => {
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    // 首屏自动查一次。
    expect(PANEL).toContain('streamInstalledPluginUpdates')
    // 刷新同样流式，不再等全量。
    expect(PANEL).toContain('await runStream().done')
    // 卸载时断开，避免一直占着宿主事件循环。
    expect(PANEL).toContain('return stop')
  })
})

describe('工具箱按钮一致性', () => {
  it('「安装」「修复」「设置」用同一套 DshButton 样式', () => {
    /*
      三者在同一列卡片里纵向排列。早前「设置」是 `size="small"` + `theme="light"`，
      另外两个是 default + solid——同一列里两种高度、两种观感。
    */
    const INDEX_PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
    const MIRROR = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
    const REPAIR = readFileSync(new URL('../../src/components/DependencyRepairCard.tsx', import.meta.url), 'utf8')
    for (const src of [INDEX_PANEL, MIRROR, REPAIR]) {
      expect(src).toContain('theme="solid"')
      /* 工具栏的按钮不带 size，用 DshButton 的默认尺寸。 */
      expect(src).not.toMatch(/theme="solid"[^>]*size="small"/u)
    }
  })
})

describe('授权目录：刷新不抖动', () => {
  it('刷新时只让按钮转圈，不把列表换成骨架屏', () => {
    /*
      之前刷新会把 `state.status` 切成 `loading`，整个列表被骨架屏替换——已经看到
      的内容闪一下消失再回来，页面高度也跟着变。

      骨架屏是「这里即将有内容」的占位，只该在**首次加载**时出现；已有内容时
      再换成占位就是纯抖动。
    */
    const CARD = readFileSync(new URL('../../src/components/AuthorizedDirectoriesCard.tsx', import.meta.url), 'utf8')
    // 独立的刷新态，与列表的 status 解耦。
    expect(CARD).toContain('const [refreshing, setRefreshing]')
    // 已就绪时不退回 loading。
    expect(CARD).toContain("current.status === 'ready'")
    // 刷新按钮按 refreshing 转圈。
    expect(CARD).toContain('data-spinning={refreshing}')

    // 动画只作用在图标上，且尊重「减少动态效果」。
    expect(STYLE).toContain("[data-spinning='true'] svg")
    expect(STYLE).toContain('prefers-reduced-motion: reduce')
  })
})
