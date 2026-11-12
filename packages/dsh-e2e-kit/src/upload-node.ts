/**
 * 把本地文件直接注入页面的 `input[type=file]`。
 *
 * ## 为什么需要它
 *
 * fnOS 应用中心的「手动安装 → 从电脑上传」有一个 `<input type="file" accept=".fpk">`。
 * 常规做法是让视觉模型去点「从电脑上传」并操作系统文件选择器，本仓库实测这条路**不可靠**：
 *
 * | 失败形态 | 实测现象 |
 * | --- | --- |
 * | 模型额度/限流 | `429 使用量已超出频率限制` → `502 额度已用尽`，上传步骤整体失败 |
 * | 扩展断连 | 上传步骤跑 4 分钟后 `Error: Connection lost, reason: client namespace disconnect` |
 * | 桥调用超时 | `Bridge call timeout after 30000ms: getBrowserTabList` |
 * | 重规划死循环 | 模型在「回桌面 → 找应用中心图标」上反复重规划，`planning cycle limit (20) reached` |
 *
 * 这些失败都发生在**视觉定位与文件选择器**环节，与被测物无关。本节点绕开两者：
 * Node 侧读本地文件 → base64 传入页面 → 页面内构造 `File` 并塞进 input → 派发 `change`。
 * 零模型调用，全程确定性。
 *
 * ## 副作用说明
 *
 * 注入后 **React 会接管并清空 input**（实测 `input.files.length` 随即归 0），
 * 这是正常现象——文件已被应用接收。因此判定「注入成功」要看**页面是否出现后续状态**
 * （如 fnOS 的「未经验证应用的安全提示」），不能看 input 里还挂着文件。
 *
 * ## 2026-11-12 更正：不需要「切来源」，也不需要让元素可见
 *
 * 早前这里写着「必须先切上传来源，并拦下 `input.click()`」，更早还要求把元素挪到
 * `body` 并给可见尺寸——**这些结论都已作废**。
 *
 * 真正的前提只有一个：**注入要发生在「手动安装」对话框已打开之后**。应用是在对话框
 * 挂载后才接上处理的；在那之前注入，`input.files` 有值但没人消费。
 *
 * 至于可见性：`input.files = dataTransfer.files` 是普通属性赋值，与元素是否可见、
 * 是否进入无障碍树**完全无关**。当初之所以去动祖先 `display`，是因为走了 CDP
 * `upload_file`（它按无障碍树找元素）——那条通道的限制被误当成了注入的必要条件。
 * 而改祖先 `display` 造成过真实事故：fnOS 把两枚 input 放在同一个 `display:none`
 * 容器里，放开容器会连带放出目录 input，页面上凭空多出一个「选择文件」按钮。
 *
 * @module dsh-e2e-kit/upload-node
 */

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { defineNode, z } from '@midscene/test'
import type { BridgeContext } from './project.ts'
import { readPageVerdict, wrapPageScript } from './page-script.ts'

/** 输入：本地文件路径与可选的定位条件。 */
const uploadFileInput = z.strictObject({
  label: z.string().min(1).describe('日志与失败信息里显示的步骤名称。'),
  path: z.string().min(1).describe('本地文件的绝对路径；必须是文件，不是目录。'),
  /** 目标 input 的 accept 匹配串，默认 `.fpk`（fnOS 手动安装用的就是这个）。 */
  accept: z.string().optional().describe('按 accept 属性筛选 input，默认 ".fpk"。'),
  /**
   * 注入后要等待的页面文本片段。
   *
   * fnOS 收到文件后会弹出「未经验证应用的安全提示」，这是「文件已被接收」的可观察证据。
   */
  expectText: z.string().optional().describe('注入后页面应出现的文本片段，用于确认文件已被接收。'),
  /** 等待 `expectText` 出现的超时毫秒，默认 30000。 */
  timeoutMs: z.number().int().min(0).optional().describe('等待页面文本出现的超时，默认 30000 毫秒。'),
  /** 派发 `change` 事件，默认 true。 */
  dispatchChange: z.boolean().optional().describe('是否派发 change 事件，默认 true。'),
})

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 往页面的 `input[type=file]` 注入本地文件。
 *
 * 典型用法（fnOS 应用中心安装 FPK）：
 *
 * ```yaml
 * - dsh.uploadFile:
 *     label: 注入 FPK 到「从电脑上传」
 *     path: ${fpkDir}/fn-deepseek-harness.fpk
 *     accept: .fpk
 *     expectText: 未经验证应用的安全提示
 * ```
 */
export const uploadFile = defineNode<
  typeof uploadFileInput,
  { fileName: string, bytes: number },
  BridgeContext
>({
  name: 'dsh.uploadFile',
  description: '把本地文件直接注入页面的 file input（绕过文件选择器与视觉定位，确定性上传）。',
  inputSchema: uploadFileInput,
  async execute({ input, context }) {
    const bytes = await readFile(input.path)
    const base64 = bytes.toString('base64')
    const accept = input.accept ?? '.fpk'
    const dispatchChange = input.dispatchChange ?? true

    // 「开对话框 → 等待渲染 → 注入」放在**同一个页面脚本**里完成。
    // 拆成多次 evaluate 时实测会失败：fnOS 的对话框渲染与 input 挂载有延迟，
    // 分次调用时注入落在还没挂好 input 的页面上。
    const script = `(async () => {
      const accept = ${JSON.stringify(accept)};
      const base64 = ${JSON.stringify(base64)};
      const fileName = ${JSON.stringify(input.path.split('/').pop() ?? 'upload.bin')};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const byText = (label) => [...document.querySelectorAll('*')]
        .find(el => el.children.length === 0 && (el.textContent || '').trim() === label);
      // 按 accept 找非目录 input：不设 id、不改样式、不碰祖先。
      const input = [...document.querySelectorAll('input[type=file]')]
        .filter(i => !i.hasAttribute('webkitdirectory'))
        .find((i) => {
          const attr = (i.getAttribute('accept') || '').toLowerCase();
          if (attr === '') return true;
          return accept.toLowerCase().split(',').some(a => attr.includes(a.trim()));
        }) ?? null;
      if (input === null) {
        return { pass: false, detail: '未找到匹配的 file input（accept=' + accept + '）' };
      }
      const bin = atob(base64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
      const file = new File([buf], fileName, { type: 'application/octet-stream' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      if (${dispatchChange ? 'true' : 'false'}) {
        // 事件序列必须**完整**：实测只派发 input/change 时应用收不到文件
        //（不弹安全提示、input.files 也不被清空）；补上 pointerdown/pointerup/click
        // 后才走通——应用在 change 之外还监听了指针事件来判定「用户真的选了文件」。
        input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // 注入后**不**在页面里长等：Bridge 的单次调用有 30 秒上限（实测
      // 'Bridge call timeout after 30000ms: evaluateJavaScript'），
      // 等待判定放到 Node 侧分次轮询。
      return { pass: true, detail: '已注入 ' + fileName + '（' + buf.length + ' 字节）' };
    })()`

    // 先开「手动安装」对话框（Node 侧分步做：页面脚本里的长等待会撞上
    // Bridge 的 30 秒单次调用上限）。
    //
    // 这里必须**容忍页面还没渲染完**：项目 setup 会先把复用页导航回目标地址，SPA 起来
    // 需要时间——实测导航后立刻执行时「既无『手动安装』也无『应用中心』」，属于时序而非
    // 元素缺失。因此脚本内部短等 + Node 侧重试。
    const openDialogScript = `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const byText = (label) => [...document.querySelectorAll('*')]
        .find(el => el.children.length === 0 && (el.textContent || '').trim() === label);
      const waitFor = async (label, timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const found = byText(label);
          if (found) return found;
          if (Date.now() > deadline) return null;
          await sleep(300);
        }
      };
      // 已经在应用中心里（左侧有「手动安装」）
      const manual = await waitFor('手动安装', 8000);
      if (manual) { manual.click(); return { pass: true, detail: '已点击「手动安装」' }; }
      // 桌面上没有入口：点「应用中心」图标打开应用中心窗口。
      // 实测要点：目标取 [desktopItemId] 那个图标容器（文本节点容器上派发事件无效），
      // 且**单击**即可打开（不需要双击）。
      const icon = await waitFor('应用中心', 8000);
      if (icon === null) return { pass: false, detail: '页面上既无「手动安装」也无「应用中心」入口' };
      (icon.closest('[desktopItemId]') || icon).click();
      const manual2 = await waitFor('手动安装', 10000);
      if (manual2 === null) return { pass: false, detail: '打开应用中心后仍未找到「手动安装」入口' };
      manual2.click();
      return { pass: true, detail: '已点「应用中心」并点击「手动安装」' };
    })()`
    let openVerdict = readPageVerdict(
      await context.agent.evaluateJavaScript(wrapPageScript(openDialogScript)),
      input.label,
    )
    for (let attempt = 1; attempt <= 2 && !openVerdict.pass; attempt += 1) {
      await sleep(2500)
      openVerdict = readPageVerdict(
        await context.agent.evaluateJavaScript(wrapPageScript(openDialogScript)),
        input.label,
      )
    }
    if (!openVerdict.pass) {
      throw new Error(`[${input.label}] 无法打开「手动安装」对话框：${openVerdict.detail ?? ''}`)
    }
    // 等对话框渲染完（fnOS 挂载 file input 有延迟）
    await sleep(1500)

    const raw = await context.agent.evaluateJavaScript(wrapPageScript(script))
    const verdict = readPageVerdict(raw, input.label)
    if (!verdict.pass) {
      throw new Error(`[${input.label}] 注入失败：${verdict.detail ?? '未知原因'}`)
    }
    process.stdout.write(`      ✓ 已注入文件：${input.label}（${verdict.detail ?? ''}）\n`)

    // 文件被应用接收后，React 会清空 input；因此用「页面出现后续文本」判定成功。
    // 轮询放在 Node 侧：页面脚本里的长等待会撞上 Bridge 的 30 秒调用上限。
    if (input.expectText !== undefined) {
      const timeoutMs = input.timeoutMs ?? 30_000
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const seen = await context.agent.evaluateJavaScript(
          wrapPageScript(`String(document.body.innerText || '').includes(${JSON.stringify(input.expectText)})`),
        )
        if (readPageVerdict(seen, input.label).pass === true) {
          process.stdout.write(`      ✓ 文件已被接收：页面出现「${input.expectText}」\n`)
          return { summary: input.label, data: { fileName: input.path.split('/').pop() ?? '', bytes: bytes.length } }
        }
        await sleep(500)
      }
      throw new Error(`[${input.label}] 注入后在 ${String(timeoutMs)}ms 内未出现「${input.expectText}」——文件可能未被应用接收`)
    }

    return { summary: input.label, data: { fileName: input.path.split('/').pop() ?? '', bytes: bytes.length } }
  },
})
