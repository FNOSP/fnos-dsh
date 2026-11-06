---
id: FNOS-047
title: FNOS-047 测试用例
description: OpenCode 套餐归属过滤与额度排序的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-047-opencode-plan-entitlement
plan: /plans/PLAN-FNOS-047-opencode-plan-entitlement
status: 通过
lastVerified: 2026-11-06
verifiedAt: 2026-11-06
---

# FNOS-047 测试用例

被测对象是 `plugins/dsh-opencode-plugin` 的套餐识别、归属过滤、额度排序，以及两个客户端上的界面口径。需求见 [FNOS-047](/requirements/FNOS-047-opencode-plan-entitlement)，执行任务见 [PLAN-FNOS-047](/plans/PLAN-FNOS-047-opencode-plan-entitlement)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-047-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) | 套餐识别 | Console 套餐接口是未公开接口；API Key 登录时该接口可能 401/404，误判会把 Go 账号的模型全过滤掉 |
| [FNOS-047-02](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-02-归属过滤) | 归属过滤 | 从「同名去重」改成「整侧过滤」后，单侧独有模型的行为变化；未知套餐时不能清空选择器 |
| [FNOS-047-03](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-03-额度排序) | 额度排序 | 估值缺失 / 不限量 / 表里有但 roster 没有的边界；按量侧不能受 Go 估算表影响 |
| [FNOS-047-04](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-04-上游更名跟进) | 上游更名跟进 | 文案改动不能连带改掉内部 id 前缀与后缀（会破坏存量隐藏设置与历史会话） |
| [FNOS-047-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐的保守处理) | 未知套餐降级 | 接口失败时选择器仍可用；错误文案不含凭据 |

**兼容基线**：本插件属于「其他 DSH 插件」，按[测试用例文档规范](/charter/tests-spec#测试环境执行方式)必须同时覆盖 **DSH Web** 与 **DSH Desktop**，只记录单一客户端不构成完成结论。

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-047-01 ~ 05 | DSH Web | `pnpm run start -- --web`，`DSH_HOME=<repo>/.dsh`，端口 8070，走启动日志的 token 地址 |
| FNOS-047-01 ~ 05 | DSH Desktop | 上游检出 `fork-pj/deepseek-harness` 的开发态 Desktop，`DSH_HOME=<repo>/.dsh`，渲染调试端口 9333 |
| FNOS-047-01、03 | 真实上游 `opencode.ai` | 真实凭据只读读取套餐接口与模型清单 |
| FNOS-047-01 ~ 05 | 单元测试 | `cd plugins/dsh-opencode-plugin && pnpm run test`，假 fetch 注入各档位响应 |

### 版本三元组

| 环境 | 记录项 | 实测值 |
| --- | --- | --- |
| DSH Web | DSH 运行时版本 | `0.2.2-rc.1`（`.dsh/profiles/web/package.json` 全部 `@deepseek-ai/dsh-*` 同为此版本） |
| DSH Web | 插件构建版本 | `@tnnevol/dsh-opencode@8.1.0`（profile 以 `link:` 指向源码检出，界面显示 v8.1.0） |
| DSH Desktop | Desktop 客户端版本 | `@deepseek-ai/dsh-desktop@0.2.2-rc.1`（Electron 44.7.0 / Chrome 152.0.7977.130，CDP UA 实测） |
| DSH Desktop | Desktop 内置 DSH 运行时版本 | `0.2.2-rc.1`（开发态 Desktop 与本仓库 catalog 基线一致） |
| DSH Desktop | 实际加载的插件版本 | `8.1.0`（插件详情页「当前版本」实测） |

版本匹配前置检查：插件 `engines.dsh` 为 `0.2.2-rc.1`，与两个客户端的运行时版本一致，组合有效。

## 测试用例

### FNOS-047-01 套餐识别

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-047-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) | Console 返回 `product: go` | [AC-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) | 已登录，套餐接口 200 | 调用 `read()` | `plan='go'`、`source='console'` | P0 | 新增行为，无回归基线 |
| TC-002 | 同上 | Console 返回 `product: go-plus` | AC-01 | 同上，product 为 go-plus | 调用 `read()` | `plan='go-plus'`，估算表取 Go Plus 那份 | P0 | 新增行为，无回归基线 |
| TC-003 | 同上 | Console 返回 `product: go-teams` | AC-01 | 同上，product 为 go-teams | 调用 `read()` | `plan='go-teams'` | P0 | 新增行为，无回归基线 |
| TC-004 | 同上 | 套餐名变体归一化 | AC-01 | 假 fetch 返回 `go_plus` / 大写形态 | 调用 `read()` | 归一化为 `go-plus` | P2 | 新增行为，无回归基线 |
| TC-005 | 同上 | 套餐接口 404 → 用量接口兜底 | AC-01 | 假 fetch：404 + 用量 200 | 调用 `read()` | `plan='go'`、`source='usage'` | P0 | 新增行为，无回归基线 |
| TC-006 | 同上 | API Key 账号套餐接口 401 不得误判按量 | AC-01 | 假 fetch：401 + 用量 200 | 调用 `read()` | `plan='go'`、`source='usage'`；**不得**判为 `payg` | P0 | 新增行为，无回归基线 |
| TC-007 | 同上 | 两个接口都失败 | AC-05 | 假 fetch 返回 5xx | 调用 `read()` | `plan='unknown'`、`source='none'`，`error` 非空且不含凭据 | P0 | 新增行为，无回归基线 |
| TC-008 | 同上 | 明确按量账号 | AC-01 | 假 fetch：套餐接口 404 + 用量 404 | 调用 `read()` | `plan='payg'` | P0 | 新增行为，无回归基线 |
| TC-009 | 同上 | 未登录 | AC-05 | 无凭据 | 调用 `read()` | `plan='unknown'`、`source='none'`、无 `error` | P1 | 新增行为，无回归基线 |
| TC-010 | 同上 | 缓存、单飞与失效 | AC-01 | 假 fetch 计数 | 并发 3 次 + `invalidate()` 后再读 | 并发只发一次；缓存窗口内不重复请求；失效后重取 | P1 | 新增行为，无回归基线 |
| TC-011 | 同上 | 真实账号套餐可读 | AC-01 | 真实凭据 | 只读请求套餐接口 | 返回 200 且 `product` 可识别 | P0 | 新增行为，无回归基线 |
| TC-012 | 同上 | 详情页显示套餐与判定依据 | AC-01 | 已登录，打开插件详情页 | 查看账号卡「套餐」与「判定依据」两行 | 显示 Go / Go Plus / Go Teams / Console（按量）/ 未知，并显示判定来源 | P0 | 新增行为，无回归基线 |

### FNOS-047-02 归属过滤

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-047-02](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-02-归属过滤) | Go 账号整侧过滤 | [AC-02](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-02-归属过滤) | 目录含两侧 | `scopeToAccountPlan(models,'go')` | 只剩 `plan='go'`，零 `zen` 条目 | P0 | 基线：[FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) 同名去重行为，本次改为整侧过滤 |
| TC-014 | 同上 | Go Plus / Teams 同属订阅侧 | AC-02 | 同上 | plan 为 `go-plus` / `go-teams` | 与 `go` 相同 | P0 | 新增行为，无回归基线 |
| TC-015 | 同上 | 仅按量账号过滤 | AC-02 | 同上 | `scopeToAccountPlan(models,'payg')` | 只剩 `plan='zen'` 条目 | P0 | 新增行为，无回归基线 |
| TC-016 | 同上 | 未知套餐不过滤 | AC-02 | 同上 | `scopeToAccountPlan(models,'unknown')` | 返回**同一引用**，两侧都在 | P0 | 基线：改造前合并列表行为 |
| TC-017 | 同上 | 单侧独有模型在 Go 账号下消失 | AC-02 | Go 账号 | 查看目录与选择器中的 `big-pickle` | 不出现（旧的同名去重会保留它） | P1 | 基线：改造前保留单侧独有条目 |
| TC-018 | 同上 | 模型选择器与目录卡口径一致 | AC-02 | Go 账号，打开插件详情页 | 对比目录卡列表与模型选择器 | 两者模型集合完全一致 | P0 | 新增行为，无回归基线 |

### FNOS-047-03 额度排序

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-019 | [FNOS-047-03](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-03-额度排序) | 按估算值降序 | [AC-03](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-03-额度排序) | 带估算值的 Go 模型 | `sortCatalogModels(models, table)` | 严格按数值降序 | P0 | 新增行为，无回归基线 |
| TC-020 | 同上 | 不限量模型置顶 | AC-03 | 含 `null` 估算值 | 调用 | `null` 排在最前 | P0 | 新增行为，无回归基线 |
| TC-021 | 同上 | 表外模型沉底且稳定 | AC-03 | 表里没有该模型 | 调用 | 排在最后，同档按 id 稳定 | P1 | 新增行为，无回归基线 |
| TC-022 | 同上 | 不传表时老口径不变 | AC-03 | 现有目录 | `sortCatalogModels(models)` | 与改造前完全一致（免费优先 → 单价升序 → id） | P0 | 基线：FNOS-026 目录排序行为 |
| TC-023 | 同上 | 免费标记不压过额度 | AC-03 | 免费低额度 + 付费高额度 | 传入估算表排序 | 按额度排，免费低额度不得排在付费高额度之前 | P0 | 新增行为，无回归基线（BUG-01 回归用例） |
| TC-024 | 同上 | 三档估算表各自生效 | AC-03 | 三份内置表 | 分别排序 | 用对应档位数值，同模型位次随档位变化 | P1 | 新增行为，无回归基线 |
| TC-025 | 同上 | 按量侧不受 Go 估算表影响 | AC-03 | `payg` 账号目录 | `applyCatalogView(models,{accountPlan:'payg'})` | 保持「免费优先、单价升序」 | P1 | 基线：FNOS-026 目录排序行为 |
| TC-026 | 同上 | 真实目录降序与官方表一致 | AC-03 | 真实账号 | 读目录后核对首尾 | 首条为不限量模型，其余严格降序 | P0 | 新增行为，无回归基线 |
| TC-027 | 同上 | 界面显示额度列 | AC-03 | Go 账号，打开目录卡 | 查看每行「预计请求数/月」 | 数值带千分位；不限量显示「不限量」；按量侧不显示 | P1 | 新增行为，无回归基线 |

### FNOS-047-04 上游更名跟进

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-028 | [FNOS-047-04](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-04-上游更名跟进) | 按量口径文案为 Console | [AC-04](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-04-上游更名跟进) | — | 审阅九语言文案 | 称「Console（按量）」，并给出 `console/models` 地址 | P1 | 基线：FNOS-026 文案称「Zen（按量）」 |
| TC-029 | 同上 | 内部标识保持稳定 | AC-04 | — | 检查 `src/contracts/identity.ts` | `zen:` / `go:` 前缀与 `· zen` / `· go` 后缀未改 | P0 | 基线：FNOS-026 标识约定 |
| TC-030 | 同上 | 九语言键集合一致 | AC-04 | — | 比较八种语言与 en 的键集合 | 完全一致，无缺键 | P0 | 基线：FNOS-045 语言包键集合约束 |

### FNOS-047-05 未知套餐降级

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-031 | [FNOS-047-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐的保守处理) | 套餐不可读时选择器仍可用 | [AC-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐的保守处理) | 套餐接口全失败 | 查看模型选择器 | 合并列表照常可用，不被清空 | P0 | 基线：改造前合并列表行为 |
| TC-032 | 同上 | 原因可见 | AC-05 | 同上 | 查看详情页 | 给出「未识别到套餐，暂不过滤」说明 | P1 | 新增行为，无回归基线 |
| TC-033 | 同上 | 错误文案脱敏 | AC-05 | 同上，注入含凭据的异常 | 检查错误文案 | 不含 token / Bearer / API Key 原文 | P0 | 基线：FNOS-011 凭据可诊断性约定 |

## 测试执行结果

执行时间 2026-11-06。两个客户端均使用 `<repo>/.dsh` 作为 `DSH_HOME`；按规范先测 Web、退出后再测 Desktop，避免同一 profile 被两个实例同时持有。

### 汇总

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-047-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) | 单元测试 | 通过 | 2026-11-06 | `product: go` → `plan='go'`、`source='console'` |
| TC-002 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | `plan='go-plus'`，估算表取 Go Plus 那份 |
| TC-003 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | `plan='go-teams'` |
| TC-004 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | `go_plus` / 大写 / 前后空白均归一化为 `go-plus` |
| TC-005 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | 套餐接口 404 → 用量 200 → `go` / `usage` |
| TC-006 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | 401 → 用量 200 → `go`；未误判为按量 |
| TC-007 | FNOS-047-05 | 单元测试 | 通过 | 2026-11-06 | 双失败 → `unknown` + 脱敏 error |
| TC-008 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | 套餐接口干净 404 + 用量非 200 → `payg` |
| TC-009 | FNOS-047-05 | 单元测试 | 通过 | 2026-11-06 | 未登录 → `unknown`、无 error |
| TC-010 | FNOS-047-01 | 单元测试 | 通过 | 2026-11-06 | 并发单飞、缓存窗口、`invalidate()` 后重取 |
| TC-011 | FNOS-047-01 | 真实上游 | 通过 | 2026-11-06 | `GET /console/api/go/status` → 200，`product=go`；带不带 `x-org-id` 结果一致；未鉴权 401 |
| TC-012 | FNOS-047-01 | DSH Web | 通过 | 2026-11-06 | 账号卡「套餐：Go」「判定依据：Console 套餐接口」 |
| TC-012 | FNOS-047-01 | DSH Desktop | 通过 | 2026-11-06 | 同上，两个客户端文案与取值一致 |
| TC-013 | [FNOS-047-02](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-02-归属过滤) | 单元测试 | 通过 | 2026-11-06 | Go 视图零 `zen` 条目 |
| TC-014 | FNOS-047-02 | 单元测试 | 通过 | 2026-11-06 | `go-plus` / `go-teams` 与 `go` 同侧 |
| TC-015 | FNOS-047-02 | 单元测试 | 通过 | 2026-11-06 | `payg` 视图零 `go` 条目 |
| TC-016 | FNOS-047-02 | 单元测试 | 通过 | 2026-11-06 | `unknown` 返回同一数组引用 |
| TC-017 | FNOS-047-02 | 单元测试 | 通过 | 2026-11-06 | `big-pickle`（仅按量侧）在 Go 账号下不出现 |
| TC-018 | FNOS-047-02 | DSH Web | 通过 | 2026-11-06 | 目录卡 29 条与选择器 29 条完全一致，均 0 个 `· zen` |
| TC-018 | FNOS-047-02 | DSH Desktop | 通过 | 2026-11-06 | 同上（CDP 计数：go=29 / zen=0） |
| TC-019 | [FNOS-047-03](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-03-额度排序) | 单元测试 | 通过 | 2026-11-06 | 严格降序 |
| TC-020 | FNOS-047-03 | 单元测试 | 通过 | 2026-11-06 | `null` 置顶 |
| TC-021 | FNOS-047-03 | 单元测试 | 通过 | 2026-11-06 | 表外模型沉底且按 id 稳定 |
| TC-022 | FNOS-047-03 | 单元测试 | 通过 | 2026-11-06 | 不传表时老口径不变（既有 59 条断言全绿） |
| TC-023 | FNOS-047-03 | 单元测试 | 通过 | 2026-11-06 | BUG-01 回归用例；以「还原旧实现则用例失败」反向验证过 |
| TC-024 | FNOS-047-03 | 单元测试 | 通过 | 2026-11-06 | 三档表各自生效 |
| TC-025 | FNOS-047-03 | 单元测试 | 通过 | 2026-11-06 | 按量侧不受 Go 估算表影响 |
| TC-026 | FNOS-047-03 | 真实上游 | 通过 | 2026-11-06 | 首条 `beam-free`（不限量）→ 226,600 / 226,600 / 216,670 …→ 490，与官方表一致 |
| TC-027 | FNOS-047-03 | DSH Web | 通过 | 2026-11-06 | 每行「预计请求数/月」带千分位；不限量显示「不限量」；底部标注快照日期与来源链接 |
| TC-027 | FNOS-047-03 | DSH Desktop | 通过 | 2026-11-06 | 同上 |
| TC-028 | [FNOS-047-04](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-04-上游更名跟进) | DSH Web | 通过 | 2026-11-06 | 目录卡不再出现「Zen（按量）」旧表述；出现「zen 是 Console 按量」与 `console/models` 链接 |
| TC-028 | FNOS-047-04 | DSH Desktop | 通过 | 2026-11-06 | 同上 |
| TC-029 | FNOS-047-04 | 代码审阅 | 通过 | 2026-11-06 | `src/contracts/identity.ts` 零改动，`zen:` / `· zen` 原样保留 |
| TC-030 | FNOS-047-04 | 单元测试 | 通过 | 2026-11-06 | en 147 键；de/es/fr/it/ja/ko/ru 八语言键集合完全一致 |
| TC-031 | [FNOS-047-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐的保守处理) | DSH Desktop | 通过 | 2026-11-06 | 移除凭据后 `plan=unknown`、`scoped=false`，目录 93 条两侧都在，选择器未被清空 |
| TC-032 | FNOS-047-05 | DSH Desktop | 通过 | 2026-11-06 | 套餐未识别时不渲染「当前套餐/已隐藏 N 个」说明 |
| TC-033 | FNOS-047-05 | DSH Desktop | 通过 | 2026-11-06 | 目录响应全文扫描 `eyJ…` / `st_…` / `oc_sk_` 无命中 |

### UI 视觉与样式核对（规范「UI 测试」清单）

| 核对项 | 要求 | 实测 |
| --- | --- | --- |
| 亮色主题 | 文字在其背景上可读 | 浅色下文字 `rgb(15,17,21)` / 卡片 `rgb(255,255,255)`，正常 |
| 暗色主题 | 同上 | `data-ds-theme-source=dark`；套餐说明行对比度 **9.25:1**、额度列与模型名 **13.34:1**（均高于 WCAG AA 4.5） |
| 主题切换跟随 | 无可残留的硬编码色 | 插件样式全部走 DSH 语义变量；暗色下取值随主题变化，无残留亮色值 |
| 间距与 BFC | 无意外空隙或 margin 穿透 | 套餐说明区、列表行、底部溯源三段的间距在亮/暗下一致，未出现双倍间距 |
| 毛玻璃 | 不叠加两层模糊 | 本轮新增元素均为不透明卡片内的文本行，未引入 `backdrop-filter` |

两个客户端（DSH Web 与 DSH Desktop）均在亮色与暗色下各核对了上述项。

### 恢复与清理（登记）

| 动作 | 说明 |
| --- | --- |
| auth 配置备份 | `tmp/auth-back/dsh-opencode-8.1.0-2026-11-06 09:16:54/`，含 `.dsh-opencode-auth.json`、`.dsh-opencode-preferences.json`、`.credentials.yaml`、`.openai-codex-auth.json`，权限 600 |
| 未登录用例 | 临时移出 `.dsh-opencode-auth.json` 执行 TC-031~033，随后原样移回并 `chmod 600`；`sha256` 与备份一致（`daaf4b2b…e83b`） |
| 恢复后复验 | 套餐重新识别为 `go` / `console`、`scoped=true`、`filteredModelCount=80`、目录 29 条纯 go 侧 |
| 主题复原 | 暗色用例后切回浅色（`data-ds-theme-source=light`），与测试前一致 |
| Desktop 进程 | 以检出路径精确匹配关闭（`pkill -f "fork-pj/deepseek-harness"`）；未触碰 `/Applications/DeepSeek Harness.app` 发行版实例（实测其进程仍在正常运行），也未使用 `~/.dsh/profiles/desktop` |
| 工作区副作用 | `pnpm run start -- --web` 启动时把六个插件的 `peerDependencies` 由 `catalog:dsh` 改写为具体版本（09:17:20 时间戳）；已 `git checkout` 全部还原，`git status` 现仅剩本次文档改动 |
| 探针脚本 | `tmp/probe/`、`tmp/web-logs/` 已删除；`.dsh` 与 `tmp/` 均被 git 忽略 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | [TC-023](#fnos-047-03-额度排序) | 额度口径下「免费」标记压过额度值，免费低额度模型排在付费高额度模型之前 | P1 | 已修复 | 评审阶段由 Lead 用排序探针发现（真实数据当时不可见，因 Go 侧两个免费模型估值恰为 `null`）。修复为额度口径只保留「不可用沉底 → 额度降序」，免费与付费同权；旧口径分支未动。补 4 条回归用例，并以「还原旧实现则用例失败」反向验证 |

本轮测试**未发现新的产品缺陷**；上述 BUG-01 为开发阶段评审已修复项，登记在此以保留回归依据。

## 测试结论

**结论：通过。** 33 条用例全部通过（0 失败 / 0 阻塞 / 0 未执行），其中 TC-012、TC-018、TC-027、TC-028 在两个客户端各执行一次并分别登记。

覆盖情况：

- **需求侧**：[FNOS-047-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) 至 [FNOS-047-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐的保守处理) 五个功能点与 [AC-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) 至 [AC-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐的保守处理) 五条验收条件全部有对应用例且通过。
- **客户端侧**：按规范同时覆盖 DSH Web（`0.2.2-rc.1` + 插件 `8.1.0`）与 DSH Desktop（开发态检出 `fork-pj/deepseek-harness`，Desktop `0.2.2-rc.1` / Electron 44.7.0），两个客户端的套餐识别、整侧过滤、额度排序与文案完全一致。
- **UI 侧**：亮色与暗色主题均核对，暗色下关键文本对比度 9.25:1 与 13.34:1，未发现硬编码颜色与模糊叠加问题。
- **上游侧**：真实账号实测套餐接口返回 `product=go`，目录排序与官方 Estimated requests 表逐项一致。

遗留风险：

1. **整侧过滤属于有意的行为变更**：Go 账号不再看到任何按量模型（含只在按量侧存在的 `big-pickle` 等）。这是本需求的核心目标，但对用户是可见变化，发版时应写入变更说明。
2. **估算表为内置快照**（抓取日期 2026-11-05）：上游调整额度后，排序会滞后到下一次插件版本更新；界面已标注快照日期与官方来源链接，便于用户判断。
3. **Console 套餐接口是未公开接口**：若上游改版或对服务账号 Key 收紧权限，三档判定会退化为「按量/未知」，此时列表回落到合并口径而非清空——该降级路径已由 TC-031~033 覆盖。
