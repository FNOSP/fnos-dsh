# 模型配置

本页汇总 Midscene 的模型选择、环境变量全集、多模型组合与验证方式。

## 模型策略：三种角色

| 模型 | 作用 |
| --- | --- |
| **默认模型** | 基础能力：元素定位（Locate），以及未交给 Planning / Insight 的任务 |
| **Planning 模型** | 增强复杂目标、多步骤任务和分支场景的规划能力 |
| **Insight 模型** | 增强数据提取、断言和页面理解能力 |

默认用一个多模态模型完成规划、定位和页面理解，**可覆盖大多数场景**，也是最少配置的起点。仅当复杂规划或页面理解遇到明确能力瓶颈时，才引入专用模型——组合会增加耗时和 Token。

## 必选配置

| 变量 | 说明 |
| --- | --- |
| `MIDSCENE_MODEL_BASE_URL` | API 接入 URL，通常以版本号结尾（如 `/v1`）。**不要**自己拼 `/chat/completions` 或 `/responses`，底层 SDK 会自动添加 |
| `MIDSCENE_MODEL_API_KEY` | API Key，如 `sk-abcd...`（`codex://app-server` 模式不需要） |
| `MIDSCENE_MODEL_NAME` | 模型名称 |
| `MIDSCENE_MODEL_FAMILY` | 模型系列，**决定坐标处理方式**；填错会导致点击偏移 |

## 支持的模型与 FAMILY

| 系列 | 常用模型 | `MIDSCENE_MODEL_FAMILY` | 备注 |
| --- | --- | --- | --- |
| 豆包 2.x | `Doubao-Seed-2.1-turbo`、`Doubao-Seed-2.0-Lite` | `doubao-seed` | 2.1-turbo 私有测评集中定位速度最快且效果好，**推荐** |
| 豆包 1.x | `Doubao-Seed-1.6-Vision`、`Doubao-Seed-1.8` | `doubao-seed` | 旧版不具竞争力；`doubao-vision` 仍兼容但建议用 `doubao-seed` |
| 千问 Qwen3.x | `qwen3.7-plus`、`qwen3.5-plus`、`qwen3.6-plus` | `qwen3` | 推荐顺序 Qwen3.7 > 3.5 > 3.6 |
| 千问 Qwen3-VL | `qwen3-vl-plus` | `qwen3-vl` | 旧版，不推荐 |
| 千问 Qwen2.5-VL | `qwen-vl-max-latest` | `qwen2.5-vl` | 旧版，不推荐 |
| DeepSeek V4 | `deepseek-flash`（V4.1 Flash）、`deepseek-v4-flash-vision-exp` | `deepseek` | ⚠️ **DeepSeek-V4-Pro 不支持视觉输入，不能用于 Midscene** |
| Google Gemini 3.x | `gemini-3.5-flash`、`gemini-3-flash-preview` | `gemini` | 3.5-flash 是私有测评集中定位表现最好的 |
| OpenAI GPT-6 | `gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna` | `gpt-6` | Sol 定位准确且价格仅 Astra 的 1/5；Luna 便宜且定位能力良好 |
| OpenAI GPT-5 | `gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` | `gpt-5` | ⚠️ **UI 定位至少需 GPT-5.4**；5.4 之前不支持视觉定位，仅可作 Planning/Insight。5.5、5.6 定位明显优于 5.4 |
| 月之暗面 Kimi | `kimi-k3` / `kimi-k2.5`、`kimi-k2.6` | `kimi3` / `kimi` | K3 始终开启思考模式，推理强度默认 `max` |
| 小米 MiMo | `mimo-v2.6-pro`、`mimo-v2.6-flash` 等 | `xiaomi-mimo` | 2.6 全系列支持多模态；2.5 仅 Omni 系列支持 |
| 智谱 GLM-V | `glm-5v-turbo`、`glm-4.6v` | `glm-v` | `glm-4.6v` 是开源模型 |

### 常见服务商 Base URL

| 服务商 | Base URL |
| --- | --- |
| 火山引擎（豆包/UI-TARS） | `https://ark.cn-beijing.volces.com/api/v3` |
| 阿里云 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| DeepSeek | `https://api.deepseek.com` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| OpenAI | `https://api.openai.com/v1` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` |
| 智谱 BigModel / Z.AI | `https://open.bigmodel.cn/api/paas/v4` / `https://api.z.ai/api/paas/v4` |

### 配置示例

```bash
# 豆包 Seed 2.1 Turbo
export MIDSCENE_MODEL_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export MIDSCENE_MODEL_API_KEY="your-api-key"
export MIDSCENE_MODEL_NAME="doubao-seed-2-1-turbo-260628"
export MIDSCENE_MODEL_FAMILY="doubao-seed"
```

**Fast Tier**：豆包开通低延迟模式后可提速约 30%~50%：

```bash
MIDSCENE_MODEL_EXTRA_BODY_JSON={"service_tier":"fast"}
```

GPT-5.6 Sol / GPT-6 Astra 支持 Fast mode（最高 2~2.5 倍速度，费率两倍）：

```bash
MIDSCENE_MODEL_NAME="gpt-5.6-sol"
MIDSCENE_MODEL_FAMILY="gpt-5"
MIDSCENE_MODEL_EXTRA_BODY_JSON='{"service_tier":"fast"}'
```

## 协议类型

默认 OpenAI **Chat Completions** 协议，也支持 **Responses** 协议。两者只是发请求的方式，**不影响 Agent API 使用**；Chat Completions 支持范围更广。

```bash
MIDSCENE_MODEL_PROTOCOL="openai-responses"   # 默认 openai-chat
```

注意：

- 部分模型/供应商可能尚不支持 Responses 协议，使用前确认。
- **同一供应商的两种协议可能使用不同 Base URL**，向供应商确认接入地址。
- Midscene 对部分供应商的 Responses API 可能尚未完成适配。

## 高级配置

### 超时与重试

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MIDSCENE_MODEL_TIMEOUT` | `180000` | 单次请求硬超时（毫秒），**覆盖完整请求生命周期含响应体读取**。每次重试重新计时且重试等待不计入，所以总耗时可能超过该值。设 `0` 仅禁用 Midscene 硬超时 |
| `MIDSCENE_MODEL_RETRY_COUNT` | `1` | 失败重试次数。HTTP 错误或返回值无法结构化解析都会重试 |
| `MIDSCENE_MODEL_RETRY_INTERVAL` | `2000` | 重试间隔（毫秒） |

> 重规划次数用 Agent 的 `replanningCycleLimit` 入参控制（默认 20，`vlm-ui-tars` 为 40），**不再用环境变量**。

### 输出与网络

| 变量 | 说明 |
| --- | --- |
| `MIDSCENE_MODEL_RESPONSE_FORMAT` | `auto`（默认）自动使用 `response_format`/`text.format` 保证可结构化解析；`none` 不指定格式参数（适用于模型不支持结构化输出） |
| `MIDSCENE_MODEL_STREAM_MODE` | 默认 `non-stream`；`stream` 会把流式结果聚合为完整结果再解析 |
| `MIDSCENE_MODEL_TEMPERATURE` | 采样温度 |
| `MIDSCENE_MODEL_HTTP_PROXY` | HTTP/HTTPS 代理，如 `http://127.0.0.1:8080`，优先级**高于** SOCKS |
| `MIDSCENE_MODEL_SOCKS_PROXY` | SOCKS 代理，如 `socks5://127.0.0.1:1080` |
| `MIDSCENE_MODEL_INIT_CONFIG_JSON` | 覆盖 OpenAI SDK 初始化配置。自定义鉴权 header 用 `defaultHeaders`（`extra_headers`/`extraHeaders` 为兼容别名） |
| `MIDSCENE_MODEL_EXTRA_BODY_JSON` | **合并到每次请求体**的 JSON（与上一项不同，后者配置 SDK 客户端）。如 vLLM 启用思考：`'{"chat_template_kwargs":{"enable_thinking":true}}'` |

### 模型原生思考

Midscene **默认关闭**模型原生思考，以获得更好的执行速度和稳定性；模型不支持关闭时，会通过控制思考粒度或限制额度尽量减少。

`MIDSCENE_MODEL_REASONING_ENABLED`：

- `false`：强制关闭（Midscene 默认）
- `true`：强制启用
- `default`：遵循模型默认行为，**Midscene 不发开关参数，并忽略显式配置的 `REASONING_BUDGET` 和 `REASONING_EFFORT`**

其他：`MIDSCENE_MODEL_REASONING_EFFORT`（`low`/`medium`/`high`）、`MIDSCENE_MODEL_REASONING_BUDGET`（思考 Token 预算）。

参数映射由 `MIDSCENE_MODEL_FAMILY` 决定：Qwen → `enable_thinking`；豆包 → `thinking.type`。

## OpenAI 特殊接入方式

### ChatGPT 订阅（SIWC，无需 API Key 计费）

已订阅 ChatGPT plan 可通过 [SIWC](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) 获得授权 token，像 API Key 一样使用：

```bash
npx @midscene/cli model siwc login     # 首次获取，打印 Access token
npx @midscene/cli model siwc refresh   # 刷新（默认 1 小时过期）
```

凭据保存在 `~/.midscene/siwc.json`，Midscene 不收集。

```bash
MIDSCENE_MODEL_BASE_URL="https://api.openai.com/v1"
MIDSCENE_MODEL_API_KEY="<access-token>"
MIDSCENE_MODEL_NAME="gpt-6-sol"
MIDSCENE_MODEL_FAMILY="gpt-6"
MIDSCENE_MODEL_PROTOCOL="openai-responses"   # SIWC 必须用 Responses API
MIDSCENE_MODEL_STREAM_MODE="stream"           # SIWC 必须开流式
```

注意：遵守 OpenAI 地区限制与条款；SIWC 消耗订阅额度；**可能比直接调 API 更慢、token 更多**。

### Codex App Server（复用已有 OAuth）

若已 `codex login`：

```bash
export MIDSCENE_MODEL_BASE_URL="codex://app-server"
export MIDSCENE_MODEL_NAME="gpt-6-sol"
export MIDSCENE_MODEL_FAMILY="gpt-6"
```

不需要 `MIDSCENE_MODEL_API_KEY`；Midscene 通过 stdio 调 `codex app-server`。需保证 `codex` 在 PATH 中且 `codex login status` 正常。⚠️ 已知可能比直连 OpenAI 兼容 API **耗时更长、token 更多**。

### 使用 GPT 的注意

- UI 定位至少需 GPT-5.4。
- GPT-5 处理**非拉丁字母文本、字号过小文本**效果可能不理想。
- OpenAI 观察到 `1440x900`、`1600x900` 截图尺寸效果较好——用 Agent 的 `screenshotShrinkFactor` 控制压缩倍率，浏览器自动化还可用 `viewport` 指定尺寸。
- **Azure OpenAI** 用 Chat Completions 时 `"detail": "original"` 可能未正确处理导致**点击坐标偏移**，此时切到 Responses API。

## 其他兼容模型

| 系列 | 配置 |
| --- | --- |
| 智谱 AutoGLM（9B 开源） | `MIDSCENE_MODEL_FAMILY="auto-glm"`（中文环境优化）或 `auto-glm-multilingual`（英语等）。更适合移动端交互；用 `aiAssert`/`aiQuery` 时建议单独配 `MIDSCENE_INSIGHT_MODEL_*` |
| UI-TARS | `MIDSCENE_MODEL_FAMILY="vlm-ui-tars"`（v1.0）、`vlm-ui-tars-doubao-1.5` 或 `vlm-ui-tars-doubao`（火山 v1.5） |

UI-TARS 迁移：旧 `MIDSCENE_USE_VLM_UI_TARS` 已废弃 →

| 旧变量 | 新配置 |
| --- | --- |
| `MIDSCENE_USE_VLM_UI_TARS=1.0` | `MIDSCENE_MODEL_FAMILY="vlm-ui-tars"` |
| `MIDSCENE_USE_VLM_UI_TARS=1.5` | `MIDSCENE_MODEL_FAMILY="vlm-ui-tars-doubao-1.5"` |
| `MIDSCENE_USE_VLM_UI_TARS=DOUBAO` | `MIDSCENE_MODEL_FAMILY="vlm-ui-tars-doubao"` |

## 设置环境变量（三选一）

### 1. 当前 Shell

```bash
export MIDSCENE_MODEL_BASE_URL="https://替换为你的模型服务地址/v1"
export MIDSCENE_MODEL_API_KEY="替换为你的 API Key"
export MIDSCENE_MODEL_NAME="替换为你的模型名称"
export MIDSCENE_MODEL_FAMILY="替换为你的模型对应的 family"
```

仅在当前 Shell 及其子进程有效。

### 2. CLI 读取 `.env`

在**运行 `midscene` 命令时所在的目录**创建 `.env`，`@midscene/cli` 自动读取，**每行不需要 `export`**：

```bash
MIDSCENE_MODEL_BASE_URL="https://替换为你的模型服务地址/v1"
MIDSCENE_MODEL_API_KEY="替换为你的 API Key"
MIDSCENE_MODEL_NAME="替换为你的模型名称"
MIDSCENE_MODEL_FAMILY="替换为你的模型对应的 family"
```

⚠️ 运行 YAML 任务时，**Shell 中已有的同名变量默认优先于 `.env`**；需覆盖用 `--dotenv-override`。
⚠️ **例外**：`midscene model verify` 反过来，会用 `.env` **覆盖** Shell 变量。

### 3. JS SDK

SDK 直接读 `process.env`。Shell/容器/部署平台已提供则无需 dotenv；配置在 `.env` 文件里则用 [dotenv](https://www.npmjs.com/package/dotenv) 加载：

```typescript
import 'dotenv/config';   // 必须在创建 Agent 之前
```

dotenv 默认**保留**当前 Shell 已有值。

## 配置多个模型（可选）

多数场景只需默认模型。复杂规划或页面理解需要独立模型时才配置，可只配一个也可两个都配：

```bash
# 默认模型：Qwen 3.5（负责视觉定位）
export MIDSCENE_MODEL_BASE_URL="https://..."
export MIDSCENE_MODEL_API_KEY="..."
export MIDSCENE_MODEL_NAME="qwen3.5-plus"
export MIDSCENE_MODEL_FAMILY="qwen3.5"

# Planning 模型：GPT-5.4
export MIDSCENE_PLANNING_MODEL_API_KEY="sk-..."
export MIDSCENE_PLANNING_MODEL_BASE_URL="https://..."
export MIDSCENE_PLANNING_MODEL_NAME="gpt-5.4"
export MIDSCENE_PLANNING_MODEL_FAMILY="gpt-5"

# Insight 模型：GPT-5.4
export MIDSCENE_INSIGHT_MODEL_API_KEY="sk-..."
export MIDSCENE_INSIGHT_MODEL_BASE_URL="https://..."
export MIDSCENE_INSIGHT_MODEL_NAME="gpt-5.4"
export MIDSCENE_INSIGHT_MODEL_FAMILY="gpt-5"
```

⚠️ 配置了独立 Planning/Insight 模型后，本页表格中的 `MIDSCENE_MODEL_*` 需改用对应的 `MIDSCENE_INSIGHT_MODEL_*` / `MIDSCENE_PLANNING_MODEL_*` 才生效。这两组变量支持各自的 `_PROTOCOL`、`_TIMEOUT`、`_TEMPERATURE`、`_RETRY_*`、`_HTTP_PROXY`、`_SOCKS_PROXY`、`_INIT_CONFIG_JSON`、`_EXTRA_BODY_JSON`、`_RESPONSE_FORMAT`。

## 验证配置

```bash
npx midscene model verify                      # 用项目安装的 CLI
npx @midscene/cli@latest model verify          # 或用最新版
```

验证失败见 [faq.md](faq.md)。
