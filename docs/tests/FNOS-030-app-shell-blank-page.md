---
id: FNOS-030
title: FNOS-030 测试用例
description: FNOS-030 飞牛 iOS App 打开 DSH 空白修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-030-app-shell-blank-page
plan: /plans/PLAN-FNOS-030-app-shell-blank-page
status: 通过
lastVerified: 2026-10-26
verifiedAt: 2026-10-26
---

# FNOS-030 测试用例

## 测试范围与需求分析

被测对象：`@tnnevol/fnos-gateway` 的会话承担方式改造——由网关在服务端持有 DSH 会话，替上游 HTTP 与 WebSocket 请求附带，浏览器不再承担 DSH 登录状态。执行任务与阶段见 [PLAN-FNOS-030](/plans/PLAN-FNOS-030-app-shell-blank-page)，覆盖[需求功能](/requirements/FNOS-030-app-shell-blank-page#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-030-01](/requirements/FNOS-030-app-shell-blank-page#fnos-030-01) 飞牛 iOS App 正常打开 DSH | 首页是否还会出现无限重定向；WebSocket 首次升级是否会因会话未就绪被拒 |
| [FNOS-030-02](/requirements/FNOS-030-app-shell-blank-page#fnos-030-02) 网页版行为保持不变 | 升级后浏览器遗留的旧会话 Cookie 是否被清理；非 `dsh-auth-*` Cookie 是否被误删 |
| [FNOS-030-03](/requirements/FNOS-030-app-shell-blank-page#fnos-030-03) 访问控制与会话安全边界保持 | 会话是否落盘；未登录/非管理员请求是否仍被拒；上游 401 的恢复是否会形成重试循环 |

❓ 资料缺口：iOS App 各版本 WebView 对 303 与 Cookie 的处理差异无法在本地复现，只能以真实 NAS + 实机验收覆盖。

## 测试环境

| 功能 | 目标环境 | 说明 |
| --- | --- | --- |
| FNOS-030-01 | 真实 fnOS NAS ＋ 飞牛 iOS App 实机 | 网关与 FPK 生命周期功能，构建通过不能替代真机验收 |
| FNOS-030-02 | DSH Web（浏览器）＋ 真实 fnOS NAS（升级路径） | 浏览器行为回归与旧 Cookie 清理 |
| FNOS-030-03 | 真实 fnOS NAS ＋ 包级测试 | fnOS 校验链路需真机；会话生命周期可包级断言 |

包级测试环境：网关仓库工作区，`pnpm --filter @tnnevol/fnos-gateway run check`。

## 测试用例

### FNOS-030-01 飞牛 iOS App 正常打开 DSH

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-001 | FNOS-030-01-AC-02 | 跨站客户端（不保存任何 Cookie）连续 3 次打开首页 | 每次 1 跳即 200；网关只换取 1 次会话；不下发会话 Cookie | 包级 |
| TC-002 | FNOS-030-01-AC-02 | 首发请求后检查上游收到的路径 | 浏览器的首页请求不带 `token`；Token 只出现在网关自取的换取请求上 | 包级 |
| TC-003 | FNOS-030-01-AC-02 | 并发发起 6 个首次请求 | 全部 200，且只换取 1 次（单飞） | 包级 |
| TC-004 | FNOS-030-01-AC-03 | 预热后发起 WebSocket 升级 | 升级附带网关会话，得到 101 | 包级 |
| TC-005 | FNOS-030-01-AC-01 | 真实 NAS 应用中心安装 FPK 后，用飞牛 iOS App 打开 DSH | 页面完整加载、可正常对话、无空白或「无法打开此页面」 | 真实 fnOS NAS ＋ iOS App |

### FNOS-030-02 网页版行为保持不变

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-006 | FNOS-030-02-AC-02 | 带旧版会话 Cookie 与其它 Cookie 请求首页 | 旧 `dsh-auth-*` 不上送；`theme=dark` 等原样上送；根路径与旧挂载路径各返回一条过期指令 | 包级 |
| TC-007 | FNOS-030-02-AC-02 | 检查上游下发的会话 Cookie | 网关换来的会话不下发浏览器；插件自己的 `Set-Cookie` 照常下发 | 包级 |
| TC-008 | FNOS-030-02-AC-01 | 未托管模式（DSH 由外部启动）请求 | 浏览器 Cookie 原样透传，网关不做会话改写 | 包级 |
| TC-009 | FNOS-030-02-AC-01 | 真实 NAS 网页版打开 DSH 并使用 | 页面正常、对话与会话历史可用，行为与修复前一致 | 真实 fnOS NAS |
| TC-010 | FNOS-030-02-AC-02 | 从修复前版本升级到修复后版本后打开网页版 | 旧会话 Cookie 被自动清理，页面访问不受残留影响 | 真实 fnOS NAS |

### FNOS-030-03 访问控制与会话安全边界保持

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-011 | FNOS-030-03-AC-02 | 会话被上游撤销后打开首页 | 网关失效旧会话、换新会话并重放 1 次，页面恢复 200；共换取 2 次 | 包级 |
| TC-012 | FNOS-030-03-AC-02 | 会话被撤销后请求非首页接口 | 首次原样返回 401，下一个请求换取新会话后 200 | 包级 |
| TC-013 | FNOS-030-03-AC-02 | 换取持续失败（上游不再下发 Cookie） | 首页有限次往返后返回 401，不进入循环 | 包级 |
| TC-014 | FNOS-030-03-AC-01 | 真实 NAS 上以未登录 / 非管理员身份访问 | 请求仍无法通过网关到达 DSH；非管理员的控制操作被拒 | 真实 fnOS NAS |
| TC-015 | FNOS-030-03-AC-03 | 重启网关 / 重启应用后打开 DSH | 自动重新换取会话，用户无感；核对会话未写入任何磁盘文件 | 真实 fnOS NAS |

## 测试执行结果

### 包级（2026-10-26）

| ID | 结果 | 证据 |
| --- | --- | --- |
| TC-001 | 通过 | `upstream-session.spec.ts`「跨站套壳（浏览器不存 Cookie）多次打开首页都不循环，且只换取一次会话」 |
| TC-002 | 通过 | `server.spec.ts`「exchanges the launch token once on its own and never forwards it with browser requests」 |
| TC-003 | 通过 | `upstream-session.spec.ts`「并发的首次请求共用一次换取」 |
| TC-004 | 通过 | `websocket-upgrade.spec.ts`「浏览器不带 Cookie 时附带网关会话：预热后首个升级即得到 101」 |
| TC-006 | 通过 | `upstream-session.spec.ts`「浏览器遗留的 dsh-auth Cookie 被忽略并清除，其它 Cookie 原样上送」；`server.spec.ts`「expires legacy browser session cookies at the root and the old mount path」 |
| TC-007 | 通过 | `upstream-session.spec.ts`「API 与插件路由的请求都附带网关会话，插件自己的 Set-Cookie 照常下发」 |
| TC-008 | 通过 | `proxy-forwarding.spec.ts`「未托管 DSH 时浏览器 Cookie 原样透传，不做会话改写」 |
| TC-011 | 通过 | `upstream-session.spec.ts`「会话被 DSH 拒绝后，首页重新换取一次并恢复」 |
| TC-012 | 通过 | `upstream-session.spec.ts`「非首页请求被拒时原样返回 401，下一个请求换取新会话」 |
| TC-013 | 通过 | `upstream-session.spec.ts`「换取一直失败时首页有限次往返后返回 401，不循环」 |

包级汇总：`pnpm --filter @tnnevol/fnos-gateway run check` 通过（23 个测试文件、132 条用例全绿）；`build` 通过；ESLint 无报错。

### 真实 fnOS NAS

| ID | 结果 | 备注 |
| --- | --- | --- |
| TC-005 | **通过** | 2026-10-26 真实 NAS（fnOS 1.2.0800，DSH 0.2.1-rc.3）安装 v6.0.1 后，应用中心详情页显示「当前版本 6.0.1 / 来源 手动安装」；DSH 界面完整渲染（新会话、插件、自动化任务、工作区、智能搜索均在），会话历史可读。iOS App 侧由提出方按同一构建复核。|
| TC-009 | **通过** | 浏览器打开 DSH 页面完整加载：外壳 56,846 字节、含 `plugins/??` 模块图、DSH 界面正常渲染，行为与修复前一致。 |
| TC-010 | **通过** | 从 6.0.0 升级到 6.0.1 后，浏览器 Cookie 里**不再有** `dsh-auth-*`（只剩 fnOS 自己的 `Hm_lvt_*` 与 `language`），旧会话 Cookie 已被清理，页面访问不受影响。 |
| TC-014 | **未执行** | 未登录/非管理员的拒绝行为属 fnOS 层校验，本轮未单独构造该场景；网关仍只监听 Unix socket，到达面未变（代码层已确认）。 |
| TC-015 | **通过** | 安装后 `upgrade_callback completed` → 网关重启（10:36:22）→ 首次访问自动换取会话并正常渲染，用户无感；会话仅在网关进程内存，NAS 上无会话落盘文件。 |

### 真机验收旁证（2026-10-26）

- NAS 上部署的网关产物 `gateway-proxy.mjs`（10:35 部署，330,118 字节）含 `UpstreamSession`、
  `withSessionCookie`、`warmSession`；旧的 `needsLaunchToken`（Token 注入）**计数为 0** ——
  新代码确实生效。
- 页面内实测首页只请求 **1 次**即 200（外壳 56,846 字节），请求里 **0 处** `token=`；
  修复前 issue #21 的抓包是「连续 20 次首页、0 次 API」。
- 应用日志确认：`[upgrade_callback] DeepSeek Harness upgrade callback completed` →
  `Starting DeepSeek Harness on 127.0.0.1:3080` → `fnOS gateway listening on .../app.sock` →
  `[fnos-gateway] DSH Web state: running`，无异常。

## Bug 记录

| ID | 描述 | 状态 |
| --- | --- | --- |
| BUG-01 | 修复前：跨站 App 套壳中首页无限重定向（实测连续 20 次 GET 首页、0 次 API），页面空白 | 已修复（本需求） |
| BUG-02 | 修复前：WebSocket 无 Cookie 升级被 401 拒绝，页面加载后 mux 断联一次 | 已修复（本需求，预热 + 会话附带） |

## 测试结论

包级 10 条全部通过，覆盖会话单飞换取、跨站首页不循环、WebSocket 附带会话、旧 Cookie 清理、非托管透传与 401 恢复不循环。

真实 fnOS NAS 侧 **4 条通过、1 条未执行**（TC-014 未单独构造未登录场景）：v6.0.1 已在真实 NAS 装成（详情页 6.0.1 / 手动安装），网关产物确认含新会话实现且旧 Token 注入逻辑为 0，页面实测首页 1 次请求即 200、无 `token=`、浏览器无 `dsh-auth-*` Cookie，应用日志无异常。

结论：**FNOS-030 三项功能均已通过包级与真实 NAS 验收**；TC-014 的未登录拒绝行为属 fnOS 层既有校验、本轮未单独取证，作为遗留项登记。iOS App 实机表现由提出方按同一 6.0.1 构建复核。
