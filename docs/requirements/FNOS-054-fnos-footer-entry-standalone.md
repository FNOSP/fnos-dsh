---
id: FNOS-054
title: FNOS-054 侧栏底部飞牛 OS 入口与独立浏览器页面能力对齐
description: 把「飞牛 OS」入口迁到侧栏底部并改为下拉菜单；修正「是否运行在 fnOS 里」的判据，让独立浏览器页面（standalone）也能正常回显入口与使用授权能力。
status: 部分通过
owner: tnnevol
targetVersion: 8.1.140
lastVerified: 2026-11-12
verifiedAt: 2026-11-12
---

# FNOS-054 侧栏底部飞牛 OS 入口与独立浏览器页面能力对齐

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-054 |
| 提出日期 | 2026-11-12 |
| 需求状态 | 部分通过 |
| 关联计划 | [PLAN-FNOS-054 侧栏底部飞牛 OS 入口](/plans/PLAN-FNOS-054-fnos-footer-entry-standalone) |
| 适用范围 | `plugins/dsh-fnos-plugin`（侧栏底部入口、`isWeb` 判据与授权能力）、相关文案 |
| 明确排除 | 网关反代的转发规则本身；宿主注入桥的实现 |

## 需求背景

两件互相关联的事，共同点是「入口与能力的归属判断都错了」：

**一、入口位置不对。** 「飞牛 OS」原先埋在侧栏「更多」菜单里（`sidebar.panellist.actions`）。那是「全局面板」分组，而飞牛 OS 不是一个面板——它是一组**应用级动作**（设置 / 刷新 / 重启）。用户要开个设置得先点「更多」再点「飞牛 OS」，两层菜单藏了一个常用入口。

**二、独立浏览器页面被当成「本地开发」。** 全插件用 `isEmbeddedFnosFrame()`（`window.parent !== window`）判断「是否运行在 fnOS 里」。这个判据只答得出「是不是 iframe」，答不出「是不是 fnOS」：

- 新标签页直接打开 `http://<nas>:5666/app/fn-deepseek-harness/` 时不是 iframe，但**同样是 fnOS 应用**，只是没有宿主注入的桥；
- 于是会话头部的日志/文件入口、设置里的「打开配置文件」、授权目录的 SDK 调用被整支跳过；
- 而且**没有任何报错**——这是最难查的失败形态。

## 功能拆解

| 编号 | 功能 | 要点 |
| --- | --- | --- |
| FNOS-054-01 | 入口迁到 `sidebar.footer.action` | 宽高与折叠态对齐官方设置行 |
| FNOS-054-02 | 入口改为下拉菜单 | 设置 / 刷新 / 重启三项，样式对齐「更多」菜单 |
| FNOS-054-03 | 移除旧的刷新/重启入口 | 「更多」菜单与会话头部菜单里都不再有 |
| FNOS-054-04 | 三种运行环境的识别 | `embedded` / `standalone` / `none` 三态可区分 |
| FNOS-054-05 | 独立浏览器页面回显入口 | 会话头部与设置入口按「属于 fnOS」注册，按「有无宿主桥」隐藏具体动作 |
| FNOS-054-06 | 独立浏览器页面授权走 `openAppAuth` | 授权页 + 回调页 + 原页面监听，链路完整 |

## 关键设计判断

### 环境判据为什么改用 `<base>`

应用网关（`packages/fnos-gateway`）会给每个 HTML 响应注入 `<base href="/app/fn-deepseek-harness/">`；本地 `dsh web` 没有这条标记。因此 `new URL(base).pathname.startsWith('/app/')` 能唯一区分「fnOS 托管」与「本地开发」，且**对 iframe 与独立浏览器页面都成立**。

三种环境与两种能力的关系：

| 环境 | 判定 | 属于 fnOS | 宿主桥 |
| --- | --- | --- | --- |
| `embedded` | base 命中 + iframe | 是 | 有 |
| `standalone` | base 命中 + 非 iframe | **是** | **无** |
| `none` | base 未命中 | 否 | 无 |

「属于 fnOS」决定**是否注册座位**，「有无宿主桥」决定**具体动作渲不渲染**——两者必须分开，混用就会出现本次这个故障。

### 授权回调页由网关提供

独立浏览器页面里授权必须走 `openAppAuth`：SDK 在系统授权页弹窗里让用户确认目录，完成后由系统 redirect 到 `redirectUri`。**回调页必须真实存在于同源下**，否则授权在最后一步断掉——用户确认了，原页面永远等不到结果。

回调页由网关内联返回（`/app/fn-deepseek-harness/fnos-auth-callback`），不往 DSH 静态目录塞文件：它要在授权跳转后独立加载，不需要拉起整个 DSH 应用。

### 明确不做的事

| 项 | 原因 |
| --- | --- |
| 独立浏览器页面「打开文件/文件管理器」用 URL 跳转 | 实测 `/app/trim.file-manager` 在真实浏览器里返回 `Not Found`；fnOS 的文件管理器是桌面 SPA 内部路由，**没有可外链的稳定地址**。这类动作明确报错并提示在 fnOS 应用内使用，不做经验性 URL 拼接 |
| 独立浏览器页面跟随 fnOS 主题/语言 | `$on` 在 standalone 抛 `bus is not available`，且 `getPlatformConfig()` 同样抛错。这是平台限制，退回浏览器自身 `prefers-color-scheme` 与 `navigator.language` |

## 验收标准

| 编号 | 验收条件 |
| --- | --- |
| AC-01 | 「飞牛 OS」出现在侧栏底部、设置行正上方，展开态与设置行同高（42px）、折叠态同为 36×36 |
| AC-02 | 点入口弹出下拉菜单，含「飞牛 OS 设置 / 刷新 / 重启」三项，可用键盘方向键与 Escape |
| AC-03 | 「更多」菜单里不再有飞牛 OS、刷新、重启任何一行；会话头部菜单里不再有刷新、重启 |
| AC-04 | 三种环境可区分：base 命中 + iframe = `embedded`，base 命中 + 非 iframe = `standalone`，base 未命中 = `none` |
| AC-05 | 独立浏览器页面下会话头部日志入口与设置「打开配置文件」位置按宿主桥可用性处理：无桥时明确不可用而不是静默消失 |
| AC-06 | 独立浏览器页面下添加授权目录走 `openAppAuth`，授权页打开后不误报「已授权」；回调到达后刷新列表 |
| AC-07 | 回调页同源、禁止缓存、校验 `state` 与 `event.origin` |

## 关联

- 测试用例：[FNOS-054](/tests/FNOS-054-fnos-footer-entry-standalone)
