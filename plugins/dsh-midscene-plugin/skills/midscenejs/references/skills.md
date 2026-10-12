# Skills 控制平台 + MCP 下线说明

## MCP 已下线 ⚠️

Midscene **不再发布 MCP server**。请改用 [Skills](#官方-skills) 让 AI 编程 Agent 通过各平台 CLI 驱动 Midscene。

如果仍需要 MCP server 包，请将 Midscene 固定在 **`1.9.8`**——这是最后一个包含 MCP 支持的版本。

必须从 Agent 配置中移除以下**已退役**的 MCP 包：

- `@midscene/web-bridge-mcp`
- `@midscene/android-mcp`
- `@midscene/ios-mcp`
- `@midscene/harmony-mcp`
- `@midscene/computer-mcp`
- `@midscene/mcp`

迁移：`MIDSCENE_MCP_CHROME_PATH` → **`MIDSCENE_CHROME_PATH`**（Skills 和 CLI 使用的新变量；旧变量暂时作为迁移别名继续生效）。

代码级自动化请改用 **JavaScript SDK**、**YAML runner** 或 Skills 中的各平台 CLI。

## 官方 Skills

Agent Skills 是扩展 AI Agent 能力的格式。Midscene 提供 Skills，让 Claude Code、Cline 等 AI 工具**通过 CLI 命令驱动 UI 自动化**。

工作方式：AI Agent 充当大脑——**截图 → 分析 UI → 决定下一步操作**。Skill 只是跑 CLI。

### 支持的平台

| Skill | 包 | CLI 命令 | 说明 |
| --- | --- | --- | --- |
| Browser Automation | `@midscene/web` | `npx @midscene/web` | 三种模式：默认 Puppeteer 无头、`--bridge` 桥接用户自己的 Chrome、`--cdp <ws-endpoint>` CDP 直连已有浏览器 |
| Desktop Computer Automation | `@midscene/computer` | `npx @midscene/computer` | macOS / Windows / Linux 桌面控制 |
| Android Device Automation | `@midscene/android` | `npx @midscene/android` | 通过 ADB 控制 Android |
| iOS Device Automation | `@midscene/ios` | `npx @midscene/ios` | 通过 WebDriverAgent 控制 iOS |
| HarmonyOS Device Automation | `@midscene/harmony` | `npx @midscene/harmony` | 通过 HDC 控制鸿蒙设备 |

### 视口尺寸

默认 Puppeteer 模式下默认视口 `1440x800`，可用 `--viewport-width <width>` / `--viewport-height <height>` 覆盖。**这两个参数仅在默认 Puppeteer 模式支持**，`--bridge` 和 `--cdp` 模式不支持。

### 浏览器模式

CDP 模式用独立的 `--extra-http-header 'Name:Value'` 为每个 HTTP 请求加 header。**因为每条 CLI 命令都会创建新的 CDP session，必须在每个可能发请求的命令上重复该参数**：

```bash
npx @midscene/web connect \
  --cdp ws://127.0.0.1:9222/devtools/browser \
  --extra-http-header 'x-use-ppe:1' \
  --extra-http-header 'x-tt-env:ppe_example' \
  --url https://example.com

npx @midscene/web act \
  --cdp ws://127.0.0.1:9222/devtools/browser \
  --extra-http-header 'x-use-ppe:1' \
  --extra-http-header 'x-tt-env:ppe_example' \
  --prompt "click the button"
```

header 在 `connect --url` 导航前应用，所以首个文档请求就带上它们。**避免把敏感认证值直接写进 shell history。**

Chrome 安装在非标准位置时设 `MIDSCENE_CHROME_PATH` 指向可执行文件路径（`MIDSCENE_MCP_CHROME_PATH` 仍是临时迁移别名）。

### 安装

先确保已安装 Node.js：

```bash
npx skills add web-infra-dev/midscene-skills                    # 通用
npx skills add web-infra-dev/midscene-skills -a claude-code    # Claude Code
npx skills add web-infra-dev/midscene-skills -a openclaw       # OpenClaw
```

仓库：https://github.com/web-infra-dev/midscene-skills

### 模型配置

Skills 需要具备强 UI 定位能力的多模态模型。以下环境变量可放系统环境变量，或放在**当前工作目录的 `.env`**（Midscene 自动加载）：

**DSH 环境**下这四行由桥接服务给出，不需要第三方 API key：

```bash
# <端口> 以 `GET /v1/health` 的 port 字段为准
curl -s "http://127.0.0.1:<端口>/v1/midscene-env" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" > .env
```

生成 `MIDSCENE_MODEL_BASE_URL`（桥地址）、`MIDSCENE_MODEL_API_KEY`（桥的接入密钥）、
`MIDSCENE_MODEL_NAME="dsh-model"`、`MIDSCENE_MODEL_FAMILY`（协议家族，默认 `glm-v`）。
**不要向用户索要模型 API key，也不要配置第三方提供方。**

详见 [model-config.md](model-config.md)。

### 典型用法

装好后直接用自然语言描述任务，Agent 会自动选 Skill、跑 CLI、读截图、决定下一步：

```
Use Midscene browser skill to open the Google search page and search for "Midscene".
```

**经典场景：编码 Agent 写完代码后自验。** 例如让 Agent 开发 Electron Todo 应用，写完后用 `desktop-computer-automation` Skill 启动应用并交互验证：加 3 条 todo、勾选一条、删除一条、截图确认最终状态正确。完整链路：写 Todo 组件 → 启动 Electron 应用 → 连接桌面 → 截图理解 UI → 自然语言交互 → 再截图验证。

### 更多场景

- **桌面应用测试**：验证 Electron、Qt、WPF 等应用功能
- **远程计算机控制**：远程桌面场景下的操作与调试
- **移动应用测试**：用 `@midscene/android`、`@midscene/ios` Skill 在真机或模拟器上验证
- **跨应用工作流**：如从浏览器取数据 → 粘贴到 Excel → 截图发 Slack
- **CI/CD 集成**：Linux CI 上用 Xvfb 无头运行桌面自动化
- **日常任务自动化**：批量填表、定时截图监控、自动整理文件

### 安全提醒

> ⚠️ AI 驱动的 UI 自动化可能产生不可预测的结果，因为它可以控制**屏幕上的一切**。使用前请评估风险。

## 本技能与官方 Skills 的关系

官方 Skills **只覆盖平台 CLI 自动化**，不覆盖整体介绍、模型配置、SDK 集成和 `@midscene/test` 测试框架——那些由本技能覆盖。

| 用户诉求 | 用哪个 |
| --- | --- |
| "让 AI Agent 自己点界面"、"npx @midscene/web 怎么用" | 官方 Skills（见本页） |
| "Midscene 是什么"、"怎么配模型"、"怎么接 Playwright/设备" | 本技能 |
| "搭 Midscene Test 工程"、"写 YAML 用例/自定义 Node" | 本技能 [midscene-test/](midscene-test/) |
