---
id: FNOS-017
title: FNOS-017 测试用例
description: FNOS-017 fnOS 插件路由 403 误拒修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-017-fnos-route-403
plan: /plans/PLAN-FNOS-017-fnos-route-403
status: 通过
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-017 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-017 |
| 关联需求 | [FNOS-017 fnOS 插件路由 403 误拒修复](/requirements/FNOS-017-fnos-route-403) |
| 关联计划 | [PLAN-FNOS-017 fnOS 插件路由 403 误拒修复](/plans/PLAN-FNOS-017-fnos-route-403) |
| 测试状态 | <Badge type="tip" text="通过（10 条全部通过，含真实 fnOS NAS）" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-017-fnos-route-403#功能列表) 中 FNOS-017-01 至 FNOS-017-04。

本缺陷的测试难点在于**两类不可混淆的 403**：

- **误拒**（要修的）：请求实际同源，但因判定取值来源不一致被拒。
- **真拒**（要保的）：请求确实跨站，必须继续拒绝。

只验证「不再 403」会把修复做成敞开大门；只验证「仍会 403」则不解决用户问题。因此用例必须成对存在，且每条都要能区分是哪一类。

第二个难点是**环境不可本地复现**：`https://<设备>.fnos.net` 的 403 依赖平台侧反代注入转发头。本地只能用请求桩构造等价头组合，真实链路必须在真机验收。

❓ 待核实项：fnOS 平台反代实际注入哪些 `x-forwarded-*` 头、取值形态（单个值还是逗号列表），需在真机上抓取请求头后回填。

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-017-01](/requirements/FNOS-017-fnos-route-403#fnos-017-01) | 真实 fnOS NAS（远程 `https://<设备>.fnos.net`） |
| [FNOS-017-02](/requirements/FNOS-017-fnos-route-403#fnos-017-02)、[FNOS-017-03](/requirements/FNOS-017-fnos-route-403#fnos-017-03) | 本地构测环境（单测覆盖） |
| [FNOS-017-04](/requirements/FNOS-017-fnos-route-403#fnos-017-04) | DSH Web（内网直连） |

版本基线：DSH `0.2.1-rc.2` / 插件 `@tnnevol/dsh-fnos` 修复版本（`0.2.1-rc.2.4` 起）/ 应用 `5.9.0`。

## 测试用例

### [FNOS-017-01 远程访问下 fnOS 路由可用](/requirements/FNOS-017-fnos-route-403#fnos-017-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-017-01](/requirements/FNOS-017-fnos-route-403#fnos-017-01) | 远程访问列出授权目录 | AC-01 | 设备已装修复版本；已授权至少一个 NAS 目录 | 1.经远程域名打开 DSH 2.请求 `GET /plugins/dsh-fnos/authorized-directories/entries` | 返回 200，`entries` 含已授权目录 | P0 | 缺陷场景 |
| TC-002 | [FNOS-017-01](/requirements/FNOS-017-fnos-route-403#fnos-017-01) | 远程访问 `/fn` 引用可用 | AC-02 | 同上 | 1.在会话输入框输入 `/fn` 2.选择目录并插入引用 | 条目可选择，引用插入成功 | P0 | 缺陷场景 |
| TC-003 | [FNOS-017-01](/requirements/FNOS-017-fnos-route-403#fnos-017-01) | 远程访问插件详情页正常 | AC-03 | 同上 | 1.打开插件页 2.进入 dsh-fnos 详情 | 授权目录区块正常渲染，无「不可用」提示 | P1 | 缺陷场景 |

### [FNOS-017-02 跨站拒绝不放松](/requirements/FNOS-017-fnos-route-403#fnos-017-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-004 | [FNOS-017-02](/requirements/FNOS-017-fnos-route-403#fnos-017-02) | 外部 Origin 被拒 | AC-01 | — | 构造 `Origin: https://evil.example` 且 `host` 为 loopback 的请求 | 403 `remote-web-origin-not-trusted` | P0 | 安全要求 |
| TC-005 | [FNOS-017-02](/requirements/FNOS-017-fnos-route-403#fnos-017-02) | cross-site 被拒 | AC-02 | — | 构造 `Sec-Fetch-Site: cross-site` 且 Origin 看似同源的请求 | 403 | P0 | 安全要求 |
| TC-006 | [FNOS-017-02](/requirements/FNOS-017-fnos-route-403#fnos-017-02) | 非回环且无 Origin 被拒 | AC-03 | — | 构造无 `Origin`、`remoteAddress=192.168.x.x` 的请求 | 403 | P0 | 安全要求 |

### [FNOS-017-03 回归覆盖补齐](/requirements/FNOS-017-fnos-route-403#fnos-017-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-017-03](/requirements/FNOS-017-fnos-route-403#fnos-017-03) | 带转发头的同源请求放行 | AC-01 | — | 构造 `x-forwarded-host=设备.fnos.net` + `origin` 改写为 loopback 的请求 | 判定为可信（修复前为 403） | P0 | 缺陷复现 |
| TC-008 | [FNOS-017-03](/requirements/FNOS-017-fnos-route-403#fnos-017-03) | 拒绝类用例修复前即失败 | AC-02 | — | 在旧实现上运行 TC-007 | TC-007 失败，证明用例有效 | P0 | 用例有效性 |

### [FNOS-017-04 内网直连不回归](/requirements/FNOS-017-fnos-route-403#fnos-017-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-017-04](/requirements/FNOS-017-fnos-route-403#fnos-017-04) | 内网直连行为不变 | AC-01 | — | 1.内网访问 DSH 2.重复 TC-001 步骤 | 与修复前一致，返回 200 | P0 | 沿用 FNOS-008 基线 |
| TC-010 | [FNOS-017-04](/requirements/FNOS-017-fnos-route-403#fnos-017-04) | host 缺失时回退 localPeer | — | — | 构造无 `host`、无 `Origin`、回环来源的请求 | 判定为可信（不因缺权威而崩） | P2 | 兜底要求 |

## 测试执行结果

| 用例范围 | 总数 | 通过 | 失败 | 阻塞 | 未执行 |
| --- | --- | --- | --- | --- | --- |
| TC-001～TC-003（FNOS-017-01） | 3 | 3 | 0 | 0 | 0 |
| TC-004～TC-006（FNOS-017-02） | 3 | 3 | 0 | 0 | 0 |
| TC-007～TC-008（FNOS-017-03） | 2 | 2 | 0 | 0 | 0 |
| TC-009～TC-010（FNOS-017-04） | 2 | 2 | 0 | 0 | 0 |
| **合计** | **10** | **10** | **0** | **0** | **0** |

### 真机执行结果（2026-10-18，真实 fnOS NAS）

环境：设备 `fnos-mi`，经 `https://xiaomi-cn.fnos.net` 远程访问，`dsh-fnos` `0.2.1-rc.2.4`（代码来源 `file:/vol1/@appcenter/fn-deepseek-harness/bundled-dsh-plugins/@tnnevol/dsh-fnos.tgz`，即内置形态安装）。

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 | 通过 | `POST /app/fn-deepseek-harness/plugins/dsh-fnos/authorized-directories/entries` 返回 **200**，响应体含 5 条授权目录（`/vol2/1000/fnos-fpk`、`/vol1/@appshare`、`/vol1/@apphome`、`/vol1/@appdata`、`/vol1/@appconf` 下的 `fn-deepseek-harness`）。请求头为 `origin: https://xiaomi-cn.fnos.net`、`sec-fetch-site: same-origin` —— 正是修复前被判 403 的形态 |
| TC-002 | 通过 | 会话输入区输入 `/fn` 后弹出「指令 fn — 选择已授权的 NAS 文件或目录」，列出全部 5 个目录及语义名 |
| TC-003 | 通过 | 插件详情页「fnOS 集成」渲染出授权目录区块，5 个目录齐全，含「添加授权目录」「刷新」「取消授权」按钮；同页 `gateway/proxy-paths` 与 `authorized-directories` 两个 GET 均 200 |
| TC-004～TC-006 | 通过（本地） | 跨站拒绝无法从页面内伪造——浏览器控制 `Origin` 头，页面脚本改不了。三类拒绝由本地请求桩用例覆盖 |
| TC-007～TC-010 | 通过（本地） | 见本地执行结果 |

**关键旁证**：页面内 `fetch` 带 `credentials: 'omit'` 时返回 `TypeError: Failed to fetch`，说明该接口仍要求凭据，修复没有把鉴权放松成「谁都能读」。

## Bug 记录

| Bug ID | 关联用例 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- | --- |
| BUG-01 | TC-007、TC-008 | 经 `https://<设备>.fnos.net` 访问时，`/plugins/dsh-fnos/authorized-directories/entries` 返回 403 `remote-web-origin-not-trusted` | `requestOrigin` 优先读 `x-forwarded-host`（公网域名、https），而网关把 `origin` 改写成 loopback 权威（http）。两侧取值来源不同，永远不相等 | 已修复：`requestOrigin` 只读网关写入的 `host`，转发头不参与判定 |

## 测试结论

10 条全部通过，FNOS-017 在真实 fnOS NAS 远程访问下确认修复。

真机证据的核心是这一条：`origin: https://xiaomi-cn.fnos.net` + `sec-fetch-site: same-origin` 的请求拿到 **200** 与完整目录数据。这正是缺陷报告里被判 403 的同一形态——修复让它从「两侧取值来源不同、永远不相等」变成「两侧都读网关改写后的同一权威」。

同时确认修复没有放松鉴权：去掉凭据后请求失败（`Failed to fetch`），跨站拒绝的三类分支由本地用例继续守住。

**未验证项**：`x-forwarded-*` 的实际注入形态仍未从抓包确认——本次请求头里没有出现该字段。这说明该远程链路下网关并未透传转发头，也意味着修复在该链路上「即使出现也不会误判」。平台其它反代路径是否注入，需另找入口才能观察。
