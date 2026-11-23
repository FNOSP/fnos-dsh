import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PANEL = readFileSync(new URL('../../src/components/LogFeedbackPanel.tsx', import.meta.url), 'utf8')
const STYLE = readFileSync(new URL('../../src/styles/index.scss', import.meta.url), 'utf8')
const MIRROR_CARD = readFileSync(new URL('../../src/components/NpmMirrorCard.tsx', import.meta.url), 'utf8')
const MIRROR_HOST = readFileSync(new URL('../../src/host/npm-mirror.ts', import.meta.url), 'utf8')
const INDEX_PANEL = readFileSync(new URL('../../src/components/PluginIndexPanel.tsx', import.meta.url), 'utf8')
const INDEX_HOST = readFileSync(new URL('../../src/host/plugin-index-sources.ts', import.meta.url), 'utf8')
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

  it('样式里不再靠 z-index 硬顶，注释说明为什么', () => {
    /*
      曾经写 `z-index: 1100` 想压过弹框的 1000——不生效，因为容器那层才 20。
      留 1 只用于槽位内的相对层级；真正的解法是 portal。
    */
    const panelBlock = STYLE.slice(STYLE.indexOf('.dsh-fnos-logpanel {'))
    const body = panelBlock.slice(0, panelBlock.indexOf('}'))
    expect(body).toMatch(/z-index:\s*1;/u)
    expect(body).not.toMatch(/z-index:\s*1100;/u)
    expect(body).toContain('overlayLayer')
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

  it('路由常量已登记', () => {
    expect(CONTRACT).toContain("FNOS_PLUGIN_INDEX_REMOVE_ROUTE = '/plugins/dsh-fnos/plugins/index-remove'")
  })
})
