---
id: PLAN-FNOS-041
title: PLAN-FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli
description: 把上游 skill 随包内置到 app/skills，安装帮助器新增「已存在则跳过」的 install-skill，安装回调改用它并保留 trim-cli skill 与 CLI 安装。
status: completed
owner: tnnevol
planDate: 2026-10-30
targetVersion: 7.0.6
lastVerified: 2026-10-30
---

# PLAN-FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-041 |
| 计划日期 | 2026-10-30 |
| 对应需求 | [FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli](/requirements/FNOS-041-fnos-cli-skill) |
| 计划状态 | 实施完成（包级用例与产物冒烟通过；真实 NAS 验收待执行，版本提交随功能提交后执行） |

## 计划目标

按 [FNOS-041](/requirements/FNOS-041-fnos-cli-skill) 完成：上游 skill 随包内置 → 安装帮助器提供「已存在则跳过」的安装命令 → 安装回调改用它 → 文档与来源记录同步。

技术边界：只换 skill 来源，不改 trim-cli 的全局安装，不删除用户已有 skill。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| skill 来源 | `@trimjs/trim-cli` 包内 `skill/`，安装时从 npm 包取 | 随包 `app/skills/fnos-cli`（上游 `0.6.1`） | 不再依赖 npm 包内容，版本可钉 |
| 安装语义 | 覆盖式（先删目标再 rename） | **只在不存时安装**，存在即跳过 | 用户自装的版本不被抹掉 |
| 帮助器命令 | `copy-trim-cli-skill <pkg> <target>` | `install-skill <source> <target>`，输出 `installed`/`skipped` | shell 据此区分日志 |
| 老用户产物 | 每次安装都刷新 `~/.agents/skills/trim-cli` | 完全不碰该目录 | 已在用的 Agent 不受影响 |
| CLI 安装 | 全局装 trim-cli | 不变 | `trim` 命令仍可用 |
| 来源记录 | 无 | `app/skills/README.md` 记录仓库/tag/提交/许可 | 升级时可对照 |

## 实施任务

| 阶段 | 任务 | 产物 | 状态 |
| --- | --- | --- | --- |
| 一 | 把上游 `skills/fnos-cli/` 整目录内置，附许可与第三方声明 | `apps/fn-deepseek-harness/app/skills/` | 已完成 |
| 二 | 帮助器新增 `installSkillIfAbsent` 与 `install-skill` 命令，删除 `copyTrimCliSkill` | `packages/fnos-gateway/src/install-callback-helper/` | 已完成 |
| 三 | 安装回调去掉 trim-cli skill 复制，新增 `install_fnos_cli_skill` | `apps/fn-deepseek-harness/cmd/install_callback` | 已完成 |
| 四 | 用例：跳过语义、缺 `SKILL.md`、原子性、脚本契约 | `packages/fnos-gateway/tests/` | 已完成 |
| 五 | 产物冒烟：真帮助器跑一次 `installed`、再跑一次 `skipped` | 见[测试用例文档](/tests/FNOS-041-fnos-cli-skill) | 已完成 |
| 六 | 文档与应用页更新 | `docs/apps/fn-deepseek-harness.md`、`app/skills/README.md` | 已完成 |
| 七 | 真实 NAS 验收（新装、已装跳过、老用户保留） | 验收证据 | 待执行 |

## 技术要点

- 帮助器输出 `installed`/`skipped` 而不是静默成功：shell 需要据此给出不同日志，测试也能断言语义。
- 「存在」用 `stat` 判断，空目录同样算存在——上一次安装中断留下的空目录不应被覆盖，否则会掩盖失败现场。
- 复制走 `cp` 到 `${target}.tmp-<pid>` 再 `rename`：中途失败不会留下半成品，也不会让下次安装误判「已安装」。
- `cp` 保留源文件的执行位，`scripts/fnos-cli` 到用户目录后仍可直接执行。
- 升级回调只转发到 `install_callback`，因此新逻辑只需放一处即可覆盖安装与升级。

## 风险与回退

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| FPK 未包含 `app/skills` | 安装回调用 `[ -f SKILL.md ]` 直接失败并中止安装 | 安装前显式校验，失败即 fail_install（不静默跳过）；真机验收确认 |
| 用户目录只读或权限不足 | skill 装不上 | 安装失败会明确报错；不影响 DSH 本体使用 |
| 上游 skill 更新 | 内置版本落后 | 整目录替换并同步 `README.md` 的版本与提交号；不自动升级用户已装版本 |
| 首次运行需要联网下载 CLI | 离线环境 `fnos-cli` 不可用 | 属上游设计（文档已说明）；失败后重试同一入口，不影响其它功能 |

回退：把 `install_fnos_cli_skill` 从 `install_callback` 的调用序列移除、恢复 trim-cli skill 复制即可回到旧行为；随包目录可保留不删。
