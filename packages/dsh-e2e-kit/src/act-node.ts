/**
 * 可靠交互 Node：点击 → 页面内核实 → 未生效自动重试。
 *
 * ## 为什么需要它（BUG-03 的教训）
 *
 * Midscene 的单次点击**可能不触发目标行为**：实测两次点击的坐标都落在按钮内，一次生效、
 * 一次不生效（`aria-pressed` 没变），而 `aiAct` 仍会**自述成功**。只信自述会得出
 * 「功能正常」的错误结论——这比失败更危险。
 *
 * `@tnnevol/dsh-e2e-kit` 早已有 `actUntil()` 处理这件事，但它是 **JS 侧的 Promise**，
 * YAML 步骤里无法直接调用，于是用例作者只能写「点一下 → 断言」——一旦那一下没生效，
 * 用例就红，看起来像产品缺陷，实际是**交互不可靠**（同一份用例会时红时绿）。
 *
 * 本 Node 把 `actUntil` 的能力带到 YAML：**先归一判断是否需要点、点完核实、没生效重试一次**，
 * 并在未生效时给出明确报告（而不是把 flaky 伪装成功能缺陷）。
 *
 * ## 用法
 *
 * ```yaml
 * - dsh.actUntil:
 *     label: 关闭「智能搜索」
 *     act: 点击「智能搜索」按钮把它关闭
 *     check: |
 *       (() => {
 *         const b = document.querySelector('.dsh-failover-pill')
 *         return { pass: b?.getAttribute('aria-pressed') === 'false', detail: 'aria-pressed=' + b?.getAttribute('aria-pressed') }
 *       })()
 * ```
 *
 * `check` 与 `dsh.assertInPage` 的脚本同形（返回 `{ pass, detail? }`），但语义不同：
 * 它表达的是「这次交互是否生效」，不成立时会**重试交互**而不是立即判失败。
 *
 * @module dsh-e2e-kit/act-node
 */

import process from 'node:process'
import { defineNode, z } from '@midscene/test'
import type { BridgeContext } from './project.ts'
import { readPageVerdict } from './page-script.ts'

/** 输入：交互描述、核实脚本与重试参数。 */
const actUntilInput = z.strictObject({
  label: z.string().min(1).describe('日志与失败信息里显示的交互名称。'),
  act: z.string().min(1).describe('交给 Midscene 执行的自然语言交互指令（会传给 aiAct）。'),
  check: z.string().min(1).describe('在页面内判定交互是否生效的脚本，返回 { pass, detail? }。'),
  retries: z.number().int().min(0).max(3).optional().describe('未生效时的重试次数，默认 1。'),
  settleMs: z.number().int().min(0).optional().describe('每次交互后的等待毫秒数，默认 2000。'),
})

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 交互 + 核实，未生效自动重试（BUG-03 的规避手段）。
 *
 * 与 `dsh.assertInPage` 的区别：后者是**断言**（不成立即失败）；本 Node 是**交互**——
 * 它在不成立时先重试，全部尝试都无效才失败，并在错误里说明「点击未生效」而不是
 * 含糊的断言失败。
 */
export const actUntil = defineNode<
  typeof actUntilInput,
  { attempts: number },
  BridgeContext
>({
  name: 'dsh.actUntil',
  description: '执行交互并核实是否生效，未生效自动重试（应对 Midscene 单次点击可能不触发行为）。',
  inputSchema: actUntilInput,
  async execute({ input, context }) {
    const attempts = (input.retries ?? 1) + 1
    const settleMs = input.settleMs ?? 2000
    const said: string[] = []

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const output = await context.agent.aiAct(input.act)
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
      said.push(text.slice(0, 200))
      process.stdout.write(`      · [${input.label}] 第 ${attempt}/${attempts} 次交互：${text.slice(0, 70)}\n`)

      await sleep(settleMs)
      const raw = await context.agent.evaluateJavaScript(
        `(async () => {
          try {
            const verdict = await (${input.check});
            return JSON.stringify({ ok: true, verdict });
          } catch (error) {
            return JSON.stringify({ ok: false, message: String(error && error.message || error) });
          }
        })()`,
      )
      const verdict = readPageVerdict(raw, input.label)
      if (verdict.pass) {
        process.stdout.write(`      ✓ 交互生效：${input.label}${verdict.detail ? `（${verdict.detail}）` : ''}\n`)
        return { summary: `${input.label}（${attempt} 次生效）`, data: { attempts: attempt } }
      }
      if (attempt < attempts) {
        process.stdout.write(`      ⚠ 未生效（${verdict.detail || '无详情'}），重试一次…\n`)
      }
    }

    throw new Error(
      `[${input.label}] 交互在 ${attempts} 次尝试后仍未生效——`
      + `这是 Midscene 点击可靠性问题（BUG-03），不是断言失败。`
      + `最后一次自述：${said.at(-1)?.slice(0, 120) ?? '（无）'}`,
    )
  },
})
