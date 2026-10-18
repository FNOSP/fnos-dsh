---
id: FNOS-017
title: FNOS-017 测试用例
description: FNOS-017 fnOS 插件路由 403 误拒修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-017-fnos-route-403
plan: /plans/PLAN-FNOS-017-fnos-route-403
status: 部分通过
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-017 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-017 |
| 关联需求 | [FNOS-017 fnOS 插件路由 403 误拒修复](/requirements/FNOS-017-fnos-route-403) |
| 关联计划 | [PLAN-FNOS-017 fnOS 插件路由 403 误拒修复](/plans/PLAN-FNOS-017-fnos-route-403) |
| 测试状态 | <Badge type="warning" text="部分通过（本地 7 条通过；真机 3 条待执行）" /> |

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
| TC-001～TC-003（FNOS-017-01） | 3 | 0 | 0 | 0 | 3 |
| TC-004～TC-006（FNOS-017-02） | 3 | 3 | 0 | 0 | 0 |
| TC-007～TC-008（FNOS-017-03） | 2 | 2 | 0 | 0 | 0 |
| TC-009～TC-010（FNOS-017-04） | 2 | 2 | 0 | 0 | 0 |
| **合计** | **10** | **7** | **0** | **0** | **3** |

## Bug 记录

| Bug ID | 关联用例 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- | --- |
| BUG-01 | TC-007、TC-008 | 经 `https://<设备>.fnos.net` 访问时，`/plugins/dsh-fnos/authorized-directories/entries` 返回 403 `remote-web-origin-not-trusted` | `requestOrigin` 优先读 `x-forwarded-host`（公网域名、https），而网关把 `origin` 改写成 loopback 权威（http）。两侧取值来源不同，永远不相等 | 已修复：`requestOrigin` 只读网关写入的 `host`，转发头不参与判定 |

## 测试结论

本地部分通过：10 条用例中 7 条通过、0 条失败、3 条未执行（需真实 fnOS NAS）。

FNOS-017-02 与 FNOS-017-04 全部通过：三类跨站拒绝保持有效（外部 Origin、`cross-site`、非回环无 Origin），内网直连与 host 缺失兜底均未回归。FNOS-017-03 通过，且已确认新增用例在修复前确有 2 条失败——这证明用例能真正捕获缺陷，而不是修复后补写的空断言。

**修复方向的关键判断**：没有采用「`x-forwarded-host` 与 Origin 一致就放行」的宽松写法。该头在本仓库零写入、完全来自外部，信任它等于把同源校验交给请求方自证。改为让比较两侧读同一套已改写的权威。

后续动作：在真实 fnOS NAS 上执行 TC-001～TC-003，验收前先抓取一次实际请求头，回填本文档「待核实项」中平台侧注入的转发头形态。
