---
id: FNOS-038
title: FNOS-038 测试用例
description: FNOS-038 工作区快捷入口目录名气泡的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-038-workspace-shortcut-tooltip
plan: /plans/PLAN-FNOS-038-workspace-shortcut-tooltip
status: 部分通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-038 测试用例

## 测试范围与需求分析

被测对象是「选择工作区目录」弹框内 fnOS 授权目录快捷入口的目录名提示：气泡是否只在目录名被 Semi `Typography.Text` 判定为省略时才出现，以及菜单项是否还残留原生 `title`。执行任务见 [PLAN-FNOS-038](/plans/PLAN-FNOS-038-workspace-shortcut-tooltip)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-038-01](/requirements/FNOS-038-workspace-shortcut-tooltip#fnos-038-01) | 省略与气泡由 `Typography.Text` 承载、气泡层级压住菜单 | 回退为自建 Tooltip 后，未省略的目录名也弹气泡 |
| [FNOS-038-02](/requirements/FNOS-038-workspace-shortcut-tooltip#fnos-038-02) | 菜单项不挂原生 `title` | 系统提示绕过省略判定，再次出现「看见什么写什么」 |

缺陷基线（修复前）：目录名完整显示（`存储空间 2/1000/Files`）时仍弹出同一串文字的气泡——自建受控 Tooltip 在 `onMouseEnter` 时无条件 `setVisible(true)`，与是否截断无关。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-038-01、02 | 包级（Node / vitest） | `pnpm --filter @tnnevol/dsh-fnos test`；源码守卫用例 |
| FNOS-038-01、02 | 类型与风格 | `tsc -p tsconfig.json`、`eslint` |
| FNOS-038-01、02 | 产物 | `tsdown` 重建 `lib/client.js` 并核对编译后的 `menuText` |
| FNOS-038-01、02 | 真实 fnOS NAS | 构建 FPK → 应用中心正常安装 → 打开「选择工作区目录」悬停条目（**未执行**） |

## 测试用例

### [FNOS-038-01 气泡只在目录名被省略时出现](/requirements/FNOS-038-workspace-shortcut-tooltip#fnos-038-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-038-01 | 省略与气泡由 Semi Typography 承载 | AC-03 | 已读取快捷入口源码 | 1.断言导入 `DshTypography as Typography` 2.断言存在 `Typography.Text` 别名 3.断言 `ellipsis` 含 `rows: 1` 与 `showTooltip` | 三项断言全部通过 | P0 | 缺陷现场：自建 Tooltip 不看省略 |
| TC-002 | FNOS-038-01 | 不再自己量宽度、不自建受控 Tooltip | AC-03 | 同上 | 1.剔除注释后断言无 `scrollWidth`、`setVisible`、`trigger: 'custom'`、`textOverflow` | 全部不存在 | P0 | 旧实现 `AuthorizedDirectoryMenuText` |
| TC-003 | FNOS-038-01 | 气泡层级压住下拉菜单 | AC-02 | 同上 | 1.断言菜单 `zIndex: 10000` 2.断言气泡 `zIndex: 10001` | 两个常量同时存在 | P0 | 菜单挂 body 渲染，层级不足会被遮挡 |
| TC-004 | FNOS-038-01 | `ellipsis` 的 children 必须是纯文本 | AC-01、AC-03 | 同上 | 1.断言目录名统一经 `menuText(text: string)` 字符串入口 | 入口签名为 `string` | P1 | Semi 对非字符串 children 会静默失效 |
| TC-005 | FNOS-038-01 | flex 子项可收缩（`min-width: 0`） | AC-01 | 同上 | 1.断言 `menuText` 的 `style` 含 `minWidth: 0` | 存在 `minWidth: 0` | P0 | `.semi-dropdown-item` 是 flex 容器，缺它省略号恒不出现 |
| TC-006 | FNOS-038-01 | 未省略目录名不弹气泡（真机交互） | AC-01 | 已安装含本改动的 FPK | 1.打开「选择工作区目录」2.展开快捷入口 3.悬停完整显示的目录名 | 不出现气泡、无系统提示 | P0 | 提出人截图（本轮未执行） |
| TC-007 | FNOS-038-01 | 省略目录名弹完整路径气泡且不被遮挡 | AC-02 | 同上 | 1.悬停显示 `…` 的目录名 | 出现完整路径气泡，位于菜单之上 | P0 | 同上（本轮未执行） |

### [FNOS-038-02 未省略的条目不再有任何系统提示](/requirements/FNOS-038-workspace-shortcut-tooltip#fnos-038-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | FNOS-038-02 | 菜单项不挂原生 `title` | AC-01 | 已读取快捷入口源码 | 1.剔除注释后匹配 `title: directory.semanticPath` | 不匹配 | P1 | 旧实现同时挂了文本与菜单项 `title` |
| TC-009 | FNOS-038-02 | 守卫用例在实现回退时变红 | AC-02 | 用例已存在 | 1.把 `menuText` 改回自建 `trigger: 'custom'` Tooltip 2.重跑用例 | 反向断言失败（预期变红） | P0 | 变异验证（本轮未执行） |
| TC-010 | FNOS-038-02 | 放得下的目录名悬停完全静默（真机交互） | AC-01 | 已安装含本改动的 FPK | 1.悬停完整显示的目录名并停留 2 秒 | 既无插件气泡也无浏览器系统提示 | P1 | 本轮未执行 |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 ~ TC-005、TC-008 | 通过 | `tests/client/workspace-authorized-tooltip.spec.ts`（5 条用例）；`vitest run` 全量 40 文件 / 374 条通过 |
| TC-004 | 通过 | 同一文件内「ellipsis 只接受纯文本 children」断言 |
| TC-006、TC-007、TC-010 | 未执行 | 需构建 FPK 后在真实 fnOS NAS 走应用中心安装验证 |
| TC-009 | 未执行 | 变异验证待真机验收时一并补做 |

构建与静态检查：

- `tsc -p tsconfig.json`：通过。
- `eslint`（改动文件与新用例）：通过。
- `tsdown`：`lib/client.js` 重建成功，编译产物中 `menuText` 为 `ellipsis: { rows: 1, showTooltip: { opts: { position: 'left', zIndex: 10001, getPopupContainer: () => document.body } } }` + `style: { minWidth: 0, maxWidth: '220px', color }`。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| BUG-038-01 | 守卫用例首次运行失败：反向断言命中了源码注释里解释「不再自己量 `scrollWidth`」的说明 | 反向断言直接匹配全文 | 断言前剔除块注释与行注释（沿用 FNOS-034 用例写法），用例转绿 |

## 最终结论

包级契约已验证：省略与气泡均由 Semi `Typography.Text` 承载、菜单项不再挂原生 `title`、气泡层级压住菜单、flex 收缩条件具备，且守卫用例能在实现回退时变红。

真机交互结论待补：TC-006、TC-007、TC-009、TC-010 需构建 FPK 后在真实 fnOS NAS 走应用中心安装验证，届时回填本节与 `docs/validation/` 证据。
