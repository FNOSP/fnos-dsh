# 配置测试项目

`midscene.config.ts` 是 Midscene Test 的项目配置文件：配置浏览器/设备初始化、注册用例可调用的 Node、设置并发与超时等运行参数。

## 配置文件结构

用 `defineTestProject()` 定义并导出项目配置。

| 选择方式 | 支持文件 | 加载方式 |
| --- | --- | --- |
| 未指定路径，自动查找 | `midscene.config.ts` 或 `midscene.config.mjs` | `.ts` 先过 TypeScript 转换；`.mjs` 由 Node 作为原生 ESM 加载 |
| CLI `--config <路径>` 或 `loadTestProject(路径)` | `.ts` 或 `.mjs` | 同上 |

两个文件同时存在时框架**报冲突**而非静默选择，此时用 `--config` 明确指定。

| 字段 | 用途 |
| --- | --- |
| `setup` | 为隐式的默认执行项目创建共享资源 |
| `nodes` | 注册所有执行项目共享的 Node |
| `projects` | 声明具名执行项目，分别配置 setup 与用例选择规则；使用时把 setup 放进各项目，不再配顶层 setup |
| `test` | 并发数、失败阈值、默认步骤超时 |
| `output` | 报告输出目录 |

## 完整示例：Playwright

在已有工程中手动接入：先装 `@midscene/test`、`@midscene/web`、`playwright`，再 `pnpm exec playwright install chromium`；运行前按模型配置设 API Key 等环境变量。

```ts
import {
  defineProjectSetup,
  defineTestProject,
} from '@midscene/test/config';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { PlaywrightAgent } from '@midscene/web/playwright/agent';
import { chromium, type Browser, type Page } from 'playwright';

interface ProjectContext {
  browser: Browser;
  page: Page;
  agent?: PlaywrightAgent;
}

const midsceneNodes = createMidsceneNodes<ProjectContext>({
  agentClass: PlaywrightAgent,
  getAgent: ({ context }) => {
    context.agent ??= new PlaywrightAgent(context.page);
    return context.agent;
  },
});

const playwrightSetup = defineProjectSetup<ProjectContext>({
  name: 'playwright',
  async setup({ onTeardown }) {
    const browser = await chromium.launch({ headless: true });
    onTeardown(() => browser.close());
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    const context: ProjectContext = { browser, page };
    onTeardown(async () => { await context.agent?.destroy(); });
    return context;
  },
});

export default defineTestProject<ProjectContext>({
  projects: [
    {
      name: 'chromium',
      setup: playwrightSetup,
      files: { include: ['cases/**/*.{yaml,yml}'] },
    },
  ],
  nodes: midsceneNodes,
});
```

关系解读：

- `setup` 创建浏览器和页面，并通过 `onTeardown()` 注册清理。
- `context` 保存运行时资源；Node 通过 `getAgent` 获取 Agent，首次调用创建并存入 `context.agent` 复用。
- `nodes` 注册通用 AI 操作与 Playwright 操作，供 YAML 调用。
- `projects` 声明名为 `chromium` 的执行项目，关联 setup 与 `cases/` 下的 YAML。

## 使用 setup 创建和清理共享资源

每个执行项目在执行 YAML 文件前运行一次 `setup`，其返回的 `context` 由该项目所有 Node 共享。

共享资源**不会在每个用例开始时自动重建**。需要重置页面、Cookie 或业务状态时，通过 YAML 生命周期钩子调用相应 Node。

创建浏览器、Agent 等资源后应**立即通过 `onTeardown()` 注册清理函数**。即使 `setup` 或测试执行失败，框架也会在项目结束时尝试清理，且**清理顺序与注册顺序相反**（上例中先销毁 Agent，再关闭浏览器）。

`setup` 中的 `onTeardown()` 在项目结束时执行；Node 内部注册的清理函数有独立执行范围。

## 项目生命周期

### 项目、文件与用例的生命周期

```text
执行项目开始
├─ setup → 返回项目共享的 context
├─ 文件 A
│  ├─ beforeAll
│  ├─ 用例 1：beforeEach → steps → afterEach → 本次执行的 Node 清理
│  ├─ 用例 2：beforeEach → steps → afterEach → 本次执行的 Node 清理
│  ├─ afterAll
│  └─ 文件级 Node 清理
├─ 文件 B
│  └─ 同样执行该文件的钩子、用例和清理
└─ 项目清理：执行 setup 中注册的 onTeardown()
```

`setup` 属于执行项目，在该项目 YAML 开始前跑一次；`beforeAll`/`afterAll` 属于**单个 YAML 文件**；`beforeEach`/`afterEach` 包围每个用例的每次执行。

重试只重跑失败 Case 的 `beforeEach → steps → afterEach`，**不重跑项目 `setup` 或文件 `beforeAll`**。`setup` 失败时该项目的 YAML 不执行，但仍会尝试执行 setup 中已注册的清理。

`onTeardown()` 的清理范围取决于注册位置：

| 注册位置 | 清理时机 |
| --- | --- |
| 项目 `setup` | 项目结束时，所有已执行文件的清理之后 |
| `beforeAll`、`afterAll` 中的 Node | 当前文件的 `afterAll` 之后 |
| `beforeEach`、`steps`、`afterEach` 中的 Node | 本次用例执行的 `afterEach` 之后，每次重试独立清理 |

每个范围内清理函数按注册顺序逆序执行。

### context 的共享范围

`setup` 返回的 `context` 在当前执行项目内复用：所有 YAML 文件、钩子、用例和重试中的 Node 接收**同一个对象**，框架不会在文件切换、用例切换或重试时复制、清空或重建。

某 Node 写入 `context.orderId` 后，后续 Node（含下一条用例）都能读到。**用例独有数据需在准备步骤重置或清理时移除；重试不会自动恢复 `context` 初始状态。** 页面、登录状态是否重置取决于项目实现。

不同执行项目分别调用自己的 `setup`，即使引用同一个 setup 定义也会**分别调用**。应在 `setup` 函数内部创建资源并返回对象，**不要在模块顶层返回同一个可变对象**，否则会在项目间共享状态。

## 注册官方 Node

### 通用 AI 操作与 Agent 接入

**内核不隐式注册任何 Node**。`midscene-test create` 生成的配置会调用 `@midscene/test/midscene` 的 `createMidsceneNodes()` 注册所选平台的官方 Node；手写配置时必须把返回的 Node 定义显式放入顶层 `nodes` 或 `projects[].nodes`。

`createMidsceneNodes()` 返回两部分：`agentClass.getTestRunnerNodeDefinitions()` 声明的通用 Agent Node 和平台 Node，以及 Test 提供的 `wait` Node。通用能力含 AI 操作、断言与信息提取、界面定位、报告记录等。

```ts
const midsceneNodes = createMidsceneNodes<ProjectContext>({
  agentClass: PlaywrightAgent,
  getAgent: ({ context }) => {
    context.agent ??= new PlaywrightAgent(context.page);
    return context.agent;
  },
});
```

- `createMidsceneNodes()` **不会直接修改全局注册表**；只有加入项目配置后才生效。
- `agentClass` 是 Agent Node 定义的**唯一来源**；`getAgent` 说明执行期间如何从当前 context 取 Agent 实例。
- 若该类没有提供 `getTestRunnerNodeDefinitions()`，工厂会在**注册阶段抛异常**。
- 传入 `PlaywrightAgent`、`PlaywrightPageAgent`、`PlaywrightBrowserAgent`、`AndroidAgent`、`IOSAgent`、`HarmonyAgent` 时，同时获得通用与对应平台 Node 定义；基础 Agent、其他 Web Agent 和 `ComputerAgent` 仅提供通用 Agent Node。
- **Node 的完整名称和输入字段不在文档中维护重复清单**，以项目生成的 Node 说明书为准。

**设备资源所有权**：每个 Device 实例只归属于一个 Agent，`Agent.destroy()` 也会销毁对应 Device。每个执行项目应创建独立资源，**不要在 Agent 销毁后复用其 Device**。

### Playwright

`createMidsceneNodes({ agentClass: PlaywrightAgent, getAgent })` 自动注册 `gotoUrl`、`setCookies`、`clearCookies`、`setViewportSize`。需先安装 `playwright`（`@midscene/web` 的 peer dependency）：`pnpm add -D playwright`。

Cookie 默认从 `process.env` 读取。仅在需要自定义来源时，才在创建 Agent 时传 `testRunner` 选项，如 `getEnv`、`getCookieProfile`、`resolveStorageStatePath`（回调中的 `context` 是当前 Agent）。

> **安全**：`setCookies` **不能在 YAML 中直接填写 Cookie 值**。Midscene Test 会把 Node 输入保存到运行结果，直接填写会让敏感信息进入持久化数据。必须用 `cookiesEnv`、`profile`、`storageStatePath` **三选一**引用。Node 只在执行时读取实际 Cookie 并直接传给 Playwright BrowserContext；结果只记录引用名和数量，不记录 Cookie 的名称、值和作用域。

环境变量可包含 Cookie header、Cookie JSON 数组或 Playwright storage-state JSON。相对的 storage-state 路径默认从当前工作目录解析，需其他根目录时配置 `resolveStorageStatePath`。引用方式只避免 Cookie 进入运行结果；环境变量、profile 和 storage-state 文件本身仍需妥善保管，**不要把含真实 Cookie 的 storage-state 文件提交到代码仓库**。

```yaml
beforeEach:
  - clearCookies: {}
  - setCookies:
      cookiesEnv: E2E_COOKIES
      url: https://example.com
  - setViewportSize:
      width: 1440
      height: 900
  - gotoUrl:
      url: https://example.com/chat
      waitUntil: domcontentloaded
```

### Puppeteer（v1.16 新增）

Puppeteer 提供**同名**的 `gotoUrl`、`setCookies`、`clearCookies`、`setViewportSize` Node，装 `puppeteer` 同级依赖后，把 `PuppeteerAgent`（或 `PuppeteerBrowserAgent`）传给 `createMidsceneNodes()` 即可：

```bash
pnpm add -D puppeteer
```

```ts
import { PuppeteerAgent } from '@midscene/web/puppeteer';
import { createMidsceneNodes } from '@midscene/test/midscene';

const midsceneNodes = createMidsceneNodes<ProjectContext>({
  agentClass: PuppeteerAgent,
  getAgent: ({ context }) => {
    context.agent ??= new PuppeteerAgent(context.page, {
      testRunner: { baseURL: 'https://example.com' },
    });
    return context.agent;
  },
});
```

Playwright 和 Puppeteer **共用同一套 Web Node Schema 和执行实现**，浏览器相关代码只保留 Driver 适配层；两者对 Cookie 的引用和结果脱敏规则也一致。

跨浏览器共用 YAML 时的注意点：

- `gotoUrl.waitUntil` 用 `domcontentloaded`、`load` 或 `networkidle` 即可；**Puppeteer 适配器会把 `networkidle` 映射为 `networkidle0`**。
- 浏览器专用值仍兼容：Playwright 支持 `commit`，Puppeteer 支持 `networkidle0` / `networkidle2`；**把这些值用于另一种 Driver 会返回明确错误**。
- **相对 URL** 会先基于 `testRunner.baseURL` 解析；未配置时再基于当前 HTTP(S) 页面地址解析。

> v1.16 起，`createMidsceneNodes()` 可接受的类扩展为 `PuppeteerAgent`、`PuppeteerPageAgent`、`PuppeteerBrowserAgent`。

### Android

`createMidsceneNodes({ agentClass: AndroidAgent, getAgent })` 注册 `launch`、`terminate`、`runAdbShell`、`back`、`home`、`recentApps`。传入的 Agent 需提供对应方法。

```ts
import { AndroidAgent } from '@midscene/android';
import { createMidsceneNodes } from '@midscene/test/midscene';

const androidNodes = createMidsceneNodes<ProjectContext>({
  agentClass: AndroidAgent,
  getAgent: ({ context }) => context.agent,
});
```

```yaml
beforeEach:
  - runAdbShell:
      command: pm clear com.example.app
      options:
        timeout: 5000
  - launch:
      uri: com.example.app
```

`runAdbShell` 的完整响应会保存在 Node 结果中。

### iOS

`createMidsceneNodes({ agentClass: IOSAgent, getAgent })` 注册 `launch`、`terminate`、`runWdaRequest`、`home`、`appSwitcher`。

```yaml
steps:
  - launch:
      uri: com.example.app
  - runWdaRequest:
      request:
        method: GET
        endpoint: /status
  - terminate:
      uri: com.example.app
```

`runWdaRequest` 的完整响应会保存在 Node 结果中。

### HarmonyOS

`createMidsceneNodes({ agentClass: HarmonyAgent, getAgent })` 注册 `launch`、`terminate`、`runHdcShell`、`back`、`home`、`recentApps`。

```yaml
steps:
  - runHdcShell:
      command: bm dump -a
  - home: {}
```

`runHdcShell` 的完整响应会保存在 Node 结果中。

## 配置执行项目

### 选择用例与控制执行

| 配置项 | 含义 |
| --- | --- |
| `projects[].files` | `include` 选 YAML 文件，`exclude` 排除；匹配规则相对于测试目录 |
| `projects[].tags` | 按标签包含或排除用例 |
| `projects[].variables` | 为 YAML 的 `${variable}` 提供值 |
| `projects[].retry` | 用例失败后的重试次数，默认 `0` |
| `test.testTimeout` | 每个步骤默认超时（毫秒），默认 `120000`；步骤 `$` 可覆盖 |
| `test.bail` | 达到失败用例数阈值后停止调度新任务，`0` 表示不启用 |
| `output.reportDir` | 报告输出目录，默认 `./midscene_run/report` |

脚手架默认选择 `cases/**/*.{yaml,yml}`；未配置 `files` 时按 `**/*.{yaml,yml}` 递归查找。

选中的文件会**去重并按路径排序**。同一项目内文件顺序执行；需要并发时使用持有独立资源的多个项目。原 Test 始终生成统一总报告，报告路径在运行结束后由 CLI 输出。

### 配置多个执行项目

顶层 `nodes` 对所有项目生效，省略时默认 `[]`。单个项目内可用与 `setup`、`files` 平级的 `nodes` 字段注册局部 Node：局部 Node 仅对当前项目生效，并**整体覆盖同名全局定义**，其余全局 Node 仍可用。**同一注册层内重名会报错。**

```ts
import { AndroidAgent } from '@midscene/android';
import { IOSAgent } from '@midscene/ios';
import { defineTestProject } from '@midscene/test/config';
import { createMidsceneNodes, type MidsceneUIAgent } from '@midscene/test/midscene';
import { sharedNodes } from './nodes';
import { androidSetup, iosSetup } from './setup';

interface ProjectContext {
  agent: MidsceneUIAgent;
}

export default defineTestProject<ProjectContext>({
  nodes: sharedNodes,
  projects: [
    {
      name: 'android-smoke',
      setup: androidSetup,
      nodes: createMidsceneNodes<ProjectContext>({
        agentClass: AndroidAgent,
        getAgent: ({ context }) => context.agent,
      }),
      files: {
        include: ['cases/**/*.{yaml,yml}'],
        exclude: ['cases/**/*.draft.yaml'],
      },
      tags: { include: ['smoke'], exclude: ['manual'] },
      retry: 1,
      variables: { appUri: 'com.example.app' },
    },
    {
      name: 'ios-smoke',
      setup: iosSetup,
      nodes: createMidsceneNodes<ProjectContext>({
        agentClass: IOSAgent,
        getAgent: ({ context }) => context.agent,
      }),
      files: { include: ['cases/**/*.{yaml,yml}'] },
      variables: { appUri: 'com.example.ios' },
    },
  ],
  test: {
    maxConcurrency: 1,
    bail: 0,
    testTimeout: 120_000,
  },
  output: {
    reportDir: './midscene_run/report',
  },
});
```

两个项目可用同一份 YAML 文件。收集用例、校验输入和执行测试时，`launch` 等平台 Node 都使用**当前项目中生效的定义**；一个项目的局部 Node 不影响其他项目。

### 并发与资源隔离

**并发调度的单位是执行项目**，`test.maxConcurrency` 限制同时运行的项目数，默认 `1`。单个项目内的 YAML 文件、用例和步骤**顺序执行**——只有一个执行项目时，增大此值也不会让项目内用例并发。

需要不同用例并发时，按目录或标签分配到多个项目并各自创建独立资源：

```ts
export default defineTestProject<ProjectContext>({
  nodes: midsceneNodes,
  projects: [
    {
      name: 'checkout',
      setup: playwrightSetup,
      files: { include: ['cases/checkout/**/*.{yaml,yml}'] },
    },
    {
      name: 'account',
      setup: playwrightSetup,
      files: { include: ['cases/account/**/*.{yaml,yml}'] },
    },
  ],
  test: { maxConcurrency: 2 },
});
```

两个项目分别调用 `playwrightSetup`，各自创建浏览器、页面和 `context`。设备测试同理：并发项目应连接**不同设备**，避免同时操作同一设备。

框架**不会自动把用例均分到不同项目**。两个项目匹配同一 YAML 文件时，该文件会在两个项目中各运行一次（适合跨平台/环境重复验证）。要分批并发，应使用互不重叠的 `files` 或 `tags`。

每个项目从初始化到完成清理始终占用一个并发名额。当前调度在**同一个 Node.js 进程内异步执行**，不会为项目创建独立进程；模块全局变量、外部账号和测试数据仍需项目自行隔离。

### 为各项目生成 Node 说明书

```bash
pnpm exec midscene-test nodes --project android-smoke
```

`--project` 会列出该项目合并全局和局部注册后实际生效的 Node。未指定项目时，若所有项目生效的 Node 定义相同则生成一份共享说明书；**定义不同则报错**并提示用 `--project` 选择，避免混合不同项目的同名定义。

## 超时与取消机制

步骤超时时框架通过该步骤的 `signal` 发出取消通知。CLI 运行收到 `SIGINT`（Ctrl+C）或 `SIGTERM` 会取消运行并传递取消信号。

Node 通过 `AbortSignal` 接收取消通知，**内部异步操作不会因此自动终止**。自定义 Node 需把 `signal` 传给支持取消的 API，或主动检查取消状态。

运行被中断后，框架仍会尝试执行 `afterEach`、`afterAll` 和通过 `onTeardown()` 注册的清理函数。执行 `afterEach`/`afterAll` 中的 Node 时，若运行的 `signal` 已被取消，框架会**换用新的、尚未取消的 signal**，使清理继续执行；这些清理步骤仍受步骤超时配置约束。

> **`onTeardown()` 注册的清理函数不会收到新的 `signal`**。不要在其中复用原步骤的 `signal`：它可能已因超时或中断被取消，导致清理请求立即失败。

### 资源隔离与清理等待（v1.16 强化）

- **超时不代表底层操作已退出。** 继续同阶段的后续 Step 前，框架会等待已取消的操作结束，**默认最多 30 秒**；仍未结束就停止后续步骤。等待单独计时，不占下一步的超时预算。
- **新的 `signal` 不绕过资源占用检查**：同一 Agent 的旧操作尚未退出时，清理 Node 不能与它重叠执行，对应操作会被标记为未执行。例：点击操作超时后仍在运行，`afterEach` 中使用同一 Agent 的点击不能同时开始。
- **生命周期钩子结束后的清理默认分两段等待**：先等运行中的操作退出（默认最多 **1 秒**），操作退出后再等注册的清理回调执行（回调阶段默认最多 **10 秒**）。
- 超过期限时，框架记录 **`cleanup pending`** 并返回快照，**这不表示底层资源已释放**——资源继续保持隔离，底层操作退出后才执行释放。这些期限**不会强制终止**底层操作或清理函数，也不替代 Step 自身的超时。
- **Node 超时后仍未退出时，注册的资源清理会延后**，避免释放正在使用的资源。清理回调抛错后仍会尝试剩余回调。
- 并发名额同理：项目从初始化到**返回清理结果**始终占用名额，清理超时返回 `pending` 时资源仍保持隔离。

## 编程式 API

```ts
import { loadTestProject, runTestProject } from '@midscene/test/config';
import {
  CaseRunner,
  createCaseRunner,
  runWorkflowDocument,
} from '@midscene/test';
```

- **`loadTestProject(path)`**：异步加载显式指定的 `.ts` 或 `.mjs` 项目配置。CLI 未收到 `--config` 时自动查找两个默认文件；两者同时存在则要求明确指定。**不支持同步加载。**
- **`runTestProject()`**：异步发现、运行并汇总整个项目。
- **`CaseRunner` / `createCaseRunner()`**：直接执行纯对象形式的单个用例（不含文件解析和生命周期控制）。
- **`runWorkflowDocument()`**：执行单个文档的完整生命周期及内部全部 Case。

适用于把 Midscene Test 集成到其他工具中，例如带图形界面的本地测试面板。
