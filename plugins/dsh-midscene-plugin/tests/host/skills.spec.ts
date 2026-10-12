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
    expect(candidates.map(candidate => candidate.name)).toEqual(['browser-automation'])
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
    const definition = await loadBundledSkill(root, candidates[0]!)
    const content = definition?.content ?? ''
    // 插件存在的意义就是让 Midscene 用 DSH 的模型：技能不该再教 agent 去要 key。
    expect(content).toContain('do not ask the user for API keys')
    expect(content).toContain('http://127.0.0.1:8787/v1/midscene-env')
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

  it('来源标注文件存在且登记上游提交、许可与本地改动点', async () => {
    const source = await import('node:fs/promises').then(async fs => fs.readFile(join(bundledSkillsDir(), 'SOURCE.md'), 'utf8'))
    expect(source).toContain('web-infra-dev/midscene-skills')
    expect(source).toContain('dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b')
    expect(source).toContain('MIT')
    // 本地对官方原文做了「模型来源」补丁，必须如实登记改动点与重新施加步骤，
    // 否则上游同步时会把第三方 key 配置带回来。
    expect(source).toContain('本地改动')
    expect(source).toContain('重新施加')
  })

  it('只内置 Web 场景技能，不含未承诺的平台技能', async () => {
    const candidates = await listBundledSkills(bundledSkillsDir())
    const names = candidates.map(candidate => candidate.name)
    for (const unsupported of ['android-device-automation', 'ios-device-automation', 'harmonyos-device-automation', 'computer-automation']) {
      expect(names, unsupported).not.toContain(unsupported)
    }
  })
})
