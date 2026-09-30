import { defineComponent, h, nextTick, onMounted, onUpdated, watch } from 'vue'
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { createMermaidRenderer } from 'vitepress-mermaid-renderer'
import ImageViewerP from '@miletorix/vitepress-image-viewer'
import AppIcon from './components/AppIcon.vue'
import VersionBadge from './components/VersionBadge.vue'
import FlowGrid from './components/FlowGrid.vue'
import vitepressBackToTop from 'vitepress-plugin-back-to-top'
import 'vitepress-plugin-back-to-top/dist/style.css'
import '@miletorix/vitepress-image-viewer/style.css'
import './custom.css'

const markNonPreviewImages = () => {
  document
    .querySelectorAll<HTMLImageElement>('.VPNavBar img, .VPHero img')
    .forEach(image => image.classList.add('no-viewer'))
}

// 渲染器自带英文 tooltip，站点为中文，这里覆盖为中文文案。
const toolbarTooltips = {
  zoomIn: '放大',
  zoomOut: '缩小',
  resetView: '重置视图',
  copyCode: '复制源码',
  copyCodeCopied: '已复制',
  download: '下载图表',
  toggleFullscreen: '全屏',
  renderErrorText: '图表渲染失败',
  toggleErrorDetailsText: '显示详情',
  toggleErrorDetailsHideText: '隐藏详情',
  toggleToolbarExpand: '展开工具栏',
  toggleToolbarCollapse: '收起工具栏'
}

/**
 * Mermaid 代码块在浏览器 hydration 后由 renderer 接管，SSR 阶段保持空操作。
 * 明暗主题变化必须重新调用，否则已挂载图表会停留在初始主题。
 */
const mountMermaid = (isDark: boolean) => {
  const renderer = createMermaidRenderer({
    theme: isDark ? 'dark' : 'default',
    startOnLoad: false,
    // 图表来自本仓库 Markdown，仍保持默认严格级别，不放宽 inline HTML。
    securityLevel: 'strict'
  })

  renderer.setToolbar({
    showLanguageLabel: false,
    downloadFormat: 'svg',
    fullscreenMode: 'dialog',
    i18n: { localeIndex: 'zh', tooltips: toolbarTooltips },
    desktop: {
      zoomIn: 'enabled',
      zoomOut: 'enabled',
      resetView: 'enabled',
      zoomLevel: 'enabled',
      copyCode: 'enabled',
      download: 'enabled',
      toggleFullscreen: 'enabled'
    },
    mobile: {
      // 移动端窄视口不堆叠缩放按钮，保留重置、复制与全屏。
      zoomIn: 'disabled',
      zoomOut: 'disabled',
      resetView: 'enabled',
      copyCode: 'enabled',
      toggleFullscreen: 'enabled'
    },
    // 全屏是阅读大图的主要场景。渲染器给全屏组的默认值只启用退出按钮，
    // 不单独配置就会在全屏后只剩「100%」和退出图标，缩放、重置、复制和
    // 下载全部消失。这里显式开启，让全屏下仍能完成缩放与导出。
    fullscreen: {
      zoomIn: 'enabled',
      zoomOut: 'enabled',
      resetView: 'enabled',
      zoomLevel: 'enabled',
      copyCode: 'enabled',
      download: 'enabled',
      toggleFullscreen: 'enabled'
    }
  })
}

const DocsLayout = defineComponent({
  setup() {
    // eslint-disable-next-line react/rules-of-hooks -- useData 是 VitePress 的 Vue 组合式函数；本文件是 Vue 主题，react 插件在此为误报。
    const { isDark } = useData()

    onMounted(markNonPreviewImages)
    onUpdated(markNonPreviewImages)

    watch(
      () => isDark.value,
      dark => nextTick(() => mountMermaid(dark))
    )
    nextTick(() => mountMermaid(isDark.value))

    return () =>
      h(DefaultTheme.Layout, null, {
        'nav-bar-content-after': () => h(VersionBadge)
      })
  }
})

export default {
  extends: DefaultTheme,
  Layout: DocsLayout,
  enhanceApp({ app }) {
    app.component('AppIcon', AppIcon)
    app.component('FlowGrid', FlowGrid)
    // 回到顶部：开源插件在 window load 后挂载独立节点，阈值 320px 与导航栏高度匹配。
    vitepressBackToTop({ threshold: 320 })
    ImageViewerP(app, {
      autoShowThumbnails: false,
      transparentBg: true
    })
  }
}
