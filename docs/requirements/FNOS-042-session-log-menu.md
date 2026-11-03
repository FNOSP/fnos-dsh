---
id: FNOS-042
title: FNOS-042 Session 日志菜单对齐官方默认结构
description: 会话头部菜单改为官方默认形态——「下载 Session 日志」为父项、导出到电脑/NAS 作为其子菜单，并新增指向本仓库的「反馈」入口；图标复用官方图标集。
status: in-progress
owner: tnnevol
targetVersion: 7.0.13
lastVerified: 2026-10-30
---

# FNOS-042 Session 日志菜单对齐官方默认结构

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-042 |
| 提出日期 | 2026-10-30 |
| 需求状态 | 实施中（包级用例与产物构建通过；真实 NAS 验收待执行） |
| 关联计划 | [PLAN-FNOS-042 Session 日志菜单对齐官方默认结构](/plans/PLAN-FNOS-042-session-log-menu) |
| 适用范围 | `@tnnevol/dsh-fnos` 的会话头部菜单（`src/components/FnosSessionLogHeaderAction.tsx`） |

## 需求背景

本插件在会话头部放了「下载 Session 日志」入口，但菜单形态与 DSH 官方默认不一致：官方是「下载 Session 日志 / 反馈」两项，而插件把「导出到电脑」「导出到 NAS」平铺成两个同级项，既看不出层级，也没有反馈入口。

提出人要求：**改回官方默认样式**——第一项仍是「下载 Session 日志」，把「导出到电脑 / 导出到 NAS」作为它的子项；第二项是「反馈」，指向本仓库 <https://github.com/FNOSP/fnos-dsh>；图标尽量复用官方图标集。

## 调研结论

| 结论 | 出处 | 影响的功能 | 状态 |
| --- | --- | --- | --- |
| 官方菜单原语 `MenuItem` 原生支持 `submenu: readonly MenuItem[]`，注释明确「Nested card opened to the right on hover/focus」 | `@deepseek-ai/dsh-client-ui-primitives` 0.2.1-rc.5 `lib/types/Menu.d.ts`（2026-10-30） | FNOS-042-01 | 已核实 |
| 子项被选中时原语调用 `onSelect?.(sub.id)`，父项（只展开子菜单的行）不触发 `onSelect` | 同包 `lib/index.js` 的菜单实现（2026-10-30） | FNOS-042-01 | 已核实 |
| 官方图标集内有下载与纸飞机（`IconDownloadOutlineRegular`、`IconPaperPlaneOutlineRegular`），插件此前已用下载与文件夹图标 | 同包 `lib/types/icons/index.d.ts`（2026-10-30） | FNOS-042-02 | 已核实 |
| 插件已按官方约定用 `Menu` 渲染该菜单（非自绘），因此结构改动只需改 `items` 数据 | `src/components/FnosSessionLogHeaderAction.tsx`（2026-10-30） | FNOS-042-01 | 已核实 |

## 需求目标

- 菜单顶层只有两项：`下载 Session 日志`（带子菜单）与 `反馈`。
- 子菜单两项：`导出到电脑`、`导出到 NAS`，沿用原有导出行为。
- `反馈` 打开本仓库地址；图标复用官方图标集，不自绘 SVG。
- 导出行为、NAS 目录选择弹框与下载状态提示均不变。

## 功能列表

| 编号 | 优先级 | 功能 | 用户可观察结果 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-042-01 | P1 | 下载日志改为父项 + 子菜单 | 打开菜单看到「下载 Session 日志」，悬停/聚焦展开子菜单，内含「导出到电脑」「导出到 NAS」 | <Badge type="warn" text="待验证" /> |
| FNOS-042-02 | P1 | 新增反馈入口 | 菜单第二项「反馈」，点击在新窗口打开 <https://github.com/FNOSP/fnos-dsh> | <Badge type="warn" text="待验证" /> |
| FNOS-042-03 | P2 | 图标复用官方图标集 | 三项图标与官方一致（下载、文件夹、纸飞机），不出现自绘图形 | <Badge type="warn" text="待验证" /> |

## 行为约束

- 导出的两条路径行为不变：`导出到电脑` 仍走 DSH 官方下载，`导出到 NAS` 仍弹目录选择框。
- 菜单关闭时机不变：选中任一项即关闭菜单。
- 反馈链接以新窗口打开，并带 `noopener,noreferrer`；不把 DSH 页面作为 referrer 传给外站。
- 不自绘 SVG 图标，统一用官方图标集。

## 不在本次范围内

- 反馈入口的埋点、模板或 issue 预填内容。
- 下载状态提示（弹框内文案、进度）的调整。
- 菜单在窄屏下的响应式排布。

## 既有功能变更关系

覆盖 [FNOS-007](/requirements/FNOS-007-dsh-017-rc2-adaptation) 引入的会话日志菜单形态（平铺两项），导出能力本身来自 [FNOS-001](/requirements/FNOS-001-dsh-fnos-adaptation) 的会话日志导出；本次只改层级与新增反馈项。

## 验收条件与完成状态

### FNOS-042-01

- `FNOS-042-01-AC-01`：菜单顶层只有「下载 Session 日志」「反馈」两项。
- `FNOS-042-01-AC-02`：子菜单含「导出到电脑」「导出到 NAS」，选择后行为与改造前一致。
- `FNOS-042-01-AC-03`：键盘可进入子菜单并选择子项（原语能力，回归时确认）。

### FNOS-042-02

- `FNOS-042-02-AC-01`：点击「反馈」在新窗口打开本仓库地址。
- `FNOS-042-02-AC-02`：链接带 `noopener,noreferrer`。

### FNOS-042-03

- `FNOS-042-03-AC-01`：三项图标均来自 `@deepseek-ai/dsh-client-ui-primitives` 图标集，源码中没有自绘 `<svg>`。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 初始登记 | 建立 FNOS-042。提出人给出官方默认菜单截图，要求把「导出到电脑 / 导出到 NAS」收进「下载 Session 日志」子菜单，并新增指向本仓库的「反馈」。调研确认 `MenuItem.submenu` 是原语原生能力、子项走 `onSelect?.(sub.id)`，图标集内有纸飞机。4 条调研结论，关联 PLAN-FNOS-042。 |
| 2026-10-30 | 二级菜单固定向左展开 | 提出人真机截图显示子菜单向右展开后被窗口右缘裁掉。核查官方 `Menu` 只有 `align`（start/end）与 `side`（bottom/top/right）两个方向 props，**没有子菜单边界判定或方向控制**；子菜单卡片固定在 `.submenu { left: calc(100% + 10px) }`。按提出人要求「没有 props 就固定到左侧」处理：用官方留给 portaled 列表的唯一样式钩子 `listClassName` 给本菜单挂 `dsh-fnos-session-log-menu`，在该作用域内把 `.submenu` 翻到 `right: calc(100% + 10px)`，指针命中桥 `.submenu::before` 同步翻到 `right: -10px`，避免悬停时子菜单闪退。覆盖不带本菜单前缀，不影响 DSH 其它菜单。<code>targetVersion</code> 更新为 7.0.12。 |
| 2026-11-03 | 修正向左规则未生效（哈希类名） | 提出人反馈子菜单仍在右侧、溢出可视区。真机核查样式表：子菜单的真实选择器是 `._submenu_4ub78_8`——CSS Modules **把类名哈希掉了**，上一版写的 `.dsh-fnos-session-log-menu .submenu` 从头到尾没匹配到任何元素（规则确实注入了，只是打空），因此规则语法上存在、行为上从未生效。改为 `.dsh-fnos-session-log-menu [class*='submenu']`：属性包含匹配哈希后的类名，权重 (0,2,0) 高于原规则的单类选择器，且不绑定具体哈希值；`::before` 命中桥同规则翻转。真机注入产物 CSS + 真实哈希类名复刻验证：`left: auto` → 计算值 `left: -173px` / `right: 210px`，子菜单左边缘落在父菜单左边界之外（`isOnLeft: true`），命中桥 `right: -10px`。同时把守卫用例改为「反例守卫」：一旦有人写回 `.dsh-fnos-session-log-menu .submenu {` 或裸 `.submenu {`，用例直接变红。<code>targetVersion</code> 更新为 7.0.13。 |
