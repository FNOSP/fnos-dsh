---
id: FNOS-028
title: FNOS-028 测试用例
description: FNOS-028 项目与插件版本统一 5.10.0、版本维护 bumpp 化（原生菜单透传 + execute 同步钩子）、FPK 组合命名与 dsh 基线标注的测试用例、执行结果与最终测试结论。
requirement: /requirements/FNOS-028-unified-project-version-bumpp
plan: /plans/PLAN-FNOS-028-unified-project-version-bumpp
status: 已完成
lastVerified: 2026-10-25
verifiedAt: 2026-10-25
---

# FNOS-028 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | [FNOS-028](/requirements/FNOS-028-unified-project-version-bumpp) |
| 关联计划 | [PLAN-FNOS-028](/plans/PLAN-FNOS-028-unified-project-version-bumpp) |
| 覆盖功能 | [FNOS-028-01](/requirements/FNOS-028-unified-project-version-bumpp#fnos-028-01) 至 [FNOS-028-07](/requirements/FNOS-028-unified-project-version-bumpp#fnos-028-07) |
| 测试状态 | <Badge type="tip" text="验收通过（2026-10-25：提出人确认需求验收通过）" /> |
| 用例总数 | 24 |
| 通过 | 22 |
| 部分通过 | 0 |
| 未执行 | 2（真机升级 AC 与 npm latest AC，见结论） |
| 测试环境 | 仓库本地（macOS arm64 / Node 24）、真实终端交互验收、`fnpack` 本地构建解包 |

## 用例与结果

### 版本统一（FNOS-028-01）

| 用例 | 步骤 | 预期 | 结果 | 状态 |
| --- | --- | --- | --- | --- |
| TC-001 | 盘点根/docs/packages×5/tooling/插件×8 的 `version` 字段 | 全部为 `5.10.0` | 16 处全部 `5.10.0`（含 local-only codebuddy） | <Badge type="tip" text="通过" /> |
| TC-002 | `manifest` version 行、应用文档页版本行、published 副本、总览表格与安装命令 | 全部 `5.10.0`，无 6.x/小尾巴残留 | 版本行、副本与 15 处安装命令全部 `5.10.0`；`dshmarket@1.66.47`（第三方）正确不动 | <Badge type="tip" text="通过" /> |
| TC-003 | `pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins` 后解包核对 FPK 内 manifest | `version = 5.10.0`，changelog 为本轮内容，desc 含基线字样 | 解包核对全部一致（本地构建；真机安装见 TC-023） | <Badge type="tip" text="通过" /> |

### 版本命令 bumpp 化（FNOS-028-02）

| 用例 | 步骤 | 预期 | 结果 | 状态 |
| --- | --- | --- | --- | --- |
| TC-004 | 真实终端执行 `pnpm run version`（无参数） | 弹出 bumpp 原生菜单：Current version + Commits 摘要 + 各档位预览 + custom 输入 | 菜单完整呈现（5.10.0、12 Commits、major 6.0.0/minor 5.11.0/patch 5.10.1/next/conventional/pre-*/as-is），summary 与 `Bump?` 确认均原生 | <Badge type="tip" text="通过" /> |
| TC-005 | 菜单/参数选定 `patch` 后走完整发布 | 一次执行完成全部包与插件同号递增 + 单条 release 提交 + 本地 tag | `chore: release v5.10.1` 单条提交 32 文件（插件/副本/安装命令/manifest/packages 全进）+ `v5.10.1` tag + 工作区干净（验收后按纪律移除） | <Badge type="tip" text="通过" /> |
| TC-006 | 单测断言三档增量（patch/minor/major）与显式版本串 | `5.10.0→5.10.1` / `→5.11.0` / `→6.0.0` | `version.spec.ts` 覆盖，95 用例全绿 | <Badge type="tip" text="通过" /> |
| TC-007 | 传小尾巴版本串 `5.10.1-0.2.1-rc.2.1` / 档位 `prerelease` | 明确报错指引，不产出半成品 | 转发层守卫拒绝并提示纯净三段式规范 | <Badge type="tip" text="通过" /> |
| TC-008 | bumpp 菜单选 `conventional-prerelease`（产出 5.11.0-beta.1）并确认 | 仓库不发布预发布版本 | version-sync 入口守卫拒绝含 `-` 目标版本并中止发布（实测堵住菜单 pre-* 档位缺口；bumpp 自身行为：确认前 files 已替换，取消后需 `git checkout` 还原） | <Badge type="tip" text="通过" /> |
| TC-009 | `major --baseline 0.2.2-rc.1`；`patch --baseline`；`major --baseline <当前值>` | baseline 仅 major 合法；spawn bumpp 前改写 catalog；非法搭配与同值拒绝 | 单测与实测均通过；catalog 改写在确认后、bumpp 启动前完成 | <Badge type="tip" text="通过" /> |
| TC-010 | 脏工作区执行版本命令 | 拒绝发版并点名脏文件 | 守卫实测拦截（bumpp 提交以 all 模式收口，脏改动会被卷入——硬约束必要） | <Badge type="tip" text="通过" /> |
| TC-011 | 插件与项目不同号时执行 | 报错点名漂移插件，不静默拉平 | 实测拦截 `@tnnevol/dsh-codebuddy@…（漂移值）` 并要求先统一 | <Badge type="tip" text="通过" /> |
| TC-012 | bumpp 的 npm 钩子链（根 `version` script 即入口自身） | 不得递归触发入口 | `bump.config.ts` 设 `ignoreScripts: true`（实测复现死循环式失败后修复）；同步由 execute 钩子承担 | <Badge type="tip" text="通过" /> |

### 插件发布与 dist-tag（FNOS-028-03）

| 用例 | 步骤 | 预期 | 结果 | 状态 |
| --- | --- | --- | --- | --- |
| TC-013 | 文档站总览与各插件页安装命令 | 全部 `@5.10.0`，与仓库版本一致 | 15 处 `@5.10.0`（version-sync 每次发布自动同步，单测断言副本/总览/安装命令三处一致） | <Badge type="tip" text="通过" /> |
| TC-014 | `generationOf('5.10.0')` 代际解析 | 返回 `undefined`，latest 维护自然跳过、不误判 | 单测覆盖（历史小尾巴版本的代际逻辑保留用于回滚场景） | <Badge type="tip" text="通过" /> |
| TC-015 | npm 发布 5.10.0 并维护 dist-tag | latest 指向 5.10.0，next 残留清理 | **未执行**：npm 发布不可撤回，待发布窗口由发布者执行（见结论） | <Badge type="info" text="未执行" /> |

### FPK 产物命名与基线标注（FNOS-028-04/05/06）

| 用例 | 步骤 | 预期 | 结果 | 状态 |
| --- | --- | --- | --- | --- |
| TC-016 | `build-app.yml` Rename 步骤源码审查 | 基线构建期从 catalog 派生，无硬编码 `DSH_VERSION` | env 硬编码已删除，`sed` 解析 catalog 行（本地实测输出 `0.2.1-rc.2`），解析失败即失败 | <Badge type="tip" text="通过" /> |
| TC-017 | 产物命名推导 | `fn-deepseek-harness-v5.10.0-dsh-0.2.1-rc.2.fpk` | 命名模板 = Tag + 派生基线（CI 实际附件见 TC-024 推送 tag 后核验） | <Badge type="tip" text="通过" /> |
| TC-018 | FPK manifest desc 基线字样 | 「运行基线为 DSH 0.2.1-rc.2」与 catalog 一致 | 解包核对一致；version-sync 每次发布自动对齐（含 `--baseline` 切换场景，单测覆盖） | <Badge type="tip" text="通过" /> |
| TC-019 | 应用文档页版本与基线双行 | 两个独立值；基线行随发布对齐 catalog | 「应用版本 `5.10.0`」+「DSH 基线 `0.2.1-rc.2`」分列，过期基线（0.2.0-rc.2）已修正并纳入自动同步 | <Badge type="tip" text="通过" /> |
| TC-020 | 文档站版本徽标 | 显示纯净项目版本 | 从 `docs/package.json` 读取，随发布自动更新（5.10.0） | <Badge type="tip" text="通过" /> |

### 校验与文档同步（FNOS-028-07）

| 用例 | 步骤 | 预期 | 结果 | 状态 |
| --- | --- | --- | --- | --- |
| TC-021 | 发布后 `git status` | 无遗留未同步的版本文件 | TC-005 发布后工作区干净（32 文件全进单条提交；local-only codebuddy 正确排除在外） | <Badge type="tip" text="通过" /> |
| TC-022 | `pnpm run check`（CLI 95 用例）+ `pnpm run check -- --sdd` + `pnpm run build -- --docs` + `git diff --check` | 全部通过 | 95 用例全绿；SDD 28+28 文档通过；文档构建通过 | <Badge type="tip" text="通过" /> |
| TC-023 | 真实 fnOS NAS 升级安装（`5.9.0-…rc.2.x → 5.10.0`） | 升级成功不判降级，用户数据保留 | **未执行**：属发布后真机验收（`5.10.0 > 5.9.0` 纯净三段比较，升级判定理论成立）；待推送 v5.10.0 tag 后按 NAS 装机流程执行 | <Badge type="info" text="未执行" /> |
| TC-024 | CI 双发布回归（v5.10.0 与后续版本） | Release 附件名含项目版本与派生基线 | **未执行**：待推送 tag 触发（workflow 改动已含解析失败即失败的保护） | <Badge type="info" text="未执行" /> |

## Bug 记录

| 编号 | 现象 | 根因 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| BUG-01 | local-only 插件 README 混入 `git add`，命令以「路径被忽略」失败 | `localOnlyPrefixes` 用 `join(repositoryRoot, …)` 拼绝对路径，与相对路径暂存清单的 `startsWith` 过滤失效 | 改回仓库相对路径前缀（提交 fafe78d） | TC-011 + 发布实测零混入 |
| BUG-02 | 根目录 `pnpm exec bumpp` 找不到命令 | bumpp 是 CLI 包依赖而非根 devDependency | 转发器直指 `tooling/fnos-dsh-cli/node_modules/bumpp/bin/bumpp.mjs`（.bin 内是 shell 包装脚本，node 不能直调） | TC-004/005 |
| BUG-03 | bumpp npm 钩子链递归触发入口（version script 即入口自身），发布死循环式失败 | bumpp 默认执行 preversion/version/postversion | `bump.config.ts` 设 `ignoreScripts: true`，同步由 execute 钩子承担 | TC-012 |
| BUG-04 | bumpp 菜单 pre-* 档位可产出 beta 版本，绕过纯净三段式约定 | 菜单选项由 bumpp 提供，转发层无法预判选择 | version-sync（execute 钩子）入口拒绝含 `-` 的目标版本，失败即中止提交 | TC-008 |

## 最终测试结论

**验收通过（2026-10-25，提出人确认）。**

核心链路全部实测通过：版本统一 5.10.0（16 处版本文件 + 15 处文档引用）、`pnpm run version` 直接调用 bumpp CLI（原生菜单/摘要/确认完整呈现）、一次发布产出单条 release 提交（32 文件含全部同步产物）+ 本地 tag、FPK 组合命名基线构建期派生、desc 基线字样自动对齐、四类守卫（脏工作区/档位语义/baseline 绑定/预发布版本）全部生效。实施中发现的 4 个缺陷（BUG-01~04）均已修复并回归。

遗留 3 项**发布后动作**（不阻塞需求验收，属发布窗口执行项）：TC-015 npm 发布与 dist-tag 维护（不可撤回，由发布者执行）、TC-023 真机升级验收、TC-024 CI 附件命名核验——后两者待推送 `v5.10.0` tag 后进行。按提出人纪律，测试性发布（v5.10.1 验收产物）已全部移除，仓库停在 5.10.0 待正式发版。
