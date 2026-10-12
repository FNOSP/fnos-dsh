# 编写自定义 Node

自定义 Node 把业务操作封装为用例作者可在 YAML 中调用的步骤。覆盖：输入定义与校验、跨 Node 数据共享、执行与清理。

## 注册自定义业务 Node

### 1. 定义并注册 Node

```ts filename=midscene.config.ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { defineNode, z } from '@midscene/test';
import { defineTestProject } from '@midscene/test/config';

const createUser = defineNode({
  name: 'user.create',
  description: '创建测试用户数据文件。',
  inputSchema: z.strictObject({
    name: z.string().min(1).describe('测试用户姓名。'),
    email: z.string().email().describe('测试用户邮箱。'),
  }),
  async execute({ input }) {
    const user = { id: randomUUID(), name: input.name, email: input.email };
    const filePath = `fixtures/users/${user.id}.json`;
    await mkdir('fixtures/users', { recursive: true });
    await writeFile(filePath, JSON.stringify(user, null, 2));
  },
});

export default defineTestProject({
  nodes: [createUser],
});
```

- `name` 是 YAML 中使用的操作名称；加入 `nodes` 数组后用例即可调用（扩展已有项目时追加到原数组）。
- `inputSchema` 可选，但定义后框架会在调用 `execute()` 前校验参数。不符合时抛 `NodeInputValidationError`。
- `z.strictObject()` 拒绝未知字段；`.describe()` 的字段说明会出现在生成的 Node 说明书中；TypeScript 据 schema 推导 `input` 类型。

### 2. 在 YAML 中调用

```yaml filename=cases/user.yaml
cases:
  - name: 创建测试用户数据
    steps:
      - user.create:
          name: Alice
          email: alice@example.com
```

框架读取 YAML 找到该 Node 并调用 `execute()`，此时 `input` 为 `{ name: "Alice", email: "alice@example.com" }`，**Node 无需自行解析 YAML 文件**。

用 `async execute({ input })` + `await` 等待异步完成；失败时抛错使 Node 执行失败。本例创建本地数据文件；要在业务系统建用户，把写文件替换为测试数据接口或数据库调用。

### 3. 生成说明书验证注册

```bash
pnpm exec midscene-test nodes
```

在当前目录生成 `midscene-node-spec.md`（显式配置 `projects` 时为 `midscene-node-spec.<project-name>.md`）。检查说明书是否包含 `user.create`、操作说明、`name`/`email` 字段及其描述。

这一步只验证 Node 是否注册、schema 能否导出，**不会执行 Node 或创建数据**。

## Node 执行参数

`execute()` 接收包含本次执行参数和运行信息的对象，可用 `execute({ input, $, context })` 解构。

### 业务参数与步骤配置

`input` 是 `inputSchema` 定义的业务参数；`$` 是框架处理的步骤配置。

```yaml
steps:
  - user.create:
      name: Alice
      email: alice@example.com
      $:
        timeout: 30000
        continue-on-error: true
```

框架把 `$` 与业务参数分开并规范化字段名，`execute({ input, $ })` 中读到：

```ts
input.name;      // 'Alice'
input.email;     // 'alice@example.com'
$.timeoutMs;     // 30000
$.continueOnError; // true
```

`inputSchema` 只需声明 `name`/`email`，**`input` 中不包含 `$`**。`continue-on-error` 允许当前阶段后续步骤在失败后继续执行，但失败步骤仍使整个用例失败。

### 可用的执行字段

| 字段 | 说明 |
| --- | --- |
| `input` | 从 YAML 传入并经 Zod 校验后的业务参数 |
| `$` | 框架控制的通用 Step 属性（如规范化后的 `timeoutMs`、`continueOnError`） |
| `signal` | 超时或运行取消时触发的 `AbortSignal` |
| `context` | `defineProjectSetup()` 返回并共享的项目级运行时资源 |
| `onTeardown()` | 注册当前 Node 所创建资源的清理函数，按 LIFO 执行 |
| `scope` | 标记当前 Node 执行的上下文边界：`case` 或 `document` |
| `case` / `document` | 当前执行位置的详细运行信息 |

## 跨 Node 共享上下文

Node 每次执行都是独立调用，**框架不会自动把上次执行结果传给下次**。业务流程由多个 Node 完成时（如订单退款：创建订单 → 打开退款页 → 删除订单），需要共享同一份测试数据。

### 创建共享上下文

`ProjectContext` 描述类型，`setup` 创建并返回对象：

```ts filename=setup.ts
import { defineProjectSetup } from '@midscene/test/config';
import { chromium, type Page } from 'playwright';
import { orderService } from './order-service';

export interface ProjectContext {
  appBaseUrl: string;
  page: Page;
  orderId?: string; // 在 Node 之间共享测试状态
  orderService: {
    create(input: { status: 'paid' }): Promise<{ id: string }>;
    remove(orderId: string): Promise<void>;
  };
}

export const setup = defineProjectSetup<ProjectContext>({
  name: 'refund',
  async setup({ onTeardown }) {
    const browser = await chromium.launch();
    onTeardown(() => browser.close());
    const page = await browser.newPage();

    const context: ProjectContext = {
      page,
      appBaseUrl: 'https://yoursite.com',
      orderService,
    };
    return context;
  },
});
```

`orderService` 是你自己的测试数据服务，需实现 `create` 和 `remove`。

### 在 Node 中写入数据

```ts filename=nodes.ts
import { defineNode, z } from '@midscene/test';
import type { ProjectContext } from './setup';

const emptyInputSchema = z.strictObject({});
const prepareOrderInputSchema = z.strictObject({
  status: z.literal('paid').describe('待创建订单的状态。'),
});

const prepareOrder = defineNode<
  typeof prepareOrderInputSchema,
  { orderId: string },
  ProjectContext
>({
  name: 'order.prepare',
  description: '调用订单服务创建测试订单。',
  inputSchema: prepareOrderInputSchema,
  async execute({ input, context, onTeardown }) {
    const order = await context.orderService.create(input);
    context.orderId = order.id; // 写入共享对象
    onTeardown(async () => {
      await context.orderService.remove(order.id);
      delete context.orderId;
    });
    return {
      summary: `已创建测试订单 ${order.id}`,
      data: { orderId: order.id },
    };
  },
});
```

`context.orderId = order.id` 修改共享对象，使后续 Node 可读取。**返回 `data` 不会自动把它写入 `context`**——两者独立。

`onTeardown()` 注册的清理函数直接使用本次调用的 `order.id`，创建与清理封装在同一 Node 内，YAML 无需额外清理步骤。

### 在后续 Node 中读取数据

```ts
const getOrderId = (context: ProjectContext) => {
  if (!context.orderId) {
    throw new Error('测试订单尚未创建。');
  }
  return context.orderId;
};

const openRefundPage = defineNode<typeof emptyInputSchema, unknown, ProjectContext>({
  name: 'browser.openRefundPage',
  description: '打开当前测试订单的退款页面。',
  inputSchema: emptyInputSchema,
  async execute({ context }) {
    const orderId = getOrderId(context);
    await context.page.goto(`${context.appBaseUrl}/orders/${orderId}/refund`);
  },
});

export const refundNodes = [prepareOrder, openRefundPage];
```

注册 setup 与 Node 后框架会把 setup 返回对象传给各 Node：

```ts filename=midscene.config.ts
import { defineTestProject } from '@midscene/test/config';
import { refundNodes } from './nodes';
import { setup, type ProjectContext } from './setup';

export default defineTestProject<ProjectContext>({
  setup,
  nodes: refundNodes,
});
```

```yaml
beforeEach:
  - order.prepare:
      status: paid
cases:
  - name: 打开退款页面
    steps:
      - browser.openRefundPage: {}
```

已注册的清理函数在本次用例的 `afterEach` 阶段之后执行，**即使 YAML 没声明 `afterEach` 也会执行**。后续准备或用例步骤失败时框架仍执行已注册清理。每次重试有独立清理范围；若创建订单失败、尚未注册回调，则本次调用没有对应清理函数。

## 进阶用法

### 记录执行结果

`execute()` 可返回 `summary`（报告展示的执行摘要）和 `data`（结构化输出），两者均可选。它们保存在运行结果中，**与共享 `context` 相互独立**。

### 异步操作、错误与取消

异步操作用 `async execute()` + `await`；操作失败应抛出错误。

`signal` 提供 `AbortSignal`：调用支持取消的 API 时传入（如 `fetch(url, { signal })`）；长时间循环可在每次迭代间调用 `signal.throwIfAborted()` 响应超时或取消。

### 资源的生命周期与清理

- 在 `beforeEach`、用例 `steps` 或 `afterEach` 的 Node 中注册的清理，在本次用例执行的 `afterEach` 之后运行；**每次重试有独立清理范围**。
- 在 `beforeAll` 或 `afterAll` 的 Node 中注册的清理，在当前文件的 `afterAll` 之后运行。

每个范围内清理按注册顺序**逆序（LIFO）**执行。Node 可借此释放自建资源或生成报告。注册清理**不会自动创建新 Agent 或重置缓存**——这些取决于项目实现。

测试运行被中断时，框架仍会尝试执行 `afterEach`、`afterAll` 和通过 `onTeardown()` 注册的清理函数。

> `onTeardown()` 注册的清理函数**不会收到新的 `signal`**，不要在其中复用已取消的 step signal。

项目级浏览器和 Agent 的清理见 [configuration.md](configuration.md)。
