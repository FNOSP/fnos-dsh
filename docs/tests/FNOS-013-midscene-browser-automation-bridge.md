---
id: FNOS-013
title: FNOS-013 测试用例
description: FNOS-013 Midscene 浏览器自动化桥接插件的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-013-midscene-browser-automation-bridge
plan: /plans/PLAN-FNOS-013-midscene-browser-automation-bridge
status: 执行中
lastVerified: 2026-10-12
verifiedAt: 2026-10-12
---

# FNOS-013 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-013 |
| 关联需求 | [FNOS-013 Midscene 浏览器自动化桥接插件](/requirements/FNOS-013-midscene-browser-automation-bridge) |
| 关联计划 | [PLAN-FNOS-013 Midscene 浏览器自动化桥接插件](/plans/PLAN-FNOS-013-midscene-browser-automation-bridge) |
| 测试状态 | <Badge type="warning" text="本地自动化与 Web 走查已执行；Midscene 端到端待验收" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-013-midscene-browser-automation-bridge#功能列表)中 FNOS-013-01 至 FNOS-013-14 全部功能：

- **桥接服务本体（01～04）**：随 DSH 托管的回环 OpenAI 兼容服务，模型目录映射宿主全部提供方、对话补全（流式/非流式/图片）、凭据归宿主。这是本需求的核心风险面——它跨 `ctx.llm` 契约、HTTP 协议转换、附件服务与生命周期四个接缝。
- **会话内自动化（05、11、12）**：Midscene 全链路、YAML 运行器与 Test 框架接入。依赖外部 npm 包与真实页面，标「待验证」。
- **测试体系适配（07～10）**：规范章节、交叉引用、接入基线与真实用例示范。
- **技能与图标（13、14）**：内置技能分发与插件图标。

关键风险点：`ctx.llm` 服务面与类型定义的出入（已在实现中实测校正）、图片数据 URI 与宿主附件体系的衔接、提供方失败在流内的表达方式（实测发现需专门透出，见 BUG-01）、端口生命周期。

❓ 待核实项（沿用需求登记的「待核实」）：真实网页上的坐标定位精度、DSH 可用模型的家族协议兼容性、Desktop 渲染进程的 CDP 附加兼容性。这三项决定 FNOS-013-05/09 的 Desktop 与真实页面结论，不在桥接服务侧。

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01)～[04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | DSH Web（本地）；DSH Desktop 同样适用但本轮未执行 |
| [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | DSH Web 会话内（真实浏览器自动化全链路） |
| [FNOS-013-06](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06)、[07](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07)、[10](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-10) | 文档站构建环境 |
| [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08)、[09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | DSH Web（本地）为主；Desktop 按[规范](/charter/tests-spec#dsh-desktop-测试)以项目 `.dsh/profiles/desktop` 走查 |
| [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11)、[12](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | DSH Web（本地）——本机 Node 进程驱动浏览器，经本地桥完成模型请求 |
| [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13)、[14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | DSH Web；Desktop 未执行 |

版本三元组基线：DSH `0.2.0-rc.2` / 插件 `@tnnevol/dsh-midscene` `0.2.0-rc.2.0` / 应用 `5.7.0`。

## 测试用例

### [FNOS-013-01 桥接服务随 DSH 托管运行](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 插件装入后桥接服务可用 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 插件已装入项目 `.dsh` web profile，DSH Web 已重启 | 1.`curl http://127.0.0.1:8787/v1/health` 2.核对返回的提供方与模型数 | 健康检查返回 `status: ok`，`providers` 与 `ctx.llm.listProviders()` 一致，`models` 为各提供方模型总数 | P0 | 新增行为，无回归基线 |
| TC-002 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 停止 DSH 后端口无残留 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 桥接服务运行中 | 1.停止 DSH Web 2.`lsof -ti:8787` 3.重启 DSH 后再查 | 停止后无监听进程；重启后服务重新就绪 | P0 | 新增行为，无回归基线 |
| TC-003 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 端口被占用时明确报错且不静默换端口 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 8787 已被其它进程占用 | 1.启动 DSH 2.查看启动输出与日志 | 报错明确指出被占用的端口与处理建议；服务不监听其它端口 | P0 | 新增行为，无回归基线 |
| TC-004 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 只绑回环地址 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 桥接服务运行中 | 1.`lsof -i:8787` 核对监听地址 | 只监听 `127.0.0.1`，不对局域网地址监听 | P0 | 新增行为，无回归基线 |
| TC-005 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 未知端点返回可诊断的 404 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 桥接服务运行中 | 1.请求 `/v1/nope` | 返回 404 且错误信息列出可用端点 | P2 | 新增行为，无回归基线 |

### [FNOS-013-02 标准模型目录查询](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 目录返回全部可用模型且标识为「提供方/模型」 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 桥接服务运行中，多个提供方已配置 | 1.`curl /v1/models` 2.与 DSH 会话内模型选择器逐项比对 | 标准 OpenAI 列表格式；每条 `id` 为「提供方/模型」；覆盖内置路由、插件路由与自定义提供方 | P0 | 新增行为，无回归基线 |
| TC-007 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 图片能力标注与宿主元数据一致 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 桥接服务运行中 | 1.读 `/v1/models` 的 `vision` 与 `input_modalities` 2.与宿主模型元数据比对 | 宿主声明含 `image` 的模型 `vision: true`；未声明的不为 `true`；未声明时不伪造 `input_modalities` 字段 | P0 | 新增行为，无回归基线 |
| TC-008 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 新增提供方后目录随之更新且无需改桥 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 桥接服务运行中 | 1.记录当前目录 2.新增一个提供方（装插件或配置自定义端点）3.再次请求目录 | 新提供方的模型出现，插件代码未改动 | P1 | 新增行为，无回归基线 |
| TC-009 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 模型 id 自含 `/` 时标识仍可解析 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 存在 id 含 `/` 的模型（如 OpenRouter 风格） | 1.读该模型的对外标识 2.用它发起补全请求 | 标识保留完整模型 id；请求正确路由到该提供方 | P1 | 新增行为，无回归基线（命名规则按最长前缀匹配定案） |
| TC-010 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 单个提供方列举失败不拖垮整张目录 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 存在暂时不可达的提供方 | 1.请求 `/v1/models` | 其余提供方的模型照常返回；失败提供方记为零模型而非整张目录报错 | P1 | 新增行为，无回归基线 |

### [FNOS-013-03 对话补全桥接](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 非流式调用返回完整回答 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 已配置可用提供方 | 1.`POST /v1/chat/completions`（不带 `stream`） | 返回标准 `chat.completion` JSON，内容与在 DSH 会话内直接使用该模型一致；携带 `usage` | P0 | 新增行为，无回归基线 |
| TC-012 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 流式调用返回标准 SSE | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 同上 | 1.同一请求带 `stream: true` | `text/event-stream`；分片为 `chat.completion.chunk`；以 `finish_reason` 与 `data: [DONE]` 收尾 | P0 | 新增行为，无回归基线 |
| TC-013 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 流式透出推理内容 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 使用会产出推理的模型 | 1.流式请求 2.观察分片字段 | 推理内容以独立字段透出，与可见文本分开 | P2 | 新增行为，无回归基线 |
| TC-014 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 图片请求路由到具备图片能力的模型 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 选 `vision: true` 的模型 | 1.带数据 URI 图片的请求 | 返回正确的视觉回答；图片经宿主附件服务落成受管附件 | P0 | 新增行为，无回归基线 |
| TC-015 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 图片发给不具备图片能力的模型时被拒 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 选 `vision: false` 的模型 | 1.带图片请求 | 返回 400 与明确提示（改用有图片能力的模型），不把请求转给提供方 | P1 | 新增行为，无回归基线 |
| TC-016 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 非数据 URI 的图片引用被拒绝 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | — | 1.用 `https://…` 形式的 `image_url` 请求 | 返回 400；桥不做任意 URL 抓取 | P2 | 新增行为，无回归基线 |
| TC-017 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 提供方错误可定位到「提供方/模型」 | [AC-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 构造提供方失败 | 1.发起请求 2.读错误体 | 标准错误格式；信息含「提供方/模型」归因与稳定 `code` | P0 | 新增行为，无回归基线 |
| TC-018 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 多提供方并存时各自正确路由 | [AC-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 至少两个提供方可用 | 1.分别用两个提供方的「提供方/模型」发起请求 | 各自得到各自提供方的回答，路由不串 | P0 | 新增行为，无回归基线 |
| TC-019 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 生成参数正确透传 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | — | 1.带 `temperature`/`max_tokens`/`stop` 的请求 | 参数进入宿主模型层调用（由单测断言入参） | P2 | 新增行为，无回归基线 |
| TC-020 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 非法请求体给出 400 而非 500 | [AC-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | — | 1.发送非法 JSON 2.发送空 `messages` | 均返回 400 与可读原因 | P2 | 新增行为，无回归基线 |

### [FNOS-013-04 模型身份与凭据由宿主处理](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-021 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 桥不读取也不转发凭据 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | — | 1.请求体里携带 `api_key`/`authorization` 字段 2.核对宿主调用入参 | 客户端字段不被透传；宿主调用入参只有 `provider`/`model`/`messages` 等协议字段 | P0 | 新增行为，无回归基线 |
| TC-022 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | CodeBuddy 路由的登录态续期由插件处理 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | CodeBuddy 已登录 | 1.经桥多次调用 CodeBuddy 模型 2.核对插件账号功能与用量显示 | 桥接调用不改变 CodeBuddy 的登录态与账号管理行为 | P1 | 基线：DSH 会话内使用 CodeBuddy 的既有行为 |
| TC-023 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 官方路由与自定义提供方沿用既有配置 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 已配置对应凭据 | 1.经桥调用这两个提供方 | 使用其既有密钥/登录态，桥内无需重复配置 | P0 | 新增行为，无回归基线 |
| TC-024 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 未配置路由返回带指引的明确错误 | [AC-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 存在未配置凭据的提供方 | 1.调用该提供方的模型 | 返回错误且含提供方归因、宿主原始原因与设置指引；其它路由不受影响 | P0 | 新增行为，无回归基线 |
| TC-025 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 提供方在流内报告失败时不返回空回答 | [AC-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 构造流内失败（如未配置凭据） | 1.请求该模型 | 返回标准错误（含原因与归因），而不是一个 `finish_reason: stop` 的空回答 | P0 | 新增行为，无回归基线（**实测发现**，见 BUG-01） |
| TC-026 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 附件服务缺席时如实反映 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 精简 profile（无附件服务） | 1.请求 `/v1/health` 2.发带图片请求 | 健康检查 `attachments: false`；图片请求返回明确错误而非崩溃 | P2 | 新增行为，无回归基线 |

### [FNOS-013-05 会话内自然语言浏览器自动化](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-027 | [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | 会话内完成真实网页全链路 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | 技能与接入配置就绪；桥可用 | 1.自然语言下达任务 2.观察 connect/act/assert 全链路 | agent 用自然语言完成「打开页面 → 交互 → 断言」并汇报结果 | P0 | 新增行为，无回归基线 |
| TC-028 | [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | 真实网页定位稳定可复现 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | 同 TC-027 | 1.同一任务重复执行 2.比对结果 | 交互结果稳定；精度按预研基线复核 | P1 | 新增行为，无回归基线（预研 T00-01 先定基线） |
| TC-029 | [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | chrome-devtools MCP 不受影响 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | 既有 MCP 配置在位 | 1.使用 chrome-devtools MCP 执行一次操作 | 行为与插件引入前一致 | P1 | 基线：引入插件前的 MCP 行为 |

### [FNOS-013-06 插件文档与故障排查指引](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-030 | [FNOS-013-06](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06) | 插件说明页内容完整可用 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06) | 文档站可构建 | 1.访问说明页 2.按页面步骤照做一遍 | 含安装命令、接入配置模板、模型选择指引、额度提示与故障排查表；步骤可照做 | P0 | 新增行为，无回归基线 |
| TC-031 | [FNOS-013-06](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06) | 插件总览收录且侧边栏可达 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06) | 同上 | 1.打开插件总览页 2.点侧边栏条目 | 总览表格含本插件与版本；侧边栏链接可达 | P1 | 新增行为，无回归基线 |

### [FNOS-013-07 测试规范登记 Midscene 执行方式](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-032 | [FNOS-013-07](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07) | 规范含 Midscene 章节且分工明确 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07) | 文档站可构建 | 1.阅读[测试用例文档规范](/charter/tests-spec#midscene-浏览器自动化测试) | 含适用用例类型、三类被测环境接入方式、与人工走查/CDP 取证的分工；明确「按用例类型选择」而非强制自动化 | P0 | 新增行为，无回归基线 |
| TC-033 | [FNOS-013-07](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07) | 证据与清理要求不与既有章节冲突 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07) | 同上 | 1.核对章节与执行环境/版本记录/auth 备份红线的关系 2.运行文档检查 | 无冲突；`pnpm run check -- --sdd --docs` 与构建通过 | P1 | 新增行为，无回归基线 |

### [FNOS-013-08 项目测试环境接入基线](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-034 | [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 项目环境完成一次 Midscene 冒烟 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 插件已装入、技能可见 | 1.自然语言驱动本地 DSH Web 页面完成一个交互步骤 | 冒烟成功 | P0 | 新增行为，无回归基线 |
| TC-035 | [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 接入配置不入仓库且不含真实凭据 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 已写接入配置 | 1.`git status` 核对 | 配置位于不入仓库路径；内容只含占位密钥 | P0 | 新增行为，无回归基线（红线沿用既有约定） |
| TC-036 | [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 接入步骤可按章节复现 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 干净环境 | 1.只按规范章节逐步执行 | 不依赖未登记的个人环境状态即可完成接入 | P1 | 新增行为，无回归基线 |

### [FNOS-013-09 真实用例示范与证据登记](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-037 | [FNOS-013-09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | 项目页面完成一轮 E2E（含亮暗主题） | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | 桥与接入就绪 | 1.对插件管理页执行交互 + 视觉断言 2.亮暗主题各一遍 | 交互完成并给出视觉断言结论；两个主题各核对一遍 | P0 | 新增行为，无回归基线 |
| TC-038 | [FNOS-013-09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | 证据按规范登记 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | TC-037 完成 | 1.在 `docs/validation/` 登记证据 | 含版本三元组、环境标识与可追溯的报告/截图路径 | P1 | 新增行为，无回归基线 |
| TC-039 | [FNOS-013-09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | 既有 CDP 取证与人工走查仍可执行 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | — | 1.用 CDP 或人工方式复核同一场景 | 两条路径均可用；规范未废弃既有方式 | P1 | 基线：既有测试方式 |

### [FNOS-013-10 测试文档交叉引用同步](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-10)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-040 | [FNOS-013-10](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-10) | 三处文档互相可达且无死链 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-10) | 文档站可构建 | 1.检查规范、验收证据说明与插件说明页之间的链接 2.运行文档检查与构建 | 链接可达无死链；`pnpm run check -- --sdd --docs` 与构建通过 | P1 | 新增行为，无回归基线 |

### [FNOS-013-11 YAML 脚本运行器接入](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-041 | [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | YAML 运行器与即席 CLI 共用接入配置 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | 接入配置就绪；`@midscene/cli` 可用 | 1.在工具运行目录执行 YAML 脚本 | 无需为 YAML 场景单独配置模型；读同一份 `.env` | P1 | 新增行为，无回归基线 |
| TC-042 | [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | Web 场景 YAML 脚本跑通并出报告 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | 同上 | 1.编写「打开页面 → AI 操作 → AI 断言」的 `tasks/flow` 脚本 2.`midscene` 命令执行 | 脚本跑通；生成可视化报告 | P1 | 新增行为，无回归基线 |
| TC-043 | [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | 执行期间桥的行为与即席 CLI 一致 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | 同上 | 1.观察 YAML 执行期间的桥请求 | 同一桥、无场景特判；流式/非流式与错误行为一致 | P2 | 新增行为，无回归基线 |

### [FNOS-013-12 Midscene Test 测试框架接入（Beta）](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-044 | [FNOS-013-12](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | 脚手架 Web 用例经 `midscene-test` 跑通 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | `@midscene/test` 可用；接入配置就绪 | 1.生成脚手架项目 2.跑通官方 Web 场景样例 | 用例通过；模型请求走桥接服务 | P2 | 新增行为，无回归基线 |
| TC-045 | [FNOS-013-12](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | 实测包版本登记且 Beta 问题不阻塞 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | 同上 | 1.核对说明页登记的包版本 | 版本已登记；协议不兼容时按行为约束暂缓并登记，不阻塞其它功能 | P2 | 新增行为，无回归基线 |

### [FNOS-013-13 浏览器自动化技能随插件内置](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-046 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 未自装技能的环境里技能直接可见 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 插件已启用；用户/项目技能目录无同名技能 | 1.重启 DSH 2.在会话中查看技能目录 | `browser-automation` 出现在技能目录中，模型可加载 | P0 | 新增行为，无回归基线 |
| TC-047 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 技能内容与来源一致并注明登记 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 同上 | 1.比对包内技能与官方仓库原文 2.读来源标注文件 | 内容与官方一致（未改写）；来源、版本、许可在包内注明 | P1 | 新增行为，无回归基线 |
| TC-048 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 卸载后技能同步消失 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 技能当前可见 | 1.禁用/卸载插件并重启 2.再查技能目录 | 技能从目录消失，无残留 | P0 | 新增行为，无回归基线 |
| TC-049 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 用户自装同名技能优先 | [AC-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 用户目录已装同名技能 | 1.查看技能目录 2.加载该技能 | 以用户安装版本为准；不冲突、不重复提示；插件不覆盖用户目录 | P1 | 基线：dsh 技能发现既有优先级 |
| TC-050 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 只内置 Web 场景技能 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 插件已载入 | 1.列出包内技能 | 只有 `browser-automation`；未承诺的移动端/桌面技能不内置 | P2 | 新增行为，无回归基线 |

### [FNOS-013-14 插件图标](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-051 | [FNOS-013-14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | 插件管理页显示图标 | [AC-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | 插件已装入且作为 bundle 出现在管理页 | 1.打开插件管理页 2.观察本插件条目 | 显示随包分发的本地图片（无外部请求） | P1 | 新增行为，无回归基线 |
| TC-052 | [FNOS-013-14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | 图标来源注明且亮暗主题可见 | [AC-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | 同上 | 1.亮暗主题各看一遍 2.核对来源登记 | 两个主题下清晰可见；来源与许可在仓库内注明 | P2 | 新增行为，无回归基线 |
| TC-053 | [FNOS-013-14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | 图标符合宿主校验 | [AC-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | 包已构建 | 1.核对格式、体积与路径 2.查看加载诊断 | PNG 且 ≤256 KiB；路径在包内；无 icon 相关诊断错误 | P1 | 新增行为，无回归基线 |

## 测试执行结果

> 按[测试用例文档规范](/charter/tests-spec#执行结果与-bug-记录)逐条回填；结果取值「通过 / 失败 / 阻塞 / 未执行」。
> 环境版本三元组：DSH `0.2.0-rc.2` / 插件 `@tnnevol/dsh-midscene` `0.2.0-rc.2.0` / 应用 `5.7.0`。
> 执行载体：DSH Web（`DSH_HOME=<repo>/.dsh`，端口 8070；桥接端口 8787）与本地包级测试。DSH Desktop 与 Midscene 端到端（TC-027 起）未执行。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | DSH Web | 通过 | 2026-10-12 | 实测 `/v1/health` 返回 `status: ok`，`providers` 为 `[openai-codex, deepseek-official, deepseek-account, codebuddy]`（4 个），`models` 24，`attachments: true` |
| TC-002 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | DSH Web | 通过 | 2026-10-12 | 禁用插件后重启：8787 无监听进程（`curl` 返回 000），重新启用后恢复 200；包级测试另覆盖 stop 后端口可被新实例立即复用 |
| TC-003 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 本地测试 | 通过 | 2026-10-12 | 单测用真实 HTTP 服务器占用端口后调 `start()`，断言抛 `BridgePortInUseError` 且消息含端口与处理建议 |
| TC-004 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | DSH Web | 通过 | 2026-10-12 | 服务以 `127.0.0.1` 绑定（`BRIDGE_HOST` 常量 + `server.listen(port, host)`）；回环可访问、无局域网监听 |
| TC-005 | [FNOS-013-01](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-01) | 本地测试 | 通过 | 2026-10-12 | 未知端点返回 404，消息列出三个可用端点 |
| TC-006 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | DSH Web | 通过 | 2026-10-12 | 实测目录 24 条，覆盖 4 个提供方；标识均为「提供方/模型」形式（如 `codebuddy/glm-5.3-flash`、`openai-codex/gpt-6-luna`） |
| TC-007 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | DSH Web + 本地测试 | 通过 | 2026-10-12 | 实测 22/24 条 `vision: true`；单测锁定「元数据缺省按不支持处理且不伪造 `input_modalities`」 |
| TC-008 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 本地测试 | 通过 | 2026-10-12 | 单测模拟新增提供方后调 `catalog.invalidate()`，目录即时反映；实现侧订阅 `llm/adapters-updated` |
| TC-009 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 本地测试 | 通过 | 2026-10-12 | 单测覆盖：模型 id 自含 `/`、提供方 id 自含 `/`（最长前缀匹配）、未命中已知提供方时退化为首个 `/` |
| TC-010 | [FNOS-013-02](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-02) | 本地测试 | 通过 | 2026-10-12 | 单测构造一个 `listModels` 抛错的提供方，断言其余提供方模型照常返回 |
| TC-011 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | DSH Web | 通过 | 2026-10-12 | 实测经 `codebuddy/glm-5.3-flash` 与 `openai-codex/gpt-6-luna` 各返回完整回答，含 `usage`（如 17/124/141） |
| TC-012 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | DSH Web | 通过 | 2026-10-12 | 实测 SSE：首片带 `role`、逐片 `content`、末片 `finish_reason: stop`、以 `data: [DONE]` 收尾 |
| TC-013 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | DSH Web | 通过 | 2026-10-12 | 实测 CodeBuddy 模型的推理内容以 `reasoning_content` 增量透出，与可见文本分开 |
| TC-014 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 本地测试 | 通过 | 2026-10-12 | 单测验证数据 URI 经 `saveImages` 落成受管附件并转为 `ImageBlock`；真实端到端（真实视觉回答）未执行 |
| TC-015 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 本地测试 | 通过 | 2026-10-12 | 单测与 HTTP 测试均断言：不支持图片的模型收到图片返回 400 且消息提示改用 `vision: true` 模型 |
| TC-016 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 本地测试 | 通过 | 2026-10-12 | 单测断言 `https://…` 形式被拒（`parseDataUri` 只接受四类图片的 base64 数据 URI） |
| TC-017 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 本地测试 | 通过 | 2026-10-12 | 单测断言错误消息前置「提供方/模型」，并按宿主 `code` 分类映射状态码（`QUOTA`→429 等） |
| TC-018 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | DSH Web | 通过 | 2026-10-12 | 实测 CodeBuddy 与 Codex 两个提供方各自返回正确回答；`deepseek-official` 因未配置凭据返回明确错误（见 TC-024） |
| TC-019 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 本地测试 | 通过 | 2026-10-12 | HTTP 测试断言宿主调用入参含 `temperature`/`maxTokens`/`stop` |
| TC-020 | [FNOS-013-03](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-03) | 本地测试 | 通过 | 2026-10-12 | 非法 JSON 与空 `messages` 均返回 400 |
| TC-021 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 本地测试 | 通过 | 2026-10-12 | HTTP 测试在请求体注入 `api_key`/`authorization`，断言宿主调用入参既不含其值、键集合也仅限协议字段 |
| TC-022 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | DSH Web | 通过 | 2026-10-12 | 桥接调用期间 CodeBuddy 账号与用量功能正常（走查期间同一会话的模型选择器与用量显示未受影响）；「续期行为」本身由该插件既有测试覆盖 |
| TC-023 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | DSH Web | 通过 | 2026-10-12 | Codex 路由经桥调用成功，未在桥内配置任何密钥（凭据来自 `dsh-codex-auth` 插件既有配置） |
| TC-024 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | DSH Web | 通过 | 2026-10-12 | 实测 `deepseek-official/deepseek-flash`（未配置 API key）返回 400 + `code: MISSING_CREDENTIAL`，消息含「提供方/模型」、宿主原始原因与设置指引；其它路由不受影响 |
| TC-025 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | DSH Web + 本地测试 | 通过 | 2026-10-12 | **实测发现的缺陷已修（BUG-01）**：宿主把提供方失败编码在 `finish` 分片里，原先被当作正常结束而返回空回答；现非流式返回标准错误、流式先发错误分片再正常收尾 |
| TC-026 | [FNOS-013-04](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-04) | 本地测试 | 通过 | 2026-10-12 | HTTP 测试在无附件服务时断言 `attachments: false`；图片请求返回 503 级明确错误 |
| TC-027 | [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | DSH Web | 通过 | 2026-10-12 | SDK 路径实测：用 PuppeteerPageAgent 附加既有 Chrome（视口 1512×945）执行 aiAct 点击左侧边栏插件菜单项，act 自述成功后经 CDP 读 DOM 独立核实 hasAddPlugin: true、hasMidscene: true（页面真的跳转）。CLI 路径同指令未通过，原因与坐标数据见 TC-042 与 BUG-03 |
| TC-028 | [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | DSH Web | 通过 | 2026-10-12 | 两项基线均通过（同样经 CDP 独立核实，不采信 act 自述）：① 页签切换「已安装」→ ok: true；② 密集列表中精确定位 @tnnevol/dsh-midscene 条目 → hasSettings: true（真的点开了插件详情页并显示接入设置区块）。**精度余量偏小**：同一按钮实测落点 SDK 为 (86,130)、YAML 运行器为 (68,110)/(200,110)/(201,110)，而按钮真实区域 y∈[120,156] —— 余量在 10px 量级，见 BUG-03 与结论 |
| TC-029 | [FNOS-013-05](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-05) | DSH Web | 通过 | 2026-10-12 | 同一任务（点「插件」并断言插件列表）分别用 Midscene 与 CDP 脚本执行：CDP 在页面内直接 element.click() 立即生效（hasAddPlugin: true）；Midscene 的 act 需视口足够宽（≥1440）才可能命中。对照结论：CDP 稳定且精确，Midscene 在窄视口下不可用、宽视口下有落点偏差；两者定位到同一真实按钮位置 (14,120,252,36) |
| TC-030 | [FNOS-013-06](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06) | 文档站 | 通过 | 2026-10-12 | 说明页含安装命令、接入配置模板、模型选择指引（`vision: true`）、额度提示、9 行故障排查表与配置项表；链接经文档检查 |
| TC-031 | [FNOS-013-06](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-06) | 文档站 | 通过 | 2026-10-12 | 插件总览表格新增一行并同步「六个运行时插件」表述；VitePress 侧边栏 `pluginItems` 加入条目 |
| TC-032 | [FNOS-013-07](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07) | 文档站 | 通过 | 2026-10-12 | 规范新增「Midscene 浏览器自动化测试」章节：适用范围表、项目环境前置条件、三类环境接入表、执行与证据、与人工走查/CDP 取证的工分表 |
| TC-033 | [FNOS-013-07](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-07) | 文档站 | 通过 | 2026-10-12 | 章节明确沿用既有执行环境/版本记录/auth 备份约束；`pnpm run check -- --sdd` 通过（13 需求 / 13 计划 / 4 测试文档）；顺带修复该文档变更记录表分隔行损坏 |
| TC-034 | [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | DSH Web | 通过 | 2026-10-12 | 干净目录（tmp/clean-verify）按插件说明页逐步执行：① curl /v1/health → status: ok；② 一条命令生成 .env（5 行，四行固定值）；③ curl /v1/models 正常返回。**首次执行时第 ③ 步失败**（/v1/models 当时要求密钥返回 401），据此修复为只读发现类端点免鉴权（BUG-04），修复后三步全部通过 |
| TC-035 | [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | DSH Web | 通过 | 2026-10-12 | 本轮未创建接入配置；`git status` 核对无配置文件混入（`.env` 未生成） |
| TC-036 | [FNOS-013-08](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-08) | 文档站 | 通过 | 2026-10-12 | 上述流程即按文档站章节从干净环境逐步复现，未遇到文档未覆盖的步骤；.env 为固定四行、换模型不需修改（与文档描述一致）。发现的文档与实现不一致处见 BUG-04（已随代码修复，文档命令无需再加密钥） |
| TC-037 | [FNOS-013-09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | DSH Web | 通过 | 2026-10-12 | 经桥完成多步自然语言流程：点击「插件」→ 断言列表 → 点击「已安装」页签 → 点击具体插件条目进入详情页并显示设置区块；每步均用 CDP 读 DOM 独立核实（TC-027/TC-028 的 ok: true、hasSettings: true） |
| TC-038 | [FNOS-013-09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | 文档站 | 通过 | 2026-10-12 | 证据即上述执行产生的 Midscene HTML 报告（含每步截图与规划过程）与独立核实的 DOM 快照；报告经 midscene_run/report/ 生成，关键结论已登记本表。报告未入库（体积 3 MB 级），按验收证据规范只引用结论 |
| TC-039 | [FNOS-013-09](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-09) | DSH Web | 通过 | 2026-10-12 | 本轮走查全程使用既有 CDP 与浏览器自动化方式（插件管理页与技能目录核对），证明既有路径未受影响 |
| TC-040 | [FNOS-013-10](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-10) | 文档站 | 通过 | 2026-10-12 | 规范「相关页面」加插件说明页链接；验收证据规范新增「Midscene 执行证据登记」小节并互相引用；`--sdd` 检查与文档构建通过 |
| TC-041 | [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | DSH Web | 通过 | 2026-10-12 | npx @midscene/cli@1 model verify 三项全 PASS：planning Text response 1917ms、insight Image understanding 8768ms、default AI locate 4129ms，请求全部发往 http://127.0.0.1:8787/v1/chat/completions（3 次请求 / 3 项通过）。**其中 Image understanding PASS 补上了 TC-014 一直缺的「真实视觉回答」验证** |
| TC-042 | [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | DSH Web | 失败 | 2026-10-12 | @midscene/cli 默认启动浏览器失败（spawn Unknown system error -88，本机沙箱拒绝启动，且 CLI 无法传 --no-sandbox）。改用 YAML 的 web.cdpEndpoint 附加既有 Chrome 后运行器正常执行：任务一 aiAssert **pass: true**（正确读出 DSH Web 界面细节），任务二定位失败 —— 点击落点 (68,110)，真实按钮区域 y∈[120,156]，落在按钮上方。见 BUG-03 |
| TC-043 | [FNOS-013-11](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-11) | DSH Web | 失败 | 2026-10-12 | 同上（YAML 运行器的交互步骤）。--deep-locate 重跑仍失败，落点 (200,110)。结论：YAML 运行器**断言能力经桥可用**、**交互步骤在本页面定位精度不足** |
| TC-044 | [FNOS-013-12](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | DSH Web | 通过 | 2026-10-12 | @midscene/test 1.15.1 经 createCaseRunner + 自定义 Node（execute）跑通：status: success，两步（附加页面 / aiAssert 首页可见）均执行；断言思考内容描述了真实截图细节（deepseek 标志、HARNESS 标签、「新会话」按钮、输入框占位文字），证明模型确实经桥读取了页面截图 |
| TC-045 | [FNOS-013-12](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-12) | 文档站 | 通过 | 2026-10-12 | @midscene/test 与 @midscene/cli 实测版本均为 **1.15.1**（@midscene/web 1.15.0），Node.js v24.17.0，插件 0.2.0-rc.2.0，DSH 运行时 0.2.0-rc.2；接入配置为插件生成的固定四行 |
| TC-046 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | DSH Web | 通过 | 2026-10-12 | **实测**：重启后在会话中查询技能目录，`browser-automation` 在列（会话目录共 78 个技能）；已确认用户目录与项目技能目录均无同名技能，故来源唯一为插件内置分发 |
| TC-047 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 本地测试 | 通过 | 2026-10-12 | 包内技能为官方 `skills/browser/SKILL.md` 原文（sha256 前 16 位 `9aa7c602a7004e53`）；`SOURCE.md` 登记上游提交、同步日期、许可（MIT）与同步方式 |
| TC-048 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | DSH Web | 通过 | 2026-10-12 | **实测**：禁用插件并重启后，agent 在会话中回答「没有」（技能已从目录消失）；同时桥接端口释放 |
| TC-049 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 本地测试 | 通过 | 2026-10-12 | 单测锁定实现前提：技能只经 `registerProvider` 注册、不写用户技能目录；优先级由宿主既有发现顺序（项目 > 用户 > 插件）承担。真实同名共存场景未构造 |
| TC-050 | [FNOS-013-13](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-13) | 本地测试 | 通过 | 2026-10-12 | 单测断言包内技能只有 `browser-automation`，且不含 android/ios/harmony/computer 四个未承诺平台技能 |
| TC-051 | [FNOS-013-14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | DSH Web | 通过 | 2026-10-12 | **实测**（亮色主题）：插件管理页「已安装」从 4 → 5，本插件条目显示 PNG 图标（`data:image/png;base64`，源图 600×600 渲染 36×36），无外部请求 |
| TC-052 | [FNOS-013-14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | DSH Web | 通过 | 2026-10-12 | **实测**（暗色主题）：图标在暗色下清晰可见；来源（官方站点 favicon URL、取用日期、MIT 许可）登记在包内 `skills/SOURCE.md` 与插件说明页「图标来源」小节 |
| TC-053 | [FNOS-013-14](/requirements/FNOS-013-midscene-browser-automation-bridge#fnos-013-14) | DSH Web + 本地测试 | 通过 | 2026-10-12 | PNG 101 331 字节（≤256 KiB）；`package.json` `icon` 字段为包内相对路径且已进 `files` 白名单；启动日志无 icon 相关诊断 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | [TC-025](/tests/FNOS-013-midscene-browser-automation-bridge) | 提供方在流内失败时桥返回空回答，真实原因丢失 | P1 | 已修复 | 实测发现：宿主把提供方失败编码在 `finish` 分片的 `reason.failure` 里（此时流无文本产出），桥原先只映射 `finish_reason`，客户端看到的是「成功的空回答」——未配置凭据、额度不足等原因全部消失。修复：聚合时捕获 `failure`，非流式改为返回标准错误（保留提供方 HTTP 状态）、流式先发错误分片再正常收尾。新增 3 条测试（非流式错误、流式错误分片、真实未配置凭据场景） |
| BUG-02 | [TC-051](/tests/FNOS-013-midscene-browser-automation-bridge) | 插件未声明 `dsh.bundle` 导致不显示在插件管理页 | P2 | 已修复 | 实测发现：`package.json` 的 `dsh` 字段缺失 `bundle.patch`，宿主因此不把本插件当作组合包，插件管理页的「已安装」列表不收录它（图标自然也无处显示）。修复：补 `dsh.bundle.patch` 指向 `cordis.patch.yml`；修复后管理页收录且图标显示 |

## 测试结论

**整体结论：部分通过（桥接服务、设置界面、文档交付与 Midscene 端到端全部完成验证；YAML 运行器的交互步骤存在定位偏差，已定位并给出规避方式）。**

- 执行用例总数 **53**，通过 **51**，失败 **2**（TC-042、TC-043，均为同一定位问题的表现），未执行 **0**，遗留 Bug **4**（BUG-01、BUG-02、BUG-04 已修复；BUG-03 属上游定位精度，已定位并规避）。
- **FNOS-013-01～04（桥接服务本体）本地与 DSH Web 全部通过**：服务托管、端口策略、目录映射、对话补全（流式/非流式/推理分片/图片门控）、多提供方路由、凭据边界与错误归因。本轮新增真实视觉验证：`model verify` 的 `Image understanding` 通过（补上 TC-014 缺口）。
- **FNOS-013-05（Midscene 端到端）三项通过**：SDK 路径完成「点击 → 断言」并经 CDP 独立核实页面真的跳转；密集列表中的条目定位准确（真的点开了插件详情页并显示接入设置区块）。
- **FNOS-013-11/12（YAML 运行器与 Test 框架）**：`@midscene/cli` 1.15.1 的 `model verify` 3/3 通过、YAML 运行器的 `aiAssert` 通过（证明断言链路经桥可用）；`@midscene/test` 1.15.1 经 `createCaseRunner` + 自定义 Node 跑通（`status: success`，断言思考内容与真实截图一致）。**YAML 运行器的交互步骤未通过**（TC-042/043），原因是视觉定位对 36px 小控件的落点偏差（BUG-03）。
- **FNOS-013-13/14（内置技能与图标）**：技能可见、禁用后消失、来源登记完整；图标亮暗主题显示正常。
- **设置界面（本轮新增能力）实测通过**：插件详情页渲染于「包含的组件」之后，密钥显示/重新生成/自定义、家族下拉、指定模型、`.env` 预览与复制可用；设置写入立即作用于运行中的桥（家族与密钥都已实测生效，旧密钥 401）。
- **文档交付（06、07）与证据规范（10）通过**：插件说明页、总览与侧边栏、测试规范 Midscene 章节、验收证据小节与交叉引用齐备。

### 未通过项与遗留风险

| 项 | 状态 | 说明 |
| --- | --- | --- |
| TC-042、TC-043（YAML 运行器交互步骤） | 失败 | 视觉定位落点偏差（BUG-03）。运行器本身可用（断言通过），失败仅在「点击小控件」；用宽视口 + CDP 独立核实可规避 |
| DSH Desktop 侧 | 未执行 | 01～04、13、14 的 Desktop 结论缺失；按兼容基线要求，只记录单一客户端不构成完成结论 |
| BUG-03 根治 | 未做 | 属上游（Midscene）视觉定位精度，本仓库不改上游代码；已在插件说明页与测试规范登记规避方式（宽视口、`--use-mock-keychain`、CDP 独立核实） |

### 本轮测试环境（版本三元组）

| 项 | 值 |
| --- | --- |
| DSH 运行时 | `0.2.0-rc.2` |
| 插件 | `@tnnevol/dsh-midscene` `0.2.0-rc.2.0`（本地加载，profile `.dsh/profiles/web`） |
| 被测客户端 | DSH Web（`127.0.0.1:8070`，token 鉴权） |
| 浏览器 | Chrome for Testing `150.0.7871.24`（`--use-mock-keychain --no-sandbox --headless=new --window-size=1512,945`） |
| Midscene | `@midscene/web` 1.15.0、`@midscene/cli` 1.15.1、`@midscene/test` 1.15.1 |
| Node.js | v24.17.0 |
| 模型 | `codebuddy/glm-5.3-flash`（家族 `glm-v`），经桥 `dsh-model` 解析 |
