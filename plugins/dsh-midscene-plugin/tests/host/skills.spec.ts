import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
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
  it('内置 browser-automation 技能保留官方操作指令', async () => {
    const root = bundledSkillsDir()
    const candidates = await listBundledSkills(root)
    expect(candidates.map(candidate => candidate.name)).toEqual(['browser-automation', 'midscenejs'])
    const definition = await loadBundledSkill(root, candidates[0]!)
    // 抽查官方内容特征：技能靠 npx @midscene/web 驱动，且指令里要求同步执行。
    // 本地补丁只动「模型来源」，这些操作指令必须原样保留。
    expect(definition?.content).toContain('@midscene/web')
    expect(definition?.content).toContain('Never run midscene commands in the background')
    expect(definition?.content).toContain('### Mode Selection Guide')
  })

  it('模型来源已改为桥接服务，不再要求第三方 API key（FNOS-013-05 定位）', async () => {
    const root = bundledSkillsDir()
    const candidates = await listBundledSkills(root)
    const definition = await loadBundledSkill(root, candidates.find(c => c.name === 'browser-automation')!)
    const content = definition?.content ?? ''
    // 插件存在的意义就是让 Midscene 用 DSH 的模型：技能不该再教 agent 去要 key。
    expect(content).toContain('do not ask the user for API keys')
    // 端口不再固定：技能必须教 agent 先发现实际端口，而不是写死 8787。
    expect(content).toContain('/v1/midscene-env')
    expect(content).toContain('auto-advances')
    expect(content).toMatch(/\$PORT|8790/u)
    // 固定四行方案：模型名是常量占位，由桥决定实际模型。
    expect(content).toContain('MIDSCENE_MODEL_NAME="dsh-model"')
    expect(content).toContain('four constant lines')
    // 上游原文里的第三方服务商示例必须已清除，否则 agent 会照抄去配 Gemini/豆包。
    for (const leaked of [
      'your-google-api-key',
      'your-aliyun-api-key',
      'your-doubao-api-key',
      'your-openrouter-api-key',
      'generativelanguage.googleapis.com',
      'dashscope.aliyuncs.com',
      'ark.cn-beijing.volces.com',
      'If the model is not configured, ask the user to set it up',
    ]) {
      expect(content, leaked).not.toContain(leaked)
    }
  })

  it('本地副本 sha256 与 SOURCE.md 登记一致（改动后必须同步更新登记）', async () => {
    // 技能含本地补丁，因此「本地副本 = 上游原文」不再成立；两个哈希都登记在
    // SOURCE.md。本断言挡住「改了技能但忘了更新登记」——否则下次同步时无人
    // 知道本仓库这一份是否被意外改动过。
    const { createHash } = await import('node:crypto')
    const { readFile } = await import('node:fs/promises')
    const root = bundledSkillsDir()
    const skillPath = join(root, 'browser-automation', 'SKILL.md')
    const digest = createHash('sha256').update(await readFile(skillPath)).digest('hex').slice(0, 16)
    const source = await readFile(join(root, 'SOURCE.md'), 'utf8')
    expect(source).toContain(digest)
  })

  it('midscenejs 技能随包分发，且每个文件的 sha256 都登记在 SOURCE.md', async () => {
    // 该技能是一整个目录（SKILL.md + GENERATION.md + references/）。逐文件登记哈希，
    // 使「改了参考文档但忘了更新登记」也会被发现——参考文档同样带桥接补丁。
    const { createHash } = await import('node:crypto')
    const { readFile, readdir } = await import('node:fs/promises')
    const root = bundledSkillsDir()
    const skillRoot = join(root, 'midscenejs')
    const source = await readFile(join(root, 'SOURCE.md'), 'utf8')

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) files.push(...await walk(full))
        else files.push(full)
      }
      return files
    }

    const files = await walk(skillRoot)
    expect(files.length).toBeGreaterThan(8)
    for (const file of files) {
      const digest = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 16)
      expect(source, join('midscenejs', file.slice(skillRoot.length + 1))).toContain(digest)
    }
  })

  it('midscenejs 的模型来源同样改成了桥接服务（参考文档是 agent 最容易照抄的地方）', async () => {
    const { readFile } = await import('node:fs/promises')
    const root = bundledSkillsDir()
    const skill = await readFile(join(root, 'midscenejs', 'SKILL.md'), 'utf8')
    const modelConfig = await readFile(join(root, 'midscenejs', 'references', 'model-config.md'), 'utf8')

    // 技能本体与最可能被照抄的参考文档都必须写明桥接方案。
    expect(skill).toContain('DSH Midscene Bridge')
    expect(skill).toContain('不要向用户索要模型 API key')
    expect(modelConfig).toContain('/v1/midscene-env')
    expect(modelConfig).toContain('dsh-model')

    // 两个技能都不再把「生成 .env」写成需要用户自己填基址与 key。
    for (const [label, content] of [['SKILL.md', skill], ['model-config.md', modelConfig]] as const) {
      for (const leaked of ['替换为你的 API Key', '替换为你的模型服务地址']) {
        expect(content, `${label}: ${leaked}`).not.toContain(leaked)
      }
    }
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

  it('来源标注文件存在且登记上游提交、许可与本地改动点', async () => {
    const source = await import('node:fs/promises').then(async fs => fs.readFile(join(bundledSkillsDir(), 'SOURCE.md'), 'utf8'))
    expect(source).toContain('web-infra-dev/midscene-skills')
    expect(source).toContain('dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b')
    expect(source).toContain('MIT')
    // 第二个技能来自另一个上游，来源同样必须可追溯。
    expect(source).toContain('tnnevol/skills')
    expect(source).toContain('b2616bbe0d587d4a5847ef7143d2da447ce9df02')
    // 本地对官方原文做了「模型来源」补丁，必须如实登记改动点与重新施加步骤，
    // 否则上游同步时会把第三方 key 配置带回来。
    expect(source).toContain('本地改动')
    expect(source).toContain('重新施加')
  })

  it('只内置 Web 场景的操作技能，不含未承诺的平台技能', async () => {
    // browser-automation 是操作技能：内置非 Web 平台的它，等于承诺了插件不承诺的能力。
    // midscenejs 是**查阅性知识技能**，允许含五平台参考（用户问「Android 怎么接」时
    // 给出准确答案，与「插件承诺支持 Android 自动化」是两件事），因此不在此列。
    const candidates = await listBundledSkills(bundledSkillsDir())
    const names = candidates.map(candidate => candidate.name)
    for (const unsupported of ['android-device-automation', 'ios-device-automation', 'harmonyos-device-automation', 'computer-automation']) {
      expect(names, unsupported).not.toContain(unsupported)
    }
  })
})
