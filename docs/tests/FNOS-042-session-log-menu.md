---
id: FNOS-042
title: FNOS-042 测试用例
description: FNOS-042 Session 日志菜单结构、反馈入口与图标复用的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-042-session-log-menu
plan: /plans/PLAN-FNOS-042-session-log-menu
status: 部分通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-042 测试用例

## 测试范围与需求分析

被测对象是会话头部菜单的结构与新增出口：层级是否与官方一致、反馈是否指向本仓库、图标是否复用官方图标集。执行任务见 [PLAN-FNOS-042](/plans/PLAN-FNOS-042-session-log-menu)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-042-01](/requirements/FNOS-042-session-log-menu#fnos-042-01) | 父项 + 子菜单结构、子项分支 | 子项 id 与处理分支不一致导致点了没反应 |
| [FNOS-042-02](/requirements/FNOS-042-session-log-menu#fnos-042-02) | 反馈地址与打开方式 | 地址写错、或 iframe 拦截弹窗 |
| [FNOS-042-03](/requirements/FNOS-042-session-log-menu#fnos-042-03) | 图标复用官方图标集 | 自绘图标导致视觉不一致 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-042-01 ~ 03 | 包级（Node / vitest） | `tests/client/session-log-menu.spec.ts` 源码契约断言 |
| FNOS-042-01 ~ 03 | 类型与构建 | `tsc -p tsconfig.json`、`tsdown` 产物 |
| FNOS-042-01、02 | 真实 fnOS NAS | 打开会话头部菜单、展开子菜单、点反馈（**未执行**） |

## 测试用例

### [FNOS-042-01 下载日志为父项 + 子菜单](/requirements/FNOS-042-session-log-menu#fnos-042-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-042-01 | 顶层只有 download 与 feedback | AC-01 | 源码 | 1.断言 `id: 'download'` 带 `submenu` 2.顶层 id 只有 feedback | 结构符合 | P0 | 官方默认形态 |
| TC-002 | FNOS-042-01 | 子项沿用原 id | AC-02 | 源码 | 1.断言子项含 computer/nas | 都存在 | P0 | 原处理分支按 id 分发 |
| TC-003 | FNOS-042-01 | 子项 id 都有处理分支 | AC-02 | 源码 | 1.断言三个分支 | 都在 | P0 | 漏分支会「点了没反应」 |
| TC-004 | FNOS-042-01 | 真机展开子菜单并导出 | AC-02、AC-03 | 已装 FPK | 1.点菜单 2.悬停「下载 Session 日志」3.选两种落点 | 子菜单展开，两种导出均生效 | P0 | 本轮未执行 |

### [FNOS-042-02 反馈入口](/requirements/FNOS-042-session-log-menu#fnos-042-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | FNOS-042-02 | 地址指向本仓库 | AC-01 | 源码 | 1.断言 `FEEDBACK_URL` | `https://github.com/FNOSP/fnos-dsh` | P0 | 提出人指定 |
| TC-006 | FNOS-042-02 | 新窗口 + noopener | AC-02 | 源码 | 1.断言 `window.open(...)` 参数 | `_blank` + `noopener,noreferrer` | P1 | 不泄漏 referrer |
| TC-007 | FNOS-042-02 | 真机点反馈 | AC-01 | 已装 FPK | 1.点「反馈」 | 新窗口打开本仓库 | P0 | 本轮未执行 |

### [FNOS-042-03 图标复用](/requirements/FNOS-042-session-log-menu#fnos-042-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | FNOS-042-03 | 用官方图标、无自绘 SVG | AC-01 | 源码 | 1.断言三个图标名 2.断言无 `<svg` | 全部来自官方图标集 | P1 | 视觉一致 |
| TC-009 | FNOS-042-03 | 中英文案键齐备 | — | 源码 | 1.断言两份文案 | 中英各一份 | P2 | zh 为映射类型，缺键会编译失败 |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 ~ TC-003、TC-005、TC-006、TC-008、TC-009 | 通过 | `tests/client/session-log-menu.spec.ts`（6 条）；全量 `vitest run` 44 文件 / 428 条通过 |
| TC-004、TC-007 | 未执行 | 需构建 FPK 后在真实 fnOS NAS 验证；子菜单方向已按「固定向左」实现并有源码断言 |
| 二级菜单方向 | 通过（源码） | `.dsh-fnos-session-log-menu .submenu` 与 `::before` 均翻到左侧，作用域限定在本菜单 |

构建与静态检查：

- `tsc -p tsconfig.json`：通过。
- `eslint`：0 error。
- `tsdown`：产物含新菜单代码（`FEEDBACK_URL` / `sessionLogDownload` 均出现在 `lib/client.js`）。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| BUG-042-02 | 真机：子菜单向右展开被窗口裁掉 | 官方 `Menu` 无子菜单方向 props，`.submenu` 固定 `left: calc(100% + 10px)` | 用 `listClassName` 作用域把 `.submenu` 及其 `::before` 命中桥翻到左侧；用例断言作用域前缀存在且无全局裸 `.submenu` 规则 |
| BUG-042-03 | 真机：子菜单依旧向右、溢出可视区 | 子菜单类名被 CSS Modules 哈希为 `_submenu_4ub78_8`，上一版 `.submenu` 选择器匹配不到任何元素（静默失效） | 改用 `[class*='submenu']` 属性选择器 + 作用域前缀；真机复刻复测 `isOnLeft: true`；守卫用例加反例断言防止写回死选择器 |

## 最终结论

包级契约已验证：菜单顶层只剩「下载 Session 日志」「反馈」，两种落点收进子菜单且沿用原 id 与分支，反馈地址与打开方式符合要求，图标全部来自官方图标集。

真机结论待补：TC-004、TC-007 需构建 FPK 后在真实 fnOS NAS 验证子菜单展开与反馈跳转（含 iframe 是否拦截弹窗）。
