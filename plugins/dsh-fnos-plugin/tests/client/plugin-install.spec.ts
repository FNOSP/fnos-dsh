/*
  eslint-disable no-template-curly-in-string --
  本文件断言的是**源码里的字面量**：`await beginLog(logPath, \`卸载 ${name}\`)`
  这类模板字符串要原样出现在被测文件里。普通字符串里出现 `${...}` 是刻意的，
  不是误把模板字符串写成了单引号。
*/
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isNewerVersion } from '../../src/host/plugin-updates.ts'

/**
 * 插件安装：pnpm 调用、按基线选版本、日志流、失败回滚。
 *
 * 这里守的是几个「看起来能跑、实际会出事」的点：
 * 用 npm 会写出第二份 lockfile、装 latest 会要求更新的基线、
 * 失败不回滚会留下「声明里有、实际没装」的中间态。
 */
const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
const ROUTES = readFileSync(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')
const DIALOG = readFileSync(new URL('../../src/components/PluginInstallDialog.tsx', import.meta.url), 'utf8')

describe('插件安装：pnpm 与版本选择', () => {
  it('优先走官方 pluginManager.updateBundle', () => {
    /*
      DSH 把插件管理注册为 Cordis 服务（`ctx.pluginManager`），`updateBundle`
      覆盖了本模块曾经手写却补不全的步骤：版本校验、`--save-exact`、
      `expected` 校验、失败还原、保 `enabled` 状态、registry 回退链。

      服务取不到（旧宿主、测试环境）时退回自己拼 `dsh plugin add`，功能不消失。
    */
    expect(INSTALL).toContain('pluginManagerOf(ctx)')
    expect(INSTALL).toContain('manager.updateBundle(name, resolved.version)')
    /*
      **`updateBundle` 只处理已安装的包。**

      它先 `listBundles().find(item => item.name === name)`，找不到直接返回
      `invalid-spec`。首次安装若也走它，「安装」按钮永远失败——这正是把它接进来
      时踩到的回归。
    */
    expect(INSTALL).toContain('previouslyInstalled ? pluginManagerOf(ctx) : undefined')

    /* 回退路径仍在，且带上了此前漏掉的 `--save-exact`。 */
    expect(INSTALL).toContain("['plugin', '--profile', 'web', 'add', spec, '--save-exact']")
    // 注释里解释「为什么不再传」不算，检查的是命令参数。
    expect(INSTALL).not.toMatch(/'(add|install)'[^\]]*minimum-release-age/u)
    expect(INSTALL).not.toContain("'npm'")
    // `dsh` 靠 DSH_HOME 定位 profiles，必须显式给。
    expect(INSTALL).toContain('DSH_HOME: environment.dshHome')
  })

  it('按 DSH 基线挑版本，不装 latest', () => {
    // latest 往往要求更新的基线，装上起不来；这里复用官方判据。
    expect(INSTALL).toContain('evaluatePluginCompatibility')
    expect(INSTALL).toContain('getDshRuntimeVersion')
    expect(INSTALL).toContain('resolveInstallableVersion')
    expect(INSTALL).toContain('no-compatible-version')
  })

  it('排除预发布版本', () => {
    expect(INSTALL).toContain("!version.includes('-')")
  })

  it('失败时还原 package.json 与 lockfile', () => {
    // 否则 profile 会停在「依赖声明里有、实际没装上」的中间态。
    expect(INSTALL).toContain('backupProfile')
    expect(INSTALL).toContain('restoreProfile')
    expect(INSTALL).toContain("'package.json'")
    expect(INSTALL).toContain("'pnpm-lock.yaml'")
  })
})

describe('插件安装：日志', () => {
  it('日志按字节 offset 增量读，不每次重传整份', () => {
    expect(INSTALL).toContain('readInstallLog')
    expect(INSTALL).toContain('offset')
    expect(ROUTES).toContain('searchParams.get(\'offset\')')
  })

  it('日志有大小上限，不会无限增长', () => {
    expect(INSTALL).toContain('LOG_MAX_BYTES')
  })

  it('安装有总超时', () => {
    expect(INSTALL).toContain('INSTALL_TIMEOUT_MS')
  })
})

describe('插件安装：接口安全', () => {
  it('安装是 POST + 同源校验', () => {
    expect(ROUTES).toContain("req.method !== 'POST'")
    expect(ROUTES).toContain('remote-web-origin-not-trusted')
  })

  it('包名做白名单校验（否则能被拼成 pnpm 选项）', () => {
    // `--foo` 这类内容会被 pnpm 当成选项而不是包名。
    expect(ROUTES).toContain('invalid-plugin-name')
    expect(ROUTES).toContain('[a-z0-9-~]')
  })
})

describe('插件安装：弹框', () => {
  it('弹框展示实时日志并自动滚到底', () => {
    expect(DIALOG).toContain('LOG_POLL_MS')
    expect(DIALOG).toContain('scrollTop = element.scrollHeight')
    expect(DIALOG).toContain('dsh-fnos-install-log')
  })

  it('安装中不允许关闭（避免半途丢失结果）', () => {
    expect(DIALOG).toContain("onCancel={status === 'running' ? undefined : onClose}")
  })

  it('成功后刷新列表', () => {
    expect(DIALOG).toContain('onSettled')
  })
})

describe('版本比较（安装选版复用）', () => {
  it('仍按语义化比较', () => {
    expect(isNewerVersion('1.4.0', '1.5.0')).toBe(true)
    expect(isNewerVersion('1.5.0', '1.4.0')).toBe(false)
  })
})

describe('卸载与启用：接入官方服务但保留自保护', () => {
  it('卸载优先走官方 removeBundle', () => {
    /*
      官方 `removeBundle` 比本模块多三重校验，都是我们漏掉的：
      `not-removable`（包不归本 profile 所有）、`stop-profile`（仍是启动时加载的
      bundle）、`bundle-in-use`（贡献行正在运行）。卸载前还会先取消选中并 reload。
    */
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    expect(INSTALL).toContain('manager.removeBundle(name)')
    // 官方的 restart-required 映射到界面的 needRestart。
    expect(INSTALL).toContain("removed.application === 'restart-required'")
    // 并发锁仍在最前，官方路径也受它约束。
    expect(INSTALL).toContain("if (removingPlugins.has(name)) return { ok: false, error: 'plugin-remove-in-progress' }")
  })

  it('禁用自身仍被拒绝——官方不覆盖这条', () => {
    /*
      官方 `PROTECTED_PLUGINS` 只列它自己的插件（`dsh-plugin-manager` 等），
      **不含 `@tnnevol/dsh-fnos`**。而这个插件是应用与 DSH 之间的唯一桥梁：
      禁用后授权目录、文件打开、网关反代、进程管理全部失效，连「重新启用」这个
      动作本身也由它提供——用户没有任何入口能救回来。

      所以这个检查必须留在本模块，不能外包给官方。
    */
    const TOGGLE = readFileSync(new URL('../../src/host/plugin-toggle.ts', import.meta.url), 'utf8')
    expect(TOGGLE).toContain("if (name === SELF_PACKAGE_NAME && !enabled)")
    expect(TOGGLE).toContain("return { ok: false, error: 'management-required' }")
    // 自保护在官方调用之前——顺序反了就等于把门开在检查前面。
    const guardIndex = TOGGLE.indexOf('SELF_PACKAGE_NAME && !enabled')
    const officialIndex = TOGGLE.indexOf('setBundleEnabled(name, enabled)')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(officialIndex).toBeGreaterThan(guardIndex)
  })
})

describe('替换官方服务后日志仍完整', () => {
  it('安装/更新/卸载/启用都写宿主日志', () => {
    /*
      浮层日志来自 `fetchInstallLog` 的 offset 轮询，不是前端手写的。所以任何一个
      操作在宿主侧不写文件，浮层就只剩一句手抄文案——失败时看不到 pnpm 的实际报错。
    */
    const INSTALL = readFileSync(new URL('../../src/host/plugin-install.ts', import.meta.url), 'utf8')
    // 安装/更新：beginLog / resetLog / appendLog 都在。
    expect(INSTALL).toContain('await beginLog(logPath, `准备安装 ${name}`)')
    expect(INSTALL).toContain('await resetLog(logPath, name, resolved.version)')
    // 卸载：官方路径也要落盘，且带回 pnpm 输出。
    expect(INSTALL).toContain('await beginLog(logPath, `卸载 ${name}`)')
    expect(INSTALL).toContain('removed.packageResult?.output')
    expect(INSTALL).toContain('卸载失败：')

    // 启用/禁用：bundle 分支同样落盘。
    const TOGGLE = readFileSync(new URL('../../src/host/plugin-toggle.ts', import.meta.url), 'utf8')
    expect(TOGGLE).toContain('await beginLog(logPath, `${verb} ${name}`)')
    expect(TOGGLE).toContain('已${verb} ${name}')
  })

  it('卸载浮层读的是宿主日志，不是手写文案', () => {
    /*
      早前卸载只有前端手写的 `pnpm remove ${name}` 与「已卸载」两句：用户看到的
      **永远是成功叙事**，而真实失败原因（依赖被引用、权限、并发锁）在命令输出里。
    */
    const PANEL = readFileSync(new URL('../../src/components/InstalledPluginsPanel.tsx', import.meta.url), 'utf8')
    expect(PANEL).toContain('fetchInstallLog(offset)')
    expect(PANEL).toContain('levelOfInstallLine(line)')
    // 手写那两句已移除。
    expect(PANEL).not.toContain("logPanelStore.append('info', `pnpm remove ${name}`)")
  })

  it('日志级别判断只有一份实现', () => {
    // 三个消费者共用 `client/log-line-level.ts`；各抄一份会漂。
    const SHARED = readFileSync(new URL('../../src/client/log-line-level.ts', import.meta.url), 'utf8')
    expect(SHARED).toContain('export function levelOfInstallLine')
    for (const file of ['PluginInstallInline.tsx', 'NpmMirrorCard.tsx', 'InstalledPluginsPanel.tsx']) {
      const source = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/function levelOfInstallLine/u)
      expect(source).toContain("from '../client/log-line-level.ts'")
    }
  })
})
