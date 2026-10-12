# Midscene.js 概览：是什么、能做什么

## 一句话

Midscene 是开源的 **GUI Agent + Testing Kit**，用**纯视觉**方式驱动 Web、移动端和桌面应用的 UI 测试与自动化：**AI 视觉驱动、全平台覆盖、开箱即用**。

## 核心工作方式

Midscene 的操作与断言都仿照人使用软件的方式：**观察屏幕 → 根据看到的内容操作 → 检查界面呈现的结果**。你用自然语言描述任务和预期结果，Midscene 根据截图判断在哪里操作、界面是否符合预期。

### 视觉理解与跨平台操作

就像人从屏幕上找到控件，Midscene 根据元素的外观和位置定位，再通过点击、输入、滚动完成指令。**无需编写选择器或添加语义化标注**，即可定位：

- 纯图标按钮
- 自定义控件
- `<canvas>` 中的元素
- 跨域 iframe 中的元素

### 验证用户真正看到的效果

断言同样采用视觉方式，能检查颜色、选中高亮、布局、视觉反馈，也适用于 `<canvas>` 绘制内容和原生应用界面：

```typescript
await agent.aiAssert('选中的套餐带有蓝色边框和勾选标记');
await agent.aiAssert('邮箱输入框下方显示了错误提示');
```

### 最小示例（Playwright）

```typescript
import { PlaywrightAgent } from '@midscene/web/playwright';

const agent = new PlaywrightAgent(page);

await agent.aiAct('搜索耳机，然后将结果筛选为价格低于 100 美元');
await agent.aiWaitFor('筛选后的搜索结果已显示');
await agent.aiAssert('搜索结果中的每件商品价格都低于 100 美元');
```

打开生成的 HTML 报告可查看截图、操作与断言结果。

## 两条产品线

| 产品线 | 用途 | 包 |
| --- | --- | --- |
| **GUI Agent** | 用 Agent API 直接操作/理解任意界面 | `@midscene/web`、`@midscene/android`、`@midscene/ios`、`@midscene/harmony`、`@midscene/computer` |
| **Testing Kit** | 把 GUI 自动化组织为可维护的 E2E 测试工程 | `@midscene/test`（Beta）+ `@midscene/cli`（YAML runner） |

### Testing Kit 提供什么

- **Midscene Test**（`@midscene/test`，Beta）：把**声明式测试意图**与**可编程工程实现**分离——YAML 写 UI 流程和预期结果，TypeScript 节点封装 API 调用、数据准备、清理。提供项目脚手架、平台预设、生命周期钩子、重试、执行项目隔离与并发；并根据已注册节点生成 Markdown 参考文档，让人和 AI Agent 共同编写用例。
- **内置可观测性**：交互式 HTML 报告展示截图、元素定位、AI 决策过程、操作与断言结果；Midscene Test 额外记录每个 AI 步骤和自定义业务操作的输入、输出、耗时、状态。Playground 可直接试验并调整指令。
- **融入现有测试体系**：`aiAct` 自主执行、`aiTap`/`aiInput` 单步控制、`aiAssert` 断言、`aiQuery` 提取结构化数据；配合 Playwright / Puppeteer / JS SDK 与已有夹具组合。AI 编程 Agent 还可通过 [Midscene Skills](skills.md) 操作界面。

## 能力边界与取舍

### 为什么选纯视觉

业界定位方式主要有两种：结合 DOM 与截图标注，或纯视觉定位。Midscene 选后者，带来：

- 以一致方式操作 Canvas、Android、iOS、桌面应用
- 摆脱渲染技术栈限制，无需维护 Selector 或界面标注
- 能校验颜色、高亮、布局等用户实际看到的效果
- 更接近真实用户操作方式，能发现潜在交互设计问题
- **Token 消耗只与页面分辨率和任务复杂度相关**，不随 DOM 规模膨胀

### 代价

纯视觉定位要求模型具备视觉理解能力，**只能使用指定的对 GUI 操作稳定的模型，而不是任意 LLM**。Midscene 用更高的模型能力要求，换取跨平台一致性和更低的界面维护成本。

数据提取/页面理解场景仍可按需附带 DOM 信息。

### Benchmark 表现

| Benchmark | 成绩 | 测试配置 |
| --- | --- | --- |
| AndroidWorld | Pass@1 **93.10%**、Pass@2 95.69%、Pass@3 97.41% | Midscene 1.9.5、Gemini-3.5-Flash |
| MobileWorld | Pass@1 **78.63%（92/117）** | Midscene 1.10.3、Gemini-3.6-Flash |
| AppControlBench | Pass@1 **96.7%（58/60）** | Midscene 1.12.0、Doubao Seed 2.1 Turbo |

AppControlBench 评测中 60 个任务**模型调用总费用仅 0.59 美元**（58 个通过）——因为不发送庞大 DOM 树。

支持的模型含 `Qwen3.x`、`Doubao-Seed-2.1`、`DeepSeek V4 Flash`、`GLM-4.6V`、`gemini-3.5-flash`、`UI-TARS` 等，也包括可自托管开源选项。详见 [model-config.md](model-config.md)。

## 怎么开始（按目标选）

| 目标 | 路径 |
| --- | --- |
| 零代码体验 | Chrome 扩展 Playground（[skills.md](skills.md)） |
| 写自动化测试 | Playwright / Puppeteer / JS SDK（[integration.md](integration.md)） |
| 搭 E2E 测试工程 | Midscene Test（[midscene-test/](midscene-test/)） |
| 让 AI Agent 操作界面 | Midscene Skills（[skills.md](skills.md)） |
| 写 YAML 脚本 | 旧版 YAML runner（[yaml-runner.md](yaml-runner.md)） |
| 测试非 Web 平台 | Android / iOS / HarmonyOS / 桌面（[platforms.md](platforms.md)） |

## 资源

- 示例项目：[midscene-example](https://github.com/web-infra-dev/midscene-example)
- GitHub：[web-infra-dev/midscene](https://github.com/web-infra-dev/midscene)
- License：MIT

构建于 UI-TARS、Qwen、Playwright、Puppeteer、scrcpy、appium、WebDriverAgent、YADB、libnut-core 等开源项目之上。
