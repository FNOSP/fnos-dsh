---
id: FNOS-053
title: FNOS-053 测试用例
description: FNOS-053 账号登录回调改道、官方登录框拦截与粘贴换码的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-053-account-login-callback-relay
status: 部分通过
lastVerified: 2026-11-13
verifiedAt: 2026-11-13
---

# FNOS-053 测试用例
关联需求：[FNOS-053](/requirements/FNOS-053-account-login-callback-relay)｜关联计划：[PLAN-FNOS-053 账号登录回调中转](/plans/PLAN-FNOS-053-account-login-callback-relay)


## 测试范围与需求分析

被测对象是「让经 fnOS 网关访问的用户能完成账号登录」。它由三段串联而成：宿主改写回调 origin、客户端拦截官方登录框并接住粘贴、服务端完成换码。任一段断掉，用户看到的现象都是「点登录没反应」或「卡在某个界面」。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-053-01](/requirements/FNOS-053-account-login-callback-relay#功能拆解) | 回调 origin 改道 | 写死端口 → 回调落到没人监听的地址 |
| [FNOS-053-02](/requirements/FNOS-053-account-login-callback-relay#安全边界) | 中继换码 | 接受调用方 URL → SSRF |
| [FNOS-053-03](/requirements/FNOS-053-account-login-callback-relay#判据为什么不能依赖-role) | 官方框拦截 | 判据过窄 → 拦截完全不生效（本次故障根因） |
| [FNOS-053-04](/requirements/FNOS-053-account-login-callback-relay#功能拆解) | 粘贴对话框三态 | 状态不推进，用户不知道该干什么 |
| [FNOS-053-05](/requirements/FNOS-053-account-login-callback-relay#功能拆解) | 会话内状态对齐 | 刷新后重复发起登录，把上一轮作废 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-053-01 ~ 05 | 包级（Node / vitest） | 源码契约断言 + 纯函数单测 |
| FNOS-053-03 ~ 05 | 真实 fnOS NAS（192.168.0.17:5666） | Chrome MCP 操作官方菜单与插件对话框 |
| FNOS-053-02 | 真实 fnOS NAS | 需真实账号授权，**未执行** |

## 用例与结果

| 编号 | 用例 | 期望 | 结果 |
| --- | --- | --- | --- |
| TC-053-01 | 非 loopback 的 callbackOrigin | 改写为 `http://127.0.0.1:<port>` | 通过（单测） |
| TC-053-02 | 已是 loopback 的 callbackOrigin | 原样透传 | 通过（单测） |
| TC-053-03 | 改写端口来源 | 取 `webServer.port`，不出现字面量 3080 | 通过（单测） |
| TC-053-04 | 中继目标 URL | 由服务端拼，不读请求体里的 URL | 通过（单测） |
| TC-053-05 | 所有路由同源校验 | 每个 handler 都有 `trusted(req)` | 通过（单测） |
| TC-053-06 | `authorizeUrl` 生成时机 | 轮询到 `waiting-browser` 才读 | 通过（单测） |
| TC-053-07 | 服务实例来源 | 由注入回调登记，不从根 ctx 读 | 通过（单测） |
| TC-053-08 | 官方框判据 | 不把 `role` 当硬性前提 | 通过（单测） |
| TC-053-09 | 排除自身 | 含 `.dsh-fnos-account-login` 的节点不被收 | 通过（单测） |
| TC-053-10 | 粘贴解析：整条地址 | 取出 code/state | 通过（单测） |
| TC-053-11 | 粘贴解析：裸查询串与只有参数 | 同上 | 通过（单测） |
| TC-053-12 | 粘贴解析：缺项 | 判为无效 | 通过（单测） |
| TC-053-13 | 官方框收起 | `#root` 之后只剩插件对话框 | **真机通过** |
| TC-053-14 | 点官方「登录」 | 授权页在新标签页打开 | **真机通过** |
| TC-053-15 | 宿主状态推进 | `/account/login-state` 返回 200 + `waiting-browser` + 真实地址 | **真机通过** |
| TC-053-16 | 切到粘贴态 | 输入框出现、标题变为「填写授权地址」 | **真机通过** |
| TC-053-17 | 粘贴换码闭环 | 宿主变为已登录 | **未执行**（需平台账号授权） |

## 缺陷记录

| 编号 | 现象 | 根因 | 处置 |
| --- | --- | --- | --- |
| BUG-053-01 | 官方框没被收起，与插件对话框并存 | 判据要求 `role="presentation"`，真机上该容器 `role` 为 null | 改为认 `#root` 之后的 `[role="dialog"]` + 标题文案 |
| BUG-053-02 | `/account/login-state` 一律空 body 400 | 从**根 ctx** 读 `ctx.deepseekAccount`；该属性只在 `inject` 子上下文存在，永远 undefined 后读 `getState` 抛错 | 改为在注入回调里登记到模块级引用 |
| BUG-053-03 | 粘贴框占位符显示 3080 | 写死端口，与 `webServer.port` 可能不一致 | 改为 `<端口>` 占位 |

### 为什么 BUG-053-02 难查

DSH webserver 在路由 handler 抛错时返回的是**空 body 的 400**，不带任何错误信息。第一反应会以为路由没注册或同源校验拒绝，实际是 handler 内部抛错被吞掉。

## 遗留项

| 项 | 说明 |
| --- | --- |
| TC-053-17 | 换码闭环需真实账号，超出自动化能力。链路已验到 `waiting-browser` 与真实授权地址 |
| 官方改版 | 拦截依赖官方对话框标题文案（覆盖九种语言）。官方改名后需同步 `OFFICIAL_TITLES` |
| `onboarding` 标志 | 未接管；点「添加 API Key」后官方引导行为恢复原状，属预期 |
