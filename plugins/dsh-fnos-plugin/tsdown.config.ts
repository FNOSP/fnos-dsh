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
  const styleLoader = `(() => { if (typeof document === 'undefined') return; const style = document.createElement('style'); style.dataset.dshFnos = 'semi'; style.textContent = ${JSON.stringify(styles)}; document.head.append(style); })();\n`
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
const ICON_NAMES = ['lucide:power', 'lucide:refresh-cw', 'lucide:folder', 'lucide:wrench'] as const

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
    const icon = data.icons[key]
    if (icon === undefined) throw new Error(`图标集里没有 ${name}`)
    picked[name] = { body: icon.body }
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
