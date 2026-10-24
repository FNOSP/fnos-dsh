import { describe, expect, it } from 'vitest'

import {
  agentModelId,
  extractMessage,
  flattenConversation,
  lastUserText,
  looksLikeLeakedCall,
  normalizeModelKey,
  sanitizeLeakedCalls,
  ZCODE_AGENT_MODEL_IDS,
} from '../../../src/host/bridge/transcript.ts'

const LEAK_PLACEHOLDER = '〔工具调用标记已拦截〕'

describe('extractMessage', () => {
  it('字符串正文原样返回，图片数为 0', () => {
    expect(extractMessage({ role: 'user', content: '纯文本正文' })).toEqual({
      text: '纯文本正文',
      imageCount: 0,
    })
  })

  it('多个文本块按换行拼接，空文本块不产生空行', () => {
    const extracted = extractMessage({
      role: 'user',
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '' },
        { type: 'text', text: '第二段' },
      ],
    })

    expect(extracted.text).toBe('第一段\n第二段')
  })

  it('reasoning 块被丢弃（历史思考不进入后续上下文）', () => {
    expect(extractMessage({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '这里是很长的思考内容' },
        { type: 'text', text: '结论' },
      ],
    }).text).toBe('结论')

    expect(extractMessage({
      role: 'assistant',
      content: [{ type: 'reasoning', text: '只有思考' }],
    })).toEqual({ text: '', imageCount: 0 })
  })

  it('图片块生成 [图片 #k]，编号只按图片出现顺序递增', () => {
    const extracted = extractMessage({
      role: 'user',
      content: [
        { type: 'text', text: '请看这两张图' },
        { type: 'image', attachment: { id: 'img-1' } },
        { type: 'reasoning', text: '思考不计数' },
        { type: 'text', text: '以及这张' },
        { type: 'image', attachment: { id: 'img-2' } },
      ],
    })

    expect(extracted).toEqual({
      text: `请看这两张图\n[图片 #1]\n以及这张\n[图片 #2]`,
      imageCount: 2,
    })
  })

  it('文件块带名字时渲染 [文件：名字]，无名时渲染 [文件]', () => {
    expect(extractMessage({
      role: 'user',
      content: [
        { type: 'file', name: 'report.pdf' },
        { type: 'file' },
      ],
    }).text).toBe('[文件：report.pdf]\n[文件]')
  })

  it('tool-call 块保留工具名与参数（对象参数序列化为 JSON）', () => {
    const extracted = extractMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', name: 'Bash', arguments: { command: 'ls -la' } },
        { type: 'tool-call', name: 'Read' },
      ],
    })

    expect(extracted.text.split('\n')).toEqual([
      '[上一次工具调用 Bash：{"command":"ls -la"}]',
      '[上一次工具调用 Read：{}]',
    ])
  })

  it('tool-call 参数超过 4000 字符时截断（避免历史工具输出撑爆上下文）', () => {
    const args = 'x'.repeat(5_000)
    const text = extractMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', name: 'Bash', arguments: args }],
    }).text

    expect(text.startsWith('[上一次工具调用 Bash：')).toBe(true)
    expect(text.endsWith(']')).toBe(true)
    expect(text).toContain('x'.repeat(4_000))
    expect(text).not.toContain('x'.repeat(4_001))
  })

  it('工具增删记录与未知块类型被忽略', () => {
    expect(extractMessage({
      role: 'developer',
      content: [
        { type: 'tool-addition', toolName: 'Bash' },
        { type: 'tool-removal', toolName: 'Bash' },
        { type: 'unknown-future-block', text: '未来块' },
        '裸字符串块',
      ],
    }).text).toBe('裸字符串块')
  })

  it('content 既不是字符串也不是数组时返回空正文', () => {
    for (const content of [undefined, null, 42, { type: 'text', text: 'x' }]) {
      expect(extractMessage({ role: 'user', content }), `content=${String(content)}`).toEqual({
        text: '',
        imageCount: 0,
      })
    }
  })
})

describe('lastUserText', () => {
  it('取最后一条用户消息，忽略其后的助手消息', () => {
    expect(lastUserText([
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回复' },
      { role: 'user', content: '最后一条' },
      { role: 'assistant', content: '再回复' },
    ])).toBe('最后一条')
  })

  it('最后一条用户消息正文为空时回退到上一条', () => {
    expect(lastUserText([
      { role: 'user', content: '有效的用户消息' },
      { role: 'user', content: [{ type: 'reasoning', text: '只有思考' }] },
      { role: 'user', content: '   ' },
    ])).toBe('有效的用户消息')
  })

  it('没有用户消息或列表为空时返回空串', () => {
    expect(lastUserText([])).toBe('')
    expect(lastUserText([
      { role: 'system', content: '系统提示' },
      { role: 'assistant', content: '助手消息' },
    ])).toBe('')
  })

  it('正文首尾空白被去掉', () => {
    expect(lastUserText([{ role: 'user', content: '  带空白的正文  ' }])).toBe('带空白的正文')
  })
})

describe('flattenConversation', () => {
  it('每段带角色前缀，顺序保持，段间空行分隔', () => {
    expect(flattenConversation([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '用户输入' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '思考被丢弃' },
          { type: 'text', text: '助手回复' },
        ],
      },
      { role: 'developer', content: '开发上下文' },
      { role: 'tool', content: '工具结果' },
    ])).toBe([
      '【系统】系统提示',
      '【用户】用户输入',
      '【助手】助手回复',
      '【上下文】开发上下文',
      '【上下文】工具结果',
    ].join('\n\n'))
  })

  it('正文为空的段落整段跳过（不留下孤零零的角色前缀）', () => {
    expect(flattenConversation([
      { role: 'user', content: '只有这一句' },
      { role: 'assistant', content: [{ type: 'reasoning', text: '只有思考' }] },
      { role: 'user', content: '   ' },
    ])).toBe('【用户】只有这一句')
  })

  it('全部为空时返回空串', () => {
    expect(flattenConversation([])).toBe('')
    expect(flattenConversation([{ role: 'assistant', content: [] }])).toBe('')
  })
})

describe('normalizeModelKey 与 agentModelId', () => {
  it('归一化：小写并去掉大小写/分隔符差异，保留点号', () => {
    expect(normalizeModelKey('GLM-5.3-Flash')).toBe('glm5.3flash')
    expect(normalizeModelKey('GLM 5.3 Turbo')).toBe('glm5.3turbo')
    expect(normalizeModelKey('GLM-5.3')).toBe('glm5.3')
    expect(normalizeModelKey('')).toBe('')
  })

  it('目录 id 映射到 agent registry 的书写形态', () => {
    expect(agentModelId('glm-5.3-flash')).toBe('GLM-5.3-Flash')
    expect(agentModelId('glm-5.3')).toBe('GLM-5.3')
    expect(agentModelId('GLM-5-TURBO')).toBe('GLM-5-Turbo')
    expect(agentModelId('glm 5.3 flash')).toBe('GLM-5.3-Flash')
  })

  it('未知模型 id 原样返回（不做兜底改写）', () => {
    expect(agentModelId('glm-4.6')).toBe('glm-4.6')
    expect(agentModelId('some-future-model')).toBe('some-future-model')
  })

  it('registry 里的规范 id 归一后映射回自身', () => {
    for (const id of ZCODE_AGENT_MODEL_IDS) {
      expect(agentModelId(id), `${id} 应映射回自身`).toBe(id)
    }
  })
})

describe('looksLikeLeakedCall', () => {
  it('识别 antml 伪调用与 function_calls 标记', () => {
    expect(looksLikeLeakedCall('<antml:invoke name="Bash">')).toBe(true)
    expect(looksLikeLeakedCall('<antml:')).toBe(true)
    expect(looksLikeLeakedCall('前文 <function_calls> 后文')).toBe(true)
  })

  it('普通正文、HTML 标签、不完整前缀与大小写变体都不算泄漏', () => {
    expect(looksLikeLeakedCall('普通正文，含 <div> 标签')).toBe(false)
    expect(looksLikeLeakedCall('流式半段 <antml')).toBe(false)
    expect(looksLikeLeakedCall('<ANTML:invoke>')).toBe(false)
    expect(looksLikeLeakedCall('<function_callsx>')).toBe(false)
  })
})

describe('sanitizeLeakedCalls', () => {
  it('没有泄漏标记时原样返回', () => {
    const text = '普通正文 <div> 不处理'

    expect(sanitizeLeakedCalls(text)).toBe(text)
  })

  it('antml 调用块被替换成占位符，原始参数不残留', () => {
    const sanitized = sanitizeLeakedCalls(
      '开始<antml:invoke name="Bash">{"command":"rm -rf /tmp/x"}</antml:invoke>结束',
    )

    expect(sanitized.startsWith('开始')).toBe(true)
    expect(sanitized.endsWith('结束')).toBe(true)
    expect(sanitized).toContain(LEAK_PLACEHOLDER)
    expect(sanitized).not.toContain('{"command"')
    expect(sanitized).not.toContain('<antml:')
  })

  it('流式半段（没有闭合标记）替换到结尾', () => {
    const sanitized = sanitizeLeakedCalls('前缀<antml:invoke name="Bash">部分参数')

    expect(sanitized).toBe(`前缀${LEAK_PLACEHOLDER}`)
  })

  it('多个调用块各自替换为占位符', () => {
    const sanitized = sanitizeLeakedCalls(
      '<antml:a>一</antml:a>中间<antml:b>二</antml:b>',
    )
    const count = sanitized.split(LEAK_PLACEHOLDER).length - 1

    expect(count).toBe(2)
    expect(sanitized).toContain('中间')
    expect(sanitized).not.toContain('<antml:a>')
    expect(sanitized).not.toContain('<antml:b>')
  })

  it('只有闭合标签不触发处理（looksLikeLeakedCall 只认起始标记）', () => {
    expect(sanitizeLeakedCalls('残留 </antml:invoke>')).toBe('残留 </antml:invoke>')
  })
})
