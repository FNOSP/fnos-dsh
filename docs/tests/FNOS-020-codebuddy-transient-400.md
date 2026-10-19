---
id: FNOS-020
title: FNOS-020 测试用例
description: FNOS-020 CodeBuddy 瞬时 400 终止整轮修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-020-codebuddy-transient-400
plan: /plans/PLAN-FNOS-020-codebuddy-transient-400
status: 部分通过
lastVerified: 2026-10-19
verifiedAt: 2026-10-19
---

# FNOS-020 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-020 |
| 关联需求 | [FNOS-020 CodeBuddy 瞬时 400 终止整轮修复](/requirements/FNOS-020-codebuddy-transient-400) |
| 关联计划 | [PLAN-FNOS-020 CodeBuddy 瞬时 400 终止整轮修复](/plans/PLAN-FNOS-020-codebuddy-transient-400) |
| 测试状态 | <Badge type="warning" text="部分通过（6 条中 5 条通过，真实环境复验待执行）" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-020-codebuddy-transient-400#功能列表) 中 FNOS-020-01 至 FNOS-020-04。

本需求的测试难点有三处：

**① 触发条件不可构造。** 该 400 由 CodeBuddy 网关偶发返回，本地无法稳定复现。因此「瞬时 400 能被重试」这条只能通过**策略取值**断言（配置正确 ⇒ 外层必然重试），真实恢复效果需在发布后观察。

**② 必须同时证明「重试了」和「没有滥重试」。** 只断言 `INVALID_REQUEST` 在集合里，会把「顺手把 `QUOTA` 也加进去」这种错误改动放过去——那会让已耗尽的账号被原地重试而不是换号。因此需要反向断言。

**③ 重试安全性依赖一个代码不变量。** 「重试不会重复内容」由 `emitted` 标志保证（产出过 chunk 就不重试），本需求不改该逻辑，用例通过策略层断言间接覆盖，并在文档中注明依据。

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-020-02](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-02)、[FNOS-020-03](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-03)、[FNOS-020-04](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-04) | 本地构测环境（单测覆盖） |
| [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | 真实使用环境（依赖网关偶发 400，不可构造） |

版本基线：DSH `0.2.1-rc.2` / 插件 `@tnnevol/dsh-codebuddy` 修复版本 / 应用 `5.9.0`。

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
| TC-006 | [FNOS-020-01](/requirements/FNOS-020-codebuddy-transient-400#fnos-020-01) | 真实环境偶发 400 后自动恢复 | AC-01、AC-02 | 已发布修复版本且 profile 指向该版本；网关再次返回该 400 | 1.正常使用会话 2.出现 400 时观察行为 3.核对事件流 | 出现 `llm/retry` 后继续，不中断；无重复 tool/call 与重复内容 | P0 | 缺陷场景 |

## 执行结果

### 阶段一（本地构测，2026-10-19）

| 用例ID | 结果 | 证据 |
| --- | --- | --- |
| TC-001 | 通过 | `retryableCodes` 含 `INVALID_REQUEST` |
| TC-002 | 通过 | 五个官方默认码全部保留 |
| TC-003 | 通过 | 实例返回同一策略对象；基类默认实现返回 `undefined`，故该断言同时证明覆写生效 |
| TC-004 | 通过 | 集合内无 `CONTEXT_WINDOW_EXCEEDED`、无 `QUOTA` |
| TC-005 | 通过 | `mode: 'normal'`、`maxRetries: 2` |
| TC-006 | 未执行 | 依赖网关偶发 400，本地不可构造；需发布后在真实使用中观察 |

命令与结果：

```text
pnpm exec vitest run tests/retry-policy.spec.ts   →  5 passed (5)
pnpm run typecheck                                →  通过
pnpm run test（插件全量）                          →  72 files / 914 tests passed
```

### 阶段二（真实环境，待执行）

TC-006 待插件发布并在目标 profile 生效后观察。判定依据：会话出现该 400 时是否自动恢复，以及事件流中是否出现 `llm/retry`（`provider: codebuddy`、`failure.code: INVALID_REQUEST`）。

## 问题记录

| 编号 | 描述 | 状态 |
| --- | --- | --- |
| BUG-001 | 修复前 `INVALID_REQUEST` 既不在 DSH 默认重试集合，也不在插件换号集合，一次瞬时 400 直接终止整轮 | 已修复（待真实环境复验） |
| BUG-002 | 该 400 的**根因未定位**：只能证明不是请求内容不合法，无法证明是网关节点、账号态还是读取竞态 | 未解决，已登记为遗留项 |

## 测试结论

**本地 5 条全部通过；真实环境 1 条未执行。**

修复把 `INVALID_REQUEST` 纳入有界重试（2 次），并保留官方五码、排除 `CONTEXT_WINDOW_EXCEEDED` 与 `QUOTA`。插件全量 914 条用例无回归。

需要说明的是：这是**缓解**而非根治。根因未定位，若后续证明该 400 由 `attemptStream` 的读取竞态导致，应另立需求收敛读取时序。

TC-006 未执行的原因是触发条件不可构造——这一点如实登记，不按通过处理。
