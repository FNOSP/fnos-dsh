import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isOpenCodeBundleSubject,
  OPENCODE_DETAIL_ID,
  OPENCODE_DETAIL_ORDER,
  OPENCODE_DETAIL_SLOT,
  OPENCODE_LOCALE_NAMESPACE,
  OPENCODE_PACKAGE_NAME,
  OPENCODE_USAGE_ID,
  OPENCODE_USAGE_ORDER,
  OPENCODE_USAGE_SLOT,
} from '../../src/client/services/registration.ts'
import { en, zh } from '../../src/client/locales.ts'

/** 递归收集 `src/` 下的 TypeScript 源码。 */
async function collect(dir: URL): Promise<URL[]> {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true })
  const files: URL[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...await collect(new URL(`${entry.name}/`, dir)))
      continue
    }
    if (/\.tsx?$/u.test(entry.name)) files.push(new URL(entry.name, dir))
  }
  return files
}

const readSource = async (path: string): Promise<string> => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8')

describe('插件详情页的 subject 判定', () => {
  it('只接受本插件的 bundle 详情页', () => {
    expect(isOpenCodeBundleSubject({ kind: 'bundle', pkg: { name: OPENCODE_PACKAGE_NAME } })).toBe(true)
  })

  it('拒绝别的组合包、row 详情页与缺失 subject', () => {
    expect(isOpenCodeBundleSubject({ kind: 'bundle', pkg: { name: '@tnnevol/dsh-codex-auth' } })).toBe(false)
    expect(isOpenCodeBundleSubject({ kind: 'row', pkg: { name: OPENCODE_PACKAGE_NAME } })).toBe(false)
    expect(isOpenCodeBundleSubject({ kind: 'bundle' })).toBe(false)
    expect(isOpenCodeBundleSubject(undefined)).toBe(false)
  })

  it('详情页组件先做 subject 过滤，再渲染内容', async () => {
    const section = await readSource('components/OpenCodeSection.tsx')
    expect(section).toContain('isOpenCodeBundleSubject(subject)')
    expect(section).toContain('return null')
  })
})

describe('座位注册契约', () => {
  it('座位常量与 id/优先级稳定且不与既有插件冲突', () => {
    expect(OPENCODE_PACKAGE_NAME).toBe('@tnnevol/dsh-opencode')
    expect(OPENCODE_DETAIL_SLOT).toBe('plugins.detail.section')
    expect(OPENCODE_DETAIL_ID).toBe('opencode-account')
    expect(OPENCODE_DETAIL_ORDER).toBe(80)
    expect(OPENCODE_USAGE_SLOT).toBe('conversation.input.right')
    expect(OPENCODE_USAGE_ID).toBe('opencode-usage')
    expect(OPENCODE_USAGE_ORDER).toBe(3)
    expect(OPENCODE_LOCALE_NAMESPACE).toBe('settings.dsh-opencode')
  })

  it('客户端入口注册两个座位并安装共享主题', async () => {
    const client = await readSource('client/index.tsx')
    const code = client.replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(client).toContain("ctx.slots.inject(OPENCODE_DETAIL_SLOT")
    expect(client).toContain('name: OPENCODE_DETAIL_SLOT')
    expect(client).toContain("ctx.slots.inject(OPENCODE_USAGE_SLOT")
    expect(client).toContain('name: OPENCODE_USAGE_SLOT')
    expect(client).toContain("installSemiDshTheme(), 'dsh-opencode-plugin: Semi DSH theme'")
    expect(client).toContain('const preferences = createPreferencesStore()')
    // 不用设置页导航座位，也不把配置塞进 bundle.config（顺序固定在前）。
    expect(code).not.toContain("ctx.slots.inject('settings.section'")
    expect(code).not.toContain('name: \'plugins.bundle.config\'')
  })

  it('客户端 inject 与 Codex 插件保持同一套必需服务', async () => {
    const client = await readSource('client/index.tsx')
    const declaration = client.match(/export const inject = \[(.*?)\]/su)?.[1] ?? ''
    const services = [...declaration.matchAll(/'([^']+)'/gu)].map(match => match[1])
    expect(services).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.llm', 'remote.session', 'timer'])
  })

  it('locale 命名空间在类型层完成合并', async () => {
    const client = await readSource('client/index.tsx')
    expect(client).toContain("interface LocaleNamespaceMap")
    expect(client).toContain("'settings.dsh-opencode': OpenCodeLocaleKey")
  })
})

describe('文案完整性', () => {
  it('中英文键集合一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('组件里出现的每个 t(\'literal\') 都有中英文案', async () => {
    const files = await collect(new URL('../../src/', import.meta.url))
    const used = new Set<string>()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(/\bt\(\s*'([A-Za-z][A-Za-z0-9]*)'/gu)) {
        const key = match[1]
        if (key !== undefined) used.add(key)
      }
    }
    expect(used.size).toBeGreaterThan(80)
    for (const key of used) {
      expect(en, `en missing ${key}`).toHaveProperty(key)
      expect(zh, `zh missing ${key}`).toHaveProperty(key)
    }
  })
})

describe('插件 UI 规范', () => {
  it('客户端与组件不直接依赖 @douyinfe/semi', async () => {
    const files = await collect(new URL('../../src/', import.meta.url))
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, file.pathname).not.toContain('@douyinfe/semi')
    }
  })

  it('样式只用 DSH 语义变量，不硬编码颜色、不覆盖 .semi-* 主题', async () => {
    const style = await readSource('styles/index.scss')
    const withoutComments = style.replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
    expect(withoutComments).not.toMatch(/\brgba?\(/u)
    expect(withoutComments).not.toMatch(/\bhsla?\(/u)
    expect(withoutComments).not.toMatch(/\.semi-/u)
    expect(withoutComments).toContain('var(--dsw-alias-settings-card-fill)')
    expect(withoutComments).toContain('var(--dsw-alias-settings-card-stroke)')
    expect(withoutComments).toContain('var(--dsw-radius-xl)')
  })

  it('浮层背景与毛玻璃交给共享主题的父容器，不在子元素重复叠加', async () => {
    const style = await readSource('styles/index.scss')
    // 契约写在注释里：真实规则由 @tnnevol/dsh-semi-ui 作用于 .semi-popover-wrapper。
    expect(style).toContain('var(--dsw-specific-menu)')
    expect(style).toContain('var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))')
    expect(style).toContain('避免子元素重复叠加模糊')
  })

  it('详情页与胶囊共享同一个偏好 store，保存后立即生效', async () => {
    const client = await readSource('client/index.tsx')
    const injected = client.match(/inject: \(\): OpenCodeUsageStatusInjected => \((\{.*?\})\)/su)?.[1] ?? ''
    expect(injected).toContain('preferences')
    expect(client).toContain('<OpenCodeSection t={t} preferences={preferences} timer={timer}')
  })
})
