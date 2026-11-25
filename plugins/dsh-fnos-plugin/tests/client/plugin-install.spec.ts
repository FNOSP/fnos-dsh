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
