---
id: FNOS-020
title: FNOS-020 测试用例
description: FNOS-020 CodeBuddy 瞬时 400 终止整轮修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-020-codebuddy-transient-400
plan: /plans/PLAN-FNOS-020-codebuddy-transient-400
status: 通过
lastVerified: 2026-10-20
verifiedAt: 2026-10-19
---

# FNOS-020 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-020 |
| 关联需求 | [FNOS-020 CodeBuddy 瞬时 400 终止整轮修复](/requirements/FNOS-020-codebuddy-transient-400) |
| 关联计划 | [PLAN-FNOS-020 CodeBuddy 瞬时 400 终止整轮修复](/plans/PLAN-FNOS-020-codebuddy-transient-400) |
| 测试状态 | <Badge type="tip" text="通过（11 条全部通过，含 DSH Web 与 DSH Desktop）" /> |
| 执行环境 | 本地构测（单测）、DSH Web（本地 8070）、DSH Desktop（开发态） |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-020-codebuddy-transient-400#功能列表) 中 FNOS-020-01 至 FNOS-020-04。

本需求的测试难点有三处：

**① 触发条件原先被认为不可构造。** 该 400 由 CodeBuddy 网关偶发返回。本轮找到了**故障注入**路径：用本地 HTTP 桩返回与真实网关**同形**的响应（HTTP 400 + `Invalid request parameters` + 不带业务码 + `x-request-id`），并把活动账号的 `endpoint` 指向桩。插件只按 HTTP 状态与响应体文案分类（`httpErrorCode`），响应形态一致即走同一分支，因此这能覆盖真实代码路径。**局限**：注入的是「响应形态」而非「网关偶发机制」本身。

**② 必须同时证明「重试了」和「没有滥重试」。** 只断言 `INVALID_REQUEST` 在集合里，会把「顺手把 `QUOTA` 也加进去」这种错误改动放过去——那会让已耗尽的账号被原地重试而不是换号。因此需要反向断言。

**③ 重试安全性依赖一个代码不变量。** 「重试不会重复内容」由 `emitted` 标志保证（产出过 chunk 就不重试），本需求不改该逻辑，用例通过策略层断言与「重试发生在失败时」间接覆盖。

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-020-02](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-02)、[FNOS-020-03](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-03)、[FNOS-020-04](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-04) | 本地构测环境（单测覆盖） |
| [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | DSH Web（本地 `pnpm run start -- --web`，8070）+ 故障注入桩 |

**双客户端要求**：CodeBuddy 属「其他 DSH 插件」，按[测试环境执行方式](/charter/tests-spec#测试环境执行方式)须同时覆盖 DSH Web 与 DSH Desktop。本次只完成 DSH Web，Desktop 未执行（原因见执行结果），因此本需求**不构成完成结论**。

版本基线：DSH `0.2.1-rc.2` / 插件 `@tnnevol/dsh-codebuddy@0.2.1-rc.2.8` / 应用 `5.9.0`。

## 测试用例

### [FNOS-020-02 路由自带重试策略](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-020-02](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-02) | `INVALID_REQUEST` 在可重试集合内 | AC-01 | — | 读取 `CODEBUDDY_RETRY_POLICY.retryableCodes` | 含 `INVALID_REQUEST` | P0 | 缺陷场景 |
| TC-002 | [FNOS-020-02](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-02) | 官方默认五码未被丢弃 | AC-02 | — | 遍历官方默认集合逐项断言 | 五码全部存在 | P0 | 回归保护 |
| TC-003 | [FNOS-020-02](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-02) | 适配器实例暴露该策略 | AC-01 | — | 调用 `CodeBuddyAdapter.prototype.providerRetryPolicy('codebuddy')` | 返回与 `CODEBUDDY_RETRY_POLICY` 同一对象（基类默认返回 `undefined`） | P0 | 缺陷场景 |

### [FNOS-020-03 不误重试确定性错误](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-004 | [FNOS-020-03](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-03) | 上下文超限与额度耗尽不在重试集合 | AC-01 | — | 断言 `retryableCodes` 不含 `CONTEXT_WINDOW_EXCEEDED` 与 `QUOTA` | 两者均不存在 | P0 | 安全要求 |

### [FNOS-020-04 重试次数有界](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | [FNOS-020-04](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-04) | 策略为 normal 且最多 2 次 | AC-01 | — | 断言 `mode === 'normal'`、`maxRetries === 2` | 均成立（非官方默认的 5 次） | P1 | 安全要求 |

### [FNOS-020-01 瞬时 400 不再终止整轮](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | 运行时采纳本路由策略 | AC-01 | DSH Web 已加载修复版本；故障注入桩已接入 | 1.发一条消息触发 chat 请求 2.读事件流 `llm/retry` 的 `policyKey` | `policyKey` 为 `["normal",2,[…, "INVALID_REQUEST", …],500,10000,0.1]`，即运行时用的是本路由策略而非官方默认 5 次集合 | P0 | 缺陷场景 |
| TC-007 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | 首次 400 后自动恢复继续 | AC-01 | 同上；桩配置为「首次 chat 返回 400，之后成功」 | 1.发一条消息 2.观察界面结果与桩日志 | 轮次标记「已完成」，内容正常产出；桩日志显示首次 400、第二次请求成功 | P0 | 缺陷场景 |
| TC-008 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | 重试耗尽后有界失败 | AC-01、AC-02 | 同上；桩配置为「始终 400」 | 1.发一条消息 2.统计桩收到的 chat 请求数 3.读事件流 | 主对话共 3 次请求（1 原始 + 2 重试）；界面显示「已重试模型请求（2/2）」后失败；无重复内容 | P0 | 安全要求 |

### 双客户端覆盖

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | DSH Web 正常加载插件 | AC-01 | DSH Web（8070，项目 `.dsh` profile） | 1.打开 Web 2.选 CodeBuddy 模型 3.发消息 | 模型选择器出现 CodeBuddy 分组与倍速；消息正常完成 | P0 | 客户端覆盖 |
| TC-010 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | DSH Desktop 正常加载插件 | AC-01 | 开发态 Desktop（`fork-pj/deepseek-harness` 检出） | 同 TC-009，改用 Desktop | 同上 | P0 | 客户端覆盖 |
| TC-011 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | DSH Desktop 首次 400 后自动恢复 | AC-01、AC-02 | 同上；桩配置为「首次 chat 返回 400，之后成功」 | 1.发一条消息 2.观察界面与桩日志 3.读事件流 `policyKey` | 轮次「已完成」并产出内容；桩日志首次 400、第二次成功；`policyKey` 含 `INVALID_REQUEST` 且 `maxRetries: 2` | P0 | 客户端覆盖 |

## 执行结果

### 阶段一：策略层（本地构测，2026-10-19）

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-020-02 | 本地构测 | 通过 | 2026-10-19 | `retryableCodes` 含 `INVALID_REQUEST` |
| TC-002 | FNOS-020-02 | 本地构测 | 通过 | 2026-10-19 | 五个官方默认码全部保留 |
| TC-003 | FNOS-020-02 | 本地构测 | 通过 | 2026-10-19 | 实例返回同一策略对象；基类默认实现返回 `undefined`，故该断言同时证明覆写生效 |
| TC-004 | FNOS-020-03 | 本地构测 | 通过 | 2026-10-19 | 集合内无 `CONTEXT_WINDOW_EXCEEDED`、无 `QUOTA` |
| TC-005 | FNOS-020-04 | 本地构测 | 通过 | 2026-10-19 | `mode: 'normal'`、`maxRetries: 2` |

命令与结果：

```text
pnpm exec vitest run tests/retry-policy.spec.ts   →  5 passed (5)
pnpm run typecheck                                →  通过（--force 无缓存：11/11）
pnpm run test（插件全量）                          →  72 files / 914 tests passed
```

**产物层复核**（`tmp/verify-retry-artifact.mjs`）：直接 `require` 构建产物 `lib/index.js` 并实例化适配器，确认 `providerRetryPolicy()` 返回的策略为 `normal / maxRetries 2 / 含 INVALID_REQUEST / 已冻结`，8 项断言全通过。**这一步必要**：DSH 加载的是 `lib/` 产物而非 `src/`，而本轮开始时产物是 15:00 的旧构建（早于 17:08 的源码改动），重建后才有新策略。

### 阶段二：运行时与恢复（DSH Web，2026-10-19）

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-006 | FNOS-020-01 | DSH Web | 通过 | 2026-10-19 | 事件流 `llm/retry` 的 `policyKey` = `["normal",2,["EMPTY_RESPONSE","INVALID_REQUEST","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]`；对比修复前为 `["normal",5,[…无 INVALID_REQUEST…],…]` |
| TC-007 | FNOS-020-01 | DSH Web | 通过 | 2026-10-19 | 桩日志：`主对话第 1 次 → 400`，459ms 后 `主对话第 2 次 → 200`；界面「已完成，用时 1 秒」并产出内容 |
| TC-008 | FNOS-020-01 | DSH Web | 通过 | 2026-10-19 | 桩收到主对话 3 次请求（1 原始 + 2 重试）；界面「已重试模型请求（2/2）· 2s」后失败；事件流 `retry=1`、`retry=2` 各一次，无第三次 |
| TC-009 | FNOS-020-01 | DSH Web | 通过 | 2026-10-19 | 模型选择器出现 CodeBuddy 分组与倍速（`Deepseek-V4.1-Flash · x0.11` 等 12 项）；消息正常完成 |
| TC-010 | FNOS-020-01 | DSH Desktop | 通过 | 2026-10-20 | 开发态 Desktop（`@deepseek-ai/dsh-desktop@0.2.1-rc.2`，上游检出，CDP 9333）；模型选择器列出 CodeBuddy 分组共 12 项（`Deepseek-V4.1-Flash · x0.11` 等），选 CodeBuddy 模型后消息正常完成（「已完成，用时 3 秒」→「收到」） |
| TC-011 | FNOS-020-01 | DSH Desktop | 通过 | 2026-10-20 | 桩日志：`主对话第 1 次 → 400`，513ms 后 `主对话第 2 次 → 200`；界面「已完成，用时 1 秒」并产出内容；事件流 `llm/retry` 的 `policyKey` = `["normal",2,["EMPTY_RESPONSE","INVALID_REQUEST","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]`，与 DSH Web 一致 |

#### 故障注入的做法（供复现）

1. 本地 HTTP 桩返回与真实网关同形的 400：`{"msg":"Invalid request parameters"}`，带 `x-request-id`，不带业务码；同时提供合法的 `/v3/config` 模型目录（否则目录为空会让 harness 在更早一步以 `UNSUPPORTED_REASONING_EFFORT` 失败，走不到 chat）。
2. 把项目 profile 中活动账号的 `endpoint` 指向桩（`resolveEntryEndpoint` 优先取该字段）。
3. 重启 DSH Web（`chatBase` 走 `this.storage` 缓存，改文件后需重启才重新读盘）。
4. 关键区分：`/v2/chat/completions` 同时承载**主对话**与**标题生成**请求，按请求体是否含 `"tools"` 区分，否则会把标题请求算进重试次数。

#### 版本三元组

DSH `0.2.1-rc.2`（`@deepseek-ai/dsh`）/ 插件 `@tnnevol/dsh-codebuddy@0.2.1-rc.2.8`（源码 `link:` 进项目 profile，产物 17:38 重建）/ 应用 `5.9.0-0.2.1-rc.2.8`。

#### 测试数据清理

- 测试前备份 `.dsh/codebuddy-auth.json` 到 `tmp/auth-back/dsh-codebuddy-0.2.1-rc.2.8-20261019-175450.json`（`600`）。
- 测试后按备份恢复，已核对：权限 `600`、6 个账号、无残留 `endpoint` 覆盖。
- 已停止故障注入桩与测试用 DSH Web 实例（8070 已关闭）。
- 未向仓库写入任何凭据；桩与校验脚本在 `tmp/`（git 忽略）。

## 问题记录

| 编号 | 描述 | 状态 |
| --- | --- | --- |
| BUG-001 | 修复前 `INVALID_REQUEST` 既不在 DSH 默认重试集合，也不在插件换号集合，一次瞬时 400 直接终止整轮 | 已修复（DSH Web 运行时已验证） |
| BUG-002 | 该 400 的**根因未定位**：只能证明不是请求内容不合法，无法证明是网关节点、账号态还是读取竞态 | 未解决，已登记为遗留项 |
| BUG-003 | 插件 `lib/` 产物可能落后于 `src/`，此时 DSH 加载的是旧逻辑。本轮开始时产物为 15:00、源码改动在 17:08，未重建即测试会得出「修复无效」的错误结论 | 已规避（重建后测试）；建议纳入验证流程 |

## 测试结论

**通过。** 11 条全部通过，无失败、无阻塞、无未执行。

**策略层**：值正确（含 `INVALID_REQUEST`、`maxRetries: 2`、排除 `CONTEXT_WINDOW_EXCEEDED` 与 `QUOTA`），且构建产物与源码一致。

**运行时（DSH Web 与 DSH Desktop 两个客户端）**：均读到 `policyKey` = `["normal",2,[…,"INVALID_REQUEST",…],500,10000,0.1]`，与修复前的 `["normal",5,[…]]` 明确不同——策略被运行时采纳；首次 400 后自动重试并成功完成（Web 459ms、Desktop 513ms），耗尽 2 次重试后有界失败（Web 实测 1 原始 + 2 重试），未出现重复内容。

按[兼容基线](/charter/tests-spec#测试环境执行方式)，非 fnOS 插件须同时覆盖 Web 与 Desktop；两个客户端均已覆盖，构成完成结论。

需要说明的是：本次是**缓解**而非根治。根因未定位，若后续证明该 400 由 `attemptStream` 的读取竞态导致，应另立需求收敛读取时序。

另一处如实登记：TC-007、TC-008、TC-011 的 400 来自故障注入桩而非网关偶发，覆盖的是「响应形态 → 错误码 → 重试判定」这条真实代码路径，**不覆盖**「网关为何偶发该 400」。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-19 | 初始登记 | 建立 FNOS-020 测试用例文档：6 条用例，策略层 5 条 + 真实环境 1 条（当时判定「依赖网关偶发 400，本地不可构造」）。 |
| 2026-10-19 | 补故障注入路径并新增 4 条用例 | 发现该 400 可用本地桩构造同形响应来覆盖真实代码路径，原「不可构造」的判断不再成立。新增 TC-006（运行时采纳策略）、TC-007（首次 400 后自动恢复）、TC-008（重试耗尽后有界失败）、TC-009（DSH Web 客户端加载）与 TC-010（DSH Desktop 客户端加载）。补「故障注入的做法」小节，记录四个必须注意的点（合法目录、endpoint 覆盖、重启读盘、区分标题请求）。 |
| 2026-10-19 | 回填 DSH Web 执行结果 | 6 条通过、TC-010 未执行。关键证据：`llm/retry` 的 `policyKey` 为 `["normal",2,[…INVALID_REQUEST…],500,10000,0.1]`（修复前为 `5` 且无该码）；桩日志显示首次 400 后 459ms 重试成功、轮次「已完成」；始终 400 时主对话恰好 3 次请求后失败。补版本三元组与数据清理动作。状态「未执行」→「部分通过」。 |
| 2026-10-20 | 补 DSH Desktop 执行结果，整体判定通过 | 开发态 Desktop（上游检出，CDP 9333，项目 `.dsh` profile）两个客户端均已覆盖：TC-010 模型选择器列出 CodeBuddy 分组 12 项、选 CodeBuddy 模型后消息正常完成；新增 TC-011 验证 Desktop 首次 400 后自动恢复（桩日志首次 400、513ms 后成功，界面「已完成」），运行时 `policyKey` 与 DSH Web 一致。11 条全部通过，状态「部分通过」→「通过」。同时登记一个 Desktop 专有的操作要点：`document.execCommand('insertText')` 对该富文本编辑器无效，输入须用 CDP 的 `Input.insertText`；macOS 上全选是 Cmd+A（`modifiers: 4`）而非 Ctrl+A。 |
