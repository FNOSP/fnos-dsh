---
id: FNOS-041
title: FNOS-041 测试用例
description: FNOS-041 内置 Skill 由 trim-cli 换成 fnos-cli 的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-041-fnos-cli-skill
plan: /plans/PLAN-FNOS-041-fnos-cli-skill
status: 部分通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-041 测试用例

## 测试范围与需求分析

被测对象是内置 skill 的来源与安装语义：随包 skill 的完整性、帮助器「已存在则跳过」的行为、安装回调的调用序列，以及老用户 trim-cli skill 是否真的不再被触碰。执行任务见 [PLAN-FNOS-041](/plans/PLAN-FNOS-041-fnos-cli-skill)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-041-01](/requirements/FNOS-041-fnos-cli-skill#fnos-041-01) | 新装/升级得到 fnos-cli skill、启动器可执行 | FPK 漏带 `app/skills`，或启动器丢执行位 |
| [FNOS-041-02](/requirements/FNOS-041-fnos-cli-skill#fnos-041-02) | 已装则整目录跳过 | 覆盖或合并抹掉用户自己的版本 |
| [FNOS-041-03](/requirements/FNOS-041-fnos-cli-skill#fnos-041-03) | 老用户 trim-cli skill 保留 | 脚本里残留写入/删除动作 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-041-01、02 | 包级（Node / vitest） | `packages/fnos-gateway/tests/install-skill.spec.ts` |
| FNOS-041-01、03 | 构建产物 | `pnpm --filter @tnnevol/fnos-gateway run build:app` 后的 `app/scripts/install-callback-helper.mjs` 实跑 |
| FNOS-041-01 ~ 03 | 脚本契约 | `packages/fnos-gateway/tests/trim-cli-install.spec.ts` 断言 `install_callback` 源码 |
| FNOS-041-01 ~ 03 | 真实 fnOS NAS | 构建 FPK → 应用中心安装/升级（**未执行**） |

## 测试用例

### [FNOS-041-01 内置 fnos-cli skill](/requirements/FNOS-041-fnos-cli-skill#fnos-041-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-041-01 | 目标不存在时安装 | AC-01 | 临时目录 | 1.`installSkillIfAbsent(源, 目标)` | 返回 `installed`，`SKILL.md` 与 `scripts/fnos-cli` 都在 | P0 | 新装路径 |
| TC-002 | FNOS-041-01 | 启动器保持可执行 | AC-01 | 同上 | 1.检查目标 `scripts/fnos-cli` 权限 | 含执行位 | P0 | 首次调用依赖它 |
| TC-003 | FNOS-041-01 | 自动创建 skills 父目录 | AC-01 | 目标父级不存在 | 1.安装 | 父级与目标都被创建 | P1 | `${HOME}/.agents` 可能不存在 |
| TC-004 | FNOS-041-01 | 缺 `SKILL.md` 时明确失败 | AC-03 | 源目录为空 | 1.安装 | 抛错且目标不存在 | P0 | 防止装空壳 |
| TC-005 | FNOS-041-01 | 不留临时目录 | AC-03 | 正常安装 | 1.安装后列父目录 | 只有 `fnos-cli` 一项 | P1 | 原子性 |
| TC-006 | FNOS-041-01 | 真帮助器端到端 | AC-01 | 已构建产物 | 1.`node app/scripts/install-callback-helper.mjs install-skill 源 目标` | 输出 `installed`，目录内容完整 | P0 | 真产物冒烟（已执行） |
| TC-007 | FNOS-041-01 | 真机新装/升级 | AC-01、AC-02 | 真实 NAS | 1.安装/升级后检查 `${HOME}/.agents/skills/fnos-cli` | 存在且 Agent 可用 | P0 | 本轮未执行 |

### [FNOS-041-02 已安装则跳过](/requirements/FNOS-041-fnos-cli-skill#fnos-041-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | FNOS-041-02 | 用户版本不被覆盖 | AC-01 | 目标已有 `SKILL.md='user version'` | 1.安装 | 返回 `skipped`，内容仍为 `user version` | P0 | 覆盖会抹掉用户改动 |
| TC-009 | FNOS-041-02 | 不合并文件 | AC-01 | 用户目录无 `scripts/` | 1.安装后检查 | `scripts/fnos-cli` 仍不存在 | P0 | 合并会造出半新半旧目录 |
| TC-010 | FNOS-041-02 | 空目录也算已安装 | AC-01 | 目标为空目录 | 1.安装 | 返回 `skipped` | P1 | 中断现场的语义 |
| TC-011 | FNOS-041-02 | 真帮助器二次执行 | AC-02 | 已跑过一次 | 1.再跑同一命令 | 输出 `skipped`（已执行） | P0 | 重复安装幂等 |
| TC-012 | FNOS-041-02 | 真机已装跳过 | AC-01、AC-02 | 真实 NAS 且已自装 | 1.升级后比对目录内容 | 内容不变 | P0 | 本轮未执行 |

### [FNOS-041-03 老用户 trim-cli skill 保留](/requirements/FNOS-041-fnos-cli-skill#fnos-041-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | FNOS-041-03 | 脚本不再调用旧命令 | AC-01 | 读取 `install_callback` | 1.断言无 `copy-trim-cli-skill` | 不包含 | P0 | 迁移后应彻底消失 |
| TC-014 | FNOS-041-03 | 不再写入 trim-cli skill 目录 | AC-01 | 同上 | 1.断言无 `.agents/skills/trim-cli` 路径 | 不包含 | P0 | 防误加回 |
| TC-015 | FNOS-041-03 | CLI 安装保留 | AC-01 | 同上 | 1.断言仍安装 `@trimjs/trim-cli@latest -g` | 存在 | P1 | 只换 skill，不砍 CLI |
| TC-016 | FNOS-041-03 | 调用顺序在插件之前 | — | 同上 | 1.比较 `install_fnos_cli_skill` 与 `install_published_dsh_plugins` 位置 | 在前 | P2 | 与既有顺序约定一致 |
| TC-017 | FNOS-041-03 | 真机老用户保留 | AC-02 | 真实 NAS 已有 trim-cli skill | 1.升级后检查该目录 | 内容与升级前一致 | P0 | 本轮未执行 |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 ~ TC-005、TC-008 ~ TC-010 | 通过 | `tests/install-skill.spec.ts`（6 条） |
| TC-006、TC-011 | 通过 | 用构建产物实跑：首次输出 `installed`，第二次输出 `skipped`；目标目录 41 个文件，`scripts/fnos-cli` 可执行 |
| TC-013 ~ TC-016 | 通过 | `tests/trim-cli-install.spec.ts`（7 条，含新增 4 条契约断言） |
| TC-007、TC-012、TC-017 | 未执行 | 需构建 FPK 后在真实 fnOS NAS 安装/升级验证 |

构建与静态检查：

- `packages/fnos-gateway`：`vitest run` 24 文件 / 155 条通过；`tsc --noEmit` 通过。
- `bash -n cmd/install_callback`：语法通过。
- `tsdown --config tsdown.app.config.ts`：帮助器产物重建，含 `install-skill`、不含 `copy-trim-cli-skill`。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| BUG-041-01 | 旧用例断言 `install_trim_cli` 会输出 `helper:copy-trim-cli-skill` | 迁移后该行为已删除 | 用例改为断言「不再出现该命令与路径」，并新增 4 条 fnos-cli 契约断言 |

## 最终结论

包级与产物层已验证：新装得到完整且可执行的 fnos-cli skill，已存在时整目录跳过且不合并，安装回调不再触碰 trim-cli skill 目录、CLI 安装保留。

真机结论待补：TC-007、TC-012、TC-017 需构建 FPK 后在真实 fnOS NAS 验证，届时回填本节与 `docs/validation/` 证据。
