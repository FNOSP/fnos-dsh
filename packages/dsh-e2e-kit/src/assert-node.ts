/**
 * 可靠断言 Node：把「页面内精确判定」变成**能真正让用例失败**的步骤。
 *
 * ## 为什么需要它（实测证据）
 *
 * Midscene 的 `javascript` 步骤**无法让用例失败**。它底层是 CDP
 * `Runtime.evaluate`（`@midscene/web` 的 `chrome-extension/page.mjs`），而该调用把页面异常
 * 放在 `result.exceptionDetails` 里返回，Midscene 不检查这个字段——异常被静默吞掉，
 * 步骤照样显示 `✓`。实测三种机制全部无效：
 *
 * | 脚本形态 | 结果 |
 * | --- | --- |
 * | `throw new Error(...)` | 未抛错，异常进了 `exceptionDetails` |
 * | `Promise.reject(...)`（`awaitPromise: true`） | 同上 |
 * | 语法错误 | 同上 |
 *
 * 后果很严重：把 `javascript` 当断言用（`if (!ok) throw`）会得到**假阳性**——用例全绿而
 * 实际未校验任何东西。这不是理论风险，是实测踩到的：一条断言「模块图不含某插件」的用例
 * 在目标确实含该插件时仍然通过。
 *
 * ## 为什么不用 `aiAssert`
 *
 * `aiAssert` 有牙齿（实测不成立确实抛错），但它是**视觉判定**：对「不存在 X」这类否定式
 * 判断不可靠（实测把药丸按钮本身误判成开关控件），对精确字符串（版本号、包名清单）也会
 * 漂移。这些恰恰是需要代码判定的场景。
 *
 * ## 本 Node 的做法
 *
 * 在**页面内**求值并返回判定结果（复用 `javascript` 擅长的精确取值），把结果带回 **Node
 * 进程侧**判定——Node 里抛错会正常传播，用例真的失败。因此它兼具两者的长处：
 * 精确判定 + 可靠的失败语义，且**零模型调用**（比 `aiAssert` 快得多）。
 *
 * ## 用法
 *
 * ```yaml
 * - dsh.assertInPage:
 *     label: 外壳模块图含四个内置插件
 *     script: |
 *       (async () => {
 *         const html = await (await fetch('/app/fn-deepseek-harness')).text();
 *         // ...
 *         return missing.length === 0 ? { pass: true, detail: '四项齐备' }
 *                                     : { pass: false, detail: '缺少 ' + missing.join('、') };
 *       })()
 * ```
 *
 * 脚本**必须返回** `{ pass: boolean, detail?: string }`（或 `true`/`false`）。返回其他形态
 * 视为用例编写错误并抛错——宁可报错，也不要静默放过。
 *
 * @module dsh-e2e-kit/assert-node
 */

import process from 'node:process'
import { defineNode, z } from '@midscene/test'
import type { BridgeContext } from './project.ts'
import { readPageVerdict, wrapPageScript } from './page-script.ts'

/** 输入：要执行的脚本与用于报错的标签。 */
const assertInPageInput = z.strictObject({
  label: z.string().min(1).describe('失败信息里显示的断言名称。'),
  script: z.string().min(1).describe('在页面内求值的脚本，须返回 { pass, detail? }。'),
})

/**
 * 页面内精确断言（失败会真正让用例失败）。
 *
 * 取代「用 `javascript` 步骤做断言」——那种写法是假阳性（见模块注释）。
 */
export const assertInPage = defineNode<
  typeof assertInPageInput,
  { passed: boolean, detail: string },
  BridgeContext
>({
  name: 'dsh.assertInPage',
  description: '在页面内执行精确判定并断言结果；失败会真正让用例失败（javascript 步骤做不到）。',
  inputSchema: assertInPageInput,
  async execute({ input, context }) {
    // **必须自己 JSON.stringify**：CDP `Runtime.evaluate` 默认不传 `returnByValue`，
    // 对象只会回一个 `objectId` 句柄（实测收到 `{className:'Object',objectId:'…'}`），
    // 取不到值。因此把用户脚本包一层，强制序列化成字符串再解析。
    const raw = await context.agent.evaluateJavaScript(wrapPageScript(input.script))
    const verdict = readPageVerdict(raw, input.label)
    const detail = verdict.detail ?? ''
    if (!verdict.pass) {
      throw new Error(`[${input.label}] 断言不成立${detail === '' ? '' : `：${detail}`}`)
    }
    process.stdout.write(`      ✓ 断言成立：${input.label}${detail === '' ? '' : `（${detail}）`}\n`)
    return { summary: input.label, data: { passed: true, detail } }
  },
})
