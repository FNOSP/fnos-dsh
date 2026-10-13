# Agent API 与集成

覆盖：API 分类与语义、编排策略、Playwright/Puppeteer 集成、接入任意自定义界面。模型配置见 [model-config.md](model-config.md)。

## API 三大类

### 1. 规划并交互

#### `aiAct` —— 核心 API

接收自然语言描述的**目标**，会观察界面、规划步骤、定位元素并执行，直至完成目标。提示词也可以包含断言条件，Midscene 会在执行中验证并在失败时抛错。

```typescript
await agent.aiAct(
  '搜索耳机，将第一件商品加入购物车，并确认购物车数量变为 1',
);
```

- 灵活自主，适合**多步骤、含条件分支或执行路径不确定**的任务。
- 执行期间会基于最新界面状态**持续重规划**，因此通常比即时交互**更耗时间和 token**。
- 其他常用 API：`aiWaitFor`（等待条件成立）。

单次调用配置：

| 选项 | 说明 |
| --- | --- |
| `deepThink` | 加强任务拆解，用不同模型调用分别完成规划和定位。提高复杂任务稳定性，但增加调用次数和延迟 |
| `deepLocate` | 增加一次模型调用提升定位准确度。目标元素**较小或容易与周围混淆**时启用 |
| `context` | 仅本次调用的补充信息（业务事实、规则、约束、输出要求） |

```typescript
await agent.aiAct('完成结账表单，在下单前停止', {
  deepThink: true,
  deepLocate: true,
  context: '如果出现地址确认弹窗，请选择默认收货地址。',
});
```

### 2. 即时交互（Instant Actions）

每次**只执行一个指定操作**：先定位元素，再对该元素执行固定动作。**这类 API 不规划多步骤**。

> ⚠️ 关键区别：即时交互 API 把提示词视为**目标元素的描述**，而**不是工作流**。"如果出现弹窗先关掉，然后点击结账"这类需求必须用 `aiAct`。

| API | 用途 |
| --- | --- |
| `aiTap` | 定位并点击元素 |
| `aiInput` | 定位输入框并输入内容（**默认 `replace` 模式**：先清空再输入） |
| `aiHover` / `aiScroll` / `aiPinch` / `aiLongPress` | 悬停 / 滚动 / 捏合 / 长按 |
| `aiClearInput` / `aiKeyboardPress` | 清空输入 / 按键 |
| `aiDoubleClick` / `aiRightClick` | 双击 / 右键 |

```typescript
await agent.aiTap('购物车中的结账按钮');
await agent.aiTap('右上角的购物车图标', { deepLocate: true });   // 目标小/不明显时
await agent.aiInput('邮箱地址输入框', { value: 'user@example.com' });
```

`aiInput` 其他模式：`typeOnly`（保留现有内容后输入）、`clear`（仅清空）。

各 API 支持的平台不同，详见官方 API 参考「规划与交互」章节。

### 3. 界面理解（Insight）

只观察界面返回分析结果，**不操作界面**。默认使用当前截图；Web 页面中若需读取截图里不可见的 DOM 信息，可传 `domIncluded`。

| API | 返回 |
| --- | --- |
| `aiAssert` | 条件成立则正常结束；**不成立时抛错**，错误信息包含模型返回的原因 |
| `aiQuery<T>` | 提取结构化数据，提示词需写明期望类型/结构 |
| `aiBoolean` | 布尔值 |
| `aiNumber` / `aiString` / `aiAsk` | 数字 / 字符串 |

```typescript
await agent.aiAssert('购物车中有一件商品，并且页面显示了小计金额');

const items = await agent.aiQuery<
  Array<{ name: string; price: number }>
>('购物车中的商品，{name: string, price: number}[]');
// [{ name: '无线耳机', price: 99.9 }]

const loginDialogVisible = await agent.aiBoolean('登录对话框是否可见'); // true
```

**操作完成不代表测试通过** —— 要用 `aiAssert` 明确检查预期结果。

## AI Context：三层优先级

context 是提供给 AI 的**补充信息**（业务事实、判断规则、约束、输出要求），**用于补充主提示词，不是替代主提示词**。

优先级（**各层不合并**，高优先级覆盖低优先级）：

```
单次调用 options.context  >  aiContexts.<api>  >  aiContexts.default
```

- `aiContexts.default` 只是**缺省回退值**：只有本次调用和对应 API 都没有自己的 context 时才使用。
- 显式传空字符串 `""` 让本次调用**不继承**用户 context。

```typescript
const agent = new PlaywrightAgent(page, {
  aiContexts: {
    default: '页面中的价格单位是美元。',
    aiQuery: '金额只返回数字，不包含货币符号。',
  },
});
```

创建 Agent 后可修改：

```typescript
agent.setAIContext(
  'aiAct',
  '如果出现 Cookie 授权弹窗，请先关闭。页面中的价格单位是美元。',
);
```

## 编排策略：`aiAct` vs JavaScript

完成同一任务的两种方式：

```typescript
// 方式 A：aiAct 自主规划
await agent.aiAct('检查列表中的所有记录，将未完成的记录标记为已完成');
```

```typescript
// 方式 B：JavaScript 编排
const recordNames = await agent.aiQuery<string[]>('列表中的所有记录名称');
for (const recordName of recordNames) {
  const completed = await agent.aiBoolean(`名为“${recordName}”的记录是否标记为“已完成”`);
  if (!completed) {
    await agent.aiTap(`名为“${recordName}”的记录`);
  }
}
```

`aiAct` 模式下 Agent 负责规划执行路径；JS 编排需要开发者在代码中定义条件、循环和步骤顺序。

- **JS 编排**：执行路径明确，可精确控制每个分支，**确定性很强**。但**只能响应代码已覆盖的 UI 变化**——例如分辨率变化导致页面需要额外滚动，代码没处理就会失败。
- **`aiAct`**：能根据最新界面状态决定步骤，更好适应页面变化，但耗时和 token 更高。

**官方选型原则**：

1. **默认使用 `aiAct`** 执行操作目标。
2. **仅当操作流程明确且稳定时**，才使用 JavaScript 编排。
3. 如果 JS 编排代码越来越难维护、或成功率持续下降，**改用 `aiAct`**。

## 集成到 Playwright

### 直接集成（快速原型 / 脚本）

```bash
npm install @midscene/web playwright tsx --save-dev
npx playwright install chromium
```

```typescript
import { chromium } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import 'dotenv/config'; // 读取 .env 中的环境变量

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('https://www.ebay.com/');

const agent = new PlaywrightAgent(page);
await agent.aiAct('搜索 headphone');
const data = await agent.aiQuery<Array<{ itemTitle: string; price: number }>>(
  '列表中的商品名称和价格，{itemTitle: string, price: number}[]',
);

await browser.close();
```

运行后打开生成的 HTML 报告查看截图与决策过程。

> ⚠️ `playwright` 是 `@midscene/web` 的 peer dependency，需显式安装。

### 在 Playwright 测试用例中集成

```bash
npm install @midscene/web --save-dev
```

**第一步：更新 `playwright.config.ts`**，加上 Midscene reporter：

```typescript
reporter: [["list"], ["@midscene/web/playwright-reporter", { type: "merged" }]],
```

**第二步：扩展 `test` 实例**：

```typescript
import { test as base } from '@playwright/test';
import type { PlayWrightAiFixtureType } from '@midscene/web/playwright';
import { PlaywrightAiFixture } from '@midscene/web/playwright';

export const test = base.extend<PlayWrightAiFixtureType>({
  agentForPage: async ({ page }, use) => {
    await new PlaywrightAiFixture(page).useAgent(() => use(new PlaywrightAgent(page)));
  },
});
```

**第三步：写用例**，fixture 提供 `agentForPage`：

```typescript
test('search headphone on ebay', async ({ agentForPage, page }) => {
  await page.goto('https://www.ebay.com/');
  await agentForPage.aiAct('搜索 headphone');
  // ...断言
});
```

### 多标签页 / Browser 级 Agent

- `new PlaywrightBrowserAgent(context, page, options)`：**显式指定**初始 active page。
- `PlaywrightBrowserAgent.create(context, options)`：让 Midscene **自动选择或创建**初始 active page——优先用 `initialPage`，否则复用 context 里的第一个页面，或新建页面。

## 集成到 Puppeteer

```bash
npm install @midscene/web puppeteer tsx dotenv --save-dev
```

```typescript
import 'dotenv/config';
import puppeteer from 'puppeteer';
import { PuppeteerAgent } from '@midscene/web/puppeteer';

const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();
await page.goto('https://www.ebay.com/');

const agent = new PuppeteerAgent(page);
await agent.aiAct('搜索 headphone');

await browser.close();
```

`@midscene/web` 基于 Puppeteer，默认无头模式；可用 `--bridge` 桥接用户自己的 Chrome，或 `--cdp <ws-endpoint>` 直连已有浏览器（见 [skills.md](skills.md)）。

## 接入任意自定义界面

只要实现符合 `AbstractInterface` 的 UI 操作类，就能控制任意界面（IoT 设备、内部应用、车载显示器等）。

```bash
# 从 demo 项目开始
git clone https://github.com/web-infra-dev/midscene-example
cd midscene-example/custom-interface
# 运行演示
```

```typescript
import type { DeviceAction, Size } from '@midscene/core';
import { getMidsceneLocationSchema, z } from '@midscene/core';
import {
  type AbstractInterface,
  defineAction,
  defineActionTap,
  defineActionInput,
} from '@midscene/core/device';

export class SampleDevice implements AbstractInterface {
  // ...连接、截图、尺寸等方法

  getSize(): Promise<Size> {
    // 返回界面的**逻辑尺寸**，不需要考虑设备像素比（dpr）
    // defineActionTap 等动作得到的坐标也是基于这个逻辑尺寸的坐标系
    // 需要时可在你自己的实现中把逻辑坐标转换为物理坐标
  }

  getActionSpace(): DeviceAction[] {
    return [
      defineActionTap(async (param) => { /* 点击 */ }),
      defineActionInput(async (param) => { /* 输入 */ }),
    ];
  }
}
```

各平台的 `getActionSpace` 还可用 `defineAction` 配合 `getMidsceneLocationSchema` 和 `z` 定义自定义动作。

## 相关页面

- 模型选择与配置：[model-config.md](model-config.md)
- 五平台接入：[platforms.md](platforms.md)
- 报错排错：[faq.md](faq.md)
