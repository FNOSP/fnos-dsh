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
    注入样式：**固定容器 + 容器常驻 head 末尾**。

    ## 两个必须解决的问题

    1. **重复**：插件会被反复加载（热更新、禁用再启用、切 profile）。无条件
       `head.append(style)` 每加载一次就多一份 250KB 样式；本仓库多个插件还各自
       内联了整份 Semi——实测一个页面堆出 4 份、合计约 107 万字符。
    2. **顺序**：CSS 同一优先级下后出现的规则胜出。我们的覆盖规则必须晚于组件库
       默认样式，但**插件加载顺序不确定**，靠 `head.append` 等于靠运气。

    ## 做法

    所有插件样式进同一个容器 `<div data-dsh-plugin-styles>`，容器**常驻 `head`
    的最后一个元素**。注入时若容器被别的样式挤到前面，就挪回末尾。

    于是「自定义样式恒在组件库默认之后」成为可依赖的约定，不需要堆 `!important`。
    详见 `docs/charter/plugin-ui-standards.md` 的「样式注入顺序」。
  */
  const styleLoader = [
    '(() => {',
    "  if (typeof document === 'undefined') return;",
    "  const ID = " + JSON.stringify('dsh-plugin-style-' + cwdName) + ";",
    "  const CSS = " + JSON.stringify(styles) + ";",
    "  const CONTAINER_ID = 'dsh-plugin-styles';",
    '',
    '  const ensureContainer = () => {',
    '    let container = document.getElementById(CONTAINER_ID);',
    '    if (container === null) {',
    "      container = document.createElement('div');",
    '      container.id = CONTAINER_ID;',
    '      container.hidden = true;',
    '    }',
    '    // 必须始终是 head 的最后一个元素：我们的规则才会晚于组件库默认样式。',
    '    if (document.head.lastElementChild !== container) document.head.append(container);',
    '    /*',
    '      别的插件/组件库可能在之后又往 head 追加样式，把容器挤到前面。',
    '      用 MutationObserver 盯着，被挤走就挪回末尾——顺序必须是**持续成立**的',
    '      约定，不能只在注入那一刻成立。',
    '    */',
    '    if (container.dataset.watching !== "1") {',
    '      container.dataset.watching = "1";',
    '      const keepLast = () => {',
    '        const live = document.getElementById(CONTAINER_ID);',
    '        if (live !== null && document.head.lastElementChild !== live) document.head.append(live);',
    '      };',
    '      new MutationObserver(keepLast).observe(document.head, { childList: true });',
    '    }',
    '    return container;',
    '  };',
    '',
    '  const existing = document.getElementById(ID);',
    '  if (existing !== null) { existing.textContent = CSS; ensureContainer(); return; }',
    '',
    "  const style = document.createElement('style');",
    '  style.id = ID;',
    "  style.dataset.dshPluginStyle = ID;",
    '  style.textContent = CSS;',
    '  ensureContainer().append(style);',
    '',
    '  // 卸载时移除，避免「禁用再启用」累积。',
    '  if (typeof module !== "undefined" && module.exports !== undefined) {',
    '    module.exports.__disposeStyle = () => {',
    '      document.getElementById(ID)?.remove();',
    '      const box = document.getElementById(CONTAINER_ID);',
    '      if (box !== null && box.childElementCount === 0) box.remove();',
    '    };',
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
      alwaysBundle: [...dshSemiClientDeps.deps.alwaysBundle ?? [], /^echarts(?:\/|$)/u],
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
