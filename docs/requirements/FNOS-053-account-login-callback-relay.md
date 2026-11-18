---
id: FNOS-053
title: FNOS-053 拦截官方账号登录，改为粘贴回调地址完成授权
description: 经 fnOS 网关远程访问时官方账号登录必然失败（只接受 loopback 回调）。改为把回调改道到本机 loopback、由用户把回调地址粘回插件对话框、服务端完成换码。
status: 部分通过
owner: tnnevol
targetVersion: 8.1.140
lastVerified: 2026-11-13
verifiedAt: 2026-11-13
---

# FNOS-053 拦截官方账号登录，改为粘贴回调地址完成授权

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-053 |
| 提出日期 | 2026-11-13 |
| 需求状态 | 部分通过 |
| 关联计划 | [PLAN-FNOS-053 账号登录回调中转](/plans/PLAN-FNOS-053-account-login-callback-relay) |
| 适用范围 | `plugins/dsh-fnos-plugin`（账号登录对话框与 loopback 回调中转）、相关文案 |
| 明确排除 | 修改官方账号服务的回调策略；保存用户凭据 |

## 需求背景

经 fnOS 网关远程访问 DSH 时，**官方账号登录必然失败**：DSH 的账号服务与平台都只接受 loopback 回调，而 iframe 里的 `window.location.origin` 是网关地址（如 `http://192.168.0.17:5666`）。校验在发出任何请求之前就抛错——用户看到「点了没反应」，没有任何可诊断信息。

这条白名单在**两层**都写死：

| 层 | 位置 | 能否改 |
| --- | --- | --- |
| ① DSH 宿主 | `deepseekAccount.startSignIn` 的 `loginOrigin()` 校验 | 可被插件替换 |
| ② 平台服务端 | `auth_init` 的 `redirect_uri` schema | **改不到** |

2026-10-20 在真实 NAS 上做过决定性实验，直接打 `auth_init`、只换 `redirect_uri`：

| redirect_uri | 结果 |
| --- | --- |
| `http://127.0.0.1:<任意端口>/<任意路径>`、`localhost`、`[::1]` | `code:0` 通过 |
| `http://192.168.0.17:5666/...` | `50005 PAYLOAD_SCHEMA_MISMATCH` |
| `https://127.0.0.1:3080/...` | `50005` |
| `dsh://oauth/callback` | `50005` |

上游 `packages/credentials/deepseek-account-platform/README.md` 把它列进 **Known Limitations**：`non-loopback reverse proxies are unsupported`。所以反代、网关、`--trusted-host` 全都没用——主机名由浏览器地址栏决定。

**结论：不改白名单，改授权码的交付路径。**

## 功能拆解

| 编号 | 功能 | 要点 |
| --- | --- | --- |
| FNOS-053-01 | 回调 origin 改道 | 非 loopback 时替换为 `http://127.0.0.1:<webServer.port>`；本机访问原样透传 |
| FNOS-053-02 | 中继换码 | 收 `code`/`state`，服务端请求本机 `/oauth/callback` 完成 PKCE |
| FNOS-053-03 | 识别官方登录框 | `body` 直接子节点里按文案认出官方登录框，**不隐藏、不替换** |
| FNOS-053-04 | 粘贴对话框 | Semi Modal 挂 `body`；只有粘贴一态（说明 + 授权链接 + 输入框 + 「取消」/「授权」） |
| FNOS-053-05 | 关闭后不再重弹 | 记住关闭时那一屏官方弹框的节点，同一屏不再显示 |

## 判定规则

官方登录框与引导弹框的文案**撞车**，判定必须避开这一点：

| 出处 | 文案 |
| --- | --- |
| `ui-settings-account` 登录框**标题** | 开始使用 |
| `ui-settings-models` 引导弹框**描述结尾** | 配置 DeepSeek 官方模型，即可开始使用。 |

用「开始使用」当判据会把**引导弹框**一起认成登录框——用户第一次打开应用就被
塞一个粘贴回调地址的框。所以只认登录框独有的文案：

| 可用判据 | 出处 |
| --- | --- |
| 登录 DeepSeek 账号 | 登录框描述：「登录 DeepSeek 账号，或添加 API Key，即可开始使用。」 |
| 等待登录 | 「等待登录」态 |
| 登录 / Sign in | 短标题 |

查找范围是 `body` 的**直接子节点**（官方弹层由 portal 挂在这一层），用数组语义
遍历而不是链表 `while`。排除自己要看**后代**：本插件弹框的类名挂在 Semi 的
`.semi-modal-content` 上，而 `body` 直下是外层 `.semi-modal-wrap`，只比本节点
class 永远不命中。

## 完整链路

```
① 插件把 callbackOrigin 改写成 http://127.0.0.1:<DSH 实际端口>
② auth_init 通过 → 授权页正常打开 → 用户授权
③ 平台 302 到 127.0.0.1:<port>/oauth/callback?code=…&state=…
   ★ 这一跳落在用户自己的电脑上，浏览器显示「无法访问此网站」
   但地址栏里带着一个有效的 code
④ 用户把那条地址粘回插件界面
⑤ 插件在 NAS 服务端请求本机 /oauth/callback?code&state → PKCE 换码 → 登录成功
```

## 关键设计判断

### 为什么在 DOM 层拦截，而不是覆盖座位

官方的登录对话框有**两个独立渲染点**，条件还不一样：

| 渲染点 | 条件 | 文件 |
| --- | --- | --- |
| 初始引导 | 未登录就**无条件**渲染 | `AccountOnboarding.tsx` |
| 侧栏「更多」 | `loginVisible && !onboarding` | `AccountMenu.tsx` |

替换任何一个座位都会破坏另一个的前提：官方 `AccountOnboarding` 一旦不挂载，`onboarding` 恒为 false，侧栏那份反而会冒出来。而且还要复刻官方菜单的图标、快捷键提示与键盘导航。

DOM 层拦截的好处是**只有一个入口需要维护**，官方菜单与引导的排版保持原样。

### 为什么「点关闭按钮」而不是 remove 节点

直接 `remove()` 会让 React 的挂载状态与实际 DOM 脱节，后续状态更新可能把节点又插回来或者报错。点它自己的关闭按钮，让 React 正常卸载。

### 判据为什么不能依赖 `role`

首版按 `role="presentation"` 过滤，真机上**完全不生效**：官方弹框的外层容器是个普通 `div`，`role` 为 null；`presentation` 只出现在某些变体上。当时的现象很有欺骗性——授权页正常打开了，官方框却原样留在屏幕上。

改为认「`#root` 之后的节点里有 `[role="dialog"]` 且文案命中标题」。`#root` 之后的区域本就是弹层专属，不会误伤应用内容。

### 端口为什么不能写死

`webServer.port` 是运行时真实端口。写死 `3080` 会在 `--port` 改过之后让改写值与实际监听端口对不上，回调落到一个没人监听的地址上。

### 安全边界

中继只接受 `code`/`state` 两个具名参数，目标 URL 固定为本机回调路由，**不接受调用方给 URL**——那会变成 SSRF 入口（可以让 NAS 去请求任意内网地址）。所有路由都过同源校验。

## 实现位置

| 层 | 文件 |
| --- | --- |
| 契约 | `plugins/dsh-fnos-plugin/src/contracts/account-login-contract.ts` |
| 宿主 | `plugins/dsh-fnos-plugin/src/host/account-login-relay.ts` |
| 客户端 | `plugins/dsh-fnos-plugin/src/components/FnosAccountLoginDialog.tsx`、`FnosAccountLoginOverlay.tsx` |
| 纯函数 | `plugins/dsh-fnos-plugin/src/client/account-login-callback.ts` |

## 验收标准

| 编号 | 判据 | 状态 |
| --- | --- | --- |
| FNOS-053-A1 | 点官方「登录」后官方框被收起，`#root` 之后只剩插件的对话框 | 真机通过 |
| FNOS-053-A2 | 点插件「登录」后授权页在新标签页打开（真实 `authorizeUrl`） | 真机通过 |
| FNOS-053-A3 | 官方框进入「等待登录」态，粘贴框出现；官方框保持可见 | 真机通过 |
| FNOS-053-A4 | 粘贴地址后服务端完成换码，宿主变为已登录 | **未验证**（需平台账号授权） |
| FNOS-053-A5 | 本机访问时 callbackOrigin 原样透传，行为不变 | 单测覆盖 |

## 已知限制

- **换码闭环未在真机验证**：需要真实账号完成平台授权，超出自动化能力范围。链路已验到 `waiting-browser` + 真实授权地址。
- **官方改版风险**：拦截依赖官方对话框的标题文案（覆盖九种语言）。官方改名后需要同步 `OFFICIAL_TITLES`。
- **`onboarding` 标志未接管**：点插件对话框的「添加 API Key」会关闭对话框，此时官方引导的后续行为恢复原状——这是预期内的，因为那条路仍由官方处理。
