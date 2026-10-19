---
id: PLAN-FNOS-020
title: PLAN-FNOS-020 CodeBuddy 瞬时 400 终止整轮修复
description: 为 codebuddy 路由实现自带重试策略，把 INVALID_REQUEST 纳入有界重试；配套单测覆盖纳入、有界与不误重试三类断言。分阶段：阶段一实现与本地验证，阶段二发布后在真实环境复验。
status: in_progress
owner: tnnevol
targetVersion: 5.9.0
lastVerified: 2026-10-19
---

# PLAN-FNOS-020 CodeBuddy 瞬时 400 终止整轮修复

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-020 |
| 计划日期 | 2026-10-19 |
| 对应需求 | [FNOS-020 CodeBuddy 瞬时 400 终止整轮修复](/requirements/FNOS-020-codebuddy-transient-400) |
| 本轮功能 | FNOS-020-01 至 FNOS-020-04 |
| 计划状态 | <Badge type="warning" text="阶段一完成；阶段二待发布后复验" /> |

## 计划目标

让一次偶发的 CodeBuddy 400 不再终止整轮：由 `codebuddy` 路由自带重试策略，把 `INVALID_REQUEST` 纳入有界重试，同时保证确定性失败不被误重试。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 重试策略来源 | 适配器未覆写 `providerRetryPolicy()`，基类返回 `undefined`，调用方退回官方默认集合 | 覆写该方法，返回本路由自有策略 | 无：仅影响 `codebuddy` 路由 |
| 可重试错误码 | 官方五码：`EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT` | 官方五码 + `INVALID_REQUEST` | 瞬时 400 由「终止整轮」变为「重试后继续」 |
| 重试次数 | 官方默认 5 次 | 2 次 | 400 属确定性错误的概率更高，缩短上界 |
| 换号逻辑 | 仅 `QUOTA`/`RATE_LIMIT` 触发 | 不变 | 无 |
| 确定性错误 | 上下文超限 → `CONTEXT_WINDOW_EXCEEDED`；额度 → `QUOTA` 换号 | 不变（且刻意排除在重试集合外） | 无 |

### 为什么改在适配器而不是 DSH 上游

DSH 的重试策略按**路由**归属：`llm/src/index.ts` 优先取 `adapter.providerRetryPolicy(provider)`，缺失时才退回默认。官方 deepseek provider 正是这样携带自己的策略。因此本修复完全落在本仓库插件内，符合「不修改上游代码」的硬约束。

### 为什么 `INVALID_REQUEST` 值得重试

CodeBuddy 对该类失败只回一句 `Invalid request parameters`，**不带业务码**，插件无法区分「请求确实不合法」与「网关侧瞬时拒绝」。在无法区分的前提下，选择「有界重试」优于「立即终止」：前者最坏代价是 2 次无效请求，后者代价是整轮中断并要求用户手动继续。

### 为什么重试是安全的

该错误在 `stream()` 的 `yield*` 之前抛出，此时 `emitted` 恒为 `false`。适配器已用这个不变量保证：一旦产出过 chunk 就不再重试，避免重复内容、工具重复执行与重复计费。

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-020-01 | `plugins/dsh-codebuddy-plugin/src/host/adapter.ts`（策略生效路径） | 无 | 由 FNOS-020-02 的用例间接覆盖 | 排错文档补该错误说明 | 真实使用环境 |
| FNOS-020-02 | 同上：新增 `CODEBUDDY_RETRY_POLICY`、覆写 `providerRetryPolicy()` | 无 | `tests/retry-policy.spec.ts` | 本需求/计划 | 本地构测 |
| FNOS-020-03 | 同上（策略取值） | 无 | 同上：断言不含确定性错误码 | — | 本地构测 |
| FNOS-020-04 | 同上（策略取值） | 无 | 同上：断言 `maxRetries: 2` | — | 本地构测 |

## 分阶段任务

### 阶段一：实现与本地验证

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-020-T01-01 | FNOS-020-02 / AC-01、AC-02 | 新增 `CODEBUDDY_RETRY_POLICY`：`mode: 'normal'`、`maxRetries: 2`、官方五码 + `INVALID_REQUEST`；用 `resolveRetryPolicy` 解析以获得合法默认退避 | 无 | `pnpm run typecheck` 通过 |
| PLAN-FNOS-020-T01-02 | FNOS-020-02 / AC-01 | 覆写 `providerRetryPolicy()` 返回该策略，并在注释里写明「基类默认返回 undefined 会退回官方集合」 | T01-01 | 单测断言实例返回同一策略对象 |
| PLAN-FNOS-020-T01-03 | FNOS-020-03 / AC-01、FNOS-020-04 / AC-01 | 新增 `tests/retry-policy.spec.ts`：纳入、保留官方五码、不混入 `CONTEXT_WINDOW_EXCEEDED`/`QUOTA`、`maxRetries: 2` | T01-01、T01-02 | 5 条用例全绿 |
| PLAN-FNOS-020-T01-04 | 回归 | 跑插件全量测试，确认未影响既有 909 条用例 | T01-01～T01-03 | 72 文件 914 条全绿 |

### 阶段二：发布后真实环境复验

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-020-T02-01 | FNOS-020-01 / AC-01 | 发布插件新版本并更新目标 profile，等待偶发 400 出现 | 插件发布、profile 指向新版本 | 会话不再中断；或从事件流确认出现 `llm/retry` 后继续 |
| PLAN-FNOS-020-T02-02 | FNOS-020-01 / AC-02 | 同一次恢复中核对输出与工具调用无重复 | T02-01 | 事件流中无重复 tool/call；界面无重复内容 |

## 数据、权限和错误处理

- 无新增数据结构、无权限变更、无配置项。
- 错误处理变化仅在 `codebuddy` 路由的 `INVALID_REQUEST` 分支：从直接抛出变为外层重试。
- 重试耗尽的最终行为与修复前一致：仍抛出最后一次失败，由用户可见。

## 依赖、风险和决策

| 项 | 说明 |
| --- | --- |
| 依赖 | `@deepseek-ai/dsh-llm` 导出的 `resolveRetryPolicy` 与 `ResolvedRetryPolicy`（已在 `0.2.1-rc.2` 中核实存在） |
| 风险一 | 若该 400 实为确定性缺陷（如某段历史确实非法），重试会多耗 2 次请求后才失败。已通过「次数有界」控制代价，且失败信息不变 |
| 风险二 | 根因未定位：本修复是**缓解**而非根治。若后续证明该 400 由读取竞态导致，应另立需求收敛 `attemptStream` 的读取时序 |
| 风险三 | 发布生效链路：运行中的 profile 从 npm 安装插件，源码修改需发布新版本并更新 profile 才对用户生效 |
| 决策 | 不改 `mode: 'always'`：无限重试会把确定性失败变成挂死 |
| 决策 | 不把 `QUOTA` 加入重试：该码的正确动作是换号，重试同一账号只会白耗请求 |
