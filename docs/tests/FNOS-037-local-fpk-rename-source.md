---
id: FNOS-037
title: FNOS-037 测试用例
description: FNOS-037 本地构建 FPK 改名定位到错误产物的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-037-local-fpk-rename-source
plan: /plans/PLAN-FNOS-037-local-fpk-rename-source
status: 通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-037 测试用例

## 测试范围与需求分析

被测对象是本地构建链路的 FPK 改名行为：`fnpack` 产出固定名 `<app>.fpk` 后，CLI 是否把**本次产物**改名为发布名，以及残留产物是否被显式提示。执行任务见 [PLAN-FNOS-037](/plans/PLAN-FNOS-037-local-fpk-rename-source)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-037-01](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01) | 改名作用于本次产物、目录不留固定名残留 | 残留旧包被误选，名字与内容错配且无报错 |
| [FNOS-037-02](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-02) | 残留产物提示、缺产物时报错 | 静默通过，装机拿到旧包 |

缺陷基线（修复前实测）：`apps/fn-deepseek-harness/` 下同时存在 `fn-deepseek-harness-v7.0.0-dsh-0.2.1-rc.5.fpk`（包内 `version = 6.1.15`、基线 rc.3）与 `fn-deepseek-harness.fpk`（包内 `version = 7.0.0`、基线 rc.5）。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-037-01、02 | 本地构建链路 | `pnpm --filter @tnnevol/fnos-dsh-cli test`；临时目录行为用例；变异验证 |
| FNOS-037-01 | 本地构建链路 | `pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins`，解包 `manifest` 核对 |

## 测试用例

### [FNOS-037-01 改名作用于本次构建的产物](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-037-01 | 残留同名旧产物时改动的是本次新包 | [AC-01](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01) | 临时目录内放同名旧目标（内容 `stale-build`）与固定名新包（内容 `fresh-build`） | 1.调用 `renameFpkToRelease` 2.读目标名内容 | 目标名内容为 `fresh-build`；`replacedStaleTarget` 为 true | P0 | 缺陷现场：名字与内容错配 |
| TC-002 | FNOS-037-01 | 构建后不残留固定名产物 | [AC-02](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01) | TC-001 同环境 | 1.改名后列举目录 | 目录内只剩发布名一份，无 `<app>.fpk` | P0 | 新增行为 |
| TC-003 | FNOS-037-01 | 命名模板仍与 CI 同形 | [AC-03](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01) | 无 | 1.运行 `fpk-release-naming.spec.ts` | 模板归一后两侧相等；均以 `.fpk` 结尾、含 `-dsh-` | P0 | 2026-10-29 引入的命名契约 |
| TC-004 | FNOS-037-01 | 实现回退时行为用例变红 | [AC-01](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01) | 已备份实现文件 | 1.把取源改回「扫目录第一个 .fpk」2.运行 `fpk-artifacts.spec.ts` 3.还原复跑 | 缺陷版 3 条失败（含 `expected 'stale-build' to be 'fresh-build'`）；还原后 4 条全绿 | P0 | 变异验证，防止用例空转 |
| TC-005 | FNOS-037-01 | 真实构建产物的名字与内容一致 | [AC-01](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-01) | 上一轮遗留产物在目录内 | 1.本地执行 FPK 构建 2.解包发布名产物 3.读 `manifest` 的 `version` 与基线 | 发布名产物内的版本与基线等于本次构建值 | P0 | 提出人现场 |

### [FNOS-037-02 残留产物被显式报告](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | FNOS-037-02 | 命名不同的旧包被列举且不删除 | [AC-01、AC-02](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-02) | 目录内有 `app-v7.0.0-...fpk` 旧包与固定名新包 | 1.调用 `renameFpkToRelease` 2.读 `leftovers` 3.读旧包内容 | `leftovers` 含旧包名；旧包内容未被改写 | P1 | 新增行为 |
| TC-007 | FNOS-037-02 | 缺固定名产物时报错且指出期望名 | [AC-03](/requirements/FNOS-037-local-fpk-rename-source#fnos-037-02) | 目录内只有其它命名的 `.fpk` | 1.调用 `renameFpkToRelease` | 抛错并包含 `fnpack produced no app.fpk`，不退化去猜别的文件 | P1 | 新增行为 |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-037-01 | 本地（vitest 临时目录） | 通过 | 2026-10-30 | `tests/fpk-artifacts.spec.ts`：目标名内容断言为 `fresh-build`，`replacedStaleTarget` true |
| TC-002 | FNOS-037-01 | 本地（vitest 临时目录） | 通过 | 2026-10-30 | 改名后目录仅剩发布名一份 |
| TC-003 | FNOS-037-01 | 本地（vitest） | 通过 | 2026-10-30 | `fpk-release-naming.spec.ts` 7 条通过，模板改读 `core/fpk-artifacts.ts`；新增「不扫目录第一个 .fpk」断言 |
| TC-004 | FNOS-037-01 | 本地（变异验证） | 通过 | 2026-10-30 | 缺陷版复现：`expected 'stale-build' to be 'fresh-build'`、`expected 'old' to be 'fresh'`、`promise resolved ... instead of rejecting`，3 条失败；还原后 4 条全绿。源码形状断言同时变红 |
| TC-006 | FNOS-037-02 | 本地（vitest 临时目录） | 通过 | 2026-10-30 | `leftovers` 为 `['app-v7.0.0-dsh-0.2.1-rc.3.fpk']`，旧包内容保持 `old` |
| TC-007 | FNOS-037-02 | 本地（vitest 临时目录） | 通过 | 2026-10-30 | 报错文案含 `fnpack produced no app.fpk` |
| TC-005 | FNOS-037-01 | 本地构建链路 | 通过 | 2026-10-30 | 实跑 `pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins`：输出「Release FPK: …-v7.0.0-dsh-0.2.1-rc.5.fpk」并提示「已覆盖同名的上一轮产物」；构建后目录只剩这一份，解包 `manifest` 为 `version = 7.0.0`、基线 `0.2.1-rc.5`。原先「名字是 v7.0.0/rc.5、内容是 6.1.15/rc.3」的错配文件被本次产物覆盖，无需手工删除 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-001、TC-005 | 改名取源文件用「目录里第一个 `.fpk`」，残留旧产物被选中后与新目标同名而提前返回，本次新包留在原名，产物名字与内容错配且无任何报错 | P1 | 已修复 | 取源改为 `fnpack` 固定产物名 `<app>.fpk`（新增 `core/fpk-artifacts.ts`）；同名目标由 rename 原子覆盖；残留的其它 FPK 由构建输出警告。新增行为用例 + 变异验证，实现回退时用例变红 |

## 测试结论

**通过**：7 条用例全部通过，0 失败、0 阻塞。

- **执行统计**：通过 7（TC-001～TC-007）/ 失败 0 / 阻塞 0；CLI 用例总数 100 → 105。
- **一句话结论**：本地 FPK 改名已改为按 `fnpack` 固定产物名取源，残留同名旧产物被本次产物覆盖、命名不同的旧包保留并告警；命名模板与 CI 保持同形；实跑构建确认发布名产物内的版本与基线来自本次构建，原先错配的文件已被覆盖。
- **遗留风险**：
  1. **命名不同的历史产物不会被清理**：修复后同名目标会被覆盖，但若目录里还留着别的版本的 FPK，构建只告警不删除，需使用者自行处置（E2E 要求目录内恰好一份，多份会直接报错，不会静默装旧包）。
  2. **CI 侧未改动**：`build-app.yml` 仍用 `find ... -quit` 取文件，在干净检出上无缺陷；若将来 CI 工作区复用，会有同样问题。
  3. **打包体积与本次修复无关**：验证构建使用 `--skip-bundle-dsh-plugins`，产物约 166 KB，与 CI 同参数同量级；带内置插件的完整包体积另计。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 初始登记与包级结果回填 | 建立 FNOS-037 用例文档：7 条用例覆盖两项功能；回填 6 条通过结果，含变异验证（缺陷版 3 条失败、还原后全绿）。真实构建核对列为待执行。 |
