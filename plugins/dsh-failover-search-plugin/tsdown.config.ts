import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UserConfig } from 'tsdown'
import { dshSemiClientDeps } from '../../packages/dsh-semi-ui/tsdown-client-deps.ts'

// DSH 的客户端模块图按 npm 包名寻址，交接 id 必须与 package.json 完全一致（含 scope）。
const PLUGIN_ID = '@tnnevol/dsh-failover-search'
const PACKAGE_VERSION = (JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }).version

// 客户端半侧外置项：由宿主模块表提供，不能内联。
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

// @tnnevol/dsh-semi-ui 是 workspace 链接包：若 rolldown 按其 exports 解析出绝对路径后
// externalize，client 会残留 require("@tnnevol/dsh-semi-ui")（DSH 模块表无此包）。
// 显式 alias 到真实入口，强制与 @douyinfe 子路径一样内联。
import { fileURLToPath } from 'node:url'
const semiUiEntry = fileURLToPath(new URL('../../packages/dsh-semi-ui/lib/index.js', import.meta.url))

/** 把构建出的样式内联进 client 产物（DSH 客户端模块表不认识 CSS import）。 */
async function inlineClientStyles(config: { cwd: string }): Promise<void> {
  const clientPath = join(config.cwd, 'lib', 'client.js')
  const stylePath = join(config.cwd, 'lib', 'style.css')
  let client = ''
  let styles = ''
  try {
    client = await readFile(clientPath, 'utf8')
    styles = await readFile(stylePath, 'utf8')
  } catch {
    return
  }
  const importStatement = "import './style.css';\n"
  if (!client.startsWith(importStatement)) return
  const styleLoader = `(() => { if (typeof document === 'undefined') return; const style = document.createElement('style'); style.dataset.dshFailoverSearch = 'semi'; style.textContent = ${JSON.stringify(styles)}; document.head.append(style); })();\n`
  await writeFile(clientPath, client.replace(importStatement, styleLoader), 'utf8')
}

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    define: {
      __DSH_FAILOVER_SEARCH_VERSION__: JSON.stringify(PACKAGE_VERSION),
    },
    deps: {
      // 官方包由宿主提供：内联会复制一份提供方实现并让 `credentials` 解析路径分叉。
      // schemastery 必须外置：内联会把它的 cosmokit 类型带进 d.ts 推导链，声明文件
      // 生成随即报 “inferred type cannot be named without a reference to …”。
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-web',
        '@deepseek-ai/dsh-web-search-deepseek',
        '@deepseek-ai/dsh-credentials',
        '@deepseek-ai/dsh-launch-environment',
        '@deepseek-ai/schemastery',
      ],
    },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      ...dshSemiClientDeps.deps,
      neverBundle: [...CLIENT_EXTERNALS],
    },
    alias: {
      ...dshSemiClientDeps.alias,
      '@tnnevol/dsh-semi-ui': semiUiEntry,
    },
    css: { inject: true, minify: true },
    onSuccess: inlineClientStyles,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      __DSH_FAILOVER_SEARCH_VERSION__: JSON.stringify(PACKAGE_VERSION),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
