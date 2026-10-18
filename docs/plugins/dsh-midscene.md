# Midscene Bridge

`@tnnevol/dsh-midscene` 在本地托管一个 OpenAI 兼容的桥接服务，把 [Midscene](https://midscenejs.com) 的模型请求接到 **DSH 宿主模型层**——凡是 DSH 里能用的模型（DeepSeek 官方路由、CodeBuddy、Codex、你自定义的 OpenAI/Anthropic 兼容端点），Midscene 都能用。凭据、请求协议与 token 续期由各提供方插件在宿主内处理，桥不接触。

用途：让会话中的 agent 用自然语言驱动浏览器完成「打开页面 → 交互 → 断言」的 E2E 测试，替代逐步编排 chrome-devtools MCP 的日常用法。

## 安装

**本插件不随 fnOS 应用（FPK）内置分发**——浏览器自动化是用完即走的场景，需要时自行安装。任何 DSH 环境（含 fnOS 上的 DSH）都执行：

```sh
dsh plugin --profile web add @tnnevol/dsh-midscene@0.2.1-rc.2.1
```

安装后重启 DSH Web profile。插件版本信息见[插件总览](/plugins/)。

> 同一 DSH 里已安装的应用内置插件（fnOS、Codex Auth、CodeBuddy、Failover Search）随应用升级自动更新，与本插件互不影响。

## 桥接服务

插件启动后在 **`127.0.0.1`** 提供四个端点（只绑回环地址，不向局域网暴露）。**端口默认 8787，被占用时自动向上尝试**（最多 20 个），实际端口以插件设置页或 `/v1/midscene-env` 为准：

| 端点 | 用途 |
| --- | --- |
| `GET /v1/models` | 模型目录：DSH 当前全部可用模型，标识为「提供方/模型」形式 |
| `GET /v1/midscene-env` | **生成接入配置**：直接给出可写入 `.env` 的四行变量（`?model=` 指定模型，省略则自动挑一个具备图片能力的） |
| `POST /v1/chat/completions` | 对话补全：流式（SSE）与非流式 |
| `GET /v1/health` | 健康检查：提供方列表、模型数量、附件服务可用性 |

健康检查示例：

```sh
curl -s http://127.0.0.1:8787/v1/health # 若端口已自动跳号，用插件设置页显示的实际端口
```

```json
{
  "status": "ok",
  "providers": ["openai-codex", "deepseek-official", "codebuddy"],
  "models": 24,
  "attachments": true
}
```

端口**不固定**：默认从 `8787` 开始，被占用时自动尝试 `8788`、`8789`…（最多 20 个）。换成可用端口后：

1. 插件会把**实际端口写回配置**，重启后直接用它（不会重复扫描）；
2. 启动日志会提示端口已变化，并要求重新拉取接入配置；
3. 插件设置页与 `/v1/midscene-env` 都返回**实际端口**。

> **端口变了要重新拉一次 `.env`**：这是自动换端口的代价。若整段 20 个端口都被占用，插件会报错并列出尝试区间与处理建议（`lsof -i :8787` 找到进程后停止它，或把配置的 `port` 改到空闲区间）。

想固定端口时，在插件配置里把 `port` 设为你想要的端口即可（仍会在占用时自动跳号）。

## 接入 Midscene

**不需要准备任何模型 API key。** 插件的存在意义就是让 Midscene 用 DSH 已经配好的模型：凭据在 DSH 的提供方插件里，桥不接触、也不转发。

Midscene 强制要求四个模型环境变量（其中 `MIDSCENE_MODEL_FAMILY` 决定它的提示词模板与坐标解析协议）。插件知道 DSH 里有哪些模型，因此**直接替你算好这份配置**。

### 一条命令生成接入配置

这份配置有**两个去处**，内容完全相同：

| 去处 | 怎么用 |
| --- | --- |
| 命令行 | 在**运行 Midscene 命令的工作目录**保存为 `.env`（Midscene 只加载当前目录的 `.env`） |
| **Midscene 浏览器扩展** | 打开扩展的**侧边栏设置**，把这四行粘进去（扩展侧边栏的 Playground 就是靠它接上 DSH 的模型） |

```sh
curl -s http://127.0.0.1:8787/v1/midscene-env |
    python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" >.env
```

得到的 `.env`：

```sh
# DSH Midscene Bridge 接入配置（由插件生成，无需填入任何真实密钥）
MIDSCENE_MODEL_BASE_URL="http://127.0.0.1:8787/v1"
MIDSCENE_MODEL_API_KEY="local-bridge"
MIDSCENE_MODEL_NAME="codebuddy/glm-5.3-flash"
MIDSCENE_MODEL_FAMILY="glm-v"
```

| 变量 | 说明 |
| --- | --- |
| `MIDSCENE_MODEL_BASE_URL` | 固定指向本地桥 |
| `MIDSCENE_MODEL_API_KEY` | **占位值**。桥不做鉴权（回环绑定 + 本机使用），填真实密钥也不会被转发 |
| `MIDSCENE_MODEL_NAME` | 「提供方/模型」形式（DSH 的模型标识），不是厂商模型名 |
| `MIDSCENE_MODEL_FAMILY` | 由插件按模型 id 推断（如 `glm-5.3` → `glm-v`、`gpt-6-luna` → `gpt-6`、`deepseek-flash` → `deepseek`） |

> 该文件只含占位值，仍建议放在不入版本管理的位置并确认 `.gitignore` 覆盖它。

### 选模型

不指定模型时，插件自动挑一个**具备图片能力且家族可推断**的模型：

```sh
curl -s http://127.0.0.1:8787/v1/models | python3 -c "
import json,sys
for m in json.load(sys.stdin)['data']:
    print(('IMG ' if m.get('vision') else '    ') + m['id'])
"
```

**只有标记 `IMG`（`vision: true`）的模型能驱动 Midscene**——它靠截图理解页面，需要图片输入。

指定模型时用 `?model=`，返回里会带上该模型的家族与同能力的备选模型：

```sh
curl -s "http://127.0.0.1:8787/v1/midscene-env?model=codebuddy/glm-5.3-flash"
```

#### 关于 `MIDSCENE_MODEL_FAMILY`

插件按模型 id 推断家族，覆盖 Midscene 官方支持的主要系列（豆包 Seed、Qwen、智谱 GLM、Gemini、GPT、DeepSeek、Kimi、MiMo、UI-TARS）。

- **推断不出来时不写入该变量**，并在响应里给出 `familyWarning`。这是刻意的保守行为：错的 family 会让坐标定位**静默失准**，比缺值更难排查。
- 遇到 `familyWarning` 时：换一个已知系列的模型（如目录里的 GLM / DeepSeek / GPT / Kimi 系列），或到 [Midscene 模型配置](https://midscenejs.com/zh/model-common-config)查该模型对应的家族值手动补上。
- 部分内部代号模型（如 CodeBuddy 的 `hy3`、`space-bunny`、`minimax-m3`）不在 Midscene 官方家族列表内，插件不会替它们猜家族。

### 跑一条命令

```sh
npx -y @midscene/web@1 connect --url https://example.com
npx -y @midscene/web@1 act --prompt "点击登录按钮"
npx -y @midscene/web@1 assert --prompt "页面显示登录表单"
npx -y @midscene/web@1 close
```

## 内置技能

安装插件后，**7 个 Midscene 技能**会直接出现在会话的技能目录里，**无需再执行 `npx skills add`**：

| 技能 | 平台 / 定位 |
| --- | --- |
| `browser-automation` | 浏览器（Puppeteer / CDP / Bridge 三种模式） |
| `computer-automation` | 桌面（macOS / Windows / Linux） |
| `android-device-automation` | Android（ADB） |
| `ios-device-automation` | iOS（WebDriverAgent） |
| `harmonyos-device-automation` | HarmonyOS（HDC） |
| `vitest-midscene-e2e` | 用 Vitest + Midscene 写跨平台 E2E |
| `midscenejs` | 知识与 API 参考（概念、模型与 FAMILY、Agent API、YAML 运行器、Midscene Test） |

前 6 个来自官方 [midscene-skills](https://github.com/web-infra-dev/midscene-skills)（与 Midscene 官方文档「支持的平台」一一对应），`midscenejs` 来自 [tnnevol/skills](https://github.com/tnnevol/skills)。来源与版本见包内 `skills/SOURCE.md`。

**技能内容与官方逐字节一致**：插件不改上游文件，升级时整目录覆盖即可，不存在需要重新施加的补丁。

### 模型来源：由插件注入的环境说明

官方技能面向 Midscene 通用用户，其「模型配置」节会教 agent 申请 Gemini／豆包等第三方 API key；而本插件的意义是让 Midscene 用 **DSH 已有模型**（桥托管本地端点、零第三方密钥）。两者直接冲突。

做法是**分发时注入一段环境说明**，而不是改文件——agent 读到的技能内容 = 环境说明 + 官方原文。说明里告知：本环境用桥、配置是固定四行、**不要向用户索要模型 API key**；官方原文中的服务商与 key 示例仅作背景知识。

这样技能文件与官方保持一致且可核对，同时 agent 不会照抄官方示例去要密钥。

> 移动端/桌面的 CLI 包（`@midscene/android` 等）不由插件提供；技能执行时用 `npx -y @midscene/<平台>@1` 按需拉取，插件不必为未使用的平台背负依赖。桌面自动化在本地模式会接管真实鼠标键盘，使用时留意。
>
> 你自行安装的同名技能优先（插件注册的技能在发现优先级里排在项目与用户目录之后），插件不覆盖、不重复提示。卸载插件后内置技能同步消失。

## 其他运行方式

Midscene 的三种运行方式读取**同一套模型环境变量**，接入配置一次写好即可共用：

| 运行方式 | 命令 | 说明 |
| --- | --- | --- |
| 即席 CLI | `npx -y @midscene/web@1 ...` | 上面的 connect / act / assert |
| YAML 脚本运行器 | `midscene`（`@midscene/cli`） | `tasks/flow` 格式脚本，可生成可视化报告 |
| Midscene Test | `midscene-test`（`@midscene/test`） | 声明式 YAML 用例 + TypeScript 自定义 Node；当前处于 Beta |

桥接侧不为任何一种方式增加专用端点——三者都打同一个 `/v1/chat/completions`。

> **额度提示**：Midscene 每一步操作都要调用视觉模型，因此按所选提供方计费。多步骤任务会消耗较多额度；Midscene 自带缓存可减少重复调用。建议先用小页面验证流程，再跑长任务。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 连接被拒绝 / `ECONNREFUSED` | 桥接服务未启动，**或端口已自动跳号**。启动日志会写明实际端口；也可在插件设置页看「桥接地址」。确认 DSH 在运行且插件已启用 |
| 之前能用、现在连不上 | 端口被占用后插件换了端口，`.env` 仍指向旧端口。重新拉一次 `/v1/midscene-env` 覆盖 `.env` 即可 |
| 启动日志报端口冲突 | 8787 被别的进程占用。`lsof -i :8787` 找到并停止它，或修改插件配置的 `port` 后重启 DSH |
| `MISSING_CREDENTIAL` | 所选提供方未配置凭据。桥返回的错误会指名「提供方/模型」，按提示到 DSH Web 设置里登录（CodeBuddy / Codex）或补齐 API key（如 `DEEPSEEK_API_KEY`） |
| `QUOTA` / `ACCOUNT_QUOTA` | 该提供方额度或余额不足。换一个「提供方/模型」或到对应平台充值 |
| `no such provider` / 模型路由错误 | 模型名写错了，或该提供方插件未安装。用 `/v1/models` 核对准确标识（注意是「提供方/模型」全称，不是裸模型名） |
| 模型家族不匹配 / 定位不准 | `MIDSCENE_MODEL_FAMILY` 与所选模型不符。核对 Midscene 的模型家族取值；也可用 Midscene 的 `--deep-locate` 提升定位精度 |
| 图片请求被拒（400） | 所选模型不具备图片输入能力。改用 `/v1/models` 里 `vision: true` 的模型 |
| 技能目录里看不到 `browser-automation` | 插件未启用或未安装。确认插件管理页里本插件为启用状态并重启 DSH；若你自己装过同名技能，以你的版本为准 |
| 响应里有 `familyWarning` | 所选模型未匹配到 Midscene 已知家族，配置里没有 `MIDSCENE_MODEL_FAMILY`。换一个已知系列的模型，或按官方文档手动补该值 |
| npm 权限报错 | `npx` 首次运行需要写 npm 缓存目录。按系统提示修正 `~/.npm` 权限，或设置 `npm_config_cache` 指向可写目录 |

## 隐私与边界

- 桥**不读取、不存储、不转发**任何凭据：请求经宿主模型层路由，凭据解析与续期在对应提供方插件内完成。
- 桥只监听回环地址，不做鉴权体系（本机使用场景）；请不要把 8787 暴露到局域网。
- 桥的日志只记录每次请求的一行摘要（模型、流式/缓冲、消息条数），**不含消息内容与图片数据**；可用配置项 `logRequests: false` 关闭。
- 图片以数据 URI 交给桥后，会经 DSH 的附件服务落成受管附件（与你在会话里发图片走同一套机制），不绕过宿主的图片策略。
- chrome-devtools MCP 不受影响，可继续使用。

## 配置项

第一版不做设置界面，配置走插件配置默认值：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `8787` | 监听端口；占用即报错，不自动更换 |
| `defaultProvider` | 空 | 裸模型名（不含 `/`）的默认提供方；留空时只接受「提供方/模型」形式 |
| `requestTimeoutMs` | `300000` | 单次模型请求超时（毫秒）；`0` 表示不超时 |
| `logRequests` | `true` | 是否记录每次请求的一行摘要日志 |

## 在真实 Chrome 中驱动（Bridge Mode）

Midscene 官方支持 **Chrome 桥接模式**：本插件的验证脚本作为服务端（默认 `127.0.0.1:3766`），
**你 Chrome 里的 Midscene 扩展反向连接过来**，从而用自然语言控制你自己的浏览器。

| 维度 | Bridge Mode | CDP 直连 |
| --- | --- | --- |
| 浏览器窗口 | **用户可见** | 不可见（headless） |
| cookies / 登录态 | 复用你的真实环境 | 全新 profile |
| macOS 钥匙串弹窗 | 无 | 每次新建 profile 都可能弹 |
| 视口 | 你的真实窗口 | headless 默认 756×413，侧边栏会收缩为图标态 |

前提条件（一次性）：Chrome 安装 [Midscene 扩展](https://midscenejs.com/zh/bridge-mode.html)，首次连接时在扩展弹窗点 **Allow**（或 **Always Allow** 后续免确认）。

**扩展自身的模型也要指向本插件**：扩展侧边栏的 Playground 自带模型配置项，把下面第 1 步拿到的
四行粘进**扩展的侧边栏设置**即可 —— 那里的模型就是 DSH 当前会话模型，**不需要申请任何第三方密钥**。
漏掉这一步时，扩展用不上 DSH 的模型，会把你引向申请外部 key，而那正是本插件要消除的成本。

```sh
# 1) 取接入配置（四行固定值；端口以 /v1/health 的 port 字段为准）
#    同一份配置用于两处：命令行（存为工作目录的 .env）与 Midscene 浏览器扩展（粘进侧边栏设置）
curl -s "http://127.0.0.1:8787/v1/midscene-env" |
    python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" >.env
# 2) 运行（目标 URL 用带 token 的完整地址）
pnpm --filter @tnnevol/dsh-midscene run test:bridge "http://127.0.0.1:8070/?token=…"
```

### 标签页纪律

测试操作的是**你真实浏览器里的标签页**，因此脚本遵守四条纪律：

- **先查后复用**：连接前先列标签页，目标站点已打开就直接绑定它，**不重复开页**（同源同路径即视为同一页——DSH Web 的 `?token=` 会随重启变化，按完整 URL 比较会让复用失效）。
- **复用后回到确定起点**：复用的页面可能停在上次测试留下的状态，脚本会先把目标地址重走一遍再开始用例。
- **收尾至少保留一个目标页**：便于你复核结果。
- **只关闭本次多开的重复页**：复用来的页面不受影响（Midscene 只清理它自己新建的页）。

脚本位于包内 `scripts/bridge-smoke.ts`。它会做两件事：断言首页可见、点击侧边栏进入插件列表——
**每步都用页面内状态独立核实**，交互未生效时自动重试一次（Midscene 的单次点击可能不触发行为，
详见测试规范的 Midscene 章节）。

桥接模式复用桌面浏览器配置，因此 `viewportWidth`、`userAgent`、`cookie`、`extraHTTPHeaders`、
`chromeArgs` 等选项会被忽略。模型配置必须放在 **Node 侧**（终端环境变量）——本仓库的 `.env` 约定正合此要求。

## 指定测试模型

设置页只有一个与模型相关的选项：**指定测试模型**（**单选**）。留空则跟随 DSH 当前会话模型；选定后把鼠标移到选择框上，点右侧的 **×** 即可清空、回到「跟随会话模型」。

下拉里**只列出具备识图能力的模型**——Midscene 靠截图理解页面，纯文本模型选进来也跑不了。因此这里不提供「只看识图模型」之类的开关：列出来的本来就是能用的。

**为什么是单选而不是列表**：Midscene 的协议家族在启动期从 `.env` 读取，且只有**一个**。如果允许选多个不同系列的模型，回退到备用模型时家族仍是最初那个，反而造成静默错位；而同族备用能救的场景又极少。既然任何时刻只可能有一个模型生效，界面就如实只让选一个。指定的模型在目录中不存在时，插件会如实提示（保留原选择、不静默改选别的）。

**DSH 里一个识图模型都没有时**，该字段会显示一条提示（说明需要先安装并登录一个提供方），而不是给一个空下拉。

### 协议家族是自动的

Midscene 需要一个 `MIDSCENE_MODEL_FAMILY`（协议家族）才能解析模型返回的坐标，而它的取值取决于**实际使用哪个模型**。这件事由插件在生成接入配置时自动完成，**不需要你设置、界面上也不出现**：

- 能识别出家族的模型 → 用对应家族（`glm-*` → `glm-v`，`deepseek-*` → `deepseek`，依此类推）；
- 识别不出、但**具备识图能力**的模型（Midscene 未适配的系列，如 `codebuddy/hy3`）→ 使用通用协议，**同样可以正常使用**；
- 家族随模型变化自动更新：换了模型，`.env` 里的家族跟着变。

之所以不把它做成选项：家族是 Midscene 的内部协议细节，让用户选择既要求理解提示词模板与坐标解析，又必然产生「家族与模型不匹配」的组合——而那种组合的表现是**点击偏几像素的静默错位**，不报错、极难排查。

**跟随会话模型时**同样安全：若会话当前用的是纯文本模型，桥会跳过它、改用目录里其他识图模型（而不是让 Midscene 因为无法识图而失败）。

> 换模型后需要重新拉取一次 `.env`（家族写在里面）。设置页的「复制 .env 内容」或 `GET /v1/midscene-env` 都能拿到最新值。

## 插件设置页

在 DSH 的插件管理页点开本插件，组件列表**下方**有「Midscene 接入设置」区块：

| 设置项 | 说明 |
| --- | --- |
| 接入密钥 | 安装时自动生成；可一键随机重新生成，或自定义。生成后需同步更新 Midscene 的 `.env`（重新拉一次即可） |
| Midscene 协议家族 | 下拉选择，选项即 Midscene 接受的白名单（默认 `glm-v`）。它决定提示词模板与坐标解析协议，换模型时可能需要同步调整 |
| 指定测试模型 | **下拉选择**（可多选、可搜索），选项来自 DSH 当前实际可用的模型目录，默认只列支持图片的模型。留空则跟随 DSH 会话模型；可多选并按顺序尝试第一个可用的 |

「指定测试模型」用下拉而不是手填：手填要求记住「提供方/模型」全称（如 `codebuddy/glm-5.3-flash`），
写错只会在真正跑 Midscene 时才报错，而用户也无从知道有哪些合法值。下拉选项与 `/v1/models` **同源**
（同一份目录缓存），不会出现「界面上能选、桥上查不到」的不一致；已配置但当前目录中不存在的模型
（提供方被卸载或模型改名）会以提示标出，不静默丢弃。

改动立即作用于运行中的桥（无需重启 DSH）；端口、超时、日志开关等标量字段由 DSH 官方设置表单承载。

## 接入配置由插件生成

`/v1/midscene-env` 生成的配置在每次请求时按当前模型目录实时计算——新增提供方、换模型后重新拉一次即可，不需要记忆任何变量取值，也不需要为任何模型准备密钥。

## 图标来源

插件图标取自 Midscene 官方站点 favicon（`https://midscenejs.com/favicon.png`，600×600 PNG，Midscene 主仓库 MIT 许可），随 npm 包分发、无外部请求。来源与取用日期登记在包内。

## 相关页面

- [插件总览](/plugins/)
- [测试用例文档规范](/charter/tests-spec)——Midscene 浏览器自动化作为 UI 走查与 E2E 用例的执行方式
- [本地 DSH Web](/development/local-dsh-web)
- [Midscene 官方文档](https://midscenejs.com/zh/)
