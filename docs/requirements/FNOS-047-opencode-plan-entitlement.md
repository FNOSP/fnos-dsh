---
id: FNOS-047
title: FNOS-047 OpenCode 套餐归属过滤与额度排序
description: 让 dsh-opencode 插件按当前账号的真实套餐（Go / Go Plus / Go Teams / 按量）决定展示与可用的模型：整侧过滤不属于账号套餐的条目，按官方 Estimated requests 表的每月预计请求数降序排列，并跟进上游 Zen → Console 的更名与套餐接口变更。
status: in-review
owner: tnnevol
targetVersion: 8.1.0
lastVerified: 2026-11-05
---

# FNOS-047 OpenCode 套餐归属过滤与额度排序

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-047 |
| 提出日期 | 2026-11-05 |
| 需求状态 | 待验收（实现与自动化验证完成，待界面目视与用户确认） |
| 关联计划 | [PLAN-FNOS-047 OpenCode 套餐归属过滤与额度排序](/plans/PLAN-FNOS-047-opencode-plan-entitlement) |
| 适用范围 | `plugins/dsh-opencode-plugin`（宿主目录、用量与套餐服务、Web 路由、目录卡片与设置区）、插件文档页 `docs/plugins/dsh-opencode.md` |
| 明确排除 | 其它六个入库插件；按量余额与账单展示；上游 Console 的支付与订阅操作 |

## 需求背景

当前插件的模型目录把两组来源合并成一个列表：OpenCode **Zen（按量）** 与 **OpenCode Go（套餐）**。合并的初衷是「账号可能只有一种付费方式，让用户自己挑」，但实际使用中这个前提不成立：

1. **列表被不属于账号的模型占满**。Go 订阅账号在目录里仍然看到 80 个按量（zen）模型，其中绝大多数需要 Console 余额才能调用；按量账号同样看到 29 个 Go 模型。用户无法从名字判断哪一条真正可用，只能试错。
2. **现有的「跨来源去重」只解决同名模型**。`dedupeByPlan` 只删掉「另一侧有同名条目」的重复项，单侧独有的模型照常保留——Go 账号因此仍能看到 `big-pickle`、`claude-opus-5-5` 这类只在按量侧存在的条目。
3. **排序口径与套餐价值脱节**。现在按「免费优先、付费按 token 单价升序」，而 Go 套餐里真正决定「能用多少次」的是每个模型的每月额度（官方文档的 Estimated requests 表）。额度最大的模型反而因为单价高被排到后面。
4. **上游已完成更名**。`opencode.ai/zen` 与 `opencode.ai/docs/zen` 现在都 302 跳到 Console 的模型页，官方 v2 文档里不再有 "Zen" 命名，按量口径统一叫 **OpenCode Console（pay-as-you-go）**。插件内部与文档仍在使用 Zen 一词，用户按文档找不到对应页面。

同时，上游在本轮调研中暴露了三个插件此前未使用的接口：

| 接口 | 返回 | 价值 |
| --- | --- | --- |
| `GET /console/api/go/status` | `product` / `renewalProduct`（`go`、`go-plus`、`go-teams`）、`access.meters` 的 `{fiveHour, week, month}` 各自 `limitMicroCents` 与 `usedMicroCents` | 唯一能区分 Go / Go Plus / Go Teams 的接口；也是额度金额的权威来源 |
| `GET /console/api/billing/status` | `mode`（`pay-as-you-go`）、`balanceMicroCents`、`availableMicroCents` | 判断账号是否只有按量余额 |
| `GET /console/api/providers` | 工作空间启用状态、`modelCount` / `enabledModelCount` | 佐证工作空间确实启用了某一侧 |

## 需求目标

用户登录后，模型选择器里的每个模型都属于当前账号的套餐，并且按「这个模型在套餐里能用多少次」从多到少排列。

| 编号 | 功能 | 用户可观察结果 |
| --- | --- | --- |
| FNOS-047-01 | 套餐识别 | 插件读到账号真实套餐：Go / Go Plus / Go Teams / 按量；详情页账号卡显示套餐名与判定依据 |
| FNOS-047-02 | 归属过滤 | Go 账号的目录与选择器只出现 `· go` 条目；按量账号只出现 `· zen` 条目；整侧过滤，不再只做同名去重 |
| FNOS-047-03 | 额度排序 | Go 侧模型按该档位的每月预计请求数降序排列；不限量模型置顶；按量侧保持原有「免费优先、单价升序」口径 |
| FNOS-047-04 | 上游更名跟进 | 面向用户的文案把「Zen（按量）」改为「Console（按量）」口径，并给出官方新地址；内部契约字段名保持稳定 |
| FNOS-047-05 | 未知套餐的保守处理 | 未登录或套餐接口不可读时不做整侧过滤，回落到原有合并列表并提示原因，避免选择器突然清空 |

## 验收条件

| 编号 | 验收条件 | 判定方式 |
| --- | --- | --- |
| FNOS-047-01 | 单元测试覆盖三种套餐返回值与两种失败路径，读到 `go-plus` 时估算表取 Go Plus 那份 | `tests/host/entitlement.spec.ts` |
| FNOS-047-02 | 目录视图在 Go 账号下不含任何 `plan === 'zen'` 条目；按量账号下不含 `plan === 'go'`；未知套餐保留两侧 | `tests/host/catalog.spec.ts` |
| FNOS-047-03 | 排序结果严格按估算表降序；`null`（不限量）在最前；表里没有的模型排在最后且顺序稳定 | `tests/host/catalog.spec.ts` |
| FNOS-047-04 | 文档页与界面文案不再把按量口径称为 Zen，且给出 `console/models` 新地址 | 文档审阅 + 文案键检查 |
| FNOS-047-05 | 套餐接口 404/超时时过滤开关不生效、目录仍可用，详情页给出可读原因 | `tests/host/entitlement.spec.ts`、`tests/host/routes.spec.ts` |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-05 | 建立需求：调研确认上游 Zen → Console 更名、套餐接口与 Estimated requests 数据面，确定「整侧过滤 + 额度降序」口径 |
| 2026-11-05 | 实现完成：套餐服务（Console 接口优先、用量兜底、未知保守降级）、整侧归属过滤、按档位额度降序、界面套餐与额度展示、九语言文案跟进；自动化验证 325 条全绿，转入待验收 |
