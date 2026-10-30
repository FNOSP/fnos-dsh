---
id: PLAN-FNOS-040
title: PLAN-FNOS-040 面板右键打开与重命名、状态保持与入口文案
description: 新增宿主重命名路由与前端打开分流，菜单补「打开/重命名」；把展开与滚动收归面板状态；改输入区入口文案。
status: completed
owner: tnnevol
planDate: 2026-10-30
targetVersion: 7.0.7
lastVerified: 2026-10-30
---

# PLAN-FNOS-040 面板右键打开与重命名、状态保持与入口文案

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-040 |
| 计划日期 | 2026-10-30 |
| 对应需求 | [FNOS-040 面板右键打开与重命名、状态保持与入口文案](/requirements/FNOS-040-picker-entry-actions) |
| 计划状态 | 实施完成（包级用例、typecheck、lint 与 client 产物重建通过；真实 NAS 验收待执行，版本提交随功能提交后执行） |

## 计划目标

按 [FNOS-040](/requirements/FNOS-040-picker-entry-actions) 完成四项：右键「打开」按类型分流、「重命名」全链路（契约 → 宿主路由 → 客户端 → 弹框）、展开与滚动状态跨收起保留、入口文案。

技术边界：不改共享包，不改授权模型；重命名只改名字、不提供跨目录移动。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 打开条目 | 无 | 新服务 `file-opener.ts`：目录 → `openFileManager`，文件 → `openFile`；carrier 未就绪显式失败 | 右键即可进入 fnOS 对应界面 |
| 重命名 | 无 | 契约加 `rename-entry` 路由；宿主用 `rename()` 并先探测目标；客户端 `renameAuthorizedEntry` | 就地改名，失败有原因 |
| 根目录保护 | 删除已有同类保护 | 重命名同样禁止改名授权根 | 持久化的授权记录不会指向空路径 |
| 展开状态 | Semi Tree 内部状态，收起即丢 | 面板持有 `expandedKeys` + `onExpand` | 重新展开还原上次展开的目录 |
| 滚动位置 | 无记录 | 记录在树的根元素上，展开后在下一帧还原 | 重新展开回到上次位置 |
| 勾选状态 | 每次展开重置 | 保持不变 | 与提出人要求一致 |
| 入口文案 | 「插入 NAS 文件或目录」 | 「文件管理」/`File manager` | 气泡与无障碍名同时更新 |

## 实施任务

| 阶段 | 任务 | 产物 | 状态 |
| --- | --- | --- | --- |
| 一 | 契约加 `FNOS_AUTHORIZED_RENAME_ENTRY_PATH` 与请求/响应类型 | `src/contracts/authorized-directories-contract.ts` | 已完成 |
| 二 | 宿主抽出单段名字校验、加 `parseRenameRequest` 与重命名路由 | `src/host/authorized-directories.ts` | 已完成 |
| 三 | 客户端封装 `renameAuthorizedEntry` | `src/client/services/authorized-directories-client.ts` | 已完成 |
| 四 | 新增打开分流服务 | `src/client/services/file-opener.ts` | 已完成 |
| 五 | 菜单补「打开/重命名」与分隔线，新增重命名弹框 | `src/components/FnosAuthorizedPathPicker.tsx`、`src/styles/index.scss` | 已完成 |
| 六 | 展开与滚动收归面板状态 | 同上 | 已完成 |
| 七 | 入口文案与新增文案键 | `src/client/locales.ts` | 已完成 |
| 八 | 包级用例（解析、分流、契约守卫）与产物验证 | 见[测试用例文档](/tests/FNOS-040-picker-entry-actions) | 已完成 |
| 九 | 真实 NAS 验收（四项交互各走一遍，亮色/暗色） | 验收证据 | 待执行 |

## 技术要点

- 打开动作把 SDK 注入进服务（`file-opener.ts` 不 import `sdk.ts`），组件侧传 `() => createTrimApp()`，与 `file-manager.ts`、`path-opener.ts` 同一手法，保证可脱离 DOM 单测。
- 宿主重命名复用 `parseEntryName`（自新建解析中抽出），保证两条写操作的名字规则完全一致。
- 目标存在性必须在 `rename` 之前探测：POSIX 覆盖是静默的，靠 `rename` 之后检查已经晚了。
- 滚动容器是 `.dsh-fnos-path-panel-tree`（`overflow: auto`），不是内层 `.semi-tree-option-list`（只做横向）。
- 展开/滚动只在 `open` 变化时复位与还原，避免树数据变化（例如展开新目录）时把滚动位置拽回去。
- 重命名成功后只重取父目录那一层（`requestAuthorizedEntries(parent)` + `updateChildren`），不整树重取，否则其它已展开分支会被收起。

## 风险与回退

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 受控 `expandedKeys` 与 `loadData` 的时序 | 极少数情况下展开后子项未合并进树 | `loadData` 仍负责取子层并合并；真机验收逐层展开确认 |
| 改名后子树从树中消失 | 用户原先展开的该目录子层被收起 | 属预期：名字变了，旧路径下的子层已不存在；同层与其它分支不受影响 |
| SDK 在 standalone 下失败 | 点「打开」无反应 | 已显式抛出并 toast；真机需确认 iframe 场景正常 |
| 滚动还原时机 zh 与异步数据 | 首次展开时若树为空，位置不还原 | 首次位置本就是 0；后续展开树数据已在，逐帧还原 |

回退：打开/重命名都是新增入口，移除菜单项与对应服务即可回到改造前；展开/滚动为纯前端状态，去掉受控 props 即恢复原行为。
