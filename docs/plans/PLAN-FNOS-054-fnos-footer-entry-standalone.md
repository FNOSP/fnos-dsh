---
id: PLAN-FNOS-054
title: PLAN-FNOS-054 侧栏底部飞牛 OS 入口与独立浏览器页面能力对齐
description: 把「飞牛 OS」入口迁到侧栏底部并改为下拉菜单，同时把「是否运行在 fnOS 里」的判据从「是不是 iframe」换成读 SDK 标志的实施计划。
status: 部分通过
owner: tnnevol
planDate: 2026-11-12
targetVersion: 8.1.140
lastVerified: 2026-11-12
---

# PLAN-FNOS-054 侧栏底部飞牛 OS 入口与独立浏览器页面能力对齐

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-054 |
| 计划日期 | 2026-11-12 |
| 对应需求 | [FNOS-054 侧栏底部飞牛 OS 入口与独立浏览器页面能力对齐](/requirements/FNOS-054-fnos-footer-entry-standalone) |
| 计划状态 | 部分通过 |

## 计划目标

按 [FNOS-054](/requirements/FNOS-054-fnos-footer-entry-standalone) 完成两件事：

1. **入口位置**：把「飞牛 OS」从侧栏「更多」菜单迁到侧栏底部，改为下拉菜单，包含设置 / 刷新 / 重启三个应用级动作。
2. **能力判据**：把 `isEmbeddedFnosFrame()`（`window.parent !== window`）换成读宿主桥注入的 SDK 标志——前者只答得出「是不是 iframe」，答不出「是不是 fnOS」，于是独立浏览器页面被误判为「本地开发」，入口消失。

技术边界：只改 `plugins/dsh-fnos-plugin` 的入口挂载与判据；不改宿主注入桥本身，不改 fnOS 网关的转发规则。

## 编号说明

本文档原误用 `FNOS-052`，与先创建的 [PLAN-FNOS-052 应用入口与网关反代](/plans/PLAN-FNOS-052-gateway-auto-proxy) 重号。按「先到先得」保留 `gateway-auto-proxy` 的 052，本文档改为 `FNOS-054`；`FNOS-053` 已被账号登录回调中转占用。

## 实施要点

| 项 | 做法 | 理由 |
| --- | --- | --- |
| 入口挂载 | `sidebar.footer.action` 插槽，宽度与折叠态对齐官方设置行 | 与官方底部动作同一视觉体系，不额外发明尺寸 |
| 判据 | 读 SDK 标志，`isWeb=false` 时也保留入口 | iframe 与否同「是不是 fnOS」无关 |
| 菜单内容 | 设置 / 刷新 / 重启 | 都是应用级动作，收进一个下拉，避免占三个常驻位 |
| 未接到宿主时 | 保留入口但禁用依赖桥的项 | 入口消失比「点了没反应」更难排查 |

## 验证

- 内嵌 fnOS 页面：底部出现「飞牛 OS」入口，下拉三项可用。
- 独立浏览器打开 `:5666/app/fn-deepseek-harness/`：入口仍在，授权与文件打开给出可读提示而不是消失。
- 桌面浏览器直接打开：不出现只对 fnOS 有意义的入口。

## 遗留

真实 NAS 的独立浏览器页面回显待真机补验；见 [测试用例](/tests/FNOS-054-fnos-footer-entry-standalone)的执行结果表。
