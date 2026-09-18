# AGENTS.md — 飞牛 fnOS 应用 Monorepo

## 项目概述

本仓库用于将第三方应用打包为飞牛 fnOS 应用商店格式。项目根目录 `package.json` 维护统一任务入口，`tooling/fn-os-apps-cli` workspace 使用 TypeScript、tsdown、Turbo 和 bumpp 管理构建与发布版本。

**技术栈**：fnOS Native 和 Docker 应用规范（bash 生命周期脚本 + JSON 配置；Docker 应用额外使用 docker-compose），非传统前后端项目。

当前应用：`apps/fn-deepseek-harness`（Native）。仓库暂无 Docker 应用。

## 文档索引

改动前先读对应页面，细节以文档站为准，本文只保留 Agent 开工所需的约束。

| 内容 | 入口 |
| --- | --- |
| 开发环境与命令入口 | [`docs/development/environment.md`](docs/development/environment.md)、[`commands-and-scripts.md`](docs/development/commands-and-scripts.md) |
| 应用结构、构建与设备验证 | [`docs/development/app-structure.md`](docs/development/app-structure.md) |
| Manifest、生命周期、权限、向导 | [`docs/development/manifest.md`](docs/development/manifest.md)、[`lifecycle.md`](docs/development/lifecycle.md)、[`permissions.md`](docs/development/permissions.md)、[`wizard.md`](docs/development/wizard.md) |
| 插件开发与本地 DSH Web | [`docs/development/plugin-development.md`](docs/development/plugin-development.md)、[`local-dsh-web.md`](docs/development/local-dsh-web.md) |
| Turbo 任务与 CLI 命令 | [`docs/development/turbo-tasks.md`](docs/development/turbo-tasks.md)、[`cli-commands.md`](docs/development/cli-commands.md) |
| 编码约定、Workflow、贡献 | [`docs/development/conventions.md`](docs/development/conventions.md)、[`github-workflows.md`](docs/development/github-workflows.md)、[`docs/contributing.md`](docs/contributing.md) |
| 打包、版本、CI、发布 | [`docs/build/fnpack.md`](docs/build/fnpack.md)、[`versioning.md`](docs/build/versioning.md)、[`ci.md`](docs/build/ci.md)、[`release.md`](docs/build/release.md) |
| 仓库结构、SDD 规范、排错 | [`docs/guide/repository-structure.md`](docs/guide/repository-structure.md)、[`sdd-workflow.md`](docs/guide/sdd-workflow.md)、[`docs/troubleshooting.md`](docs/troubleshooting.md) |

## 官方文档

涉及飞牛应用开发相关问题时，优先使用 [`fnnas-docs` Skill](https://github.com/tnnevol/skills/tree/main/skills/fnnas-docs) 查阅官方文档：

```bash
# 安装技能（首次使用前执行一次）
pnpx skills add tnnevol/skills --skill fnnas-docs -g -y
```

该 skill 覆盖 manifest 配置、权限管理、入口配置、Docker/Native 构建、向导配置、网关认证和 CLI 工具。

## 常用命令

```bash
# 环境
nvm use && pnpm install

# 开发服务（交互多选：插件 / 文档 / 本地 DSH Web）
pnpm run start

# 构建（交互多选：插件 / FPK / 文档）
pnpm run build

# 检查；完整门禁
pnpm run check -- --all
pnpm run build -- --docs

# 版本
pnpm run version -- project patch
pnpm run version -- plugin fnos patch
```

设备上的验证需在 fnOS 真机执行 `appcenter-cli install-local`。

## SDD 维护模式

本仓库采用轻量规格驱动开发（SDD）维护模式：

- 新功能、用户可见行为、权限、数据、网关或插件契约变更，先更新 `docs/requirements/`，再在 `docs/plans/` 建立或调整实施计划。
- 需求规格描述范围、优先级和可观察的验收条件；计划描述实现、测试、发布和回滚，不用代码或测试替代规格。
- 每个 P0/P1 功能应保持需求、验收、计划任务、测试和目标环境证据的可追踪关系；涉及 fnOS 的功能必须区分本地验证和真实 NAS 验收。
- 应用和插件面向用户的说明以 `docs/` 为唯一维护入口；`README.md` 只保留项目识别、开发入口或历史兼容内容。
- 提交前运行 `pnpm run check -- --all` 和与改动相关的构建/测试；文档改动还需运行 `pnpm run build -- --docs` 与 `git diff --check`。

完整流程见 [`docs/guide/sdd-workflow.md`](docs/guide/sdd-workflow.md)。

## 硬性约束

### 禁止绝对路径

受版本管理的文件**不得写入开发者本机绝对路径**（`/Users/<name>/...`、`/home/<name>/...`、Windows 盘符），也不要指向其他检出。这类路径只在写入它的机器和检出目录下成立，换机器或换目录后立即失效；指向其他检出时，本仓库的检查结果还会随那个仓库的状态变化。

按场景选择替代方式：

| 场景 | 做法 |
| --- | --- |
| 同包或相邻模块 | 相对导入，如 `../src/foo.ts` |
| 跨 workspace 引用 | 包名别名，如 `@tnnevol/dsh-semi-ui` |
| 需要绝对路径定位文件 | 基于 `import.meta.url` / `import.meta.dirname` 运行时解析 |
| fnOS 应用脚本 | 平台变量 `${TRIM_PKGVAR}`、`${TRIM_APPDEST}` |

测试读取源码做断言时同样用运行时解析，不写死路径。被忽略的目录（`node_modules/`、`.turbo/`、`docs/.vitepress/dist`）不在约束范围内；描述该规则本身时用占位写法（`/Users/<name>/...`）不算违规。

完整说明见 [`docs/development/conventions.md`](docs/development/conventions.md)。

### DSH 插件插槽

开发 DSH Client 插件时，先检查目标 Slot 的现有条目和 `priority`。列表插槽中相同 `id` 不能使用相同优先级，否则会导致插件加载失败。尤其注意 `conversation.composer.dock` 的内置会话步骤统计条目使用 `id: 'stats'`、`priority: 0`；需要置换它时必须使用不同优先级（例如 `priority: -1`，较低优先级生效），仅新增内容则使用自有 `id`，不要占用 `stats`。

### 文档站

应用与插件说明只维护 `docs/` 下的文档站页面，不同步维护 `apps/*/README.md`、`plugins/*/README.md` 或 `docs/apps/`、`docs/plugins/` 下的重复内容。

开发指南按主题分组：环境与工具、应用开发、插件开发、任务与构建、协作与规范。单页承担三个以上互不相关主题、或篇幅超过约 300 行时按主题拆分，并更新全部交叉引用与侧边栏配置。

## 注意事项

- `manifest` 为 INI 格式，字段对齐靠空格，不要改成 JSON。
- 权限配置使用 `defaults.run-as: "package"` 与 `username`，不要写 `docker-<appname>` 前缀（那是 Docker 应用形态的做法，本仓库当前应用是 Native）。
- 入口配置（`app/ui/config`）根据应用形态选择 `type: "url"` 或 `type: "iframe"`；Native 网关应用可使用 iframe。
- 不要编造项目中不存在的资源链接。
