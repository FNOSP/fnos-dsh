# AGENTS.md — fnOS DSH

## 文件定位

本文件只维护仓库级工作入口、文档导航、硬性约束和命令速查。
详细需求、设计、实现和验收规则以 `docs/` 下的权威文档为准。

## 项目概览

本仓库用于维护飞牛 fnOS 上的 DeepSeek Harness 应用、DSH 插件、网关和构建发布工具。

当前应用：`apps/fn-deepseek-harness`（fnOS Native）。仓库当前没有 Docker 应用。

主要技术：pnpm Workspace、Turborepo、TypeScript、Shell、tsdown、Vite、VitePress 和 fnOS Native。

## 开始工作前

根据变更类型选择对应文档：

| 变更类型 | 首先阅读和维护 |
| --- | --- |
| 新功能、用户行为、权限、数据、网关、插件契约 | `docs/requirements/` → `docs/plans/` |
| 已有功能修复 | 对应需求和计划的变更记录 |
| fnOS 应用、Manifest、生命周期、权限 | `docs/development/` |
| DSH 插件 | [`docs/development/plugin-development.md`](docs/development/plugin-development.md) |
| 构建、版本、发布 | `docs/build/` |
| 真实 NAS 验收 | `docs/validation/` |
| 仅文档或格式调整 | 对应文档、文档构建和 `git diff --check` |

## 文档索引

| 主题 | 权威入口 |
| --- | --- |
| 项目维护章程与 SDD 规范 | [`docs/charter/sdd-workflow.md`](docs/charter/sdd-workflow.md) |
| 目录结构规范 | [`docs/charter/directory-structure.md`](docs/charter/directory-structure.md) |
| 需求清单 | [`docs/requirements/index.md`](docs/requirements/index.md) |
| 实施计划 | [`docs/plans/index.md`](docs/plans/index.md) |
| 验收证据 | [`docs/validation/README.md`](docs/validation/README.md) |
| 开发环境 | [`docs/development/environment.md`](docs/development/environment.md) |
| 常用命令与脚本 | [`docs/development/commands-and-scripts.md`](docs/development/commands-and-scripts.md) |
| 应用结构 | [`docs/development/app-structure.md`](docs/development/app-structure.md) |
| Manifest 与生命周期 | [`docs/development/manifest.md`](docs/development/manifest.md)、[`docs/development/lifecycle.md`](docs/development/lifecycle.md) |
| 权限、向导和入口 | [`docs/development/permissions.md`](docs/development/permissions.md)、[`docs/development/wizard.md`](docs/development/wizard.md) |
| 插件和本地 DSH Web | [`docs/development/plugin-development.md`](docs/development/plugin-development.md)、[`docs/development/local-dsh-web.md`](docs/development/local-dsh-web.md) |
| Turbo、CLI 和协作 | [`docs/development/turbo-tasks.md`](docs/development/turbo-tasks.md)、[`docs/development/cli-commands.md`](docs/development/cli-commands.md)、[`docs/development/conventions.md`](docs/development/conventions.md) |
| 打包、版本和发布 | [`docs/build/fnpack.md`](docs/build/fnpack.md)、[`docs/build/versioning.md`](docs/build/versioning.md)、[`docs/build/release.md`](docs/build/release.md) |
| 仓库结构和排错 | [`docs/guide/repository-structure.md`](docs/guide/repository-structure.md)、[`docs/troubleshooting.md`](docs/troubleshooting.md) |

## 必须遵守的约束

- 涉及用户行为、权限、数据、网关或插件契约的改动，先更新需求和计划。
- 本地通过不等于 fnOS 验收完成；涉及 NAS 的功能必须记录真实环境证据。
- 新增目录或文件前必须遵循 [`目录结构规范`](docs/charter/directory-structure.md)，不得在根目录或模块内随意堆积。
- 受版本管理的文件不得写入开发者本机绝对路径；使用相对路径、包名别名或运行时解析。
- `manifest` 使用 INI 格式，不改成 JSON。
- Native 应用使用 `defaults.run-as: "package"` 和 `username`，不要使用 `docker-<appname>` 前缀。
- 入口配置 `app/ui/config` 根据应用形态选择 `type: "url"` 或 `type: "iframe"`；Native 网关应用可使用 iframe。
- 修改 DSH Slot 前先检查已有 `id` 和 `priority`；不要制造相同 `id`、相同优先级的列表项。
- 应用和插件面向用户的说明只维护 `docs/apps/`、`docs/plugins/` 等文档站页面，不把 `README.md` 作为现行说明入口。
- 不要编造项目中不存在的文档、API 或资源链接。
- 官方上游项目只作为契约和行为参考，不直接修改或提交上游代码。

## 官方文档

涉及 fnOS 平台能力时，优先参考 [`fnnas-docs Skill`](https://github.com/tnnevol/skills/tree/main/skills/fnnas-docs)。
