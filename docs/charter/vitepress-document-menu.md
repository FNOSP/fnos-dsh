---
title: VitePress 文档菜单规范
description: fnOS DSH 文档新增、归档与 VitePress 左侧菜单登记规则。
---

# VitePress 文档菜单规范

本规范确保 `docs/` 中新增的正式文档不会脱离 VitePress 页面路由和左侧菜单，用户能够从文档站导航、搜索和返回文档。

## 核心原则

1. **先有页面入口，再提交文档**：新增正式 Markdown 文档必须在同一变更中登记到 `docs/.vitepress/config.mts` 的对应 sidebar。
2. **文档、索引、菜单同步**：需求、计划、验收证据和章程规范除加入 sidebar 外，还必须更新各自目录的索引或入口页。
3. **菜单链接使用站点路由**：菜单使用以 `/` 开头的 VitePress clean URL，不使用本机绝对路径、文件系统路径或 `.md` 后缀。
4. **菜单分组与目录职责一致**：文档所在目录决定默认菜单分组，不跨目录堆放条目。
5. **不产生孤立页面**：除明确声明为构建产物、模板或内部片段的文件外，正式文档必须至少从一个 sidebar 或权威索引页可达。

## 目录与菜单映射

| 文档目录 | VitePress 路由前缀 | 默认 sidebar | 额外入口 |
| --- | --- | --- | --- |
| `docs/guide/`、`docs/charter/`、`docs/development/`、`docs/build/` | `/guide/`、`/charter/`、`/development/`、`/build/` | `developmentSidebar` | `docs/charter/` 新规范同步更新 AGENTS.md 文档索引 |
| `docs/apps/` | `/apps/` | `appSidebar` | 应用索引或应用入口页 |
| `docs/plugins/` | `/plugins/` | `appSidebar` | 插件总览页 |
| `docs/requirements/` | `/requirements/` | `requirementsSidebar` | `docs/requirements/index.md` |
| `docs/plans/` | `/plans/` | `plansSidebar` | `docs/plans/index.md` |
| `docs/tests/` | `/tests/` | `testsSidebar` | `docs/tests/index.md` |
| `docs/validation/` | `/validation/` | 对应验收 sidebar | `docs/validation/README.md` 或验收索引 |

以上映射以 `docs/.vitepress/config.mts` 为唯一菜单配置入口。新增目录时，必须先更新[目录结构规范](./directory-structure.md)，再补充对应映射。

## 新增文档流程

### 1. 确认文档归属

将文档放入现有职责目录，并确认文件名符合该目录的命名规范。需求、计划和验收文档不得直接放在 `docs/` 根目录。

### 2. 配置 sidebar

在创建文档的同一提交中：

- 在 `docs/.vitepress/config.mts` 对应数组加入菜单项；
- 菜单文案与文档一级标题保持一致或使用清晰的短标题；
- 菜单链接使用 clean URL，例如：

```ts
{ text: 'FNOS-008 插件配置统一迁入插件管理页', link: '/requirements/FNOS-008-plugin-config-in-plugin-manager' }
```

### 3. 更新权威索引

- 新需求同时更新 `docs/requirements/index.md`；
- 新计划同时更新 `docs/plans/index.md`；
- 新章程同步更新 `AGENTS.md` 的文档索引；
- 新验收证据同步更新 `docs/validation/README.md` 或对应验收索引；
- 新测试用例文档同步更新 `docs/tests/index.md`，并在 `testsSidebar` 加入条目（与需求同编号）。

### 4. 检查链接与构建

提交前至少执行：

- 检查菜单链接对应的 Markdown 文件存在；
- 检查目录索引、sidebar 和文档内部链接一致；
- 运行文档站构建；
- 运行 `git diff --check`。

文档构建失败、sidebar 路由不存在或新增页面无法从菜单到达时，不得视为文档变更完成。

## 页面登记检查清单

- [ ] 文件已归档到正确的 `docs/` 子目录。
- [ ] 文件包含 `title`、`description` 或该文档类型要求的元数据。
- [ ] 文件已加入 `docs/.vitepress/config.mts` 的对应 sidebar。
- [ ] 需求、计划、章程或验收文档已更新对应权威索引。
- [ ] sidebar 链接使用 clean URL，且目标文件真实存在。
- [ ] 页面能从顶部导航或左侧菜单进入，并能通过上级入口返回。
- [ ] 文档构建和 `git diff --check` 通过。

## 例外规则

以下内容可以不单独占用左侧菜单条目，但必须由一个已登记的权威页面链接到：

- 文档站组件示例或被其他页面 include 的片段；
- 仅供构建工具读取的模板；
- 自动生成且不作为独立阅读页面的中间产物。

例外文件不得伪装成正式需求、计划、章程或用户文档；一旦需要独立阅读，就必须补充 sidebar 条目。
