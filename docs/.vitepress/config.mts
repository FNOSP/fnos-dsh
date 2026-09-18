import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-mermaid-plugin'
import packageJson from '../package.json'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'fn-os-apps'
const base = process.env.DOCS_BASE || (process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}/` : '/')

const markStatusTableColumns = (md: Parameters<NonNullable<Parameters<typeof defineConfig>[0]['markdown']>['config']>[0]) => {
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

const configureMarkdown = (md: Parameters<NonNullable<Parameters<typeof defineConfig>[0]['markdown']>['config']>[0]) => {
  markStatusTableColumns(md)
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
  { text: 'dsh-codebuddy', link: '/plugins/dsh-codebuddy' }
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

// 「开始使用」并入「开发指南」作为首个子模块；`/guide/` 路由仍可直达，
// 因此该路由复用同一组 sidebar，避免出现两份需要同步维护的菜单。
const guideItems = [
  { text: '快速开始', link: '/guide/quick-start' },
  { text: '仓库结构', link: '/guide/repository-structure' },
  { text: 'SDD 维护规范', link: '/guide/sdd-workflow' },
  { text: 'SDD 模式转换报告', link: '/guide/sdd-transition-report' }
]

// 开发指南按主题分组：环境与工具、应用开发、插件开发、任务与构建、协作与规范。
// 单页承担三个以上互不相关主题、或篇幅超过约 300 行时按主题拆分。
const developmentSidebar = [
  {
    text: '开始使用',
    items: guideItems
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
      { text: '贡献指南', link: '/contributing' }
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
      { text: '规范', link: '/requirements/' },
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
    ]
  }
]

const plansSidebar = [
  {
    text: '详细计划',
    items: [
      { text: '规范', link: '/plans/' },
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
    ]
  }
]

// 项目内置的 DeepSeek Harness 图标，供标签 favicon、导航栏 logo 和首页 hero 图共用。
const DSH_LOGO = '/icons/dsh-logo.svg'

// Mermaid 图由 vitepress-mermaid-plugin 在客户端渲染，并自动跟随明暗主题切换。
export default withMermaid(defineConfig({
  lang: 'zh-CN',
  title: 'fnOS DeepSeek Harness',
  description: '飞牛 fnOS 的 DeepSeek Harness 应用与 DSH 插件开发文档。',
  base,
  vite: {
    server: {
      port: 8876
    },
    // Mermaid 及其依赖链含 CommonJS 代码（fastdom 及其 extensions），需要让
    // Vite 预构建整条链，否则 dev 模式报 "does not provide an export named
    // 'default'"。mermaid 必须一起列出，否则内联的 CJS 不会被转换。
    optimizeDeps: {
      include: [
        'mermaid',
        'fastdom',
        'fastdom/extensions/fastdom-promised.js',
        'dayjs',
        'debug',
        'cytoscape',
        'cytoscape-cose-bilkent',
        '@braintree/sanitize-url'
      ]
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
    version: packageJson.version,
    nav: [
      { text: '开发指南', link: '/development/environment' },
      { text: '应用文档', link: '/apps/fn-deepseek-harness' },
      { text: '需求清单', link: '/requirements/' },
      { text: '详细计划', link: '/plans/' }
    ],
    sidebar: {
      '/guide/': developmentSidebar,
      '/apps/': appSidebar,
      '/plugins/': appSidebar,
      '/development/': developmentSidebar,
      '/build/': developmentSidebar,
      '/troubleshooting': developmentSidebar,
      '/requirements/': requirementsSidebar,
      '/plans/': plansSidebar,
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
  },
  // 亮色主题在此设置；深色主题由插件自动切换。
  mermaid: {}
}))
