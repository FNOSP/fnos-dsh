---
id: FNOS-030
title: FNOS-030 测试用例
description: FNOS-030 DSH 0.2.1-rc.3 插件适配与基线迁移的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-030-dsh-021-rc3-adaptation
plan: /plans/PLAN-FNOS-030-dsh-021-rc3-adaptation
status: 执行中
lastVerified: 2026-10-25
verifiedAt: 2026-10-25
---

# FNOS-030 测试用例

## 测试范围与需求分析

被测对象是 DSH 基线 `0.2.1-rc.2 → 0.2.1-rc.3` 迁移后的仓库运行时与八个插件副本（七个入库 + 不入库的 CodeBuddy 本地副本）。执行任务与阶段见 [PLAN-FNOS-030](/plans/PLAN-FNOS-030-dsh-021-rc3-adaptation)，覆盖需求功能：

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-030-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 七插件在新运行时加载与代表功能 | 门禁误拒、行挂起、宿主接缝行为差异 |
| [FNOS-030-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-02) | 界面插座位置与主题 | rc.3 导航定制改动波及插件区块 |
| [FNOS-030-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-03) | CodeBuddy 本地副本加载 | 副本锚定漂移、`webStartup` 接缝变化 |
| [FNOS-030-04](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-04) | 基线三方一致与三方插件门禁 | `latest` 仍指 rc.2 导致装错版本 |
| [FNOS-030-05](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-05) | 既有用户数据保持 | 迁移过程改写数据 |
| [FNOS-030-06](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-06) | 联调检出与 Desktop 版本 | 检出 tag、启动版本与插件锚定不匹配 |

回归基线来源：[FNOS-014](/requirements/FNOS-014-dsh-021-rc2-adaptation) 在 `0.2.1-rc.2` 上的双客户端验收行为（插件管理页状态、界面区块位置、登录态与用量显示）。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-030-01、02、05 | DSH Web 与 DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME` 指向仓库 `.dsh`，带 token 地址）；Desktop：上游检出开发态（`fork-pj/deepseek-harness`，CDP 取证） |
| FNOS-030-03 | 本地开发态运行时 | 开发态 Desktop / DSH Web 加载 CodeBuddy 副本走查 |
| FNOS-030-04 | 本地构建链路 + DSH Web | `pnpm run check`、启动日志版本核对、`dshmarket` peer 判定 |
| FNOS-030-06 | DSH Desktop | `git describe` 与启动日志版本核对 |

## 测试用例

### [FNOS-030-01 七个入库插件在新运行时正常加载](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-030-01 | 插件管理页七个插件无异常 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 基线迁移完成，DSH Web 以 rc.3 启动 | 1.启动 DSH Web（带 token 地址）2.打开插件管理页 3.逐个核对七个插件行 | 全部插件行正常显示、无「异常」标记、无行挂起；组合包显示已启用 | P0 | [FNOS-014-01](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-01) 同口径 |
| TC-002 | FNOS-030-01 | 运行日志无插件加载错误 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | TC-001 执行后 | 1.查看 DSH Web 启动与运行日志 2.检索模块未找到、插座未声明、挂起类错误 | 无此类错误 | P0 | [FNOS-014-01-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-01) 同口径 |
| TC-003 | FNOS-030-01 | Codex Auth 登录态与用量显示 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 迁移前已有登录凭据（沿用既有账号） | 1.打开 Codex Auth 详情页 2.核对账号区 3.发起一次对话查看用量 | 登录态保持；模型目录可同步；用量显示剩余额度与重置时间 | P0 | [FNOS-014-03](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-03) |
| TC-004 | FNOS-030-01 | Failover Search 开关与转移 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载，既有偏好生效 | 1.核对输入区开关节 2.执行一次搜索类请求 | 开关状态与迁移前一致；搜索按配置顺序执行 | P1 | [FNOS-014-05](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-05) |
| TC-005 | FNOS-030-01 | Midscene 桥接健康检查 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载 | 1.`curl` 桥接健康端点（端口按实际值） 2.核对模型目录 | 健康检查返回正常；模型目录映射宿主提供方 | P1 | [FNOS-014-06](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-06) |
| TC-006 | FNOS-030-01 | OpenCode 合并目录与后缀 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 已有 OpenCode 登录凭据 | 1.打开 OpenCode 详情页 2.核对模型目录卡片 | 单一 `OpenCode` 分组；模型名带 `· zen` / `· go` 后缀；计数与搜索可用 | P1 | [FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) 双客户端验收行为 |
| TC-007 | FNOS-030-01 | ZCode 登录态与额度显示 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 已有 ZCode 登录凭据 | 1.打开 ZCode 详情页 2.核对账号与额度卡片 | 登录态保持；额度窗口显示与迁移前口径一致 | P1 | [FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) 双客户端验收行为 |
| TC-008 | FNOS-030-01 | Semi UI Showcase 渲染 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载 | 1.打开 Semi UI Showcase 详情页 2.核对组件区块 | 各区块渲染无异常 | P2 | [FNOS-014-07](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-07) |
| TC-009 | FNOS-030-01 | fnos 插件在 DSH Web 的加载状态 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-01) | 插件已加载（本地 Web 无 fnOS 宿主） | 1.核对插件管理页 fnos 行状态 | 插件包本身加载不报错（fnOS 专属能力不在 Web 验收，NAS 验证按后续流程） | P2 | [FNOS-014-14](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-14) 的 NAS 边界口径 |

### [FNOS-030-02 插件界面契约保持](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | FNOS-030-02 | 七类插座位置不变 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-02) | 插件已加载 | 1.核对插件详情区块 2.核对会话头部工具 3.核对输入区左右插槽 4.核对侧栏底部与设置动作 | 各区块出现在与 rc.2 基线相同的位置，无缺失、无重复 | P0 | [FNOS-014-08](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-08) |
| TC-011 | FNOS-030-02 | 亮暗主题渲染与切换 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-02) | 插件已加载 | 1.亮色主题走查插件区块 2.切暗色主题 3.再切回 | 两主题下文本/边框/背景对比可读；切换实时生效、无残留 | P1 | [FNOS-014-08-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-08) |

### [FNOS-030-03 CodeBuddy 本地副本随基线可用](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | FNOS-030-03 | 副本构建通过 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-03) | 副本 peer/compatibility 已改写 rc.3 | 1.在副本目录执行 check（typecheck+单测+build） | 命令退出码 0；产物生成 | P0 | [FNOS-025](/requirements/FNOS-025-codebuddy-plugin-delisting) 下架前的构建口径 |
| TC-013 | FNOS-030-03 | 副本在开发态运行时加载 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-03) | 开发态运行时为 rc.3，副本已装入本地 profile | 1.打开插件管理页核对 CodeBuddy 行 2.打开详情页 | 插件行不挂起；配置区块渲染、登录入口可见（不要求完成真实登录） | P1 | [FNOS-014-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-02) 同口径 |

### [FNOS-030-04 仓库运行与构建基线同步](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-014 | FNOS-030-04 | 基线三方一致 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-04) | 版本命令已执行 | 1.核对 catalog `@deepseek-ai/dsh` 2.核对 `install_callback` `DSH_VERSION` 3.核对插件 compatibility | 三处均为 `0.2.1-rc.3`；`pnpm run check` 通过 | P0 | [FNOS-014-12](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-12) 四处同源口径 |
| TC-015 | FNOS-030-04 | DSH Web 运行时版本核对 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-04) | TC-001 环境 | 1.读启动日志或关于页版本 2.与插件兼容声明比对 | 运行时报告 `0.2.1-rc.3`，与插件锚定一致 | P0 | [FNOS-014-12-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-12) |
| TC-016 | FNOS-030-04 | dshmarket 门禁判定 | [AC-03](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-04) | 基线已切 rc.3 | 1.semver 判定 peer 范围 2.（可选）本地 profile 安装链路验证 | `^0.2.1-rc.1` 包含 `0.2.1-rc.3`，安装不被拒 | P1 | [FNOS-014-11](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-11) |
| TC-017 | FNOS-030-04 | 全插件包级验证 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-04) | 锚定改写完成 | 1.逐插件执行 check 2.仓库级 `pnpm run check` | 全部退出码 0，基线一致性用例通过 | P0 | [FNOS-014-12](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-12) 23 任务全绿口径 |

### [FNOS-030-05 用户数据兼容](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | FNOS-030-05 | 既有凭据与偏好保持 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-05) | 迁移前记录凭据/偏好清单 | 1.迁移后启动 DSH Web 2.核对各插件登录态 3.核对模型配置与开关偏好 | 凭据、账号、偏好、模型配置全部生效，无需重新登录或配置 | P0 | [FNOS-014-09](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-09) |
| TC-019 | FNOS-030-05 | 迁移无数据改写 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-05) | TC-018 环境 | 1.比对迁移前后 `.dsh` 关键文件（内容与权限） | 文件内容与权限（600）未被迁移过程改写 | P1 | [FNOS-014-09-AC-02](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-09) |

### [FNOS-030-06 Desktop 联调检出更新](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-020 | FNOS-030-06 | 检出 tag 核对 | [AC-01](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-06) | fetch 完成 | 1.在检出目录执行 `git describe --tags` | HEAD 精确落在 `dsh-v0.2.1-rc.3` | P0 | 新增行为，无回归基线 |
| TC-021 | FNOS-030-06 | Desktop 版本与插件加载 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-06) | 检出已装依赖；项目 `.dsh` 作 `DSH_HOME` | 1.启动开发态 Desktop（渲染调试端口）2.读运行时版本 3.核对插件管理页 | 版本报告 `0.2.1-rc.3`；七插件 + CodeBuddy 副本加载正常 | P0 | [FNOS-014-01-AC-03](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-01) Desktop 口径 |
| TC-022 | FNOS-030-06 | Desktop 界面回归 | [AC-02](/requirements/FNOS-030-dsh-021-rc3-adaptation#fnos-030-06) | TC-021 通过 | 1.CDP 走查插件详情与输入区块 2.亮暗主题切换 | 与 Web 侧结论一致：区块位置不变、主题切换生效 | P1 | [FNOS-014-08](/requirements/FNOS-014-dsh-021-rc2-adaptation#fnos-014-08) |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-020 | FNOS-030-06 | DSH Desktop | 通过 | 2026-10-25 | 检出 `git describe` = `dsh-v0.2.1-rc.3`（fetch 官方 tag 后 checkout，工作区干净） |
| TC-016 | FNOS-030-04 | 本地构建链路 | 通过 | 2026-10-25 | `dshmarket@1.66.47` peer `^0.2.1-rc.1`；semver satisfies `0.2.1-rc.3` = true（semver 7.8.5 判定） |

其余用例待执行，随执行回填。

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 暂无 | — | — | — |

## 测试结论

尚未执行。全部用例执行后给出最终结论（通过 / 部分通过 / 未通过）与遗留风险。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-25 | 初始登记 | 建立 FNOS-030 测试用例文档：22 条用例，覆盖六项功能；双客户端（DSH Web + 开发态 Desktop）执行；TC-020/TC-016 随调研先行通过。 |
