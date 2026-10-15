/**
 * Desktop 用例的 Node：CDP 通道上的精确断言与点击。
 *
 * 与页面内那套 Node（`assertInPage` / `clickInPage`）**共用**判定约定
 * （`wrapPageScript` / `readPageVerdict`），差别只在通道：这里走 Desktop 渲染进程的 CDP，
 * 不经过 Chrome 扩展，因此：
 *
 * - 不动用户的鼠标，不切前台（实测 Computer Mode 会，这是选它的主因）；
 * - 零模型调用（毫秒级，而 `aiAssert` 每步一次视觉请求）。
 *
 * 代价是**没有视觉判定**：「两态肉眼是否可辨」这类断言只能由人工走查，或等
 * `@midscene/computer` 支持虚拟光标。DOM 级的一致性断言（`aria-pressed`、类名、
 * 计算样式）不受影响。
 *
 * @module dsh-e2e-kit/desktop-nodes
 */

import process from 'node:process'
import { defineNode, z } from '@midscene/test'
import { setTimeout as delay } from 'node:timers/promises'
import { readPageVerdict, wrapPageScript } from './page-script.ts'
import type { DesktopCdpContext } from './desktop-context.ts'

/** `dsh.desktopAssert` 的输入。 */
const desktopAssertInput = z.strictObject({
  label: z.string().min(1).describe('失败信息里显示的断言名称。'),
  script: z.string().min(1).describe('在渲染进程内求值的脚本，须返回 { pass, detail? }。'),
})

/**
 * Desktop 渲染进程内的精确断言（失败会真正让用例失败）。
 *
 * 与 `dsh.assertInPage` 同一个判定约定，只是通道不同。
 */
export const desktopAssert = defineNode<
  typeof desktopAssertInput,
  { passed: boolean, detail: string },
  DesktopCdpContext
>({
  name: 'dsh.desktopAssert',
  description: '在 DSH Desktop 渲染进程内执行精确判定并断言；不移动鼠标、不切前台。',
  inputSchema: desktopAssertInput,
  async execute({ input, context }) {
    const raw = await context.session.evaluate<unknown>(wrapPageScript(input.script))
    const verdict = readPageVerdict(raw, input.label)
    const detail = verdict.detail ?? ''
    if (!verdict.pass) {
      throw new Error(`[${input.label}] 断言不成立${detail === '' ? '' : `：${detail}`}`)
    }
    process.stdout.write(`      ✓ 断言成立：${input.label}${detail === '' ? '' : `（${detail}）`}\n`)
    return { summary: input.label, data: { passed: true, detail } }
  },
})

/** `dsh.desktopClick` 的输入。 */
const desktopClickInput = z.strictObject({
  selector: z.string().min(1).describe('目标元素的 CSS 选择器。'),
  /** 未命中时是否报错；缺省 `true`。设 `false` 用于「点了才判断存不存在」的流程。 */
  optional: z.boolean().optional().describe('未命中时不报错（用于「先点开再判断」的导航步骤）。'),
  /** 失败或未生效时的重试次数，缺省 1。 */
  retries: z.number().int().min(0).max(5).optional().describe('点击后未生效时的重试次数（默认 1）。'),
  /** 判定「点击生效」的脚本，须返回 { pass, detail? }；缺省只判断元素仍存在。 */
  verify: z.string().min(1).optional().describe('点击后判断是否生效的脚本，须返回 { pass, detail? }。'),
})

/**
 * Desktop 渲染进程内的元素点击。
 *
 * **为什么用 `element.click()` 而不是视觉坐标点击**：视觉定位对 <40px 的控件落点余量小
 * （实测药丸按钮曾被点到视口外 `[2774, 1817]`，而视口只有 1920×962），而页面内
 * `element.click()` **零坐标偏差**，且实测能真实切换 React 受控组件的状态。
 */
export const desktopClick = defineNode<
  typeof desktopClickInput,
  { clicked: boolean, detail: string },
  DesktopCdpContext
>({
  name: 'dsh.desktopClick',
  description: '在 DSH Desktop 渲染进程内按 CSS 选择器点击元素；零坐标偏差，不动鼠标。',
  inputSchema: desktopClickInput,
  async execute({ input, context }) {
    const attempts = (input.retries ?? 1) + 1
    let lastDetail = ''
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const script = `(async () => {
        const el = document.querySelector(${JSON.stringify(input.selector)});
        if (el === null) return { pass: ${input.optional === true ? 'true' : 'false'}, detail: '未找到匹配元素' };
        el.click();
        await new Promise(r => setTimeout(r, 120));
        return { pass: true, detail: '已点击' };
      })()`
      const verdict = readPageVerdict(await context.session.evaluate<unknown>(wrapPageScript(script)), input.selector)
      lastDetail = verdict.detail ?? ''
      if (!verdict.pass) {
        if (attempt === attempts) {
          throw new Error(`[${input.selector}] 点击未生效：${lastDetail}`)
        }
        continue
      }
      // 有 verify 脚本时以它的判定为准，未生效可重试。
      if (input.verify !== undefined) {
        const verified = readPageVerdict(
          await context.session.evaluate<unknown>(wrapPageScript(input.verify)),
          `${input.selector} 点击生效判定`,
        )
        if (!verified.pass) {
          lastDetail = verified.detail ?? '未生效'
          if (attempt === attempts) {
            throw new Error(`[${input.selector}] 点击未生效${lastDetail === '' ? '' : `：${lastDetail}`}`)
          }
          process.stdout.write(`      ⚠ 未生效（${lastDetail}），重试一次…\n`)
          continue
        }
        lastDetail = verified.detail ?? lastDetail
      }
      process.stdout.write(`      ✓ 已点击 ${input.selector}${lastDetail === '' ? '' : `（${lastDetail}）`}\n`)
      return { summary: input.selector, data: { clicked: true, detail: lastDetail } }
    }
    throw new Error(`[${input.selector}] 点击未生效：${lastDetail}`)
  },
})

/** `dsh.desktopClickText` 的输入。 */
const desktopClickTextInput = z.strictObject({
  /** 目标元素的可见文本（需 trim 后完全相等，避免「插件」误中「插件市场」）。 */
  text: z.string().min(1).describe('目标元素的可见文本，trim 后需完全相等。'),
  /** 限定在哪些容器内查找，缺省在整页查找。 */
  container: z.string().optional().describe('CSS 选择器，限定查找范围；缺省全页。'),
  /** 未命中时是否报错，缺省 `true`。 */
  optional: z.boolean().optional().describe('未命中时不报错。'),
  /** 点击后未生效时的重试次数，缺省 1。 */
  retries: z.number().int().min(0).max(5).optional().describe('点击后未生效时的重试次数（默认 1）。'),
  /** 判定「点击生效」的脚本，须返回 { pass, detail? }。 */
  verify: z.string().min(1).optional().describe('点击后判断是否生效的脚本，须返回 { pass, detail? }。'),
})

/**
 * 按可见文本点击 Desktop 渲染进程内的元素。
 *
 * **为什么需要它**：DSH 界面的类名带构建哈希（实测侧边栏为 `_58WOtG_panelRow` 这类），
 * 换个构建就失效，**不能作稳定选择器**；而纯文本又不适合直接 click（父容器文本包含目标）。
 * 这里取「容器选择器 + 文本完全相等」的交集：既避开哈希类名，又不会误中包含该文本的祖先节点。
 */
export const desktopClickText = defineNode<
  typeof desktopClickTextInput,
  { clicked: boolean, detail: string },
  DesktopCdpContext
>({
  name: 'dsh.desktopClickText',
  description: '按可见文本点击 DSH Desktop 渲染进程内的元素；避开带哈希的类名选择器。',
  inputSchema: desktopClickTextInput,
  async execute({ input, context }) {
    const attempts = (input.retries ?? 1) + 1
    const findScript = `(() => {
      const scope = ${input.container === undefined ? 'document' : `document.querySelector(${JSON.stringify(input.container)})`};
      if (scope === null) return { pass: false, detail: '容器未找到：${input.container ?? '(全页)'}' };
      const want = ${JSON.stringify(input.text)};
      const el = [...scope.querySelectorAll('*')]
        .find(node => node.children.length === 0 && (node.textContent || '').trim() === want);
      if (el === undefined) {
        return { pass: ${input.optional === true ? 'true' : 'false'}, detail: '未找到文本为「' + want + '」的元素' };
      }
      el.click();
      return { pass: true, detail: '已点击「' + want + '」' };
    })()`

    let lastDetail = ''
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const verdict = readPageVerdict(
        await context.session.evaluate<unknown>(wrapPageScript(findScript)),
        `点击「${input.text}」`,
      )
      lastDetail = verdict.detail ?? ''
      if (!verdict.pass) {
        if (attempt === attempts) throw new Error(`[点击「${input.text}」] 未生效：${lastDetail}`)
        continue
      }
      if (input.verify !== undefined) {
        const verified = readPageVerdict(
          await context.session.evaluate<unknown>(wrapPageScript(input.verify)),
          `点击「${input.text}」生效判定`,
        )
        if (!verified.pass) {
          lastDetail = verified.detail ?? '未生效'
          if (attempt === attempts) {
            throw new Error(`[点击「${input.text}」] 未生效${lastDetail === '' ? '' : `：${lastDetail}`}`)
          }
          process.stdout.write(`      ⚠ 未生效（${lastDetail}），重试一次…\n`)
          continue
        }
        lastDetail = verified.detail ?? lastDetail
      }
      process.stdout.write(`      ✓ 已点击「${input.text}」${lastDetail === '' ? '' : `（${lastDetail}）`}\n`)
      return { summary: input.text, data: { clicked: true, detail: lastDetail } }
    }
    throw new Error(`[点击「${input.text}」] 未生效：${lastDetail}`)
  },
})

/** `dsh.sleep` 的输入。 */
const sleepInput = z.strictObject({
  milliseconds: z.number().int().min(0).max(60_000).describe('等待毫秒数。'),
})

/**
 * Node 侧等待。
 *
 * **为什么不能用页面内的 `setTimeout`**：Desktop 窗口在后台时，页面内定时器被系统节流——
 * 实测 3 次 `setTimeout(100)` 实际耗时约 **2.5 秒**（放大约 8 倍）。因此等待异步挂载的
 * 元素时，在页面脚本里轮询会成倍超时（30 轮足以超过 CDP 求值的 30 秒上限，实测报
 * `CDP 求值超时`）。等待放在 Node 侧不受影响。
 */
export const sleep = defineNode<
  typeof sleepInput,
  { waited: number },
  DesktopCdpContext
>({
  name: 'dsh.sleep',
  description: '在 Node 侧等待若干毫秒；用于等界面异步挂载（页面内定时器会被后台窗口节流）。',
  inputSchema: sleepInput,
  async execute({ input }) {
    await delay(input.milliseconds)
    return { summary: `等待 ${input.milliseconds}ms`, data: { waited: input.milliseconds } }
  },
})
