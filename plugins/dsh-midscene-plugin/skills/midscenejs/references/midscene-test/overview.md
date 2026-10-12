# Midscene Test 概览

## 是什么

Midscene Test 是面向 AI 驱动的端到端（E2E）测试的新框架，由 `@midscene/test` 提供。核心设计是把**声明式用例**与**可编程扩展**分离：用 YAML + 自然语言描述测试流程，用 TypeScript 扩展业务操作和测试工程能力。

> **Beta 状态**：Midscene Test 用于替代原有 YAML 自动化方案，测试协议与 API 仍在演进。旧 `tasks/flow` YAML 链路进入维护状态，只保留兼容和必要修复。新项目和新增用例推荐使用 Midscene Test。

## 为什么需要它

GUI Agent 能驱动 E2E 流程，但真正落地还需要解决三个问题，Midscene Test 正是针对这三点设计：

1. **需要结合确定性脚本**：实际测试还要做 API 调用、数据准备、生命周期控制等后台任务，保证稳定、极速、高性价比。
2. **核心流程应为声明式语言**：核心流程应是 YAML，而不是在 `.ts`/`.js` 里揉进大量自然语言，影响长期维护。
3. **留有共同维护的扩展空间**：让 Agent 与人类共同维护脚本，确定性工程与自然语言意图之间有清晰边界。

## 提供的关键能力

| 能力 | 说明 |
| --- | --- |
| 基础原子能力 + 定制扩展 | 内置 `aiAct`、`aiAssert` 等通用 AI 操作和平台操作；支持用 TS 自定义 Node 封装业务接口/数据准备 |
| 声明式 YAML 用例 | 用例作者聚焦「测什么」，用自然语言描述操作与校验 |
| 自动生成 Node 说明书 | `midscene-test nodes` 把项目实际注册的 Node、Zod 入参校验导出为 Markdown，供人和 AI Agent 查阅 |
| 可观测性 | 每个步骤的入参、出参、耗时、状态、截图统一记录在报告中 |
| 生命周期与并发控制 | 生命周期钩子（Before/After）、环境并发机制，保障 CI 下稳定运行 |

**注意**：`midscene-test create` 脚手架会按所选平台显式注册官方 Node；**手写 `midscene.config.ts` 时不会隐式注册任何 Node**，需自行配置。

## 实战案例：验证订单退款流程

以电商团队验证已支付订单退款为例，典型的「确定性工程 + 声明式语义」分层：

- **确定性工程（TypeScript Node）**：用例开始前用自定义 Node `order.prepare` 准备测试订单，结束后用 `order.cleanup` 清理。
- **声明式语义（AI 自然语言）**：Agent 按 YAML 中的自然语言指令提交退款并检查结果。

### 推荐目录结构

```text
ecommerce-tests/
├── cases/
│   └── refund.yaml            # 声明式用例：业务测试意图
└── midscene.config.ts         # 确定性工程：自定义 Node、运行环境
```

- `midscene.config.ts`：由自动化/测试平台开发人员维护，实现自定义 Node（Zod Schema + `execute`）并配置浏览器/环境。
- `cases/refund.yaml`：由业务测试人员或 AI Agent 维护，装配高层业务意图。

### Node 说明书的自动产出

工程开发者写好 `order.prepare` 后，`nodes` 工具会自动把它编译进说明书：

```markdown
## order.prepare

* **标题**：准备订单数据
* **说明**：在数据库中提前创建一个处于指定状态的订单。
* **参数格式 (JSON Schema)**：
  { "type": "object", "properties": { "status": { "type": "string", "description": "..." } }, "required": ["status"] }
```

### 用例写法（退款示例）

```yaml
# 1. 确定性工程：数据与环境准备
beforeEach:
  - order.prepare:
      status: paid
  - browser.openRefundPage: {}

# 2. 声明式语义：表达业务测试意图
cases:
  - name: 已支付订单可以申请全额退款
    steps:
      - aiAct: 点击申请退款，选择全额退款并提交
      - aiAssert:
          prompt: 页面显示退款申请已提交，退款金额为订单的全部金额
          message: 全额退款申请提交失败

# 3. 确定性工程：资源清理
afterEach:
  - order.cleanup: {}
```

框架维护者注册的业务 Node 负责数据与页面管理，Midscene Node 负责界面操作与校验；测试意图与技术实现分离，两类维护工作独立演进。

## 相关页面

> 所属技能：[Midscene.js](../overview.md)。模型配置见 [model-config.md](../model-config.md)，平台接入见 [platforms.md](../platforms.md)。

- 新建项目、YAML 用例、运行与报告：[use.md](use.md)
- 运行环境、多执行项目、并发与 API：[configuration.md](configuration.md)
- 自定义 Node 与跨 Node 共享数据：[extend.md](extend.md)
