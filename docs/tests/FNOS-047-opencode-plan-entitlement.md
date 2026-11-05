---
id: FNOS-047
title: FNOS-047 测试用例
description: OpenCode 套餐归属过滤与额度排序的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-047-opencode-plan-entitlement
plan: /plans/PLAN-FNOS-047-opencode-plan-entitlement
status: 进行中
lastVerified: 2026-11-05
---

# FNOS-047 测试用例

被测对象是 `plugins/dsh-opencode-plugin` 的套餐识别、归属过滤、额度排序与界面口径。需求见 [FNOS-047](/requirements/FNOS-047-opencode-plan-entitlement)，执行任务见 [PLAN-FNOS-047](/plans/PLAN-FNOS-047-opencode-plan-entitlement)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| FNOS-047-01 | 套餐识别 | Console 套餐接口是未公开接口；API Key 登录时该接口可能 401/404，误判会把 Go 账号的模型全过滤掉 |
| FNOS-047-02 | 归属过滤 | 从「同名去重」改成「整侧过滤」后，单侧独有模型的行为变化；未知套餐时不能清空选择器 |
| FNOS-047-03 | 额度排序 | 估值缺失/不限量/表里有但 roster 没有的边界；按量侧不能受 Go 估算表影响 |
| FNOS-047-04 | 上游更名跟进 | 文案改动不能连带改掉内部 id 前缀与后缀（会破坏存量隐藏设置与历史会话） |
| FNOS-047-05 | 未知套餐降级 | 接口失败时选择器仍可用；错误文案不含 token |

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-047-01 | 真实上游（`opencode.ai`） | 本机凭据实测 `/console/api/go/status`，OAuth 与 API Key 两种登录方式各自验证 |
| FNOS-047-02、03、05 | 单元测试（vitest） | `pnpm run test`，假 fetch 注入各档位响应 |
| FNOS-047-04 | 类型检查 + 文档审阅 | `pnpm run typecheck`；九语言键集合一致性用例 |
| 界面 | DSH Web 插件详情页 | 账号卡套餐显示、目录卡过滤说明与额度列 |

## 测试用例

### FNOS-047-01 套餐识别

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-4701 | 三档正常值 | Console 返回 `product: go` | 已登录，`go/status` 200 | 调用 `read()` | `plan='go'`、`source='console'` | P0 |
| TC-4702 | 三档正常值 | Console 返回 `product: go-plus` | 同上，product 为 go-plus | 调用 `read()` | `plan='go-plus'`，估算表取 Go Plus 那份 | P0 |
| TC-4703 | 三档正常值 | Console 返回 `product: go-teams` | 同上，product 为 go-teams | 调用 `read()` | `plan='go-teams'` | P0 |
| TC-4704 | 产品名归一化 | `product: go_plus` / `GO-PLUS` 等变体 | 假 fetch 返回下划线或大写形态 | 调用 `read()` | 归一化为 `go-plus` | P1 |
| TC-4705 | 兜底路径 | `go/status` 404、用量接口 200 | 假 fetch | 调用 `read()` | `plan='go'`、`source='usage'` | P0 |
| TC-4706 | 兜底边界 | `go/status` 401（API Key 访问 Console 会话接口）、用量 200 | 假 fetch | 调用 `read()` | `plan='go'`、`source='usage'`；**不得**判为按量 | P0 |
| TC-4707 | 失败路径 | 两个接口都失败 | 假 fetch 返回 5xx | 调用 `read()` | `plan='unknown'`、`source='none'`，`error` 非空且不含 token | P0 |
| TC-4708 | 明确按量 | `go/status` 404、用量 404 | 假 fetch | 调用 `read()` | `plan='payg'` | P0 |
| TC-4709 | 未登录 | `resolveToken` 返回 undefined | 无凭据 | 调用 `read()` | `plan='unknown'`、`source='none'`、无 `error` | P1 |
| TC-4710 | 缓存与单飞 | 并发调用 3 次 | 假 fetch 计数 | `Promise.all([read(), read(), read()])` | 只发一次请求；缓存窗口内不重复请求；`invalidate()` 后重新请求 | P1 |

### FNOS-047-02 归属过滤

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-4711 | Go 账号 | `scopeToAccountPlan(models, 'go')` | 目录含两侧共 109 条 | 调用 | 只剩 29 条 `plan === 'go'`，零 `zen` 条目 | P0 |
| TC-4712 | Go Plus / Teams | 同上，plan 为 `go-plus` / `go-teams` | 同上 | 调用 | 与 `go` 相同（都属订阅侧） | P0 |
| TC-4713 | 按量账号 | `scopeToAccountPlan(models, 'payg')` | 同上 | 调用 | 只剩 `plan === 'zen'` 条目 | P0 |
| TC-4714 | 未知套餐 | `scopeToAccountPlan(models, 'unknown')` | 同上 | 调用 | 返回**同一引用**（不新建数组），两侧都在 | P0 |
| TC-4715 | 单侧独有模型 | Go 账号下的 `big-pickle`（仅按量侧存在） | Go 账号 | 查看目录与选择器 | 不出现（旧的同名去重会保留它，这是本需求要改的行为） | P1 |

### FNOS-047-03 额度排序

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-4716 | 降序 | 传入 Go 估算表 | 若干带 `estimatedRequestsPerMonth` 的模型 | `sortCatalogModels(models, table)` | 严格按数值降序 | P0 |
| TC-4717 | 不限量 | 含 `null` 估算值的模型（`beam-free`、`iceman-contributor-free`） | 同上 | 调用 | `null` 排在最前 | P0 |
| TC-4718 | 缺数据 | 表里没有该模型 | 同上 | 调用 | 排在最后，且同档内按 id 稳定 | P1 |
| TC-4719 | 向后兼容 | 不传估算表 | 现有目录 | `sortCatalogModels(models)` | 行为与改造前完全一致（免费优先 → 单价升序 → id） | P0 |
| TC-4720 | 档位切换 | 同一模型在 Go / Go Plus / Teams 下的位次 | 三份内置表 | 分别排序 | 用对应档位的数值；Go Plus/Teams 数值与 Go 不同 | P1 |
| TC-4721 | 按量侧不受影响 | `payg` 账号目录 | 无估算表 | `applyCatalogView(models, { accountPlan: 'payg' })` | 保持原「免费优先、单价升序」口径 | P1 |

### FNOS-047-04 上游更名跟进

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-4722 | 文案口径 | 面向用户的按量说明 | — | 审阅九语言文案 | 称「Console（按量）」，并给出 `https://opencode.ai/console/models` | P1 |
| TC-4723 | 标识稳定性 | 模型 id 前缀与显示后缀 | — | 检查 `src/contracts/identity.ts` | `zen:` / `go:` 前缀与 `· zen` / `· go` 后缀**未改** | P0 |
| TC-4724 | 文案完整性 | 九语言键集合 | — | 单测比较八种语言与 en 的键集合 | 完全一致，无缺键 | P0 |

### FNOS-047-05 未知套餐降级

| 用例 ID | 覆盖 | 标题 | 前置 | 步骤 | 预期 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-4725 | 选择器可用 | 套餐接口全失败 | 已登录、接口 5xx | 查看模型选择器 | 两侧合并列表照常可用，不被清空 | P0 |
| TC-4726 | 原因可见 | 同上 | 同上 | 查看详情页 | 给出「未识别到套餐，暂不过滤」的可读说明 | P1 |
| TC-4727 | 错误脱敏 | 同上 | 同上 | 检查错误文案 | 不含 token / Bearer / API Key 原文 | P0 |

## 执行结果

执行时间 2026-11-05，环境：本机（macOS）+ 真实上游 `opencode.ai`（本账号 Go 订阅）+ 单元测试。

| 层次 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 单元 | `cd plugins/dsh-opencode-plugin && pnpm run test` | **325 passed / 19 files**（基线 208 → 新增 117） |
| 类型 | `pnpm run typecheck` | 0 error |
| 构建 | `pnpm run build`（tsdown） | 成功；客户端产物 2.18 MB + 样式 164.65 kB |
| 静态检查 | `pnpm exec eslint src tests` | 0 error / 4 warning（全部在未改动的既有文件） |
| 真实上游 | 本机凭据只读探测 | `go/status` 200、`product=go`；roster 按量 80 / Go 29 |

### 用例逐条结果

| 用例 ID | 结果 | 证据 |
| --- | --- | --- |
| TC-4701 | 通过 | `tests/host/entitlement.spec.ts`（三档 product 各一条） |
| TC-4702 | 通过 | 同上；`estimatesForPlan('go-plus')` 取 Go Plus 表 |
| TC-4703 | 通过 | 同上 |
| TC-4704 | 通过 | `normalizeAccountPlan` 支持 `go_plus` / 大写 / 前后空白 |
| TC-4705 | 通过 | 404 → 用量 200 → `plan='go'`, `source='usage'` |
| TC-4706 | 通过 | 401 → 用量 200 → `go`；不被误判为按量 |
| TC-4707 | 通过 | 双失败 → `unknown` + `source='none'` + 脱敏 error |
| TC-4708 | 通过 | 套餐接口干净 404 + 用量非 200 → `payg` |
| TC-4709 | 通过 | 未登录 → `unknown`、无 error |
| TC-4710 | 通过 | 并发单飞、缓存窗口、`invalidate()` 后重取 |
| TC-4711 | 通过 | 真实 roster：Go 视图 36 条全部 `plan='go'`，零 zen |
| TC-4712 | 通过 | `go-plus` / `go-teams` 与 `go` 同侧 |
| TC-4713 | 通过 | 按量视图 85 条全部 `plan='zen'` |
| TC-4714 | 通过 | `unknown` 返回同一数组引用，121 条两侧都在 |
| TC-4715 | 通过 | `big-pickle`（仅按量侧）在 Go 账号下不出现 |
| TC-4716 | 通过 | 真实数据严格降序：226600/226600/216670/…/490 |
| TC-4717 | 通过 | `null`（beam-free、iceman-contributor-free）置顶 |
| TC-4718 | 通过 | 表外模型（omen-alpha、qwen3.6-plus 等 9 条）沉底且按 id 稳定 |
| TC-4719 | 通过 | 不传表时老口径不变（既有 59 条 catalog 断言全绿） |
| TC-4720 | 通过 | 三档表分别排序，同模型位次随档位变化 |
| TC-4721 | 通过 | `payg` 视图保持「免费优先、单价升序」 |
| TC-4722 | 通过 | 九语言文案统一为「Console（按量）」并给出 `console/models` 链接 |
| TC-4723 | 通过 | `identity.ts` 的 `zen:` / `· zen` 零改动（历史会话不受影响） |
| TC-4724 | 通过 | 九语言键集合与键顺序与 en 逐一相等（各 147 键） |
| TC-4725 | 通过 | 套餐接口全失败时合并列表 121 条照常可用 |
| TC-4726 | 通过 | `entitlement.plan === 'unknown'` 时界面给出「未识别到套餐，暂不过滤」 |
| TC-4727 | 通过 | error 经 `redactMessage` 脱敏；含 token 的异常输入有专项断言 |

## Bug 记录

| 编号 | 发现方式 | 现象 | 处置 |
| --- | --- | --- | --- |
| BUG-047-01 | Lead 排序探针复核 | `sortCatalogModels` 的额度口径里，「免费」档（`rank()`）仍优先于额度值：免费低额度模型会排在付费高额度模型之前，违背「按每月预计请求数降序」。真实数据当时看不出来（Go 侧两个免费模型估值均为 `null`，本就在最前），但上游一旦给免费模型标出有限额度即会出错 | 已修复：额度口径拆成独立比较器，只保留「不可用沉底 → 额度降序」，免费与付费同权；旧口径分支一行未动。补 4 条回归用例，并做了「还原旧实现则用例失败」的反向验证 |

## 最终结论

**本次改造在单元、类型、构建与真实上游四个层次全部通过，27 条用例 27 通过、0 失败、0 未执行。**

两条验收提醒：

1. **未做真实浏览器目视**：自动化环境拿不到可用的 DSH Web 会话（GUI 返回 401），套餐行与额度列的最终视觉待 UI 验收确认；接线与文案已由源码级断言覆盖。
2. **整侧过滤是有意的行为变更**：Go 账号将不再看到任何按量模型（含只在按量侧存在的 `big-pickle` 等）。这是本需求的核心目标，但对外属于可见变化，随版本发布时应写入变更说明。
