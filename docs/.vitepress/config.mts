import { defineConfig } from 'vitepress'
import type { MarkdownOptions } from 'vitepress'
import { back2topPlugin } from 'vitepress-plugin-back2top'
import packageJson from '../package.json'

// markdown.config 回调的参数类型：从 MarkdownOptions['config'] 推导，与
// defineConfig 的 markdown 字段同源，vitepress 升级时类型自动跟随。
type MarkdownConfig = NonNullable<MarkdownOptions['config']>
type MarkdownIt = Parameters<MarkdownConfig>[0]

/**
 * vite 双实例垫片。
 *
 * vitepress 与 vitepress-plugin-back2top 各自 `import { PluginOption } from 'vite'`，
 * pnpm 按 peer 组合解析出两份 vite（@types/node 22 / 26 两个副本），两个 `Plugin`
 * 因 `apply` 回调的 `UserConfig` 来源不同而互不兼容。任何 vite 插件都有 `name`，
 * 收敛成结构化类型后两侧均可赋值；运行时对象原样传递，vite 的真实检查不受影响。
 */
type StructuredVitePlugin = { name: string } & Record<string, unknown>
const asVitePlugin = (plugin: StructuredVitePlugin): StructuredVitePlugin => plugin

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'fn-os-apps'
const base = process.env.DOCS_BASE || (process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}/` : '/')

const markStatusTableColumns = (md: MarkdownIt) => {
  md.core.ruler.after('block', 'status-table-columns', (state) => {
    const { tokens } = state

    for (let tableStart = 0; tableStart < tokens.length; tableStart += 1) {
      if (tokens[tableStart].type !== 'table_open') continue

      const tableEnd = tokens.findIndex((token, index) => index > tableStart && token.type === 'table_close')
      if (tableEnd === -1) continue

      let headerColumn = 0
      let statusColumn = -1

      for (let index = tableStart + 1; index < tableEnd; index += 1) {
        const token = tokens[index]
        if (token.type === 'thead_close') break
        if (token.type !== 'th_open') continue

        const content = tokens[index + 1]?.type === 'inline' ? tokens[index + 1].content.trim() : ''
        if (content === '状态') statusColumn = headerColumn
        headerColumn += 1
      }

      if (statusColumn === -1) {
        tableStart = tableEnd
        continue
      }

      let cellColumn = 0
      for (let index = tableStart + 1; index < tableEnd; index += 1) {
        const token = tokens[index]
        if (token.type === 'tr_open') cellColumn = 0
        if (token.type !== 'th_open' && token.type !== 'td_open') continue

        if (cellColumn === statusColumn) token.attrJoin('class', 'status-column')
        cellColumn += 1
      }

      tableStart = tableEnd
    }
  })
}

/**
 * 给每个表格套一层滚动容器。
 *
 * 表格需要同时满足两件事：宽度撑满正文栏，且列也跟着撑满（不留右侧空白）；
 * 列很多时又要在表格内部横向滚动而不是撑破正文栏。
 *
 * 这两件事无法用单个元素的 CSS 同时做到：
 *
 * - `display: block` 的表格能在自身内部滚动，但它不是表格布局，`width: 100%`
 *   只撑开盒子，列仍按内容宽度排列，右侧留出空白。
 * - `display: table` 的表格列会随容器撑满，但它自身不能滚动；内容超宽时会把
 *   整页撑出横向滚动条。
 *
 * 因此把表格包进一层容器：外层 `overflow-x: auto` 负责滚动，内层保持
 * `display: table` 与 `width: 100%` 负责撑满。
 */
const wrapTablesForScroll = (md: MarkdownIt) => {
  md.core.ruler.after('block', 'wrap-tables-for-scroll', (state) => {
    const { tokens } = state

    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (tokens[index].type !== 'table_open') continue

      const closeIndex = tokens.findIndex((token, i) => i > index && token.type === 'table_close')
      if (closeIndex === -1) continue

      const open = new state.Token('html_block', '', 0)
      open.content = '<div class="docs-table-scroll">'
      const close = new state.Token('html_block', '', 0)
      close.content = '</div>'

      tokens.splice(closeIndex + 1, 0, close)
      tokens.splice(index, 0, open)
    }
  })
}

const configureMarkdown = (md: MarkdownIt) => {
  markStatusTableColumns(md)
  wrapTablesForScroll(md)
}

const appItems = [
  { text: 'DeepSeek Harness', link: '/apps/fn-deepseek-harness' },
  { text: '应用适配说明', link: '/apps/adaptation' }
]

// 三个 Semi UI 条目的性质不同，命名需能区分：
// 「共享包」可被插件依赖，另两个分别是文档站预览页与运行时展示插件。
const pluginItems = [
  { text: '插件总览', link: '/plugins/' },
  { text: 'dsh-fnos', link: '/plugins/dsh-fnos' },
  { text: 'dsh-codex-auth', link: '/plugins/dsh-codex-auth' },
  { text: 'dsh-codebuddy', link: '/plugins/dsh-codebuddy' },
  { text: 'dsh-failover-search', link: '/plugins/dsh-failover-search' }
]

const sharedUiItems = [
  { text: 'DSH Semi UI 共享包', link: '/plugins/dsh-semi-ui' },
  { text: '组件预览（文档站）', link: '/plugins/semi-ui' },
  { text: '组件总览（展示插件）', link: '/plugins/dsh-semi-ui-showcase' }
]

// `/apps/` 与 `/plugins/` 路由共用同一组条目，避免维护两份菜单。
const appSidebar = [
  {
    text: '应用文档',
    items: appItems
  },
  {
    text: 'Harness 插件',
    items: pluginItems
  },
  {
    text: '共享 UI',
    items: sharedUiItems
  }
]

// 「开始使用」和「章程规范」并入「开发指南」作为前两个子模块；`/guide/`、
// `/charter/` 路由仍可直达，因此复用同一组 sidebar，避免出现重复菜单。
const gettingStartedItems = [
  { text: '快速开始', link: '/guide/quick-start' },
  { text: '仓库结构', link: '/guide/repository-structure' }
]

const charterItems = [
  { text: 'SDD 维护规范', link: '/charter/sdd-workflow' },
  { text: '需求文档规范', link: '/charter/requirements-spec' },
  { text: '计划文档规范', link: '/charter/plans-spec' },
  { text: '测试用例文档规范', link: '/charter/tests-spec' },
  { text: 'VitePress 文档菜单规范', link: '/charter/vitepress-document-menu' },
  { text: '插件 UI 规范', link: '/charter/plugin-ui-standards' },
  { text: '目录结构规范', link: '/charter/directory-structure' },
  { text: '应用上架规范', link: '/charter/app-listing-spec' }
]

// 开发指南按主题分组：环境与工具、应用开发、插件开发、任务与构建、协作与规范。
// 单页承担三个以上互不相关主题、或篇幅超过约 300 行时按主题拆分。
const developmentSidebar = [
  {
    text: '开始使用',
    items: gettingStartedItems
  },
  {
    text: '章程规范',
    items: charterItems
  },
  {
    text: '环境与工具',
    items: [
      { text: '开发环境', link: '/development/environment' },
      { text: '命令与脚本', link: '/development/commands-and-scripts' }
    ]
  },
  {
    text: '应用开发',
    items: [
      { text: '应用结构', link: '/development/app-structure' },
      { text: 'Manifest 配置', link: '/development/manifest' },
      { text: '生命周期脚本', link: '/development/lifecycle' },
      { text: '权限与入口', link: '/development/permissions' },
      { text: '用户向导', link: '/development/wizard' }
    ]
  },
  {
    text: '插件开发',
    items: [
      { text: '插件开发', link: '/development/plugin-development' },
      { text: '本地 DSH Web', link: '/development/local-dsh-web' }
    ]
  },
  {
    text: '任务与构建',
    items: [
      { text: 'Turbo 任务', link: '/development/turbo-tasks' },
      { text: 'CLI 命令参考', link: '/development/cli-commands' }
    ]
  },
  {
    text: '协作与规范',
    items: [
      { text: '路径与编码', link: '/development/conventions' },
      { text: 'GitHub Workflow', link: '/development/github-workflows' },
      { text: '贡献指南', link: '/contributing' },
      { text: 'SDD 模式转换报告（历史）', link: '/charter/sdd-transition-report' }
    ]
  },
  {
    text: '构建发布',
    items: [
      { text: 'fnpack 打包', link: '/build/fnpack' },
      { text: '版本管理', link: '/build/versioning' },
      { text: 'CI 构建', link: '/build/ci' },
      { text: '发布流程', link: '/build/release' }
    ]
  },
  {
    text: '问题排查',
    items: [{ text: '常见问题', link: '/troubleshooting' }]
  }
]

const requirementsSidebar = [
  {
    text: '需求清单',
    items: [
      { text: '需求清单', link: '/requirements/' },
      {
        text: 'FNOS-001 DSH 飞牛 NAS 适配',
        link: '/requirements/FNOS-001-dsh-fnos-adaptation'
      },
      {
        text: 'FNOS-002 DSH 应用与插件优化',
        link: '/requirements/FNOS-002-dsh-app-plugin-optimization'
      },
      {
        text: 'FNOS-003 FPK 应用运行设置统一',
        link: '/requirements/FNOS-003-fpk-runtime-settings'
      },
      {
        text: 'FNOS-004 DSH 0.1.5-rc.2 适配',
        link: '/requirements/FNOS-004-dsh-015-rc2-adaptation'
      },
      {
        text: 'FNOS-005 CodeBuddy 成长任务与本地 DSH',
        link: '/requirements/FNOS-005-codebuddy-and-local-dsh'
      },
      {
        text: 'FNOS-006 安装脚本与安装流程优化',
        link: '/requirements/FNOS-006-installation-script-optimization'
      },
      {
        text: 'FNOS-007 DSH 0.1.7-rc.2 适配',
        link: '/requirements/FNOS-007-dsh-017-rc2-adaptation'
      },
      {
        text: 'FNOS-008 插件配置统一迁入插件管理页',
        link: '/requirements/FNOS-008-plugin-config-in-plugin-manager'
      },
      {
        text: 'FNOS-009 DSH 0.2.0-rc.2 插件适配',
        link: '/requirements/FNOS-009-dsh-020-rc2-adaptation'
      },
      {
        text: 'FNOS-010 三方搜索接入与官方兜底',
        link: '/requirements/FNOS-010-thirdparty-web-search-failover'
      },
      {
        text: 'FNOS-011 凭据文件权限异常的可诊断性',
        link: '/requirements/FNOS-011-credential-permission-diagnostics'
      },
      {
        text: 'FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新',
        link: '/requirements/FNOS-012-codebuddy-model-speed-and-client-version'
      },
      ]
  }
]

const plansSidebar = [
  {
    text: '详细计划',
    items: [
      { text: '计划清单', link: '/plans/' },
      {
        text: 'PLAN-FNOS-001 DSH 飞牛 NAS 适配',
        link: '/plans/PLAN-FNOS-001-dsh-fnos-adaptation'
      },
      {
        text: 'PLAN-FNOS-002 DSH 应用与插件优化',
        link: '/plans/PLAN-FNOS-002-dsh-app-plugin-optimization'
      },
      {
        text: 'PLAN-FNOS-003 FPK 应用运行设置统一',
        link: '/plans/PLAN-FNOS-003-fpk-runtime-settings'
      },
      {
        text: 'PLAN-FNOS-004 DSH 0.1.5-rc.2 适配与 FPK 运行修复',
        link: '/plans/PLAN-FNOS-004-dsh-015-rc2-adaptation'
      },
      {
        text: 'PLAN-FNOS-005 CodeBuddy 成长任务与本地 DSH',
        link: '/plans/PLAN-FNOS-005-codebuddy-and-local-dsh'
      },
      {
        text: 'PLAN-FNOS-006 安装脚本与安装流程优化',
        link: '/plans/PLAN-FNOS-006-installation-script-optimization'
      },
      {
        text: 'PLAN-FNOS-007 DSH 0.1.7-rc.2 适配与插件错误修复',
        link: '/plans/PLAN-FNOS-007-dsh-017-rc2-adaptation'
      },
      {
        text: 'PLAN-FNOS-008 插件配置统一迁入插件管理页',
        link: '/plans/PLAN-FNOS-008-plugin-config-in-plugin-manager'
      },
      {
        text: 'PLAN-FNOS-009 DSH 0.2.0-rc.2 插件适配',
        link: '/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation'
      },
      {
        text: 'PLAN-FNOS-010 三方搜索接入与官方兜底',
        link: '/plans/PLAN-FNOS-010-thirdparty-web-search-failover'
      },
      {
        text: 'PLAN-FNOS-011 凭据文件权限异常的可诊断性',
        link: '/plans/PLAN-FNOS-011-credential-permission-diagnostics'
      },
      {
        text: 'PLAN-FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新',
        link: '/plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version'
      },
    ]
  }
]

// 测试用例文档与需求同编号（FNOS-###），每个需求一个条目，便于多个需求并列查看。
const testsSidebar = [
  {
    text: '测试用例',
    items: [
      { text: '测试用例清单', link: '/tests/' },
      {
        text: 'FNOS-009 DSH 0.2.0-rc.2 插件适配',
        link: '/tests/FNOS-009-dsh-020-rc2-adaptation'
      },
      {
        text: 'FNOS-010 三方搜索接入与官方兜底',
        link: '/tests/FNOS-010-thirdparty-web-search-failover'
      },
    ]
  }
]

// 项目内置的 DeepSeek Harness 图标，供标签 favicon、导航栏 logo 和首页 hero 图共用。
const DSH_LOGO = '/icons/dsh-logo.svg'

// Mermaid 图由 vitepress-mermaid-renderer 在客户端主题中挂载，并自动跟随明暗主题切换；
// 这里不再需要构建期插件，配置保持纯 VitePress。
export default defineConfig({
  lang: 'zh-CN',
  title: 'fnOS DeepSeek Harness',
  description: '飞牛 fnOS 的 DeepSeek Harness 应用与 DSH 插件开发文档。',
  base,
  vite: {
    plugins: [
      // 回到顶部：向默认主题 Layout 的 doc-after slot 注入按钮；
      // top 与导航阈值对齐，marginBottom 抬高避开页脚遮挡。
      // 经结构化垫片转换，绕开两份 vite 类型的 Plugin 不兼容（见上）。
      asVitePlugin(back2topPlugin({ top: 320, marginBottom: 96 }) as StructuredVitePlugin)
    ],
    server: {
      port: 8876
    }
  },
  head: [['link', { rel: 'icon', href: `${base}icons/dsh-logo.svg` }]],
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    config: configureMarkdown
  },
  themeConfig: {
    siteTitle: 'fnOS DeepSeek Harness',
    logo: {
      src: DSH_LOGO,
      alt: 'DeepSeek Harness'
    },
    // 自定义扩展字段：VitePress 1.6 的主题类型没有 version（消费端
    // VersionBadge.vue 以 `as { version?: string }` 读取），写入端对称断言。
    ...( { version: packageJson.version } as { version: string } ),
    nav: [
      {
        text: '开发指南',
        link: '/development/environment',
        activeMatch: '^/(guide|charter|development|build|troubleshooting|contributing)(/|$)'
      },
      {
        text: '应用文档',
        link: '/apps/fn-deepseek-harness',
        activeMatch: '^/(apps|plugins)(/|$)'
      },
      {
        text: '需求清单',
        link: '/requirements/',
        activeMatch: '^/requirements(/|$)'
      },
      {
        text: '详细计划',
        link: '/plans/',
        activeMatch: '^/plans(/|$)'
      },
      {
        text: '测试用例',
        link: '/tests/',
        activeMatch: '^/tests(/|$)'
      }
    ],
    sidebar: {
      '/guide/': developmentSidebar,
      '/charter/': developmentSidebar,
      '/apps/': appSidebar,
      '/plugins/': appSidebar,
      '/development/': developmentSidebar,
      '/build/': developmentSidebar,
      '/troubleshooting': developmentSidebar,
      '/requirements/': requirementsSidebar,
      '/plans/': plansSidebar,
      '/tests/': testsSidebar,
      '/contributing': developmentSidebar
    },
    outline: {
      level: [2, 3],
      label: '本页目录'
    },
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/FNOSP/fnos-dsh' }
    ],
    footer: {
      message: '基于 VitePress 构建',
      copyright: '© fnOS Apps Contributors'
    },
    docFooter: {
      prev: '上一页',
      next: '下一页'
    },
    lastUpdatedText: '最后更新'
  }
})
