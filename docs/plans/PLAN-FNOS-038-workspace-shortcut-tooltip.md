---
id: PLAN-FNOS-038
title: PLAN-FNOS-038 工作区快捷入口目录名气泡只在省略时出现
description: 用 Semi `Typography.Text` 的 `ellipsis.showTooltip` 替换自建受控 Tooltip，去掉原生 `title`，补齐 flex 收缩与守卫用例。
status: completed
owner: tnnevol
planDate: 2026-10-30
targetVersion: 7.0.3
lastVerified: 2026-10-30
---

# PLAN-FNOS-038 工作区快捷入口目录名气泡只在省略时出现

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-038 |
| 计划日期 | 2026-10-30 |
| 对应需求 | [FNOS-038 工作区快捷入口目录名气泡只在省略时出现](/requirements/FNOS-038-workspace-shortcut-tooltip) |
| 计划状态 | 实施完成（包级用例、typecheck、lint 与 client 产物重建通过；真实 NAS 验收待执行，版本提交随功能提交后执行） |

## 计划目标

按 [FNOS-038](/requirements/FNOS-038-workspace-shortcut-tooltip) 把工作区快捷入口的目录名提示改为「只有被省略才提示」：删除自建的受控 `Tooltip` 分支，改为 Semi `Typography.Text` 的 `ellipsis.showTooltip`，去掉菜单项的原生 `title`，并用源码守卫用例固定契约。

技术边界：只改 `dsh-fnos-plugin` 的工作区快捷入口组件与其守卫用例；不改选择器组件、不改菜单宽度、不引入新的 Semi 依赖。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 文本渲染 | 原生 `span` + 自定义 `text-overflow: ellipsis` / `white-space: nowrap` / `overflow: hidden` | Semi `Typography.Text`，省略号由组件类名提供 | 插件不再维护省略样式 |
| 气泡判定 | 自建 `trigger: 'custom'` Tooltip，`onMouseEnter` 即 `setVisible(true)`，与是否截断无关 | `ellipsis.showTooltip` 由 `isOverflowed` 判定，只有溢出才挂气泡 | 未省略的目录名不再弹气泡 |
| 系统提示 | 文本 `title` + 菜单项 `title: directory.semanticPath` | 两处都不再挂 `title` | 放得下的目录名悬停时完全静默 |
| 省略可用性 | 依赖自定义宽度样式 | 依赖 flex 子项 `min-width: 0` 才能收缩出省略号 | 漏掉时省略号与气泡同时失效 |
| 气泡层位 | `zIndex: 10001`、`getPopupContainer: () => document.body` | 保持不变，改由 `showTooltip.opts` 传入 | 层级仍压住菜单 |
| 回归防护 | 无守卫用例 | 新增源码守卫用例：禁止自建 Tooltip / 原生 `title`，要求 `ellipsis` + `min-width` | 回退时用例变红 |

判定链路：

```mermaid
flowchart LR
    Hover[悬停目录名] --> Enter[Typography 内部 onHover]
    Enter --> Measure[shouldTruncated: 容器宽度 vs 文本宽度]
    Measure -->|超出| Mount[挂载 Tooltip 浮层]
    Measure -->|放得下| Silent[不挂浮层]
    Mount --> Show[显示完整路径气泡]
```

## 实施任务

| 阶段 | 任务 | 产物 | 状态 |
| --- | --- | --- | --- |
| 一 | 用 `Typography.Text` + `ellipsis.showTooltip` 替换自建 Tooltip 与自定义省略样式 | `src/client/shortcuts/workspace-authorized-shortcut.ts` | 已完成 |
| 二 | 去掉菜单项与文本上的原生 `title`，补齐 `min-width: 0` | 同上 | 已完成 |
| 三 | 新增源码守卫用例 | `tests/client/workspace-authorized-tooltip.spec.ts` | 已完成 |
| 四 | 包级验证（vitest / typecheck / lint / client 产物重建） | 测试结果见[测试用例文档](/tests/FNOS-038-workspace-shortcut-tooltip) | 已完成 |
| 五 | 真实 NAS 验收（装 FPK 后观察气泡是否只出现在省略项） | 验收证据 | 待执行 |

## 技术要点

- `ellipsis.showTooltip` 的 `opts` 会覆盖 `Typography` 内部的默认浮层参数，因此位置、`zIndex`、`getPopupContainer` 都能沿用原气泡约定。
- `ellipsis` 只接受纯文本 `children`，目录名必须经 `menuText(text: string)` 传入，不能直接把 ReactNode 交给它。
- `.semi-dropdown-item` 是 flex 容器，文本侧缺 `min-width: 0` 时不会出现省略号，`isOverflowed` 恒为假——两条断言必须成对存在。
- 反向断言要剔除注释后再匹配，避免被解释成因的说明文字误伤（沿用 FNOS-034 用例的写法）。

## 风险与回退

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 真实 NAS 菜单宽度与本地推演不同，导致省略阈值变化 | 气泡出现时机与截图预期不一致 | 菜单宽度（250px）与文本 `max-width`（220px）保持不变，验收时按实际截图核对 |
| `Typography` 的 `ResizeObserver` 在浮层内测量时机靠后 | 首帧宽度未稳定时判定可能为「未省略」 | 与输入卡片选择器同一机制（已验收），验收时观察首次悬停表现 |
| 守卫用例只断言源码文本，不渲染真实布局 | 样式层回归（例如有人删掉 `min-width: 0`）只能靠用例里的字面断言捕获 | 断言 `minWidth` 与 `ellipsis` 同时存在；真实布局由 NAS 验收覆盖 |

回退：单文件改动，恢复 `workspace-authorized-shortcut.ts` 与删除新用例即可回到旧行为。
