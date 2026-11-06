---
id: FNOS-047
title: FNOS-047 OpenCode 套餐归属过滤与额度排序
description: 让 dsh-opencode 插件按当前账号的真实套餐（Go / Go Plus / Go Teams / 按量）决定展示与可用的模型：整侧过滤不属于账号套餐的条目，按官方 Estimated requests 表的每月预计请求数降序排列，并跟进上游 Zen → Console 的更名与套餐接口变更。
status: accepted-pending-user
owner: tnnevol
targetVersion: 8.1.0
lastVerified: 2026-11-05
---

# FNOS-047 OpenCode 套餐归属过滤与额度排序

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-047 |
| 提出日期 | 2026-11-05 |
| 需求状态 | 待验收（双客户端与自动化测试全部通过，待用户确认收口） |
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
| FNOS-047-05 | 未知套餐按 Go 口径处理 | 未登录或套餐接口不可读时按 OpenCode Go 展示：只列 `· go` 条目、按 Go 档额度排序、共用模型走 Go 端点，并说明未能识别套餐的原因 |
| FNOS-047-06 | 账号卡按值渲染 | 账号卡只显示有值的字段：邮箱、组织等取不到时整项不显示，不再出现「未知」占位；API Key 登录时组织名尽量补全 |

### FNOS-047-01 套餐识别

插件按「Console 套餐接口优先、Go 用量接口兜底」的顺序判定账号套餐，区分 `go` / `go-plus` / `go-teams` / `payg` 四类结果。详情页账号卡显示套餐名与判定依据（Console 套餐接口 / 用量接口兜底 / 不可读）。

### FNOS-047-02 归属过滤

账号套餐可判定时**整侧过滤**：Go 订阅只保留 `· go` 条目，仅按量账号只保留 `· zen` 条目。只在另一侧存在的模型（如 `big-pickle`）同样不出现；模型选择器与详情页目录卡片口径一致。

### FNOS-047-03 额度排序

Go 侧模型按官方 Go 文档 Estimated requests 表的每月预计请求数降序排列，按套餐档位取对应的一份数据；文档标为 `Unlimited` 的模型置顶，表里没有的模型沉底。仅按量账号保持原有「免费优先、单价升序」口径。

上游新上架的免费模型（额度表快照还没有条目时）按不限量置顶，不沉底。依据是官方 Go 额度表里标 `Unlimited` 的恰好只有免费模型，FAQ 也写明「达到 Go 限制后可以继续使用免费模型」，因此「Go 侧免费 ⇒ 不限量」是上游的确定规则而非推测。付费模型在表里没有条目时仍沉底：没有数据就不编造额度。

是否免费按 token 单价判定，价格来源依次为 Console 覆盖、本段公开目录、另一段公开目录、pi-ai 内置目录、**活 roster**（roster 用 `cost.text.input.price` 的分层形态，且比 models.dev 同步更快，作为链尾兜底）。

### FNOS-047-04 上游更名跟进

面向用户的按量口径文案统一为「Console（按量）」，并给出官方新地址 `https://opencode.ai/console/models`；内部 `zen:` 前缀与 `· zen` 后缀保持不变，以免存量隐藏设置与历史会话失效。

### FNOS-047-05 未知套餐按 Go 口径处理

未登录、套餐接口不可读或响应无法识别时，**按 OpenCode Go 处理**：整侧过滤只保留 `· go` 条目、排序取 Go 档的预计请求数表、`auto` 端点策略走 Go 端点，同时在详情页说明「未识别到套餐，暂按 OpenCode Go 套餐展示模型」并保留宿主给出的失败原因。

口径变更说明：本功能最初的设计是「读不出来就不过滤、两侧合并列出」。2026-11-06 用真实账号验证时发现，合并列表会把大量按量模型（需要 Console 余额才能调用）摆到 Go 用户面前，与 FNOS-047-02「只展示属于账号套餐的模型」的初衷直接冲突。OpenCode 的主力付费形态是 Go 订阅，按 Go 口径比两侧混列更接近用户真实可用的集合；确实只有按量余额的用户可以把「推理端点」显式设为 Zen 端点。

### FNOS-047-06 账号卡按值渲染

账号卡的信息按「有值才显示」渲染：取不到的字段整项隐藏，不显示「未知」这类占位文案。原因是上游对 API Key 登录的账号信息接口一律拒绝，把「未知」摆出来会让用户以为插件读取过、只是没回填，实际是这条路根本没有数据。

API Key 登录拿不到邮箱（`/api/user` 与 `/api/orgs` 对 Key 返回 401/403），但 `GET /console/api/v2/config` 对 Key 可用，其 `providers.opencode.name` 形如 `<工作空间名> / OpenCode`、`headers['x-opencode-org-id']` 给出工作空间 id，因此登录时用它补全组织名；仍取不到就留空并整项隐藏。

## 验收条件

| 编号 | 验收条件 | 判定方式 |
| --- | --- | --- |
| [AC-01](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-01-套餐识别) | 单元测试覆盖三种套餐返回值与两条失败路径，读到 `go-plus` 时估算表取 Go Plus 那份；两个客户端详情页能看到套餐名与判定依据 | `tests/host/entitlement.spec.ts`、DSH Web 与 DSH Desktop 走查 |
| [AC-02](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-02-归属过滤) | 目录视图在 Go 账号下不含任何 `plan === 'zen'` 条目；按量账号下不含 `plan === 'go'`；未知套餐按 Go 口径过滤 | `tests/host/catalog.spec.ts` |
| [AC-03](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-03-额度排序) | 排序结果严格按估算表降序；`null`（不限量）在最前；表里没有的模型排在最后且顺序稳定 | `tests/host/catalog.spec.ts` |
| [AC-04](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-04-上游更名跟进) | 文档页与界面文案不再把按量口径称为 Zen，且给出 `console/models` 新地址 | 文档审阅 + 文案键检查 |
| [AC-05](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-05-未知套餐按-go-口径处理) | 套餐接口不可用时目录按 Go 口径过滤且仍可用，详情页给出「暂按 Go 展示」说明与可读原因；`/catalog` 的 `filteredModelCount` 恒为数字 | `tests/host/entitlement.spec.ts`、`tests/host/routes.spec.ts` |
| [AC-06](/requirements/FNOS-047-opencode-plan-entitlement#fnos-047-06-账号卡按值渲染) | 账号卡不渲染值为空的字段；API Key 登录时组织名取自工作空间配置，取不到则不留占位 | `tests/host/auth.spec.ts`、双客户端走查 |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-05 | 建立需求：调研确认上游 Zen → Console 更名、套餐接口与 Estimated requests 数据面，确定「整侧过滤 + 额度降序」口径 |
| 2026-11-05 | 实现完成：套餐服务（Console 接口优先、用量兜底、未知保守降级）、整侧归属过滤、按档位额度降序、界面套餐与额度展示、九语言文案跟进；自动化验证 325 条全绿，转入待验收 |
| 2026-11-06 | FNOS-047-03 排序补充规则：上游新上架的免费模型（如 2026-11-03 的 `crouton-alpha-free`）此前因不在内置额度表里被排到末尾；现按「Go 侧免费 ⇒ 不限量」置顶。同时 `cost` 兜底链补上活 roster 价格源（此前完全不读 roster），并修掉 `??` 把表内 `null` 穿透成「无数据」的缺陷 |
| 2026-11-06 | FNOS-047-05 口径变更：未知套餐从「不过滤、两侧合并」改为「按 Go 口径过滤」（整侧只留 `· go`、Go 档额度排序、`auto` 走 Go 端点）。真实账号验证发现合并列表会把按量模型摆到 Go 用户面前，与 FNOS-047-02 初衷冲突。`/catalog` 响应移除恒为 true 的 `scoped` 字段，`filteredModelCount` 改为恒有值 |
| 2026-11-06 | 补充 FNOS-047-06：API Key 登录无法从 Console 会话接口取得邮箱与组织（401/403），改为从 `v2/config` 补组织名；账号卡改为「有值才显示」，空字段整项隐藏，移除 `accountUnknown` 占位文案 |
| 2026-11-06 | 按测试用例规范完成双客户端验收：DSH Web（0.2.2-rc.1 + 插件 8.1.0）与 DSH Desktop（开发态检出 0.2.2-rc.1 / Electron 44.7.0）各执行界面用例，33 条用例全部通过；亮/暗主题对比度达标；未登录降级与凭据恢复已复验。测试产物已清理，待用户确认收口 |
