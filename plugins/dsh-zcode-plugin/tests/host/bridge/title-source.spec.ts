import { describe, expect, it } from 'vitest'

import { titleSourceText } from '../../../src/host/bridge/transcript.ts'

/**
 * DSH 的会话标题提供方只发一条用户消息：英文指令 + 人话 JSON 数组。
 * 直接取这条文本会把指令当标题（实测事故），所以这里锁定解析口径。
 */
describe('titleSourceText', () => {
  it('从 DSH 的标题请求里解出第一条人话，而不是英文指令', () => {
    const message = {
      role: 'user',
      content: 'Generate the session title from this JSON array of human messages:\n'
        + '[{"role":"user","content":"帮我修一下 ZCode 插件"}]',
    }
    expect(titleSourceText([message])).toBe('帮我修一下 ZCode 插件')
  })

  it('人话内容是块数组时取文本块', () => {
    const message = {
      role: 'user',
      content: 'Generate the session title from this JSON array of human messages:\n'
        + '[{"role":"user","content":[{"type":"text","text":"第二段才是正文"}]}]',
    }
    expect(titleSourceText([message])).toBe('第二段才是正文')
  })

  it('数组里第一条为空文本时继续找下一条', () => {
    const message = {
      role: 'user',
      content: 'Generate the session title from this JSON array of human messages:\n'
        + '[{"role":"user","content":""},{"role":"user","content":"后面这条有效"}]',
    }
    expect(titleSourceText([message])).toBe('后面这条有效')
  })

  it('不是 JSON 时按原样返回，不抛错', () => {
    const message = { role: 'user', content: '直接的一句话，没有 JSON' }
    expect(titleSourceText([message])).toBe('直接的一句话，没有 JSON')
  })

  it('JSON 结构损坏且只剩指令时返回空串', () => {
    const message = {
      role: 'user',
      content: 'Generate the session title from this JSON array of human messages:\n[{"role":"user",',
    }
    expect(titleSourceText([message])).toBe('')
  })

  it('没有用户消息时返回空串', () => {
    expect(titleSourceText([{ role: 'assistant', content: '只有助手' }])).toBe('')
  })

  it('指令与人话 JSON 分在不同消息时仍能取到人话', () => {
    const messages = [
      { role: 'user', content: 'Generate the session title from this JSON array of human messages:' },
      { role: 'user', content: '[{"role":"user","content":"分成两条也要取到"}]' },
    ]
    expect(titleSourceText(messages)).toBe('分成两条也要取到')
  })

  it('人话 JSON 落在系统提示里时也能取到', () => {
    const messages = [{ role: 'user', content: 'Generate the session title from this JSON array of human messages:' }]
    expect(titleSourceText(messages, '[{"role":"user","content":"来自系统提示"}]')).toBe('来自系统提示')
  })

  it('只拿到英文指令时返回空串（交回默认标题，不造垃圾标题）', () => {
    const messages = [{ role: 'user', content: 'Generate the session title from this JSON array of human messages:' }]
    expect(titleSourceText(messages)).toBe('')
  })
})
