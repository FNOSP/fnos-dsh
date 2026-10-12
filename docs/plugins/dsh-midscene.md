# Midscene Bridge

`@tnnevol/dsh-midscene` 在本地托管一个 OpenAI 兼容的桥接服务，把 [Midscene](https://midscenejs.com) 的模型请求接到 **DSH 宿主模型层**——凡是 DSH 里能用的模型（DeepSeek 官方路由、CodeBuddy、Codex、你自定义的 OpenAI/Anthropic 兼容端点），Midscene 都能用。凭据、请求协议与 token 续期由各提供方插件在宿主内处理，桥不接触。

用途：让会话中的 agent 用自然语言驱动浏览器完成「打开页面 → 交互 → 断言」的 E2E 测试，替代逐步编排 chrome-devtools MCP 的日常用法。

## 安装

在 fnOS 上使用 DSH 时，插件随应用安装或升级自动安装。其他 DSH 环境可执行：

```sh
dsh plugin --profile web add @tnnevol/dsh-midscene@0.2.0-rc.2.0
```

安装后重启 DSH Web profile。插件版本信息见[插件总览](/plugins/)。

## 桥接服务

插件启动后在 **`127.0.0.1:8787`** 提供三个端点（只绑回环地址，不向局域网暴露）：

| 端点 | 用途 |
| --- | --- |
| `GET /v1/models` | 模型目录：DSH 当前全部可用模型，标识为「提供方/模型」形式 |
| `GET /v1/midscene-env` | **生成接入配置**：直接给出可写入 `.env` 的四行变量（`?model=` 指定模型，省略则自动挑一个具备图片能力的） |
| `POST /v1/chat/completions` | 对话补全：流式（SSE）与非流式 |
| `GET /v1/health` | 健康检查：提供方列表、模型数量、附件服务可用性 |

健康检查示例：

```sh
curl -s http://127.0.0.1:8787/v1/health
```

```json
{
  "status": "ok",
  "providers": ["openai-codex", "deepseek-official", "codebuddy"],
  "models": 24,
  "attachments": true
}
```

端口固定且**占用即报错**，不会自动更换——静默换端口会让你下面的接入配置失配。端口冲突时启动日志会给出冲突端口与处理建议（`lsof -i :8787` 找到进程后停止它，或修改插件配置的 `port`）。

## 接入 Midscene

**不需要准备任何模型 API key。** 插件的存在意义就是让 Midscene 用 DSH 已经配好的模型：凭据在 DSH 的提供方插件里，桥不接触、也不转发。

Midscene 强制要求四个模型环境变量（其中 `MIDSCENE_MODEL_FAMILY` 决定它的提示词模板与坐标解析协议）。插件知道 DSH 里有哪些模型，因此**直接替你算好这份配置**。

### 一条命令生成接入配置

在**运行 Midscene 命令的工作目录**执行（Midscene 只加载当前目录的 `.env`）：

```sh
curl -s http://127.0.0.1:8787/v1/midscene-env | python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" >.env
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

## 内置浏览器自动化技能

安装插件后，Midscene 的浏览器自动化技能（`browser-automation`）会直接出现在会话的技能目录里，**无需再执行 `npx skills add`**。技能内容是 Midscene 官方技能仓库的原文，来源与版本见包内 `skills/SOURCE.md`。

- 技能只做分发不做改写：它教 agent「怎么用 Midscene 命令」，模型从哪来由本插件负责。
- 只内置 Web 场景技能；Android/iOS/HarmonyOS/桌面自动化的技能未内置（本插件不承诺这些平台），需要时按[官方技能仓库](https://github.com/web-infra-dev/midscene-skills)自装。
- 你自行安装的同名技能优先，插件不覆盖、不重复提示。
- 卸载插件后内置技能同步消失。

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
| 连接被拒绝 / `ECONNREFUSED` | 桥接服务未启动。检查 DSH 是否在运行（`curl http://127.0.0.1:8787/v1/health`），以及插件是否已启用 |
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
