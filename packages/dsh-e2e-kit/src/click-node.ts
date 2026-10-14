/**
 * 页面内点击并核实：绕开视觉定位的坐标偏差，稳定命中**小控件**。
 *
 * ## 为什么需要它（实测数据）
 *
 * Midscene 的视觉定位对**小控件**（行高 <40px 的菜单项、图标按钮、药丸按钮）落点余量偏小。
 * 实测证据：
 *
 * | 现象 | 数据 |
 * | --- | --- |
 * | 药丸按钮真实位置 | `(648, 893)`，尺寸 `86×28`（视口 1920×962） |
 * | 报告里 `Tap` 的落点 | `(2774, 1817)` —— **完全在视口外**（DPR=2 下的坐标放大） |
 * | `aiAct` 自述 | 「已成功点击…按钮已切换为高亮（启用）状态」 → **与实际不符** |
 *
 * 也就是说：点击既可能**落空**，`aiAct` 还照样**自述成功**（测试规范记录的 BUG-03）。
 * 后果是用例时红时绿，失败信息还指向不了真因。
 *
 * ## 本 Node 的做法
 *
 * 在页面内用 `element.click()` —— 它直接在该元素上派发点击事件，**不经过坐标**，
 * 因此没有定位偏差问题。实测确认它能真实切换 React 受控状态（药丸按钮的
 * `aria-pressed` 从 `false` 变为 `true`）。
 *
 * 测试规范《视口与定位精度的实测约束》对此的建议原文是：
 * **「点击小控件（行高 <40px 的菜单项、页签、图标按钮）优先走 CDP 脚本——页面内
 * `element.click()` 稳定且精确」**。
 *
 * ## 与 `aiAct` 的分工
 *
 * - **本 Node**：目标明确、可被 CSS 选择器唯一定位的小控件（按钮、开关、页签）。
 *   零模型调用，毫秒级，且点不到会明确报错。
 * - **`aiAct`**：目标需要视觉理解才能找到、或路径不确定的多步流程（如「找到并打开插件页」）。
 *
 * 先看清楚目标长什么样，再决定用哪个——不要为了省事让视觉定位去点一个选择器就能
 * 命中的小控件。
 *
 * @module dsh-e2e-kit/click-node
 */

import process from 'node:process'
import { defineNode, z } from '@midscene/test'
import type { BridgeContext } from './project.ts'
import { readPageVerdict, wrapPageScript } from './page-script.ts'

/** 输入：选择器与可选的生效核实。 */
const clickInPageInput = z.strictObject({
  label: z.string().min(1).describe('日志与失败信息里显示的步骤名称。'),
  selector: z.string().min(1).describe('目标元素的 CSS 选择器，必须在页面内唯一命中。'),
  check: z.string().optional().describe('可选的核实脚本（返回 { pass, detail? }），确认点击真的生效。'),
  retries: z.number().int().min(0).max(3).optional().describe('未生效时的重试次数，默认 1。'),
  settleMs: z.number().int().min(0).optional().describe('点击后的等待毫秒数，默认 800。'),
})

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 在页面内点击指定元素，可选核实是否生效。
 *
 * 用于**小控件**：绕开视觉定位的坐标偏差（实测落点可偏到视口外），且零模型调用。
 */
export const clickInPage = defineNode<
  typeof clickInPageInput,
  { attempts: number },
  BridgeContext
>({
  name: 'dsh.clickInPage',
  description: '在页面内按 CSS 选择器点击元素（小控件优先用它，绕开视觉定位坐标偏差），可选核实是否生效。',
  inputSchema: clickInPageInput,
  async execute({ input, context }) {
    const attempts = (input.retries ?? 1) + 1
    const settleMs = input.settleMs ?? 800

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // 点击脚本自身也走包装：找不到元素等异常会被编码回来，不会静默通过。
      const clicked = await context.agent.evaluateJavaScript(wrapPageScript(`(() => {
        const el = document.querySelector(${JSON.stringify(input.selector)});
        if (el === null) return { pass: false, detail: '选择器未命中任何元素：' + ${JSON.stringify(input.selector)} };
        if (el.disabled === true) return { pass: false, detail: '元素处于 disabled，点击无效' };
        el.click();
        return { pass: true, detail: '已在该元素上派发点击' };
      })()`))
      const clickVerdict = readPageVerdict(clicked, input.label)
      if (!clickVerdict.pass) {
        throw new Error(`[${input.label}] 无法点击：${clickVerdict.detail ?? '未知原因'}`)
      }

      // 没有核实脚本时，点击本身成功即算完成。
      if (input.check === undefined) {
        process.stdout.write(`      ✓ 已点击：${input.label}（${input.selector}）\n`)
        return { summary: input.label, data: { attempts: attempt } }
      }

      await sleep(settleMs)
      const checked = await context.agent.evaluateJavaScript(wrapPageScript(input.check))
      const verdict = readPageVerdict(checked, input.label)
      if (verdict.pass) {
        process.stdout.write(`      ✓ 点击生效：${input.label}${verdict.detail ? `（${verdict.detail}）` : ''}\n`)
        return { summary: input.label, data: { attempts: attempt } }
      }
      if (attempt < attempts) {
        process.stdout.write(`      ⚠ 点击未生效（${verdict.detail || '无详情'}），重试一次…\n`)
      }
    }

    throw new Error(
      `[${input.label}] 点击「${input.selector}」后核实仍未通过（${attempts} 次尝试）——`
      + `若元素存在且未 disabled，说明它响应的是其它事件（如拖拽），或核实脚本写得不对。`,
    )
  },
})
