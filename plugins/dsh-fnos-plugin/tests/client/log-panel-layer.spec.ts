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

    /*
      **转圈状态必须复位。**

      `setRefreshing(true)` 之后若没有 `finally { setRefreshing(false) }`，按钮
      会永远转下去——即使请求早已结束、列表也更新了。这类「漏了收尾」的 bug 在
      界面上只表现为一个不停转的图标，很难从代码里一眼看出来。
    */
    const setTrue = CARD.indexOf('setRefreshing(true)')
    expect(setTrue).toBeGreaterThan(-1)
    expect(CARD.slice(setTrue)).toContain('setRefreshing(false)')
  })
})

describe('agent skill 清理', () => {
  it('只清 trim-cli 与 fnos-cli，不动用户其它 skill', () => {
    /*
      `~/.agents/skills` 是用户的目录，应用没有资格做通用清理——只删自己曾经
      写进去的那两个。
    */
    const SKILLS = readFileSync(new URL('../../src/host/agent-skills.ts', import.meta.url), 'utf8')
    expect(SKILLS).toContain("BUNDLED_SKILL_NAMES: readonly string[] = ['trim-cli', 'fnos-cli']")
    // 删完再确认一次：`rm` 成功不代表目录真的没了。
    expect(SKILLS).toContain('directory still exists')
  })

  it('没有可清理目录时按钮置灰', () => {
    // 一个永远点得动却什么也不做的按钮，比没有按钮更让人困惑。
    const CARD = readFileSync(new URL('../../src/components/DependencyRepairCard.tsx', import.meta.url), 'utf8')
    expect(CARD).toContain('disabled={skillsTask.running || skillsPresent.length === 0}')
  })

  it('执行日志进任务浮层与运行日志中心', () => {
    // 清理是破坏性操作，必须在「日志」页留痕。
    const CARD = readFileSync(new URL('../../src/components/DependencyRepairCard.tsx', import.meta.url), 'utf8')
    expect(CARD).toContain('logPanelStore.beginTask')
    expect(CARD).toContain('logPanelStore.append')
    expect(CARD).toContain('logPanelStore.finish')
    /* 并进「修复插件安装异常」卡片，不再单独成卡。 */
    expect(CARD).toContain("t('agentSkillsTitle')")
    // 按钮与「修复」同款。
    expect(CARD).toContain("theme=\"solid\"")
    const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
    expect(ROUTES).toContain('ctx.logger.info(`[agent-skills]')
  })

  it('安装流程不写也不删这些 skill，只由工具箱处理', () => {
    const CALLBACK = readFileSync(new URL('../../../../apps/fn-deepseek-harness/cmd/install_callback', import.meta.url), 'utf8')
    /*
      `~/.agents/skills` 属于用户的 agent 环境：

      - 新装：不再写入（`install_fnos_cli_skill` 已移除）；
      - 老用户：**升级时也不删**——那是用户的目录，迁移动作要由他自己在工具箱里
        发起，不能在一次版本升级里悄悄抹掉。
    */
    expect(CALLBACK).not.toContain('install_fnos_cli_skill')
    expect(CALLBACK).not.toContain('install_trim_cli')
    expect(CALLBACK).not.toContain('remove_bundled_agent_skills')
    /* 连命令本身都不再被调用（注释里提到名字不算）。 */
    expect(CALLBACK).not.toMatch(/^\s*"?\$\{?NPM_BIN\}?"?\s+install\s+"?\$\{TRIM_CLI_PACKAGE\}/mu)
    expect(CALLBACK).not.toContain('TRIM_CLI_PACKAGE=')
    /* 注释里要留着「为什么不能加回来」，避免以后有人又好心地改回去。 */
    expect(CALLBACK).toContain('也不在')
  })
})

describe('插件安装：日志隔离与自动启用', () => {
  it('开始安装时立即清空日志，不等版本解析', () => {
    /*
      前端在卡片挂载时就开始按 offset 拉日志。若日志还留着上一次安装的内容，
      第一次拉取会把**上一个插件**的整份日志当成本次内容追加进任务浮层——实测
      表现为「只装了 fnos-cli，浮层里却有 dshmarket 的记录」。

      版本解析、备份 profile 都可能耗时几百毫秒，那段时间足够前端拉一次。
    */
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    // 一进安装流程就清，且 `beginLog` 出现在 `backupProfile` 之前。
    const begin = INSTALL.indexOf('await beginLog(logPath')
    const backup = INSTALL.indexOf('await backupProfile(profile)')
    expect(begin).toBeGreaterThan(-1)
    expect(backup).toBeGreaterThan(-1)
    expect(begin).toBeLessThan(backup)
  })

  it('bundle 型插件装完自动启用，与官方一致', () => {
    /*
      官方 `plugin-manager` 装完就 `bundles.push(name)`。漏掉这一步，用户会看到
      「安装成功」但卡片上是「已禁用」，还得手动再点一次开关——而他刚刚做的就是
      「安装」，意图已经很明确。
    */
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(INSTALL).toContain('async function activateBundleIfDeclared')
    expect(INSTALL).toContain('await activateBundleIfDeclared(profile, name)')
    // 只对声明了 `dsh.bundle.patch` 的包动手：普通依赖加进 bundles 没有意义。
    expect(INSTALL).toContain("typeof packageManifest.dsh?.bundle?.patch !== 'string'")
  })
})

describe('插件卸载：日志与确认按钮', () => {
  it('卸载走任务浮层，失败原因写到日志', () => {
    /*
      卸载要跑 `pnpm remove` 并改 profile。失败原因（依赖被别的插件引用、权限、
      并发锁）只能从命令输出里看出来；不给日志的话用户只看到一句「卸载失败」。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("taskStore.begin('plugin-remove', name)")
    expect(PANEL).toContain('logPanelStore.beginTask')
    expect(PANEL).toContain("logPanelStore.append('error', message)")
    expect(PANEL).toContain('logPanelStore.finish')
  })
})

describe('依赖修复：不绕过供应链防护', () => {
  it('clean / install 都不带 minimum-release-age=0', () => {
    /*
      那个参数会绕过 pnpm 的发布冷静期（供应链防护）。修复的职责是把安装环境
      重置回可解析状态，不是替用户绕过安全策略。

      真装上了刚发布几分钟的包，风险由谁担？冷静期存在本身就是为了防投毒。
    */
    const REPAIR = readFileSync(new URL('../../src/host/dependency-repair.ts', import.meta.url), 'utf8')
    // 注释里解释「为什么不传」不算，检查的是命令参数。
    expect(REPAIR).toContain("run(pnpmBin, ['clean', '--lockfile']")
    expect(REPAIR).toContain("run(pnpmBin, ['install']")
    expect(REPAIR).not.toMatch(/run\(pnpmBin, \[[^\]]*minimum-release-age/u)
  })
})

describe('日志时间格式', () => {
  it('日志页与浮层都显示完整年月日时分秒', () => {
    /*
      日志跨重启、跨天都可能留着，只有 `HH:mm:ss` 时用户看不出某条是今天还是
      上周的——排查「刚才那次安装」时会把旧记录当成新的。

      走 `dayjs` 而不是 `toLocaleTimeString`：后者依赖运行时 locale，不同设备的
      补零与分隔符可能不同，列宽随之跳动。
    */
    for (const file of [
      '../../src/components/RuntimeLogPanel.tsx',
      '../../src/components/LogFeedbackPanel.tsx',
    ]) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src).toContain("dayjs(at).format('YYYY-MM-DD HH:mm:ss')")
      // 不再用运行时 locale 格式化（注释里解释「为什么不用」不算）。
      expect(src).not.toMatch(/new Date\([^)]*\)\.toLocaleTimeString/u)
    }
  })
})

describe('agent skill 清理：确认框给出绝对路径', () => {
  it('列出语义化后的完整路径，不只给目录名', () => {
    /*
      `fnos-cli` 这个名字看不出它在哪块存储、哪个账号下。这是不可撤销的删除，
      用户有权在按下确定之前看清到底删哪个位置。

      语义化形式（`存储空间2/...`）由宿主经 `trim.file.convertPath` 给出，
      拿不到时退回内部路径。
    */
    const SKILLS = readFileSync(new URL('../../src/host/agent-skills.ts', import.meta.url), 'utf8')
    expect(SKILLS).toContain('convertPathsForDisplay')
    expect(SKILLS).toContain('displayPath')
    // 语义化失败不能让整个状态读不出来。
    expect(SKILLS).toContain('/* 保持退回值。 */')

    const CARD = readFileSync(new URL('../../src/components/DependencyRepairCard.tsx', import.meta.url), 'utf8')
    expect(CARD).toContain('skills?.entries')
    expect(CARD).toContain('item.displayPath')
  })
})


describe('已安装插件：操作状态跨弹框保持', () => {
  it('三个「正在操作谁」都存在 taskStore，不用组件内 state', () => {
    /*
      弹框关闭会卸载整个面板，组件 state 随之消失：用户重新打开时看到正在切换的
      开关「复位」、或正在卸载的卡片恢复可点，与宿主真实状态不一致。

      store 在模块作用域里，重开面板仍能读到。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("useTaskSlot('plugin-install')")
    expect(PANEL).toContain("useTaskSlot('plugin-toggle')")
    expect(PANEL).toContain("useTaskSlot('plugin-remove')")
    // 不再有这三个组件内 state（错误消息仍用 state，那个不需要跨弹框保持）。
    expect(PANEL).not.toContain('const [installing, setInstalling]')
    expect(PANEL).not.toContain('const [toggling, setToggling]')
    expect(PANEL).not.toContain('const [removingName, setRemovingName]')
    expect(PANEL).not.toContain('setToggling')
    expect(PANEL).not.toContain('setRemovingName')
    expect(PANEL).not.toContain('setInstalling')

    const STORE = readFileSync(new URL('../../src/client/task-store.ts', import.meta.url), 'utf8')
    /* 槽位要能说出「正在操作谁」。 */
    expect(STORE).toContain('readonly target: string | undefined')
    expect(STORE).toContain("| 'plugin-toggle'")
  })

  it('失败写 failed，不只写 ok', () => {
    // 开关切换原来在 `finally` 里无条件写 ok，失败也报成功。
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain("taskStore.finish('plugin-toggle', 'failed', message)")
  })
})

describe('更新插件：保持状态、正确标题、正确收尾', () => {
  it('更新不自动启用，只有首次安装才加入 bundles', () => {
    /*
      更新时用户已经表过态（他把开关关着），此时再自动启用等于推翻他的选择。
      「装」隐含「我要用它」，所以只有首次安装才该自动开。
    */
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(INSTALL).toContain('async function isDeclaredDependency')
    expect(INSTALL).toContain('if (previouslyInstalled) {')
    // 更新分支只记日志，不动 bundles。
    expect(INSTALL).toContain('保留原有启用状态')
    // 自动启用只在 else 分支。
    const idx = INSTALL.indexOf('if (previouslyInstalled) {')
    const activated = INSTALL.indexOf('activateBundleIfDeclared(profile, name)', idx)
    expect(activated).toBeGreaterThan(idx)
  })

  it('任务标题按安装/更新区分', () => {
    const INLINE = readFileSync(new URL('../../src/components/PluginInstallInline.tsx', import.meta.url), 'utf8')
    expect(INLINE).toContain("t(isUpdate ? 'pluginUpdateTask' : 'pluginInstallTask')")
    expect(INLINE).toContain('readonly isUpdate: boolean')
  })

  it('组件卸载也要写收尾状态，浮层不能永久停在执行中', () => {
    /*
      组件可能在安装期间被卸载（用户关掉弹框）。此前 `cancelled` 为真就整个
      return——`logPanelStore.finish()` 也被跳过，于是浮层永远停在蓝色脉冲点，
      即便日志里早已写着「安装成功」。

      浮层与 taskStore 都在模块作用域里，卸载后仍可安全写入。
    */
    const INLINE = readFileSync(new URL('../../src/components/PluginInstallInline.tsx', import.meta.url), 'utf8')
    const thenBlock = INLINE.slice(INLINE.indexOf('startPluginInstall(name).then'), INLINE.indexOf('.catch((cause'))
    // finish 在 cancelled 判断之前，且不受它控制。
    expect(thenBlock).toContain("logPanelStore.finish(ok ? 'ok' : 'failed')")
    expect(thenBlock).toContain('if (!cancelled) onSettled(ok)')
    expect(thenBlock).not.toMatch(/if \(cancelled\) return[\s\S]*logPanelStore\.finish/u)
  })
})
