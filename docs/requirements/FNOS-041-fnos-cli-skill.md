---
id: FNOS-041
title: FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli
description: 应用不再分发 @trimjs/trim-cli 包内的 skill，改为随包内置 fnnas-labs/fnos-cli-skill；用户已自装则整目录跳过，老用户已有的 trim-cli skill 不删除。
status: in-progress
owner: tnnevol
targetVersion: 7.0.6
lastVerified: 2026-10-30
---

# FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-041 |
| 提出日期 | 2026-10-30 |
| 需求状态 | 实施中（包级用例与产物冒烟通过；真实 NAS 验收待执行） |
| 关联计划 | [PLAN-FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli](/plans/PLAN-FNOS-041-fnos-cli-skill) |
| 适用范围 | 应用的安装/升级回调（`apps/fn-deepseek-harness/cmd/install_callback`）、随包资源（`app/skills/`）、安装帮助器（`packages/fnos-gateway`） |

## 需求背景

应用从早期版本起就把 `@trimjs/trim-cli` 包内的 skill 复制到 `${HOME}/.agents/skills/trim-cli`，让 Agent 能按说明驱动 NAS 命令。现在上游提供了专门的 [`fnnas-labs/fnos-cli-skill`](https://github.com/fnnas-labs/fnos-cli-skill)：面向 `fnos-cli` 命令、随包自带启动器（首次运行自行下载并校验对应版本 CLI），覆盖面比 trim-cli 的 skill 更完整。

因此内置 Skill 改为 `fnos-cli`，但必须守住两条边界：

1. **不覆盖用户已有安装**：用户可能自己用 `npx skills add` 装过、甚至版本更新，覆盖会抹掉用户的选择。
2. **不删除老用户的 trim-cli skill**：已经在用它的 Agent 不应因为一次升级就失去能力。

## 调研结论

| 结论 | 出处 | 影响的功能 | 状态 |
| --- | --- | --- | --- |
| 旧实现只在**安装**回调里复制 skill（`install_trim_cli` 内），升级回调本身只是转发到 `install_callback`，因此把新逻辑放进安装回调即可覆盖安装与升级两条路径 | `cmd/install_callback` 与 `cmd/upgrade_callback`（2026-10-30） | FNOS-041-01、FNOS-041-02 | 已核实 |
| 上游 skill 目录为 `skills/fnos-cli/`，自带 `scripts/fnos-cli` 启动器，按包内 `runtime-manifest.json` 下载并 SHA-256 校验对应版本的 CLI，**不依赖全局 npm 安装、不需要 Node** | 上游仓库 README 与 `skills/fnos-cli/runtime-setup.md`（版本 0.6.1，提交 `d14b840`） | FNOS-041-01 | 已核实 |
| 上游包 `fnos-cli-skill` 为 `private: true`，无法作为 npm 依赖安装，必须把 skill 随包分发 | 上游 `package.json`（2026-10-30） | FNOS-041-01 | 已核实 |
| `app/` 目录整体进入 FPK，运行时即 `${TRIM_APPDEST}`（现有 `app/scripts`、`app/bundled-dsh-plugins` 均按此引用），构建流程只清理 `app/bundled-dsh-plugins`，不会动 `app/skills` | `cmd/install_callback` 的路径常量与 `tooling/fnos-dsh-cli/src/commands/build.ts`（2026-10-30） | FNOS-041-01 | 已核实 |
| 帮助器产物由 `packages/fnos-gateway/tsdown.app.config.ts` 生成到 `app/scripts/install-callback-helper.mjs`，新增命令随构建自动进入 FPK | 同上（2026-10-30） | FNOS-041-01 | 已核实 |

## 需求目标

- 安装与升级时，把随包的 `fnos-cli` skill 装到 `${HOME}/.agents/skills/fnos-cli`；目标目录已存在则整目录跳过。
- 不再分发 trim-cli 包内的 skill；`@trimjs/trim-cli` CLI 本身照旧全局安装。
- 老用户已有的 `${HOME}/.agents/skills/trim-cli` 保持原样，不刷新、不删除。
- 随包 skill 保留可执行权限（启动器），失败时不留下半个目录或伪装成「已安装」。

## 功能列表

| 编号 | 优先级 | 功能 | 用户可观察结果 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-041-01 | P1 | 新装/升级内置 fnos-cli skill | 装完后 `${HOME}/.agents/skills/fnos-cli` 出现，Agent 能按说明使用 `fnos-cli` 管理 NAS | <Badge type="warn" text="待验证" /> |
| FNOS-041-02 | P1 | 用户已安装时跳过 | 自己装过 `fnos-cli` skill 的用户升级后，目录内容与版本不变 | <Badge type="warn" text="待验证" /> |
| FNOS-041-03 | P2 | 老用户 trim-cli skill 保留 | 升级后 `${HOME}/.agents/skills/trim-cli` 仍在，内容不被刷新也不被删除 | <Badge type="warn" text="待验证" /> |

## 行为约束

- 只在目标目录**不存在**时安装；存在（哪怕为空目录）一律跳过，不做合并或部分覆盖。
- 复制走「临时目录 + 原子 rename」，失败不留下可被误判为「已安装」的目录。
- 随包 skill 内容与上游保持一致，本仓库不改写；升级时整目录替换并同步来源记录。
- `@trimjs/trim-cli` 的全局安装保持不变（`trim` 命令仍可用），只是不再分发它的 skill。
- 不删除任何用户目录下的既有 skill。

## 不在本次范围内

- 卸载流程对 skill 目录的处理。
- 通过 DSH 插件市场分发 `fnos-cli` 的 DSH bundle（上游另有 `cordis.patch.yml`，本次只涉及 skill）。
- trim-cli 与 fnos-cli 两套 CLI 的能力对齐。
- 用户自定义 skill 的版本管理或升级提示。

## 既有功能变更关系

覆盖 [FNOS-007](/requirements/FNOS-007-dsh-017-rc2-adaptation) 引入的「全局安装 trim-cli 并复制其 skill」中的**skill 部分**，CLI 安装与 npm 源配置不变；`fnos-cli` 的上游来源与版本记录见 `apps/fn-deepseek-harness/app/skills/README.md`。

## 验收条件与完成状态

### FNOS-041-01

- `FNOS-041-01-AC-01`：全新安装后 `${HOME}/.agents/skills/fnos-cli/SKILL.md` 存在，`scripts/fnos-cli` 保持可执行。
- `FNOS-041-01-AC-02`：升级到本版本后同样具备该 skill。
- `FNOS-041-01-AC-03`：随包目录缺少 `SKILL.md` 时安装明确失败，不留下目标目录。

### FNOS-041-02

- `FNOS-041-02-AC-01`：目标目录已存在时返回 `skipped`，目录内容逐个文件保持不变（不合并、不覆盖）。
- `FNOS-041-02-AC-02`：跳过时安装流程不失败，日志说明「保留用户自己那份」。

### FNOS-041-03

- `FNOS-041-03-AC-01`：安装/升级脚本中不再出现对 `.agents/skills/trim-cli` 的写入或删除。
- `FNOS-041-03-AC-02`：老用户升级后该目录内容保持不变。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 初始登记 | 建立 FNOS-041。提出人要求把内置 skill 从 trim-cli 换成 `fnnas-labs/fnos-cli-skill`，并明确「用户已装则忽略」「老用户 trim-cli skill 不要删」。调研确认上游 skill 自带启动器、包为 private 需随包分发、`app/` 整体进 FPK，且升级回调转发到安装回调。5 条调研结论，关联 PLAN-FNOS-041。 |
