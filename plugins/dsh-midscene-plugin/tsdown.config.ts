import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

// DSH 的模块图按 npm 包名寻址，产物版本常量与 package.json 保持同源。
const PACKAGE_VERSION = (JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }).version

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
      __DSH_MIDSCENE_VERSION__: JSON.stringify(PACKAGE_VERSION),
    },
    deps: {
      // 官方包由宿主提供：内联会复制一份宿主实现并让服务解析路径分叉。
      // schemastery 必须外置：内联会把它的类型带进 d.ts 推导链，声明文件
      // 生成会报 “inferred type cannot be named without a reference to …”。
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-skill',
        '@deepseek-ai/schemastery',
      ],
    },
  },
] satisfies UserConfig[]
