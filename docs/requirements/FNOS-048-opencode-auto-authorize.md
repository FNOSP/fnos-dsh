---
id: FNOS-048
title: FNOS-048 OpenCode 登录授权页自动打开
description: 把 OpenCode 设备码登录从「点击展开验证链接、再点一次打开」改为「点登录即自动打开授权页」，并在授权页无法自动打开时提供复制授权地址的兜底。
status: in-review
owner: tnnevol
targetVersion: 8.1.2
lastVerified: 2026-11-06
---

# FNOS-048 OpenCode 登录授权页自动打开

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-048 |
| 提出日期 | 2026-11-06 |
| 需求状态 | 待验收 |
| 关联计划 | [PLAN-FNOS-048 OpenCode 登录授权页自动打开](/plans/PLAN-FNOS-048-opencode-auto-authorize) |
| 适用范围 | `plugins/dsh-opencode-plugin` 的账号卡片与客户端开窗编排 |
| 明确排除 | 上游 Console 的设备码协议；OAuth 回调与凭据存储（沿用 FNOS-026 既有实现） |

## 需求背景

登录 OpenCode 需要用户在浏览器里打开授权页并输入一次性验证码。当前实现是「点登录 → 卡片里出现一个验证链接 → 用户再点一次打开」，多一步操作，且链接在小屏或窄侧栏里容易被忽略，用户会停在等待授权的卡片前不知道下一步做什么。

设备码授权本身是异步的：点登录后插件才向 Console 请求设备码，拿到结果才知道授权地址。浏览器有「非用户手势触发的 `window.open` 会被拦截」的限制，因此不能简单地「拿到地址后再开窗」。

## 需求目标

| 编号 | 功能 | 用户可观察结果 |
| --- | --- | --- |
| FNOS-048-01 | 自动打开授权页 | 点「登录 OpenCode」后授权页自动在浏览器中打开，无需再点第二次 |
| FNOS-048-02 | 授权页自动预填验证码 | 打开的授权页已带入一次性代码，用户只需确认授权 |
| FNOS-048-03 | 去掉多余入口 | 卡片内不再出现「打开验证页面」链接，改为「复制授权地址」按钮 |
| FNOS-048-04 | 复制失败可兜底 | 剪贴板不可用时把授权地址原文显示出来，供用户手动选中复制 |

### FNOS-048-01 自动打开授权页

点登录后自动打开授权页。浏览器与 DSH Desktop 两条路径都要生效：浏览器在用户手势内先开占位页、拿到地址后导航；Desktop 由 Electron 壳在原生层交给系统浏览器打开，不受手势限制。

任何一步拿不到窗口句柄都**不视为失败**：Desktop 壳接管时 `window.open` 恒返回 `null` 而页面已打开，把 `null` 当拦截会让 Desktop 登录直接中断。

### FNOS-048-02 授权页自动预填验证码

授权的地址取自上游的 `verification_uri_complete`（带 `user_code` 查询参数），用户打开后无需手抄验证码。

### FNOS-048-03 去掉多余入口

原来「打开验证页面」的链接移除，同一位置改为「复制授权地址」按钮，复制成功后按钮文案短暂变为「已复制」。

### FNOS-048-04 复制失败可兜底

复制走 `navigator.clipboard`，在非安全上下文或受限 iframe 中回落到 `execCommand`。两者都失败时把授权地址原文渲染出来（可选中、长地址换行不溢出），并给出对应的失败提示 —— 只报「复制失败」而不给出地址等于把人堵死。

## 验收条件

| 编号 | 验收条件 | 判定方式 |
| --- | --- | --- |
| [AC-01](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-01-自动打开授权页) | 浏览器路径：手势内开占位页并导航；Desktop 路径：占位页被 deny 后直接开真实地址；两条路都不把 `null` 当失败 | `tests/client/authorization-window.spec.ts` |
| [AC-02](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-02-授权页自动预填验证码) | 打开的是 `verification_uri_complete` | `tests/host/console-client.spec.ts` |
| [AC-03](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-03-去掉多余入口) | 组件不再引用「打开验证页面」文案键，改为复制按钮 | 源码级断言 |
| [AC-04](/requirements/FNOS-048-opencode-auto-authorize#fnos-048-04-复制失败可兜底) | 复制失败分支渲染地址原文与提示 | 源码级断言 |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-06 | 建立需求并实现：登录自动打开授权页、去掉验证链接、新增复制授权地址与失败兜底 |
