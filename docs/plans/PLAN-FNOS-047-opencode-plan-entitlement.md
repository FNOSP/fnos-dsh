---
id: PLAN-FNOS-047
title: PLAN-FNOS-047 OpenCode 套餐归属过滤与额度排序
description: 新增套餐识别服务、整侧归属过滤与额度降序排序的实施计划，含上游更名跟进、保守降级、验证与回滚。
status: accepted-pending-user
owner: tnnevol
planDate: 2026-11-05
targetVersion: 8.1.0
lastVerified: 2026-11-05
---

# PLAN-FNOS-047 OpenCode 套餐归属过滤与额度排序

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-047 |
| 计划日期 | 2026-11-05 |
| 对应需求 | [FNOS-047 OpenCode 套餐归属过滤与额度排序](/requirements/FNOS-047-opencode-plan-entitlement) |
| 计划状态 | 待验收（T1–T7 全部完成；双客户端 33 条用例通过，待用户确认） |

## 计划目标

按 [FNOS-047](/requirements/FNOS-047-opencode-plan-entitlement) 的五个功能编号完成改造：新增套餐识别（Console 套餐接口优先、用量接口兜底）、把「同名去重」升级为「整侧过滤」、把排序口径换成按套餐档位的每月预计请求数降序，并跟进上游 Zen → Console 的更名。套餐不可读时保守降级，不改变选择器可用性。

技术边界：只改 `plugins/dsh-opencode-plugin` 与它的文档页；不改其它插件；不改上游 Console、不发起支付或订阅动作；不新增网络依赖（估算表内置）。

口径变更记录：FNOS-047-05 原设计为「套餐判不出时不过滤、两侧合并列出」，2026-11-06 真实账号验证发现合并列表会把按量模型摆到 Go 用户面前，与 FNOS-047-02 冲突，改为「按 Go 口径处理」；`/catalog` 响应随之移除恒为 true 的 `scoped` 字段，`filteredModelCount` 改为恒有值。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 套餐判定 | `ownedPlan()`（`src/index.ts`）：能读到 `/inference/go/v1/usage` 即 `go`，否则 `zen`。二值、无法区分三档 | 新增 `OpenCodeEntitlementService`：先读 `GET /console/api/go/status` 取 `product`，失败回退用量接口，再失败为 `unknown` | 三档套餐都能区分；调用方拿到 `payg` / `go` / `go-plus` / `go-teams` / `unknown` |
| 归属过滤 | `dedupeByPlan`：只删「另一侧有同名条目」的重复项 | `scopeToAccountPlan`：Go 订阅只保留 `plan === 'go'`，按量账号只保留 `zen`；**`unknown` 按 Go 口径过滤**（2026-11-06 变更，原设计不过滤） | 单侧独有模型（如 `big-pickle`）在 Go 账号下也会消失 |
| 排序 | `sortCatalogModels`：免费优先 → 付费按 `input+output` 单价升序 → id 兜底 | `sortCatalogModels(models, estimates)`：有估算表时按 `estimatedRequestsPerMonth` 降序（`null` 不限量最前，缺数据最后）；无估算表时保持原口径 | 目录卡片与选择器顺序同时改变 |
| 估算数据 | 无 | 新增 `src/contracts/estimates.ts`：三档内置表 + `estimatesForPlan` / `estimateOf` | 纯数据，无网络 |
| 端点策略 | `endpointPlan: auto` 时用「是否读到 Go 用量」决定打哪组端点 | 跟随套餐判定：Go 订阅走 Go 端点，`payg` 走按量端点，`unknown` 走 Go 端点（与目录口径一致） | `auto` 不再依赖用量接口成功 |
| 目录响应 | `/catalog` 只下发 `catalog` 与诊断 | 追加 `entitlement`（套餐与判定来源），供卡片显示套餐与过滤原因 | 浏览器侧新增只读字段 |
| 用户文案 | 大量使用 `Zen` / `zen` 描述按量口径 | 面向用户的按量口径改为「Console（按量）」，并给出 `https://opencode.ai/console/models`；内部 `plan: 'zen'` 字段名保持稳定 | 九个语言文件同步改文案 |

## 实施任务

| 编号 | 任务 | 对应功能 | 写入范围 |
| --- | --- | --- | --- |
| T1 | 新增估算契约 `src/contracts/estimates.ts`（已完成） | FNOS-047-03 | `src/contracts/estimates.ts` |
| T2 | 新增套餐服务 `src/host/entitlement.ts`：`GET /console/api/go/status` 优先、用量兜底、缓存与单飞 | FNOS-047-01、05 | `src/host/entitlement.ts`、`src/contracts/catalog.ts` |
| T3 | 目录视图改造：`scopeToAccountPlan` + 额度降序 `sortCatalogModels` | FNOS-047-02、03 | `src/host/catalog.ts` |
| T4 | 装配与路由：`src/index.ts` 换用套餐服务，`/catalog` 下发 `entitlement` | FNOS-047-01、05 | `src/index.ts`、`src/host/routes.ts` |
| T5 | 界面：账号卡显示套餐、目录卡显示过滤说明与额度列 | FNOS-047-01、03 | `src/components/*`、`src/client/services/*` |
| T6 | 文案：九语言同步「Console（按量）」口径与新地址 | FNOS-047-04 | `src/client/locales*.ts` |
| T7 | 测试与文档：单测、插件文档页、需求/计划/用例回填 | 全部 | `tests/*`、`docs/*` |

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Console 套餐接口为未公开接口，可能变更或按工作空间返回 404 | 判定回落到用量接口，三档退化为二值 | 兜底路径已实现；`unknown` 时不整侧过滤，选择器不清空 |
| 整侧过滤让「有余额的 Go 账号」看不到按量模型 | 用户若确实想用余额买按量模型，需先退订 Go | 详情页给出可读原因；保留 `endpointPlan` 手动开关作为显式覆盖 |
| 内置估算表与上游漂移 | 排序不再最优（不影响可用性） | 表头标注抓取日期与来源 URL；随版本更新 |
| 排序变化让用户熟悉的模型位置移动 | 短期不适应 | 排序只影响展示顺序，不改变条目与显隐记录 |

回滚：三个改动点彼此独立（套餐服务、过滤、排序），任一可单独回退；估算表是纯数据，删除后 `sortCatalogModels` 自动回到原口径。

## 验证计划

| 层次 | 方式 |
| --- | --- |
| 单元 | `tests/host/entitlement.spec.ts`（三档 + 两条失败路径）、`tests/host/catalog.spec.ts`（过滤与排序）、`tests/client/*`（文案与展示） |
| 类型 | `pnpm run typecheck` |
| 真实上游 | 用本机 `.dsh/.dsh-opencode-auth.json` 凭据实测 `/console/api/go/status`、`/inference/go/v1/models`、`/inference/v1/models` |
| 界面 | DSH Web 插件详情页与模型选择器目视核对；与本文件的「目录对照表」核对顺序 |
