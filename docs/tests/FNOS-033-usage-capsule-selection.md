---
id: FNOS-033
title: FNOS-033 测试用例
description: FNOS-033 用量胶囊按当前选择即时显隐的测试用例与执行结果。
requirement: /requirements/FNOS-033-usage-capsule-selection
plan: /plans/PLAN-FNOS-033-usage-capsule-selection
status: 通过
lastVerified: 2026-10-26
verifiedAt: 2026-10-26
---

# FNOS-033 测试用例

## 测试范围与需求分析

被测对象是 OpenCode 与 ZCode 用量胶囊的客户端显隐判定：是否按会话投影 wire view 的 `next` 取值、切走模型后是否立即隐藏、`next` 为空时是否退回 `lastUsed`。执行任务见 [PLAN-FNOS-033](/plans/PLAN-FNOS-033-usage-capsule-selection)，覆盖[需求功能](/requirements/FNOS-033-usage-capsule-selection#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-033-01](/requirements/FNOS-033-usage-capsule-selection#fnos-033-01) OpenCode 胶囊随选择即时显隐 | 是否仍读 `pending`；`next` 为 null 时是否丢失 `lastUsed` |
| [FNOS-033-02](/requirements/FNOS-033-usage-capsule-selection#fnos-033-02) 同类插件口径一致且有回归 | ZCode 是否已用 `next`；策略（always/off/未登录）是否被改坏 |

## 测试环境

| 功能 | 目标环境 | 说明 |
| --- | --- | --- |
| FNOS-033-01 | 包级测试 | 纯显隐判定可断言，不依赖 UI |
| FNOS-033-02 | 包级测试 | ZCode 纯函数与策略真值表 |

包级：`pnpm --filter @tnnevol/dsh-opencode run check`、`pnpm --filter @tnnevol/dsh-zcode run check`。

## 测试用例

### FNOS-033-01 OpenCode 胶囊随选择即时显隐

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-001 | FNOS-033-01-AC-01 | `next` 指向其它供应商、`lastUsed` 仍是 OpenCode 时调用 `readSelectedProvider` | 返回新供应商；`auto` 判定 false | 包级 |
| TC-002 | FNOS-033-01-AC-02 | `next: null`、`lastUsed` 为 OpenCode 时调用读取 | 退回 `lastUsed`，返回 OpenCode | 包级 |
| TC-003 | FNOS-033-01-AC-01、AC-02 | `next` 指向 OpenCode go/zen 模型时读取并判定 | 返回 OpenCode；`auto` 为 true | 包级 |

### FNOS-033-02 同类插件口径一致且有回归

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-004 | FNOS-033-02-AC-01 | ZCode：`next` 指向本插件 / 指向其它供应商（`lastUsed` 为本插件） | 分别显示 / 立即不显示 | 包级 |
| TC-005 | FNOS-033-02-AC-01 | ZCode：`next: null` 回退、投影缺失、空字段、always/off/未登录 | 与真值表一致 | 包级 |
| TC-006 | FNOS-033-02-AC-02 | 全仓库搜索用量显隐里的 `projection.pending` | 0 处命中 | 包级 |

## 测试执行结果

| ID | 结果 | 执行日期 | 证据/备注 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-10-26 | opencode `usage-visibility.spec.ts`「切到其它供应商时立即不显示」 |
| TC-002 | 通过 | 2026-10-26 | 同文件「优先 next，其次 lastUsed」 |
| TC-003 | 通过 | 2026-10-26 | 同文件 go/zen 用例 |
| TC-004 | 通过 | 2026-10-26 | 新增 zcode `capsule-visibility.spec.ts` |
| TC-005 | 通过 | 2026-10-26 | 同文件回退、空字段与策略用例 |
| TC-006 | 通过 | 2026-10-26 | 全仓库 `grep` 确认只有已修复的 opencode 曾命中，现为 0 |

包级汇总：`@tnnevol/dsh-opencode` 208 条通过；`@tnnevol/dsh-zcode` 169 条通过。

## Bug 记录

| ID | 关联用例 | 标题 | 级别 | 状态 | 说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-001 | OpenCode 胶囊切走模型后不立即隐藏 | P0 | 已修复 | 读取了 wire view 中不存在的 `pending`，改为 `next ?? lastUsed` |
| BUG-02 | TC-001 | 已发布的 6.0.6 仍带旧客户端构建 | P0 | 已定位；按决定不发布，本地打包交付 | `@tnnevol/dsh-opencode@6.0.6` 发布时未重新构建：`lib/index.js` 含会话头兜底，但 `lib/client.js` 仍读 `pending`。仓库源码已正确，本地重新构建的 tarball 已验证含修复（sha256 `86b9e3d8…`）；线上 6.0.6 保持不变 |

## 测试结论

包级验证通过：OpenCode 的字段错误已修复，ZCode 既有正确实现补齐回归。

线上交付状态（2026-10-28 核查）：npm 上已发布的 `@tnnevol/dsh-opencode@6.0.6` **未包含**本修复——其 `lib/client.js` 仍是旧构建（`pending`）。根源是发布时未重新构建，产物为磁盘旧 `lib/`；仓库源码与本地重新构建后的 tarball 均已验证含 `next` 修复。按 2026-10-28 决定不发布 npm，改为本地打包交付：产物为 `tmp/fnos-opencode-local/tnnevol-dsh-opencode-6.0.6-local-capsule-fix.tgz`，解包验证 `client.js` 读 `next`、`index.js` 含会话头兜底。后续如需正式发布，按 [发布前必须重新构建产物](/build/release#发布前必须重新构建产物-强制性) 逐项核对。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-26 | 建立测试用例文档 | 6 条用例全部包级通过；记录 BUG-01 |
| 2026-10-28 | 补记 BUG-02 与线上核查 | 用户更新 6.0.6 后症状仍在；`npm pack` 取证确认线上包 `client.js` 为旧构建；按决定不发布 npm，改为本地打包交付并验证产物 |
