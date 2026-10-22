import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BRIDGE_PRELUDE,
  bundledSkillsDir,
  createBundledSkillProvider,
  listBundledSkills,
  loadBundledSkill,
  parseFrontmatter,
  SKILL_PROVIDER_NAME,
} from '../../src/host/skills.ts'

/**
 * 内置技能分发（FNOS-013-13）。
 *
 * 覆盖 AC-01（技能可见且可加载）、AC-02（内容与官方一致，来源标注在包内）、
 * AC-03（卸载后消失）与 AC-04 的注册侧（同名共存由宿主优先级承担，这里只
 * 锁定「不覆盖、不写用户目录」这一实现前提）。
 */

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async dir => rm(dir, { recursive: true, force: true })))
})

/** 造一个临时技能根目录。 */
async function makeSkillRoot(skills: Record<string, string>): Promise<string> {
  const root = join(tmpdir(), `midscene-skills-${Math.random().toString(36).slice(2)}`)
  tempDirs.push(root)
  await mkdir(root, { recursive: true })
  for (const [slug, content] of Object.entries(skills)) {
    await mkdir(join(root, slug), { recursive: true })
    await writeFile(join(root, slug, 'SKILL.md'), content, 'utf8')
  }
  return root
}

describe('parseFrontmatter', () => {
  it('解析 name 与 description', () => {
    const parsed = parseFrontmatter('---\nname: my-skill\ndescription: 说明\n---\n\n正文')
    expect(parsed).toEqual({ name: 'my-skill', description: '说明' })
  })

  it('去掉值两侧引号', () => {
    expect(parseFrontmatter('---\nname: "quoted"\n---\n').name).toBe('quoted')
  })

  it('无 frontmatter 时返回空对象', () => {
    expect(parseFrontmatter('# 只有正文')).toEqual({})
  })

  it('忽略空值字段', () => {
    expect(parseFrontmatter('---\nname:\ndescription:\n---\n')).toEqual({})
  })
})

describe('listBundledSkills', () => {
  it('列出包内技能候选，字段齐备（AC-01）', async () => {
    const root = await makeSkillRoot({ 'demo-skill': '---\nname: demo\ndescription: 演示\n---\n\n正文' })
    const candidates = await listBundledSkills(root)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      name: 'demo',
      description: '演示',
      provider: SKILL_PROVIDER_NAME,
      source: 'bundled',
      rank: 0,
    })
    expect(candidates[0]!.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(candidates[0]!.resourceBase).toEqual({ kind: 'directory', path: join(root, 'demo-skill') })
  })

  it('无 SKILL.md 的目录被跳过', async () => {
    const root = await makeSkillRoot({ 'has-skill': '---\nname: a\n---\n' })
    await mkdir(join(root, 'not-a-skill'), { recursive: true })
    const candidates = await listBundledSkills(root)
    expect(candidates.map(candidate => candidate.name)).toEqual(['a'])
  })

  it('目录不存在时返回空列表而不是抛错', async () => {
    expect(await listBundledSkills(join(tmpdir(), 'definitely-not-here-xyz'))).toEqual([])
  })

  it('frontmatter 缺 name 时回落目录名', async () => {
    const root = await makeSkillRoot({ 'slug-name': '# 无 frontmatter' })
    const candidates = await listBundledSkills(root)
    expect(candidates[0]!.name).toBe('slug-name')
  })

  it('多个技能按目录名稳定排序', async () => {
    const root = await makeSkillRoot({ zeta: '---\nname: z\n---\n', alpha: '---\nname: a\n---\n' })
    const candidates = await listBundledSkills(root)
    expect(candidates.map(candidate => candidate.name)).toEqual(['a', 'z'])
  })
})

describe('loadBundledSkill', () => {
  it('回读完整技能正文（AC-01）', async () => {
    const root = await makeSkillRoot({ 'demo-skill': '---\nname: demo\ndescription: 演示\n---\n\n正文内容' })
    const [candidate] = await listBundledSkills(root)
    const definition = await loadBundledSkill(root, candidate!)
    expect(definition?.content).toContain('正文内容')
    expect(definition?.name).toBe('demo')
    expect(definition?.provider).toBe(SKILL_PROVIDER_NAME)
  })

  it('文件被删除后返回 undefined（宿主按不再可加载处理，AC-03）', async () => {
    const root = await makeSkillRoot({ 'demo-skill': '---\nname: demo\n---\n' })
    const [candidate] = await listBundledSkills(root)
    await rm(join(root, 'demo-skill'), { recursive: true, force: true })
    expect(await loadBundledSkill(root, candidate!)).toBeUndefined()
  })
})

describe('createBundledSkillProvider', () => {
  it('provider 名为 dsh-midscene（注册表唯一性）', () => {
    expect(createBundledSkillProvider('/nowhere').name).toBe(SKILL_PROVIDER_NAME)
  })

  it('list 与 get 走同一份包内数据', async () => {
    const root = await makeSkillRoot({ 'demo-skill': '---\nname: demo\ndescription: d\n---\n\nbody' })
    const provider = createBundledSkillProvider(root)
    const listed = await provider.list({})
    const candidates = Array.isArray(listed) ? listed : []
    const definition = await provider.get(candidates[0]!, {})
    expect(definition?.content).toContain('body')
  })
})

describe('包内技能资产（AC-02）', () => {
  it('内置官方 6 个技能 + 知识技能 + 插件自有入口，共 8 个', async () => {
    const root = bundledSkillsDir()
    const candidates = await listBundledSkills(root)
    // 前 6 个与上游仓库一致：browser / computer / android / ios / harmony / vitest，
    // 第 7 个是知识参考，第 8 个 `dsh-midscene` 是**插件自有**的入口技能（非上游）。
    expect(candidates.map(candidate => candidate.name)).toEqual([
      'android-device-automation',
      'browser-automation',
      'computer-automation',
      'dsh-midscene',
      'harmonyos-device-automation',
      'ios-device-automation',
      'midscenejs',
      'vitest-midscene-e2e',
    ])
  })

  it('入口技能不参与上游同步：用独占名字，且写明「不要索要模型密钥」', async () => {
    // 这条守的是本次事故的根因：agent 不知道插件的作用，于是向用户索要 MIDSCENE_MODEL_*。
    // 入口技能必须①用独占名字（不参与同名冲突、不会被遮蔽），②明确禁止索要密钥。
    const root = bundledSkillsDir()
    const candidates = await listBundledSkills(root)
    const entry = candidates.find(candidate => candidate.name === 'dsh-midscene')
    expect(entry, '缺少入口技能 dsh-midscene').toBeDefined()

    const definition = await loadBundledSkill(root, entry!)
    const content = definition?.content ?? ''
    // 必须给出取配置的权威路径（桥的环境端点），而不是让用户自己找配置。
    expect(content).toContain('/v1/midscene-env')
    // 必须显式禁止索要第三方密钥。
    expect(content).toContain('不要向用户索要任何模型密钥')
    // 必须说明优先用用户自己的 Chrome（Bridge 模式）。
    expect(content).toContain('--bridge connect')
    // 必须点破「上游文档说插件不提供 env」这个具体弯路。
    expect(content).toContain('上游文档不知道本插件的桥存在')
    // 描述要能被浏览器/自动化类任务触发。
    expect(entry!.description).toContain('Midscene')
  })

  it('分发内容 = 环境说明 + 上游原文，且上游部分未被改动', async () => {
    const root = bundledSkillsDir()
    const candidates = await listBundledSkills(root)
    const definition = await loadBundledSkill(root, candidates.find(c => c.name === 'browser-automation')!)
    const content = definition?.content ?? ''

    // 前面是插件注入的环境说明……
    expect(content.startsWith(BRIDGE_PRELUDE)).toBe(true)
    // ……后面是官方原文，**一字未改**（抽查官方特征句与官方原样的第三方配置示例）。
    expect(content).toContain('### Mode Selection Guide')
    expect(content).toContain('Never run midscene commands in the background')
    expect(content).toContain('your-google-api-key')
    expect(content).toContain('generativelanguage.googleapis.com')
  })

  it('环境说明告知 agent 用 DSH 桥、不要索要第三方 key（FNOS-013-05 定位）', async () => {
    const root = bundledSkillsDir()
    const candidates = await listBundledSkills(root)
    // 每个技能都必须带上说明——否则 agent 可能只读到官方原文的「模型配置」节。
    for (const candidate of candidates) {
      const definition = await loadBundledSkill(root, candidate)
      const content = definition?.content ?? ''
      expect(content, candidate.name).toContain('不要向用户索要模型 API key')
      expect(content, candidate.name).toContain('DSH Midscene Bridge')
    }
    // 说明里给出可执行的取配置方式（端口不固定，先查健康检查）。
    const browser = await loadBundledSkill(root, candidates.find(c => c.name === 'browser-automation')!)
    expect(browser?.content).toContain('/v1/midscene-env')
    expect(browser?.content).toContain('dsh-model')
  })

  it('磁盘上的技能文件与上游逐字节一致（哈希登记在 SOURCE.md）', async () => {
    // 这是「与官方保持一致、不做补丁」的可核对形式：本地文件必须等于上游原文，
    // 一旦有人手改文件（而不是靠 BRIDGE_PRELUDE 注入），这里会报红。
    const { createHash } = await import('node:crypto')
    const { readFile, readdir } = await import('node:fs/promises')
    const root = bundledSkillsDir()
    const source = await readFile(join(root, 'SOURCE.md'), 'utf8')

    // 插件自有的入口技能不来自上游，**不参与**这项逐字节比对（它的内容由本仓库维护）。
    const ownSkillDir = join(root, 'dsh-midscene')

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (full === ownSkillDir) continue
          files.push(...await walk(full))
        } else if (!full.endsWith('SOURCE.md')) files.push(full)
      }
      return files
    }

    const files = await walk(root)
    // 22 个上游文件：6 个官方技能（含 vitest 的 references/scripts）+ midscenejs 的 14 个。
    // 插件自有的 dsh-midscene 已排除（见上），若把它的文件算进来，说明排除逻辑失效。
    expect(files.length).toBe(22)
    for (const file of files) {
      const digest = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 16)
      expect(source, file.slice(root.length + 1)).toContain(digest)
    }
  })

  it('SOURCE.md 如实登记两个上游与提交（技能文件无本地补丁）', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(join(bundledSkillsDir(), 'SOURCE.md'), 'utf8')
    expect(source).toContain('web-infra-dev/midscene-skills')
    expect(source).toContain('dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b')
    expect(source).toContain('tnnevol/skills')
    expect(source).toContain('b3f7fd6cc2bbe48d6d5e3cad804de168b2a615dd')
    expect(source).toContain('MIT')
    // 说明注入机制必须被登记：否则下次同步时无人知道「环境约束在哪施加」。
    expect(source).toContain('BRIDGE_PRELUDE')
    expect(source).toContain('逐字节一致')
  })

  it('frontmatter 支持块标量：多行 description 不能被解析成 "|" 或 ">"', async () => {
    // 技能描述会进入模型上下文用于判断该不该调用技能。上游两个技能都用块标量
    // （`description: |` 与 `description: >`）写多行描述，只取行内值会得到字面量
    // "|" / ">"，等于技能没有描述。
    const candidates = await listBundledSkills(bundledSkillsDir())
    for (const candidate of candidates) {
      expect(candidate.description.length, candidate.name).toBeGreaterThan(80)
      expect(candidate.description.trim(), candidate.name).not.toBe('|')
      expect(candidate.description.trim(), candidate.name).not.toBe('>')
    }
  })

  /**
   * FNOS-018：Bridge 模式的说明必须与 `@midscene/web` 的真实 API 一致。
   *
   * 这里守的是「说法与调用方式」两件事，而不是措辞：
   * - 静默开关在 `connectCurrentTab({ activateTab: false })`，`setActiveTabId` 只收一个参数，
   *   写上第二参数会被静默忽略（不报错、也不生效）；
   * - Bridge 没有 `evaluate`，调用返回 undefined 且不抛错，用它取证会静默失败。
   *
   * PRELUDE 会注入到全部 8 个技能，SKILL.md 是自有技能正文；两处必须同时更新，
   * 否则 agent 从不同技能进来会看到互相矛盾的说法。
   */
  it('documents the real bridge API in both the prelude and the owned skill', async () => {
    const owned = await readFile(join(bundledSkillsDir(), 'dsh-midscene', 'SKILL.md'), 'utf8')
    for (const [label, text] of [['BRIDGE_PRELUDE', BRIDGE_PRELUDE], ['dsh-midscene/SKILL.md', owned]] as const) {
      // 静默开关的正确字段名与调用位置
      expect(text, label).toContain('activateTab')
      expect(text, label).toContain('connectCurrentTab')
      // 旧的错误写法必须彻底消失，否则会被照抄
      expect(text, label).not.toContain('activate: false')
      // 两步式写法实测跑不通（Active tab id is already set），说明里必须劝阻
      expect(text, label).toContain('Active tab id is already set')
      // 能力边界
      expect(text, label).toContain('evaluate')
      // 已证实的结论要保留
      expect(text, label).toContain('数字')
    }
  })

  it('keeps the prelude injected ahead of every bundled skill', async () => {
    const candidates = await listBundledSkills(bundledSkillsDir())
    for (const candidate of candidates) {
      const loaded = await loadBundledSkill(bundledSkillsDir(), candidate)
      expect(loaded?.content.startsWith(BRIDGE_PRELUDE), candidate.name).toBe(true)
    }
  })

})
