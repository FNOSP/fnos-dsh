import type { UserConfig } from 'tsdown'

export default {
  entry: 'src/index.ts',
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: true,
  clean: true,
  // Midscene 由消费方提供：内联会把它的类型带进声明文件，也会让「项目配置里
  // import 的 @midscene/web」与本包内联的副本分成两个实例。
  deps: {
    neverBundle: ['@midscene/computer', '@midscene/test', '@midscene/web'],
  },
} satisfies UserConfig
