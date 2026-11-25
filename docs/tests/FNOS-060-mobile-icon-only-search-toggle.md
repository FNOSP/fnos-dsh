---
id: FNOS-060
title: FNOS-060 测试用例
description: FNOS-060 移动端「智能搜索」按钮图标态的呈现推导、几何样式、可访问名称与桌面端不变性的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-060-mobile-icon-only-search-toggle
plan: /plans/PLAN-FNOS-060-mobile-icon-only-search-toggle
status: 部分通过
lastVerified: 2026-11-25
verifiedAt: 2026-11-25
---

# FNOS-060 测试用例

## 测试范围与需求分析

被测对象是消息框左下角「智能搜索」开关的**呈现层**：移动端是否收起可见文案、几何是否收成 28×28、可访问名称是否不降级、桌面端是否保持不变。开关状态读写与端点不在本次改动范围内，按回归处理。执行任务见 [PLAN-FNOS-060](/plans/PLAN-FNOS-060-mobile-icon-only-search-toggle)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-060-01](/requirements/FNOS-060-mobile-icon-only-search-toggle#fnos-060-01-移动端图标态) | 移动端文案收起、图标态几何、判定口径 | 判定用了视口宽度导致桌面窄窗口也收起；或几何覆盖了高度/配色 |
| [FNOS-060-02](/requirements/FNOS-060-mobile-icon-only-search-toggle#fnos-060-02-名称与状态不降级) | 可访问名称、`aria-pressed`、键盘可达 | 文案不渲染后名称变空，读屏只剩「按钮」 |
| [FNOS-060-03](/requirements/FNOS-060-mobile-icon-only-search-toggle#fnos-060-03-桌面端形态不变) | 桌面端类名、文案与配色 | 条件渲染写反或误伤桌面分支 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-060-01 ~ 03 | 包级（Node / vitest） | 纯函数行为断言 + 源码/样式契约断言：`tests/client/toggle-control.spec.ts` |
| FNOS-060-01 ~ 03 | 类型与构建 | `tsc -p tsconfig.json`、`tsdown` 产物（`lib/client.js`、`lib/style.css`） |
| FNOS-060-01、03 | 浏览器（真实主题令牌 + 构建产物样式） | 静态预览页量取计算几何（桌面 86×28 带文案 / 移动端 28×28 无文案） |
| FNOS-060-01、02 | 移动端运行时 | 手机视口或真机目视 + 点击切换（**未执行**，需装带本次改动的新版本） |
| FNOS-060-03 | 桌面端运行时 | 桌面端会话目视文案仍在（**未执行**，同上） |

## 测试用例

### [FNOS-060-01 移动端图标态](/requirements/FNOS-060-mobile-icon-only-search-toggle#fnos-060-01-移动端图标态)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-060-01 | FNOS-060-01 | 移动设备上不渲染可见文案 | AC-01 | 纯函数 | 1.`togglePresentation({ enabled: true, mobile: true })` | `showLabel === false` | P0 | 提出人要求「只显示 icon」 |
| TC-060-02 | FNOS-060-01 | 关闭态同样收起文案 | AC-01 | 纯函数 | 1.`togglePresentation({ enabled: false, mobile: true })` | `showLabel === false`（判据与开关状态无关） | P1 | 状态不应改变形态 |
| TC-060-03 | FNOS-060-01 | 图标态使用独立修饰类 | AC-01 | 纯函数 | 1.取 `className` | 含 `dsh-failover-pill--iconOnly`，桌面结果不含 | P0 | 修饰类承载几何 |
| TC-060-04 | FNOS-060-01 | 判定取自宿主移动设备检测，而非视口宽度 | AC-01 | 源码 | 1.断言组件引用 `isMobileDevice` 与 `togglePresentation` 2.断言样式表无 pill 的媒体/容器查询 | 组件按设备判定；样式表没有按视口翻转的规则 | P0 | 与官方控件同口径 |
| TC-060-05 | FNOS-060-01 | 图标态 28×28、内距 0、图标居中、高度不由图标态覆盖 | AC-01 | 样式源码 + 构建产物 | 1.正则取 `--iconOnly` 规则块 2.断言 `width: 28px`、`padding: 0`、`justify-content: center`、无 `height` 3.构建产物 `lib/style.css` 含该规则 | 几何符合，高度仍由基础类提供 28px | P0 | 命中区不得缩小 |
| TC-060-06 | FNOS-060-01 | 浏览器实测图标态几何与配色 | AC-01 | 构建产物 + 主题令牌 | 1.渲染桌面态与图标态按钮 2.量取计算样式 | 桌面 86×28 带文案；图标态 28×28、内距 0、图标 14×14；激活态浅蓝底蓝图标、普通态透明底灰图标 | P0 | 视觉基准：官方 chip |
| TC-060-07 | FNOS-060-01 | 移动端运行时目视 | AC-01、AC-02 | 装带改动的新版本 | 1.手机打开 DSH Web 2.看消息框左下角 3.点击切换 | 只出现地球图标、点击切换生效、配色随状态变化 | P0 | **本轮未执行** |

### [FNOS-060-02 名称与状态不降级](/requirements/FNOS-060-mobile-icon-only-search-toggle#fnos-060-02-名称与状态不降级)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-060-08 | FNOS-060-02 | 可访问名称仍含「智能搜索」与状态 | AC-02 | 纯函数 | 1.取开关/关闭两态名称 | 都含「智能搜索」，两态名称不同 | P0 | 读屏不依赖可见文案 |
| TC-060-09 | FNOS-060-02 | 名称接线与状态表达不变 | AC-02 | 源码 | 1.断言 `aria-label={toggleAccessibleName(enabled)}` 2.断言 `aria-pressed={enabled}` 与 `type="button"` | 名称与状态都在 | P0 | 键盘与读屏可达 |

### [FNOS-060-03 桌面端形态不变](/requirements/FNOS-060-mobile-icon-only-search-toggle#fnos-060-03-桌面端形态不变)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-060-10 | FNOS-060-03 | 桌面端保留文案且无图标态类 | AC-03 | 纯函数 | 1.`togglePresentation({ enabled: true/false, mobile: false })` | `showLabel === true`，类名不含 `--iconOnly` | P0 | 桌面形态不变 |
| TC-060-11 | FNOS-060-03 | 激活态/普通态类名规则不变 | AC-03 | 纯函数 | 1.比开启与关闭两态的 `className` | 开启含 `dsh-failover-pill--active`，关闭不含；两者都含基础类 | P0 | FNOS-012-06 既有约定 |
| TC-060-12 | FNOS-060-03 | 桌面端运行时目视 | AC-03 | 装带改动的新版本 | 1.桌面端打开会话 2.看消息框左下角 | 仍是「地球图标 + 智能搜索」 | P1 | **本轮未执行** |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-060-01 ~ TC-060-05、TC-060-08 ~ TC-060-11 | 通过 | `tests/client/toggle-control.spec.ts`（15 条，其中 FNOS-060 新增 4 条 + 既有断言改为纯函数断言 1 条）；插件全量 22 文件 / 237 条通过 |
| TC-060-06 | 通过 | 静态预览页（真实主题令牌 + 构建产物 `lib/style.css`）：桌面态 `86×28`、含文案；图标态 `28×28`、内距 `0px`、`justify-content: center`、图标 `14×14`；激活态 `rgb(228, 237, 253)` 底 / `rgb(65, 118, 230)` 图标，普通态透明底 / `rgb(97, 102, 107)` |
| TC-060-07、TC-060-12 | 未执行 | 需装带本次改动的新版本后在移动端与桌面端各目视一次；插件从插件市场 / npm 安装，不随 FPK 内置 |

构建与静态检查：

- `tsc -p tsconfig.json`：通过。
- `eslint`（3 个改动文件）：0 error。
- `tsdown`：`lib/client.js` 含 `isMobileDevice` 与 `dsh-failover-pill--iconOnly`；`lib/style.css` 含 `.dsh-failover-pill--iconOnly{justify-content:center;width:28px;padding:0}`。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| — | 本轮无缺陷 | — | — |

既有用例的类名断言原先直接匹配组件源码里的字符串字面量；类名推导移到纯函数后，这些断言改为调用 `togglePresentation` 断言输出，覆盖面比字符串匹配更强（同时覆盖状态与设备两个维度）。

## 最终结论

包级与产物级验证通过：移动端不渲染文案、图标态几何 28×28、名称与状态不降级、桌面端呈现规则不变。运行时目视（移动端 1 条、桌面端 1 条）待装带本次改动的新版本后补测，因此结论记为**部分通过**。