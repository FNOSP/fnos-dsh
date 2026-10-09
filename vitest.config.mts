import { defineConfig } from 'vitest/config'

/** Shared defaults for package and plugin unit tests. */
export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    // vitest 4 起 server.deps 从顶层 vite server 配置挪进 test.server
    // （顶层 server 回归纯 vite 语义，不再接受 deps）。
    server: {
      deps: {
        inline: ['@douyinfe/semi-ui', '@douyinfe/semi-icons', '@douyinfe/semi-icons-lab'],
      },
    },
  },
  ssr: {
    noExternal: ['@douyinfe/semi-ui', '@douyinfe/semi-icons', '@douyinfe/semi-icons-lab'],
  },
})
