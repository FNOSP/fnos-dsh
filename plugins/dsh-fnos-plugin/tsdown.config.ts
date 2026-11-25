import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { dshSemiClientDeps } from '../../packages/dsh-semi-ui/tsdown-client-deps.ts'

const PLUGIN_ID = '@tnnevol/dsh-fnos'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

async function inlineClientStyles(config: { cwd: string }): Promise<void> {
  const clientPath = join(config.cwd, 'lib', 'client.js')
  const stylePath = join(config.cwd, 'lib', 'style.css')
  let client = ''
  let styles = ''
  try {
    client = await readFile(clientPath, 'utf8')
    styles = await readFile(stylePath, 'utf8')
  } catch {
    // The node build runs before the client build and has no client CSS yet.
    return
  }
  const importStatement = "import './style.css';\n"
  if (!client.startsWith(importStatement)) return
  // 插件目录名，用于给 <style> 一个稳定的 id（去重的依据）。
  const cwdName = String(config.cwd).split(/[\\/]/u).pop() ?? 'plugin'
  /*
    注入样式时**必须去重，并保证卸载时移除**。

    ## 为什么

    插件会被反复加载（热更新、禁用再启用、切换 profile），而早前的写法是
    「无条件 `document.head.append(style)`」：

    - 每加载一次就多一份 **254KB** 的 `<style>`，页面里能堆出好几份完全相同的
      Semi 样式；浏览器的样式匹配因此变慢，DevTools 里看到的也是一堆重复规则。
    - 多个插件各自带一份 Semi 样式时更明显（本仓库 6 个插件都内联了 Semi）。

    ## 做法

    1. 用**固定 id** 定位自己那份样式，存在就复用（不重复插入）。
    2. 把 `dispose` 挂到模块的导出上，宿主卸载插件时调用它移除标签——这样
       「禁用再启用」不会累积。
  */
  /*
    注入样式：**`<style>` 直接 append 到 head 末尾**。

    ## 两个约束

    1. **不重复**：插件会被反复加载（热更新、禁用再启用、切 profile）。用固定 id
       定位自己那份，存在就更新内容，不重复插入。
    2. **顺序**：CSS 同一优先级下后出现的规则胜出。我们的覆盖必须晚于组件库默认
       样式，而插件加载顺序不确定——单靠「谁后 append 谁靠后」等于靠运气。

    ## 为什么不用容器

    早前把所有插件样式塞进一个 `<div hidden>` 容器，再把容器保持在 head 末尾。
    但那在 `<head>` 里放了一个非语义元素：HTML 规范只允许 metadata content，
    `<div>` 会被浏览器校验工具与无障碍检查标出来，没有任何正当理由。

    改为**直接操作 `<style>` 元素**：

    - 需要提高优先级时，用 DOM 操作把 `<style>` append 到 `head` 即可（后出现的
      规则胜出）——这正是「权重」在 CSS 里的原生表达，不需要容器这一层；
    - 用 `MutationObserver` 盯着 `head`：被后来的样式挤到前面时，把自己的
      `<style>` 重新 append 回末尾。

    于是「自定义样式恒在组件库默认之后」仍是持续成立的约定，而 head 里只有合法的
    `<style>` 元素。
  */
  const styleLoader = [
    '(() => {',
    "  if (typeof document === 'undefined') return;",
    '  const ID = ' + JSON.stringify('dsh-plugin-style-' + cwdName) + ';',
    '  const CSS = ' + JSON.stringify(styles) + ';',
    '',
    '  const ensureStyle = () => {',
    '    let style = document.getElementById(ID);',
    '    if (style === null) {',
    "      style = document.createElement('style');",
    '      style.id = ID;',
    '      style.dataset.dshPluginStyle = ID;',
    '      style.textContent = CSS;',
    '    }',
    '    /*',
    '      必须在 head 末尾：我们的规则才会晚于组件库默认样式。',
    '      用 append（DOM 操作）而不是提高选择器特异性——这是 CSS 原生的',
    '      「后出现者胜出」，语义最直接。',
    '    */',
    '    if (document.head.lastElementChild !== style) document.head.append(style);',
    '    /*',
    '      别的插件/组件库之后可能再往 head 追加样式，把我们挤到前面。',
    '      用 MutationObserver 盯着，被挤走就挪回末尾——顺序要**持续成立**。',
    '    */',
    '    if (style.dataset.watching !== "1") {',
    '      style.dataset.watching = "1";',
    '      /* 只在真被挤走时才动：无条件的 append 会自触发成死循环。 */',
    '      new MutationObserver(() => {',
    '        const live = document.getElementById(ID);',
    '        if (live === null) return;',
    '        if (document.head.lastElementChild !== live) document.head.append(live);',
    '      }).observe(document.head, { childList: true });',
    '    }',
    '    return style;',
    '  };',
    '',
    '  const style = document.getElementById(ID);',
    '  if (style !== null) { style.textContent = CSS; ensureStyle(); return; }',
    '  ensureStyle();',
    '',
    '  // 卸载时移除，避免「禁用再启用」累积。',
    '  if (typeof module !== "undefined" && module.exports !== undefined) {',
    '    module.exports.__disposeStyle = () => { document.getElementById(ID)?.remove(); };',
    '  }',
    '})();',
    '',
  ].join('\n')
  await writeFile(clientPath, client.replace(importStatement, styleLoader), 'utf8')
}

/**
 * Copy the plugin's bundled static resources next to the compiled host half.
 *
 * The node build uses `clean: true`, so `lib/` is wiped on every build; copying
 * here (rather than into `src/`) keeps the published artifact self-contained.
 * `src/host/static-assets.ts` reads them from `lib/assets/`.
 */
async function copyStaticAssets(config: { cwd: string }): Promise<void> {
  const target = join(config.cwd, 'lib', 'assets')
  await mkdir(target, { recursive: true })
  await cp(join(config.cwd, 'src', 'assets'), target, { recursive: true })
}

/**
 * 构建期只抽取「实际用到」的 Iconify 图标，生成 `src/generated/icons.ts`。
 *
 * 直接 `import '@iconify-json/lucide/icons.json'` 会把整套 1600+ 图标打进客户端
 * 产物（实测 +660KB）。这里在构建前把用到的名字挑出来写成一个小模块，打包器
 * 因此只见到这几条 body。
 *
 * 用到哪些图标由 `ICON_NAMES` 决定——它是唯一的清单，调用处只写名字。
 */
const ICON_NAMES = [
  'lucide:power',
  'lucide:refresh-cw',
  'lucide:folder',
  'lucide:folder-plus',
  'lucide:wrench',
  'lucide:activity',
  // 「运行」页的字段图标：端口、CPU、内存、磁盘、网络上下行、进程、日志。
  'lucide:plug',
  'lucide:chevron-right',
  'lucide:cpu',
  'lucide:download',
  'lucide:x',
  'lucide:circle-x',
  'lucide:circle-check',
  'lucide:loader',
  'lucide:memory-stick',
  'lucide:hard-drive',
  'lucide:arrow-down',
  'lucide:arrow-up',
  'lucide:list-tree',
  'lucide:scroll-text',
  'lucide:route',
  'lucide:blocks',
  'lucide:trash',
  // 侧栏底部入口的下拉菜单：「设置」一行。
  'lucide:settings',
] as const

async function generateIcons(): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  // 钩子传入的 cwd 实测为空，因此以本配置文件所在目录为基准解析路径。
  const root = fileURLToPath(new URL('.', import.meta.url))
  const setPath = join(root, 'node_modules', '@iconify-json', 'lucide', 'icons.json')
  const data = JSON.parse(await readFile(setPath, 'utf8')) as {
    width?: number
    height?: number
    icons: Record<string, { body: string } | undefined>
  }
  const picked: Record<string, { body: string }> = {}
  for (const name of ICON_NAMES) {
    const key = name.slice(name.indexOf(':') + 1)
    /*
      **先查实体，再解析别名。**

      lucide 把一批名字放在 `aliases` 里（如 `trash-2` → `trash`），只查
      `data.icons` 会误报「图标集里没有」。早前写 `lucide:trash-2` 就踩了这个坑。
    */
    const alias = (data as { aliases?: Record<string, { parent?: string } | undefined> }).aliases?.[key]
    const resolved = data.icons[key] ?? (alias?.parent === undefined ? undefined : data.icons[alias.parent])
    if (resolved === undefined) throw new Error(`图标集里没有 ${name}（也不是可解析的别名）`)
    picked[name] = { body: resolved.body }
  }
  const target = join(root, 'src', 'generated', 'icons.ts')
  await mkdir(join(root, 'src', 'generated'), { recursive: true })
  const source = [
    '/**',
    ' * 由 `tsdown.config.ts` 在构建前生成，请勿手改。',
    ' *',
    ' * 只含本插件实际用到的 Iconify 图标：整套 lucide 会让客户端产物多 660KB。',
    ' * 需要新图标时改构建配置里的 `ICON_NAMES`，重跑构建即可。',
    ' */',
    '',
    `export const ICON_BOX = { width: ${String(data.width ?? 24)}, height: ${String(data.height ?? 24)} } as const`,
    '',
    'export const ICON_BODIES: Record<string, string> = {',
    ...Object.entries(picked).map(([name, icon]) => `  ${JSON.stringify(name)}: ${JSON.stringify(icon.body)},`),
    '}',
    '',
  ].join('\n')
  await writeFile(target, source, 'utf8')
}

export default [
  {
    entry: 'src/index.ts',
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    onSuccess: copyStaticAssets,
    deps: {
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-host-webserver',
        '@deepseek-ai/dsh-settings',
        '@deepseek-ai/schemastery',
      ],
    },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    // 构建前生成按需图标模块，避免把整套图标集打进产物。
    hooks: { 'build:before': generateIcons },
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    sourcemap: false,
    deps: {
      ...dshSemiClientDeps.deps,
      /*
        ECharts 必须**打进**客户端产物，不能当外部依赖。

        宿主的模块表只提供 react / cordis / dsh-client-ui-* 那几项；`echarts` 不在其中，
        当外部依赖处理时运行时直接报
        `require("echarts/charts") missed the module table`，整个插件加载失败
        （实测真机报 "Failed to load plugins / import failed"）。

        用正则覆盖子路径：`echarts/core`、`echarts/charts` 等都要内联。
      */
      alwaysBundle: [
        ...dshSemiClientDeps.deps.alwaysBundle ?? [],
        /^echarts(?:\/|$)/u,
        /*
          `react-virtuoso` 同理，且**踩过同一个坑**。

          它不在宿主的模块表里；不显式 bundle 时产物里是
          `require("react-virtuoso")`，运行时整插件加载失败——**样式注入了、但
          `apply` 一次都没跑**，所以侧栏「飞牛 OS」入口与设置弹框全部消失。
          2026-11-25 换成 Virtuoso 时真机复现，表现为「插件还在但界面入口全没了」。
        */
        /^react-virtuoso(?:\/|$)/u,
      ],
      neverBundle: [...CLIENT_EXTERNALS],
    },
    alias: dshSemiClientDeps.alias,
    css: { inject: true, minify: true },
    onSuccess: inlineClientStyles,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
