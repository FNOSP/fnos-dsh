---
id: PLAN-FNOS-053
title: PLAN-FNOS-053 拦截官方账号登录，改为粘贴回调地址完成授权
description: 把账号登录的回调改道到本机 loopback、由用户在对话框粘贴回调地址、服务端完成换码的实施计划。
status: in-review
owner: tnnevol
planDate: 2026-11-13
targetVersion: 8.1.101
lastVerified: 2026-11-13
---

# PLAN-FNOS-053 拦截官方账号登录，改为粘贴回调地址完成授权

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-053 |
| 计划日期 | 2026-11-13 |
| 对应需求 | [FNOS-053 拦截官方账号登录，改为粘贴回调地址完成授权](/requirements/FNOS-053-account-login-callback-relay) |
| 计划状态 | 待验收 |

## 计划目标

按 [FNOS-053](/requirements/FNOS-053-account-login-callback-relay)，在**不改上游代码、不改平台白名单**的前提下，让经 fnOS 网关访问的用户能完成 DSH 账号登录。

技术边界：只改 `plugins/dsh-fnos-plugin`；不修改 DSH 官方账号服务的内部实现，只在宿主侧替换 `startSignIn` 的实例方法并新增路由。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 影响 |
| --- | --- | --- | --- |
| callbackOrigin | 直接用 `window.location.origin`（网关地址，平台必拒） | 非 loopback 时改写为 `http://127.0.0.1:<webServer.port>` | 登录能进入 `waiting-browser` |
| 授权码交付 | 平台 302 回浏览器，用户电脑上打不开 | 用户粘贴地址回插件，服务端请求本机 `/oauth/callback` | 换码在 NAS 侧完成 |
| 官方登录框 | 原样渲染，用户点下去无反应 | DOM 监听 + 点关闭按钮收起，由插件对话框接管 | 用户看到可操作的界面 |
| 登录入口 | 两个渲染点（引导 / 侧栏），条件互相牵制 | 不覆盖座位，DOM 层统一拦截 | 一个入口维护，官方排版不变 |

## 关键约束

- **端口必须取运行时值**：写死会让 `--port` 改过之后回调落到没人监听的地址。
- **判据不能依赖 `role`**：官方弹框外层容器 `role` 为 null，`presentation` 只出现在某些变体；首版因此在真机上完全不生效。
- **中继不接受调用方给 URL**：目标固定为本机回调路由，否则是 SSRF 入口。
- **不覆盖 `settings.launcher` / `settings.models.sign-in`**：会连带丢失官方 `onboarding` 标志，侧栏那份弹框反而冒出来，还要复刻官方菜单。
- **`startSignIn` 返回时 `authorizeUrl` 尚未生成**：要轮询到 `phase === 'waiting-browser'` 再取。

## 实施任务

| 序 | 任务 | 产出 |
| --- | --- | --- |
| 1 | 定义宿主/客户端共用的路由与载荷契约 | `contracts/account-login-contract.ts` |
| 2 | 宿主：改写 `startSignIn` 的 callbackOrigin | `host/account-login-relay.ts` |
| 3 | 宿主：中继路由（code/state → 本机 `/oauth/callback`） | 同上 |
| 4 | 宿主：发起 / 状态 / 取消三个路由 | 同上 |
| 5 | 客户端：DOM 监听收起官方框 | `components/FnosAccountLoginDialog.tsx` |
| 6 | 客户端：粘贴对话框（三态） | 同上 |
| 7 | 客户端：挂到 `shell.overlay` | `components/FnosAccountLoginOverlay.tsx` |
| 8 | 纯函数抽出，便于单测 | `client/account-login-callback.ts` |
| 9 | 九语言文案 | `client/locales*.ts` |
| 10 | 真机验证 | 见下方验收 |

## 真机验证记录（2026-11-13，8.1.101）

| 项 | 结果 |
| --- | --- |
| 点官方「更多」→「登录」 | 官方框被收起，`#root` 之后只剩插件对话框 |
| `/account/login-state` | 200，返回 `phase: waiting-browser` + 真实 `authorizeUrl` |
| 点插件「登录」 | 授权页在新标签页打开（真实 `authorize_id`） |
| 切到粘贴态 | 输入框出现，标题「填写授权地址」 |
| 中继换码闭环 | **未验证**（需平台账号授权） |

### 真机暴露并修掉的三处缺陷

| # | 缺陷 | 根因 |
| --- | --- | --- |
| 1 | 官方框没被收起 | 判据依赖 `role="presentation"`，真机上该属性为 null |
| 2 | `/account/login-state` 一律空 body 400 | 从**根 ctx** 读 `ctx.deepseekAccount`，该属性只在 `inject` 子上下文存在 |
| 3 | 占位符写死 3080 | 实际端口取自 `webServer.port` |

## 测试

`plugins/dsh-fnos-plugin/tests/client/account-login.spec.ts`，16 条，覆盖：

- 只改写非 loopback、端口不写死、中继目标固定在服务端；
- `authorizeUrl` 要等状态推进、服务实例由注入回调登记；
- 判据不依赖 `role`、不把自己收掉、点关闭按钮而非 remove；
- 粘贴解析三种形态（整条地址 / 裸查询串 / 只有参数）；
- 先同步开窗再导航、关闭时取消宿主尝试。

## 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 官方改版 | 拦截依赖官方对话框标题文案（覆盖九种语言） | 官方改名后同步 `OFFICIAL_TITLES` |
| `onboarding` 未接管 | 点「添加 API Key」后官方引导行为恢复原状 | 预期内，那条路仍由官方处理 |
| 换码闭环未验 | 需真实账号 | 链路已验到 `waiting-browser`，留给用户验收 |
