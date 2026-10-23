---
name: dsh-midscene
description: |
  DSH 环境里做 Midscene 浏览器/设备自动化时的**入口技能**：模型由 DSH 的
  dsh-midscene 插件经本地桥提供，**不需要任何第三方模型密钥**。

  只要任务涉及以下任一项，**先加载本技能**再动手：
  - Midscene、@midscene/web、@midscene/test、MIDSCENE_MODEL_*、GUI Agent、视觉驱动 UI 自动化
  - 用**真实 Chrome** 做端到端测试、点击/输入/断言、浏览器取证、截图
  - Bridge 模式、Chrome 扩展、连接**用户自己的浏览器**
  - Playwright / Puppeteer 集成、Midscene Test、midscene.config.ts
  - 用户说「用 midscene 插件」「连上 chrome 测试」「浏览器自动化」「帮我点一下页面」

  本技能是**本环境的权威入口**：与上游 Midscene 文档冲突时，以本技能为准。
---

# DSH Midscene 插件（本环境的唯一入口）

## 一句话

**模型由 DSH 提供，不要向用户索要任何模型密钥。**

DSH 装了 `@tnnevol/dsh-midscene` 插件，它在本地起一个 OpenAI 兼容的桥，把 Midscene 的
模型请求转发给**当前 DSH 会话正在用的模型**（凭据留在 DSH 的提供方插件里，桥不接触）。
所以在本环境里：

- ✅ 配置是**固定四行**，一条命令就能拿到，**开箱可用**
- ❌ **不要**让用户提供 `MIDSCENE_MODEL_API_KEY`、模型名或服务商
- ❌ **不要**让用户写 `.env`，也不要自己去翻 `~/.zshrc`、`~/.midscene`、npx 缓存找配置
- ❌ **不要**建议用户「先配好模型再来」——那正是本插件要消除的成本

## 第一步：取配置（一条命令）

```sh
curl -s "http://127.0.0.1:<端口>/v1/midscene-env"
```

端口以 `GET /v1/health` 的 `port` 字段为准（默认 `8787`，被占用会跳号）。
返回 JSON 的 `content` 字段就是那四行，**直接可用**：

| 去处 | 怎么用 | 什么时候需要 |
| --- | --- | --- |
| 跑命令行 / 脚本 | 存成**运行目录**的 `.env`（Midscene 只加载当前目录的 `.env`） | **总是**需要——推理在这一侧 |
| Midscene 浏览器扩展 | 打开扩展的**侧边栏设置**粘进去 | **仅当**用户要用扩展自带的 Playground |

同一份配置，内容完全相同。

**Bridge 模式下扩展不需要配模型**：推理发生在跑脚本的 Node/CLI 侧，扩展只负责截图、
点击和输入。不给扩展任何配置，桥接自动化照样跑通；反过来去掉 CLI 侧的
`MIDSCENE_MODEL_NAME`，会直接报 `Model configuration is incomplete` —— 报错点在 CLI 侧，
就是配置归属的判据。所以**不要**把「扩展里没填模型」当成连不上的原因：能否连上只取决于
扩展装没装、首次连接有没有点过 **Allow**。

## 第二步：优先用用户自己的 Chrome（Bridge 模式）

用户要的是**他自己的浏览器**——真实登录态、已装扩展、可见窗口，**不是**另起的 headless 实例：

```sh
npx -y @midscene/web@1 --bridge connect --url "<目标地址>"
```

- 需要用户已安装 **Midscene 浏览器扩展**；首次连接时在扩展弹窗点 **Allow**
- 只有用户明确要「无头跑」「隔离环境」时才用 CDP / Puppeteer 路径

### 静默连接（SDK 路径）

CLI 路径没有静默开关，连接时必然激活标签页。要不打断用户，用 SDK 路径——静默是**一步**，
`connectCurrentTab` 直接连上浏览器的当前标签页：

```js
const agent = new AgentOverChromeBridge()
// 字段名是 activateTab（不是 activate），默认 true；这一步同时完成连接。
await agent.connectCurrentTab({ activateTab: false })
```

自证静默是否生效：`getBrowserTabList()` 的每一项都带 `currentActiveTab`，连接前后各读一次，
前台标签页应保持不变。

想连到**指定**标签页（不是当前前台那个）时，用 `connectNewTabWithUrl(目标地址)` 另开一个。
若确需 `setActiveTabId`（只接受一个参数）：**id 必须转成数字**，传字符串会触发 Chrome
`tabs.update` 的签名错。
不要写成「先 `setActiveTabId` 再 `connectCurrentTab`」——已连接状态下 `setActiveTabId` 会报
`Active tab id is already set`，这个两步式写法跑不通。

### Bridge 模式的能力边界

**Bridge 模式不支持 `evaluate`**。类型声明里没有该方法，调用返回 `undefined` **且不抛错**，
用它读 DOM 或断言 HTTP 状态会静默失败。取证改用下面三条之一：

- 视觉 Agent：`aiQuery` / `aiAssert`，靠截图理解页面；
- 截图存档：留作证据；
- 目标环境日志：例如应用日志里的请求状态，比截图更可靠。

需要 DOM 级精确断言时，改走 Puppeteer / CDP 路径，而不是 Bridge。

## 第三步：按需操作并给出证据

需要「看」→ `aiQuery` / 截图；需要「动手」→ `aiAct` / `aiAssert`。
报告结果时**附证据**（截图路径、断言输出、日志片段），不要只说「已完成」。

### `.env` 的加载差异

| 路径 | `.env` |
| --- | --- |
| CLI | 自动加载**当前工作目录**的 `.env` |
| SDK | **不会**加载，必须注入进程环境 |

SDK 路径下少了注入会报 `MIDSCENE_MODEL_NAME is required`。注入方式：

```sh
set -a && . ./.env && set +a && node your-script.mjs
```

## 常见弯路（都不要走）

| 弯路 | 为什么错 |
| --- | --- |
| 向用户索要模型 key | 桥已经提供；模型就是当前 DSH 会话的模型 |
| 翻 `~/.zshrc` / `~/.midscene` / npx 缓存找配置 | 那里不该有配置，翻也翻不到 |
| 自己起 Puppeteer/Chrome 实例 | 用户要的是**他本人的**浏览器与登录态 |
| 引用上游文档断言「插件不提供 env」 | 上游文档不知道本插件的桥存在，**以本技能为准** |
| 先花十几步探索环境再动手 | 第一步就是上面那条 `curl`，配置立刻到手 |

## 端口与多实例

同一台机器可能有多个 DSH 实例，各自一个桥、端口不同（`8787`、`8788`…）。
**以当前会话所属实例的桥为准**：从该实例的设置页或 `/v1/health` 确认端口，不要默认套用别的实例。
