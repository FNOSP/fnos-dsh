---
id: PLAN-FNOS-042
title: PLAN-FNOS-042 Session 日志菜单对齐官方默认结构
description: 用 MenuItem.submenu 把两种导出落点收进「下载 Session 日志」，新增指向本仓库的反馈项，图标复用官方图标集。
status: completed
owner: tnnevol
planDate: 2026-10-30
targetVersion: 7.0.12
lastVerified: 2026-10-30
---

# PLAN-FNOS-042 Session 日志菜单对齐官方默认结构

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-042 |
| 计划日期 | 2026-10-30 |
| 对应需求 | [FNOS-042 Session 日志菜单对齐官方默认结构](/requirements/FNOS-042-session-log-menu) |
| 计划状态 | 实施完成（包级用例与产物构建通过；真实 NAS 验收待执行，版本提交随功能提交后执行） |

## 计划目标

按 [FNOS-042](/requirements/FNOS-042-session-log-menu) 把菜单改成官方形态：`下载 Session 日志` 作父项、两种落点作子项，新增 `反馈` 项指向本仓库。

技术边界：只改菜单数据与新增一个跳转；不动导出实现、不动下载状态提示。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 菜单层级 | 平铺两项：导出到电脑 / 导出到 NAS | 顶层两项：下载 Session 日志（含子菜单）/ 反馈 | 与官方默认一致 |
| 子项 | 无 | `submenu: [computer, nas]`，沿用原 id 与处理分支 | 行为不变 |
| 反馈 | 无 | `id: 'feedback'`，新窗口打开本仓库 | 新增出口 |
| 图标 | 下载、文件夹 | 再加官方纸飞机（反馈） | 复用官方图标集 |

## 实施任务

| 阶段 | 任务 | 产物 | 状态 |
| --- | --- | --- | --- |
| 一 | 确认 `MenuItem.submenu` 与 `onSelect` 语义 | 调研结论见需求文档 | 已完成 |
| 二 | 菜单改为父项 + 子菜单，新增反馈项与跳转 | `src/components/FnosSessionLogHeaderAction.tsx` | 已完成 |
| 三 | 中英文案键 | `src/client/locales.ts` | 已完成 |
| 四 | 源码守卫用例：层级、反馈地址、图标复用、子项分支 | `tests/client/session-log-menu.spec.ts` | 已完成 |
| 五 | 包级验证与产物构建 | 见[测试用例文档](/tests/FNOS-042-session-log-menu) | 已完成 |
| 六 | 真实 NAS 验收（展开子菜单、两条导出路、反馈跳转） | 验收证据 | 待执行 |

## 技术要点

- 子菜单是原语能力：`Menu` 在悬停/聚焦时把 `submenu` 渲染成右侧卡片，选中后调用 `onSelect?.(sub.id)`；父项本身不触发 `onSelect`，因此 `id: 'download'` 不需要处理分支。
- 反馈跳转用 `window.open(url, '_blank', 'noopener,noreferrer')`：既新开窗口，也不把 DSH 页面地址作为 referrer 带给外站。
- 图标全部取自 `@deepseek-ai/dsh-client-ui-primitives`，避免自绘 SVG 与官方视觉不一致。

## 风险与回退

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| fnOS iframe 可能拦截 `window.open` | 点「反馈」无反应 | 真机验收确认；若被拦截，改为复制链接并提示 |
| 子菜单在窄屏下向右溢出 | 子项不可见 | 原语负责贴边翻转；真机验收观察 |
| 旧习惯用户找「导出到电脑」多一层 | 操作路径变长 | 与官方一致，属预期 |

回退：把 `menuItems` 恢复成平铺两项并移除反馈分支即可。
