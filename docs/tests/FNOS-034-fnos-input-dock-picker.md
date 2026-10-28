---
id: FNOS-034
title: FNOS-034 测试用例
description: FNOS-034 fnOS 授权目录选择器改为输入卡片宽浮层的测试用例与执行结果。
requirement: /requirements/FNOS-034-fnos-input-dock-picker
plan: /plans/PLAN-FNOS-034-fnos-input-dock-picker
status: 部分通过
lastVerified: 2026-10-28
verifiedAt: 2026-10-28
---

# FNOS-034 测试用例

## 测试范围与需求分析

被测对象是 fnOS 授权目录选择器的**承载形式**：从工具栏 28px 按钮上的 TreeSelect 下拉，改为 `conversation.input.overlay` 里贴齐输入卡片的浮层。选择语义（父子独立勾选、勾选即插入引用、取消即移除）必须原样保持。

执行任务见 [PLAN-FNOS-034](/plans/PLAN-FNOS-034-fnos-input-dock-picker)，覆盖[需求功能](/requirements/FNOS-034-fnos-input-dock-picker#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-034-01](/requirements/FNOS-034-fnos-input-dock-picker#fnos-034-01) 选择器改为输入卡片宽浮层 | 是否仍写死像素宽度；是否与指令面板共用锚点；高度是否越出视口 |
| [FNOS-034-02](/requirements/FNOS-034-fnos-input-dock-picker#fnos-034-02) 保持原有选择语义 | 父子勾选是否被折叠；取消勾选是否漏删引用；会话间是否串状态 |
| [FNOS-034-03](/requirements/FNOS-034-fnos-input-dock-picker#fnos-034-03) 浮层有明确收起出口 | 点外部/Esc/再点图标是否都能关；点卡片内部是否误关 |

## 测试环境

| 环境 | 用途 | 是否作为验收依据 |
| --- | --- | --- |
| 包级测试（vitest） | 几何规则、槽位注册形状、树数据搬运、开关 store | **是**（逻辑层） |
| 构建 | `pnpm --filter @tnnevol/dsh-fnos run build` 产出 `lib/client.js` | **是**（产物） |
| FPK + 真实 fnOS NAS | 浮层在真实输入卡片上的呈现、真实授权目录树的勾选与引用增删 | **是**（验收依据） |

::: warning 本地 DSH Web 不作为验收依据
`@tnnevol/dsh-fnos` 注册 fnOS 设置命名空间、fnOS JS SDK 桥和网关前缀路由，脱离 fnOS 宿主没有可提供的能力，因此按[本地 DSH Web](/development/local-dsh-web)的约定**不进本地 profile**。

本需求的验收一律以 **FPK 在真实 NAS 安装后**的表现为准。开发期间若需观察前端几何，只能作为实现自检，不能计入验收结论。
:::

包级：`pnpm --filter @tnnevol/dsh-fnos run check`（typecheck + vitest 270 条）。

FPK：`pnpm run build` 后在应用中心安装，按 TC-101 起的真机用例执行。

## 测试用例

### FNOS-034-01 选择器改为输入卡片宽浮层

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-001 | FNOS-034-01-AC-01 | 用真实 `SlotCore` 注册浮层条目，读 `conversation.input.overlay` 的条目列表 | 官方 `slash-menu`/`command-popup`/`feedback-dialog` 原样保留，新条目排在最后 | 包级 |
| TC-002 | FNOS-034-01-AC-01 | 重复注册同一 id 与 priority | 抛出 `already has an entry`，证明必须用自有 id | 包级 |
| TC-003 | FNOS-034-01-AC-02 | 断言样式源码 | 面板规则内没有 `px` 宽度、没有 `560px`、没有 `100vw` | 包级 |
| TC-004 | FNOS-034-01-AC-02 | 断言面板规则 `left: 0` / `right: 0` / `bottom: calc(100% + 4px)` | 与上游斜杠菜单同一套几何 | 包级 |
| TC-005 | FNOS-034-01-AC-03 | 断言面板使用 `useAnchoredMaxHeight` 且顶部留 84 | 高度按视口上方可用空间钳制，与斜杠菜单同值 | 包级 |
| TC-006 | FNOS-034-01-AC-03 | 读树区与标题栏样式 | 树区 `overflow: auto` 自己滚，标题栏 `flex: none` 固定 | 包级 |
| TC-101 | FNOS-034-01-AC-02 | 真实 NAS 打开选择器，量面板与输入框的 `getBoundingClientRect` | 左右偏差为 0，宽度相等 | 真实 NAS |
| TC-102 | FNOS-034-01-AC-02 | 真实 NAS 上把浏览器窗口拉窄，再量一次 | 面板跟随输入框收窄，左右仍齐边，无横向滚动 | 真实 NAS |

### FNOS-034-02 保持原有选择语义

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-007 | FNOS-034-02-AC-01 | `selectedPaths(['/vol1', '/vol1/media'])` | 两条都保留，不做父子折叠 | 包级 |
| TC-008 | FNOS-034-02-AC-01 | `selectedPaths` 传入非绝对路径、重复项、空值 | 只留绝对路径并去重；空值归一为空数组 | 包级 |
| TC-009 | FNOS-034-02-AC-01 | 懒加载子节点后 `updateChildren` 并回父节点 | 子节点挂上、父节点 `isLeaf` 置 false、兄弟节点引用不变 | 包级 |
| TC-010 | FNOS-034-02-AC-02 | 断言引用插入仍走 `slash/input-insert-reference` 与官方 chip 占位 | 插入路径未变，草稿投影与 CAS 跨度数学保持原样 | 包级 |
| TC-011 | FNOS-034-02-AC-03 | store 上展开 A 会话后读 B 会话 | A 为 true、B 为 false | 包级 |
| TC-012 | FNOS-034-02-AC-03 | toggle 交叉翻转两个会话；重复 set 同一状态 | 各自独立翻转；重复设置不重复通知 | 包级 |
| TC-013 | FNOS-034-02-AC-03 | `closeAll` 后读各会话；退订后再变更 | 全部关闭且只通知一次；退订后不再通知 | 包级 |
| TC-014 | FNOS-034-02-AC-01 | 读树节点 `key`/`value` | 用内部路径而非可读语义路径（Host 路由只认内部路径） | 包级 |
| TC-103 | FNOS-034-02-AC-01 | 真实 NAS 勾选父目录与子目录各一 | 两条都被勾选并各自插入引用 | 真实 NAS |
| TC-104 | FNOS-034-02-AC-01 | 真实 NAS 取消一个已勾选目录 | 对应引用从草稿中移除，其余引用不变 | 真实 NAS |
| TC-105 | FNOS-034-02-AC-02 | 真实 NAS 勾选后发送消息 | 模型收到 `@/path/` 形式的 NAS 路径 | 真实 NAS |

### FNOS-034-03 浮层有明确收起出口

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-015 | FNOS-034-03-AC-01 | 断言点卡片外的关闭逻辑与卡片内豁免 | 命中 `[data-composer-card]` 时不关闭，否则关闭 | 包级 |
| TC-016 | FNOS-034-03-AC-02 | 断言 `Escape` 的 keydown 处理 | 存在 Esc 关闭分支 | 包级 |
| TC-017 | FNOS-034-03-AC-03 | 断言按钮走同一个 store 的 `toggle` | 再点图标关闭，`aria-expanded` 同步 | 包级 |
| TC-018 | FNOS-034-03-AC-01/02 | 断言收起后两个全局监听器都被移除 | 无残留 `pointerdown`/`keydown` 监听 | 包级 |
| TC-106 | FNOS-034-03-AC-01 | 真实 NAS 打开面板后点页面空白处 | 面板收起 | 真实 NAS |
| TC-107 | FNOS-034-03-AC-01 | 真实 NAS 打开面板后点回输入框 | 面板**保持打开** | 真实 NAS |
| TC-108 | FNOS-034-03-AC-02 | 真实 NAS 打开面板后按 Esc | 面板收起 | 真实 NAS |
| TC-109 | FNOS-034-03-AC-03 | 真实 NAS 连点 fnOS 图标两次 | 先开、再关 | 真实 NAS |

## 测试执行结果

### 已执行（包级）

| ID | 结果 | 执行日期 | 证据/备注 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-10-28 | `tests/client/input-picker-panel.spec.ts`「浮层注册在 conversation.input.overlay，且排在官方条目之后」 |
| TC-002 | 通过 | 2026-10-28 | 同文件「使用自有 id，不替换指令面板与命令选择」 |
| TC-003 | 通过 | 2026-10-28 | `tests/client/input-picker-geometry.spec.ts`「不写任何固定像素宽度」 |
| TC-004 | 通过 | 2026-10-28 | 同文件「左右对齐锚点」「浮在输入卡片上沿之上」 |
| TC-005 | 通过 | 2026-10-28 | 同文件「面板用锚定的最大高度」「顶部留出会话头部的安全距离」 |
| TC-006 | 通过 | 2026-10-28 | 同文件「树区自己滚动，标题栏固定」 |
| TC-007 | 通过 | 2026-10-28 | `input-picker-panel.spec.ts`「保留父子同时勾选的路径」 |
| TC-008 | 通过 | 2026-10-28 | 同文件「丢弃非绝对路径并去重」「空值归一成空数组」 |
| TC-009 | 通过 | 2026-10-28 | 同文件两条 `updateChildren` 用例 |
| TC-010 | 通过 | 2026-10-28 | `tests/contracts/package-contract.spec.ts`「keeps fnOS file and folder references in the native input draft」 |
| TC-011 | 通过 | 2026-10-28 | `input-picker-panel.spec.ts`「展开一个会话不影响另一个会话」 |
| TC-012 | 通过 | 2026-10-28 | 同文件 toggle 交叉与「重复设置同一状态不触发通知」 |
| TC-013 | 通过 | 2026-10-28 | 同文件 `closeAll` 与退订两条 |
| TC-014 | 通过 | 2026-10-28 | 同文件「节点 key 与 value 都用内部路径」 |
| TC-015 | 通过 | 2026-10-28 | `input-picker-geometry.spec.ts`「点击输入卡片外部收起」 |
| TC-016 | 通过 | 2026-10-28 | 同文件「按 Esc 收起」 |
| TC-017 | 通过 | 2026-10-28 | 同文件「再点工具栏图标收起」 |
| TC-018 | 通过 | 2026-10-28 | 同文件「收起时监听器被移除」 |

包级总量：35 个测试文件 / 270 条全绿（`pnpm --filter @tnnevol/dsh-fnos run check`）；`run build` 产出 `lib/client.js` 2.13 MB。

### 待执行（真实 NAS）

| ID | 结果 | 阻塞原因 |
| --- | --- | --- |
| TC-101 ~ TC-109 | 未执行 | 需先构建 FPK 并在真实 NAS 走应用中心安装 |

## 未覆盖与后续验证

| 项 | 原因 | 后续动作 |
| --- | --- | --- |
| 浮层在真实输入卡片上的宽度对齐 | 包级只能断言样式规则，无法测出运行时的 `--dsh-composer-card-max-width` | 按 TC-101/TC-102 在真实 NAS 上量 |
| 真实授权目录树的勾选与引用增删 | 需要 fnOS 生命周期环境变量提供的授权路径 | 按 TC-103 ~ TC-105 在真实 NAS 上验证 |
| 三个关闭出口的实际手感 | 依赖真实事件与焦点行为 | 按 TC-106 ~ TC-109 在真实 NAS 上验证 |

## 最终结论

包级 18 条用例全部通过；**验收尚未完成**——浮层的实际呈现与交互需在真实 NAS 上按 TC-101 ~ TC-109 执行后回填。按仓库约定，本地 DSH Web 的观感不作为验收依据。
