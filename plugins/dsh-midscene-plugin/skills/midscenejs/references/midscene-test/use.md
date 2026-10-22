# 创建和使用测试项目

覆盖：建项目 → 模型与运行环境 → 了解可用 Node → 写 YAML 用例 → 生命周期 → 运行 → 看报告。

## 1. 创建项目

准备 Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` 和 pnpm。运行交互式引导：

```bash
pnpm dlx @midscene/test create
```

命令会依次提示选择项目目录、平台、包管理器，以及是否安装依赖。也可直接传参：

```bash
pnpm dlx @midscene/test create my-tests --platform web --package-manager pnpm
cd my-tests
```

| 参数 | 说明 |
| --- | --- |
| `[directory]` | 项目目录，相对或绝对路径，`.` 表示当前目录。省略时会提示输入，**已有文件不会被覆盖** |
| `--platform <value>` | `web`（Playwright）、`android`、`ios`、`harmony`、`computer`。省略时提示选择 |
| `--package-manager <value>` | `npm` 或 `pnpm`。交互式终端省略会提示；非交互环境检测调用命令的包管理器，识别不到用 `npm` |
| `--yes`、`-y` | 跳过交互并安装依赖。**必须同时提供目录和 `--platform`**；与 `--skip-install` 同用时只生成文件 |
| `--skip-install` | 只生成文件，不安装依赖，**也不生成 Node 说明书** |
| `--help`、`-h` | 查看帮助和示例 |

```bash
# 创建 iOS 项目并安装依赖，全程不询问
pnpm dlx @midscene/test create my-ios-tests --platform ios --package-manager pnpm --yes

# 只生成 Web 项目文件
pnpm dlx @midscene/test create my-web-tests --platform web --package-manager pnpm --skip-install
```

> CI 等非交互环境**必须**提供目录和 `--platform`。

生成结构（Web 模板）：

```text
my-tests/
├── cases/todo.yaml              # TodoMVC 用例
├── nodes/todo.ts                # Web 自定义 Node：初始化、校验和状态记录
├── midscene.config.ts           # 平台配置与 Node 注册
├── midscene-node-spec.web.md   # 安装后自动生成的 Node 说明书
├── README.md
└── README.zh.md
```

其他平台模板在 `midscene.config.ts` 中定义 `todo.setup`，**不包含 `nodes/todo.ts`**，说明书文件名用对应平台名（如 `midscene-node-spec.ios.md`）。

创建项目和生成说明书**不会运行测试**，所以这一步不需要 API Key、浏览器或设备。

### 示例模板（v1.16 起）

五个平台的模板都用**在线 React TodoMVC**，演示添加、删除、完成任务：

- **Web**：每条用例前通过 `todo.setup` 打开 All 视图、清空页面存储并重新加载，用 DOM 确认列表为空，再由 `todo.seed` 添加三个任务；第一条用例校验初始状态，第二条用 AI 删除和完成任务后校验结果；每条用例后由 `todo.captureState` 记录页面状态。
- **Android / iOS / HarmonyOS / 桌面**：用 AI 添加三个任务、删除一个、完成另一个、切换到已完成筛选并校验结果；修改任务前先用 `todo.setup` 打开 All 视图并等待输入框，再由 `aiAssert` 检查列表为空且无遮挡弹窗。

> ⚠️ 运行测试的浏览器或设备**需要能访问该在线网站**。已有任务会保留；检查失败时请切到 All 删除全部任务，或仅清除 TodoMVC 网站数据，关闭遮挡弹窗后重跑。AI 检查可能误判，失败时结合报告确认页面状态。所有模板均**串行**运行，首次用例失败即停止后续用例（`test.bail: 1`），同时正常保存报告、释放资源。

## 2. 配置模型与运行环境

把 `.env.example` 复制为 `.env`，按模型配置页填写模型名、服务地址、API Key。运行前校验模型连接与 Midscene 兼容性：

```bash
pnpm exec midscene-test model verify
pnpm exec midscene-test model verify --help
```

该命令读取当前工作目录的 `.env`，并覆盖已有 Shell 环境变量，无需浏览器或设备。

Web 项目还需安装浏览器：`pnpm exec playwright install chromium`。

其他平台在创建时改 `--platform`，并做对应准备：

| 平台 | 参数值 | 运行前准备 |
| --- | --- | --- |
| Android | `android` | 连接设备，可用 `ANDROID_DEVICE_ID` 选择 |
| iOS | `ios` | 启动 WebDriverAgent。直连配置 `WDA_HOST`、`WDA_PORT`；**经网关时配 `WDA_BASE_URL`**；远程视频流用 `WDA_MJPEG_URL`，直连可用 `WDA_MJPEG_PORT` |
| HarmonyOS | `harmony` | `hdc list targets` 检查连接，`HARMONY_DEVICE_ID` 选择设备；PATH 无 HDC 时设 `HDC_HOME` |
| 桌面端 | `computer` | 安装依赖并授权，`COMPUTER_DISPLAY_ID` 选显示器；无界面 Linux 装 Xvfb 并启用 `MIDSCENE_COMPUTER_HEADLESS_LINUX` |

然后 `pnpm test` 运行示例。运行结束后在 `midscene_run/report/` 查看报告，随后修改 `cases/todo.yaml` 编写自己的用例。

## 3. 了解可用的测试操作（Node）

Midscene Test 把每一种可在 YAML 中调用的能力称为 **Node**。Node 既能在 `steps` 调用，也能在生命周期钩子中调用，写法相同。

所有平台都提供：`aiAct`（按自然语言操作界面）、`aiAssert`（检查预期结果）、`wait`（等待指定时长）。

平台专用 Node 示例：

- **Web**：`gotoUrl`（打开网页）、`setCookies`、`setViewportSize`。
- **Android**：`launch`（启动应用）、`back`、`home`、`runAdbShell`。

### 生成 Node 说明书（事实来源）

不同平台、执行项目、项目版本的可用 Node 可能不同。**不要根据其他项目的示例推测当前项目能力**；`midscene-test nodes` 按最终生效的注册结果生成说明书，它是 Node 名称、输入字段和字符串简写方式的事实来源。人和 AI Agent 都应据此写 YAML。

脚手架安装依赖后自动生成。修改 `agentClass`、顶层 `nodes`、`projects[].nodes`、Node schema 或升级 Midscene 包后应重新生成：

```bash
pnpm run nodes
pnpm exec midscene-test nodes ./e2e --config ./config/midscene.config.ts
pnpm exec midscene-test nodes --project android-smoke
```

说明书生成规则：

- 配置了 `projects` 时，默认**按执行项目分别生成**，文件名 `midscene-node-spec.<project-name>.md`；未显式配置 `projects` 时为 `midscene-node-spec.md`。
- `--project <name>` 只生成指定项目说明书。
- 生成命令只加载配置和 Node 定义，不执行 `setup`/用例/`getAgent`，因此无需启动浏览器、连接设备或调用模型。
- 说明书是**生成文件，不要手动编辑**；配置变化后重新生成。
- 内容含 Available Nodes 与 Node Details（description、字符串简写规则、Zod `inputSchema` 转成的 JSON Schema），并优先列出 `aiAct`、`aiAssert`，其余按名称排序；还含 `Case files`（`files.include`/`exclude`）与 `Config file`，路径均相对说明书所在目录。
- Project name 重复或转换后文件名冲突（含大小写差异），会在写入任何文件前抛错。

## 4. 编写 YAML 测试用例

一个 YAML 文件 = Workflow Document，可含多个 Case；Case 含多个 Step；每个 Step 只调用一个 Node。

```yaml filename=cases/search.yaml
beforeEach:
  - gotoUrl: https://your-shop.example

cases:
  - name: 搜索商品
    steps:
      - aiAct: 在搜索框输入“马克杯”，点击搜索按钮
      - aiAssert: 搜索结果中包含马克杯
```

- `beforeEach`：每个用例执行前运行的准备步骤（可选）。
- `cases`：用例列表，至少一个。每项含 `name` 和 `steps`。
- `name`：用例名称。
- `steps`：按顺序执行的步骤，至少一个；每步只调一个 Node，冒号后填参数。

示例使用了**字符串简写**：`gotoUrl` 后文本作为 `url`，`aiAct`/`aiAssert` 后文本作为 `prompt`。是否支持简写以项目说明书为准。

### 关键 Node：操作与断言

| Node | 用途 | 示例 |
| --- | --- | --- |
| `aiAct` | 按自然语言完成界面操作，可含多个动作 | “搜索马克杯，将第一个商品加入购物车” |
| `aiAssert` | 检查界面是否满足预期，不满足则步骤失败 | “购物车中有一件马克杯” |
| `aiTap` | 点击一个指定目标 | “页面右上角的购物车图标” |

操作完成 ≠ 测试通过，要用 `aiAssert` 明确检查预期。需要自定义失败信息时展开参数：

```yaml
steps:
  - aiAct: 搜索马克杯，将第一个商品加入购物车
  - aiTap: 页面右上角的购物车图标
  - aiAssert:
      prompt: 购物车中有一件马克杯
      message: 加购后购物车内容不符合预期
```

`aiAct` 支持可选 `options.effort`（规划投入程度：`fast`/`balance`/`deepThink`）；省略则沿用 Agent 默认。同时提供 `deepThink` 时 `effort` 优先：

```yaml
steps:
  - aiAct:
      prompt: 完成结算
      options:
        effort: deepThink
```

### 设置 AI 上下文

推荐在 `beforeAll` 用 `setAIContext` 统一配置，让上下文对本文件后续所有 AI 操作生效。也可在 `beforeEach`/`steps` 中设置或清除；修改从调用时开始生效。

- **设置**：传 `context` 字符串；`target` 可为 `default`（各 AI API 共用默认上下文）或 `aiAct`、`aiTap`、`aiAssert` 等具体 API。
- **清除**：省略 `context`（等同 `undefined`）；清除具体 API 后回退到 `default`，清除 `default` 则移除共用上下文。把 `context` 设为空字符串 `""` 可禁用继承。

```yaml
beforeAll:
  - setAIContext:
      target: aiAct
      context: |
        整个流程使用测试账号。
        如出现优惠券弹窗，关闭后继续。
```

单次调用的 `options.context` 优先于 Agent 级配置，各层上下文**不拼接**。配置属于 Agent 实例：`beforeAll` 与用例需共用同一 Agent。

### 其他 Node 调用模式

平台操作与自定义业务 Node 结构相同：**Node 名下填参数**。

```yaml
steps:
  - setViewportSize:
      width: 1440
      height: 900
  - clearCookies: {}
```

无参 Node 用 `{}`。参数还可含嵌套对象/数组，如给 `aiAct` 传参考图（文字 + 图片组成 `prompt`，`options` 单独填）：

```yaml
steps:
  - aiAct:
      prompt:
        prompt: 按照参考图完成设置
        images:
          - name: 目标状态
            url: ./fixtures/target.png
      options:
        deepLocate: true
```

### 设置超时和错误处理

`$` 用于设置由框架控制的 Step 参数，**不会传入 Node 的 `input`**：

```yaml
steps:
  - order.create:
      sku: midscene-mug
      quantity: 1
      $:
        timeout: 30000
        continue-on-error: true
```

- `timeout`：Step 超时（毫秒）。
- `continue-on-error`：`true` 时即使 Step 失败也继续执行当前阶段后续 Step；默认 `false`。**它只控制是否继续执行；只要有 Step 失败，Case 最终就是 `failed`。**

### 使用项目变量与环境变量

执行前会递归解析 Node input：

```yaml
steps:
  - launch:
      uri: ${appUri}
  - api.createOrder:
      baseURL: ${{TEST_API_BASE_URL}}
      payload:
        count: ${orderCount}
```

- `${name}` 读执行项目 `variables`；独占整个标量时保留原始 JSON 类型。
- `${{ENV_NAME}}` 读环境变量，结果始终是字符串。
- 对象/数组变量可作完整值使用，但不能嵌入更长字符串。
- 未定义变量在**收集阶段**失败。变量只解析 Node input，不解析 `$`。

> **YAML 不提供 `set`、`saveAs` 或 Step 输出表达式**。每个 Step 独立运行，不自动接收前序 Step 结果。需共享信息请通过执行项目的 `context` 显式提供。

### 使用 tags 筛选 Case

```yaml
cases:
  - name: Android 冒烟下单
    tags: [smoke, android]
    steps:
      - aiAct: 完成下单
```

执行项目配置 `tags.include` / `tags.exclude`。**exclude 始终优先**；include 非空时，Case 命中任意一个 include tag 即选中。

## 5. 定义执行生命周期

四个钩子都可选，与 `cases` 同级，步骤写法同 `steps`：

| 钩子 | 执行时机 | 常见用途 |
| --- | --- | --- |
| `beforeAll` | 当前 YAML 文件所有用例开始前，**执行一次** | 准备本文件共用的测试数据 |
| `beforeEach` | 每个用例的每次执行开始前（含重试） | 打开页面、重置用例状态 |
| `afterEach` | 每个用例的每次执行结束后（含失败和重试） | 清理本次用例创建的数据 |
| `afterAll` | 当前 YAML 文件所有用例结束后，**执行一次** | 清理本文件共用的测试数据 |

`beforeAll`/`afterAll` 属于**单个 YAML 文件**，不是全局钩子。示例（`data.prepare`/`data.cleanup` 为需自行实现注册的自定义 Node）：

```yaml filename=cases/search.yaml
beforeAll:
  - data.prepare: 准备马克杯和水壶两种测试商品

beforeEach:
  - gotoUrl: https://your-shop.example

cases:
  - name: 搜索马克杯
    steps:
      - aiAct: 搜索马克杯
      - aiAssert: 搜索结果中包含马克杯
  - name: 搜索水壶
    steps:
      - aiAct: 搜索水壶
      - aiAssert: 搜索结果中包含水壶

afterEach:
  - clearCookies: {}

afterAll:
  - data.cleanup: 删除本文件准备的测试商品
```

### 执行顺序与重试

```text
beforeAll
  用例 1：beforeEach → steps → afterEach
  用例 2：beforeEach → steps → afterEach
afterAll
```

配置重试后，失败用例在**本次清理完成、没有操作仍在运行**的前提下，于重试次数内重新执行 `beforeEach → steps → afterEach`。重试**不重新执行 `beforeAll`**，`afterAll` 仍在文件结束时跑一次。

> ⚠️ **重试次数是上限**：操作未退出、清理等待或清理失败都会**提前停止重试**。

### 失败时如何执行

- `beforeEach` 失败：跳过当前用例 `steps`，仍执行 `afterEach`。
- `steps` 失败：仍执行 `afterEach`。
- `beforeAll` 失败：本文件用例标记 `not-run`，仍执行 `afterAll`。
- `afterEach`/`afterAll` 失败：记为失败，不会因是清理步骤而忽略。

默认一阶段内步骤失败后，该阶段剩余步骤不再执行；需继续则设 `continue-on-error`（不把失败改为成功，但**仍受资源安全限制约束**）。**清理 Node 应能处理准备步骤只完成一部分的情况**。

**资源异常是上述继续规则的例外**（v1.16 明确）：若操作未退出，或注册的清理函数等待/失败，则：

- **不再重试**，也不执行同文件的后续 Case
- CLI 还会**停止调度该项目的后续文件**（因为它们共享 `context`）；独立项目可继续执行

普通 `afterEach` Step 失败仍按用例失败处理——只要操作已退出且注册的清理完成，就可以重试。报告写入等**运行基础设施错误**会取消整次运行。

默认一个 Case 失败后仍继续下一个 Case；需提前停止调度用 `test.bail`。文件级前置条件放 `beforeAll`（失败后本文件 Case 不再执行）；有依赖关系的业务步骤放同一个 Case，不要依赖另一条 Case 成功。

## 6. 运行测试

```bash
pnpm exec midscene-test                                    # 运行全部
pnpm exec midscene-test ./cases/smoke                      # 指定目录
pnpm exec midscene-test ./cases/order.yaml                 # 指定单个文件
pnpm exec midscene-test --project android-smoke --project ios-regression
pnpm exec midscene-test --config ./config/midscene.config.ts
pnpm exec midscene-test --result-dir ./test-results
```

未配置 `files` 时，Midscene Test 在测试目录下按 `**/*.{yaml,yml}` 递归查找，自动忽略 `node_modules` 和 `.git`。

**旧版 YAML**：顶层用 `tasks/flow` 的旧文件和 YAML 批配置继续用 `midscene` 命令：

```bash
pnpm exec midscene ./legacy-flow.yaml
pnpm exec midscene --config ./legacy-batch.yaml
```

`midscene-test` **不会自动识别**这些旧文件，也不接受旧批配置和旧 CLI 参数。一个文件完整转换为 `cases/steps` 后才能改用 `midscene-test`。迁移期两类文件可放同一仓库的不同目录，但同一次命令只能选一种格式。

用例运行失败、文档解析失败或收集阶段错误时，CLI 返回退出码 `1`。

## 7. 查看测试结果

每次运行结束，CLI 打印执行结果和 `Report:` 路径。HTML 报告可查看项目、Case、重试记录、截图、Step 输入输出、错误及关联的 Agent 执行详情。

报告总览按 **Project → File → Case** 三层结构组织（v1.16 重构）。读结果时注意：

- 顶部摘要和进度条按最终结果展示 **Passed / Failed / Not run**。**Passed 包含此前失败、后来通过的 Case**。
- 图例中的 **passed after retry** 标记这类「恢复通过」的 Case：它是 Passed 的**子集**，不作为独立结果重复计数。绿色通过区段内的描边留白部分即表示它们。
- 受影响的 Project / Case 名称后有橙色警告图标，悬浮或键盘聚焦可查看提示。**文件整体重试的历史保留在 File 的 Attention 和 Project 提示中**，不会让其中一直通过的 Case 都被标记。

默认报告路径：

```text
midscene_run/report/midscene-e2e-<runId>.html
```

用外置截图时报告是含 `index.html` 和 `screenshots/` 的目录，复制/上传需保留整个目录。可用 `output.reportDir` 改目录。

### 链接到报告中的 Step

URL Hash 参数 `runner-step` 可直接打开指定 Step，除具体 Step ID 外还支持通用选择器：

| 选择器 | 定位目标 |
| --- | --- |
| `first` | 最早开始执行的 Step |
| `last` | 最晚执行完成的 Step |
| `first-error` | 最早开始执行的失败 Step（含失败重试） |
| `last-error` | 最晚执行完成的失败 Step（含失败重试） |

URL 无 Case 路由时搜索整份报告；同时含 `runner-page=case`、`runner-project`、`runner-case` 时只搜索该 Case。无匹配时报告显示提示且不打开无关 Agent 详情。

```text
https://example.com/report/index.html#runner-step=last-error
https://example.com/report/index.html#runner-step=last-error&runner-trace=page
```

## 8. 用例设计约定

YAML 按声明顺序线性执行，不引入 DAG、分支或循环语法；需要复杂编排时，建议在更上层构建脚本生成能力，产出明确的步骤序列交给 Midscene Test。

每个 Node 无状态，不自动继承前序 Step 输出。**断言不要用指代**：

```yaml
steps:
  - aiAct: 点击商品详情页的收藏星标，将其点亮
  # 错误：断言不会继承上一步的指令上下文
  - aiAssert: 上一步的图标已经点亮
```

应让断言自带完整检查条件：

```yaml
steps:
  - aiAct: 点击商品详情页的收藏星标，将其点亮
  - aiAssert: 商品详情页的收藏星标处于点亮状态
```

界面状态保留前一步结果，但后续 Node 指令应独立描述目标，不依赖“上一步”“刚才那个”等指代。
