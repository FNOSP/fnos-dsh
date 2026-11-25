/* eslint-disable no-new-func -- bundle tests intentionally evaluate generated browser artifacts in a sandbox. */
import { readFileSync } from 'node:fs'
import * as React from 'react'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import { describe, expect, it } from 'vitest'

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

describe('dsh-fnos client artifact', () => {
  it('registers the scoped ModuleLoader factory with the bundled theme bridge', () => {
    const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
    let handoff: Handoff | undefined
    const browserWindow = {
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: { load(value: Handoff) { handoff = value } },
    } as unknown as Window
    Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow })
    new Function(source)()
    expect(handoff?.id).toBe('@tnnevol/dsh-fnos')
    expect(source).toContain('sdk.$on("os/theme"')
    expect(source).toContain('getPlatformConfig')
    expect(source).toContain('const fnosTheme = bridge.getTheme()')
    expect(source).toContain('fnOS path opener')
    expect(source).toContain('openFile')
    expect(source).not.toContain('/app/fn-deepseek-harness/trim-web-app.js')
    expect(source).not.toContain('__DSH_FNOS_THEME_BRIDGE__')
    // Semi TreeSelect bundles its own timer utilities. Check the plugin
    // sources for the no-polling contract instead of scanning third-party UI
    // code that is intentionally included in the client artifact.
    const pluginSource = [
      'src/client/index.ts',
      'src/client/services/theme-bridge.ts',
      'src/client/services/sdk.ts',
      'src/components/FnosAuthorizedPathPicker.tsx',
    ].map(path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')).join('\n')
    expect(pluginSource).toContain('useInput((state: InputState) => state)')
    expect(pluginSource).not.toContain('setInterval')
    expect(pluginSource).not.toContain('visibilitychange')
    const primitives = {
      IconBrowseOutline16: () => null,
      IconFolderOpen16: () => null,
    }
    const jsxRuntime = { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    const exports = handoff?.factory(specifier => {
      if (specifier === 'react') return React
      if (specifier === 'react/jsx-runtime') return jsxRuntime
      if (specifier === 'react-dom') return ReactDom
      if (specifier === 'react-dom/client') return ReactDomClient
      if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      /*
        ECharts 由 `RuntimeStatusCard` 按需引入（core/charts/components/renderers）。
        这个用例只验证「产物能被加载并暴露 apply」，不渲染图表，因此给最小桩：
        `use` 是注册图表类型的空操作，`init` 返回一个空壳实例。
      */
      if (specifier === 'echarts/core') {
        // `use` 是 ECharts 的注册图表类型的函数，不是 React Hook；规则按名字误判。
        return {
          // eslint-disable-next-line react/no-unnecessary-use-prefix
          use: () => undefined,
          init: () => ({ setOption: () => undefined, resize: () => undefined, dispose: () => undefined }),
        }
      }
      if (specifier === 'echarts/charts' || specifier === 'echarts/components' || specifier === 'echarts/renderers') {
        return { LineChart: () => null, GridComponent: () => null, TooltipComponent: () => null, CanvasRenderer: () => null }
      }
      /*
        Semi 的空状态插画：`Empty` 通过 `image` / `darkModeImage` 接收它们。
        这个用例不渲染组件，只要模块能解析、导出存在即可，所以给空组件。
      */
      if (specifier.startsWith('@douyinfe/semi-illustrations')) {
        return new Proxy({}, { get: () => () => null })
      }
      /*
        虚拟化列表：`Virtuoso` 是运行期渲染的组件，这个用例只验证「产物能被加载并
        暴露 apply」，不渲染列表，给空组件即可。
      */
      if (specifier === 'react-virtuoso') {
        return { Virtuoso: () => null }
      }
      throw new Error(`unexpected client external: ${specifier}`)
    })
    expect(typeof exports?.apply).toBe('function')
    expect(exports?.name).toBe('dsh-fnos-plugin-client')
  })
})

describe('第三方依赖必须内联', () => {
  it('产物里不出现 require(第三方包)，否则整插件加载失败', () => {
    /*
      宿主的 client 模块表只提供 react / cordis / dsh-client-ui-* 那几项。任何
      第三方库若被当外部依赖，产物里就是 `require("xxx")`，运行时
      `missed the module table`，**整个插件加载失败**——
      表现为「样式注入了、但 apply 一次没跑」，侧栏入口与设置弹框全部消失。

      2026-11-25 换 Virtuoso 时真机踩到：`require("react-virtuoso")` 让 fnOS 的
      全部界面入口消失。`echarts` 历史上踩过同一个坑，`alwaysBundle` 里有它的注释。

      这条断言在**产物层**兜底：只要出现已知第三方包的 require，就说明
      `alwaysBundle` 漏了它。
    */
    const clientPath = new URL('../../lib/client.js', import.meta.url)
    let source = ''
    try {
      source = readFileSync(clientPath, 'utf8')
    } catch {
      return // 未构建时跳过：这个用例验证的是产物。
    }
    // 已知需要内联的第三方包。
    for (const pkg of ['react-virtuoso', 'echarts']) {
      expect(source).not.toContain(`require("${pkg}")`)
    }
  })
})
