---
id: FNOS-012
title: FNOS-012 测试用例
description: FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-012-codebuddy-model-speed-and-client-version
plan: /plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version
status: 规划中
lastVerified: 2026-10-10
verifiedAt: 2026-10-10
---

# FNOS-012 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-012 |
| 关联需求 | [FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新](/requirements/FNOS-012-codebuddy-model-speed-and-client-version) |
| 关联计划 | [PLAN-FNOS-012 CodeBuddy 模型倍速展示与客户端版本更新](/plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version) |
| 测试状态 | <Badge type="info" text="规划中" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#功能列表) 中 FNOS-012-01 至 FNOS-012-06 全部功能：

- `/model` 模型列表展示倍速，目录未披露时不编造（[FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01)）。
- 插件请求携带的 CLI / WorkBuddy 客户端版本与官方一致（[FNOS-012-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02)）。
- web profile 的 `minimumReleaseAgeExclude` 失效条目触发依赖重建自愈（[FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03)）。
- npm `latest` 标签校正与发布后的自动维护（[FNOS-012-04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04)）。
- 插件发布内容完整性校正：`compatibility.json` 包清单与源码依赖一致（[FNOS-012-05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05)）。

**关键风险点**：

- **倍速展示不得改变行为**：倍速是展示信息，用例须同时断言模型路由、预算与请求行为未被影响（需求行为约束）。
- **自愈的破坏性边界**：依赖重建会清理 `lockfile` 与 `node_modules`，用例必须验证用户配置与凭据**不被触碰**——这是唯一有数据丢失风险的路径。
- **版本指纹是外部契约**：客户端版本号与官方一致才能避免服务端按旧版本对待，但不能靠「改了常量」自证，须以真实请求的指纹取证。
- **发布类功能（04/05）的验证对象是 registry 与已发布包**，不是仓库源码：源码正确不等于线上正确，用例强制「解包核对」而非只看版本号（本轮 `FNOS-012-05` 的真实缺口正是「源码已修、线上包未含」）。
- 依赖 npm 发布权限：当前环境 `npm whoami` 曾返回 401，执行发布类用例前必须先 `npm login`；无权限时该组用例标记「阻塞」而非「失败」。

## 测试环境

目标环境按[需求的验收环境范围](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#验收环境范围)划分；执行方式遵循[测试环境执行方式](/charter/tests-spec#测试环境执行方式)：

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| [01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01)、[02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | DSH Web、DSH Desktop | Web：`DSH_HOME=<repo>/.dsh pnpm exec dsh web`；Desktop：项目 `.dsh/profiles/desktop`（`DSH_DESKTOP_APP_DIR` 指向上游检出 `fork-pj/deepseek-harness`）；两者均需覆盖 |
| [03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 本地 DSH Web profile + 真实 fnOS NAS | 本地在项目 `.dsh` 构造残留条目；NAS 走真实安装/升级链路 |
| [04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04)、[05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | npm registry（只读核对）+ 本地发布链路 | `npm view` / registry HTTP 查询；发布类操作需先 `npm login` |

**版本三元组**（执行前记录，缺记录不得作为结论依据）：

| 环境 | 必须记录 |
| --- | --- |
| DSH Web | DSH 运行时版本、`@tnnevol/dsh-codebuddy` 构建版本、`@tnnevol/dsh-failover-search` 版本（05 涉及） |
| DSH Desktop | Desktop 客户端版本、内置 DSH 运行时版本、实际加载的插件版本 |
| 真实 fnOS NAS | fnOS 版本、FPK 应用版本、插件版本 |

**现场构造与恢复约定**（03 相关用例通用）：

- 在项目 `.dsh` 的测试 profile 内构造 `minimumReleaseAgeExclude` 残留条目，不动用户真实 profile；构造前备份 `pnpm-workspace.yaml` 到 `tmp/plugin-backup/`。
- 凭据文件一律不入仓库；发布类用例不得把 npm token 写入仓库或日志。

## 测试用例

### [FNOS-012-01 模型列表展示倍速](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 有倍速的模型名称带倍速小尾巴 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | CodeBuddy 已登录，模型目录可获取 | 1.会话内执行 `/model` 2.观察有 `credits` 的模型条目名称 | 条目名称带倍速小尾巴（如 `Hy3 · x3.33`），数值与模型目录返回的 `credits` 一致 | P0 | 新增行为，无回归基线 |
| TC-002 | [FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 目录未披露倍速时保持原名 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 目录中存在 `credits` 缺省或为空的模型 | 1.`/model` 打开列表 2.定位 `credits` 缺省的模型条目 | 该条目保持模型原名（无 `·` 小尾巴、无占位数值），其余条目不受影响 | P0 | 新增行为，无回归基线 |
| TC-003 | [FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 零倍率模型照常带 x0.00 小尾巴 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 目录中存在 `credits` 为 0 的免费模型 | 1.`/model` 打开列表 2.定位该模型 | 名称带 `· x0.00` 小尾巴——零倍率是有效事实，与「未披露」区分处理 | P1 | 新增行为，无回归基线 |
| TC-004 | [FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 倍速不影响模型选择与请求行为 | [FNOS-012-01 行为约束](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#行为约束) | 已展示倍速 | 1.选择一个带倍速的模型 2.发送一轮对话 3.核对实际请求的模型 id | 请求使用所选模型 id；倍速未参与路由、预算或请求参数——展示信息不改变行为 | P0 | 新增行为，无回归基线 |
| TC-005 | [FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 亮色与暗色主题下名称小尾巴可读 | [AC-03（修订后路由不变性）](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 已展示倍速 | 1.选择一个带倍速的模型并发送对话 2.核对实际请求的模型 id 与目录一致性 | 倍速仅存在于 `name` 展示字段；请求使用模型 `id`，路由、预算与请求参数不含倍速 | P0 | 新增行为，无回归基线（原「主题可读性」验收随承载方式修订并入本地走查） |
| TC-006 | [FNOS-012-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 超长模型名与超长倍速的布局边界 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-01) | 构造超长模型名条目 | 1.打开列表 2.观察超长名称与倍速的排布 | 名称按既有规则截断/换行，倍速位不被挤出容器或覆盖名称 | P3 | 新增行为，无回归基线 |

### [FNOS-012-02 客户端版本更新](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-012-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 请求指纹携带新版本号 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 插件构建已更新，账号已登录 | 1.发起一次对话请求 2.抓取请求头中的客户端版本指纹 | CLI 版本为 `2.163.0`、WorkBuddy 版本为 `5.77`；与常量表逐字符一致 | P0 | 基线：更新前指纹（`2.159.0` / `5.6.2`） |
| TC-008 | [FNOS-012-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 常量表与指纹断言测试同步 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 源码可读 | 1.读取版本常量 2.运行指纹相关单测 | 常量值与单测断言一致（无「改了常量但测试断言旧值」的脱节） | P1 | 新增行为，无回归基线 |
| TC-009 | [FNOS-012-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 版本更新后既有登录凭据继续有效 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 更新前已登录，存在既有凭据 | 1.升级插件到新版本 2.不重新登录直接发对话 3.查询用量与账号管理 | 无需重新登录即成功；账号管理与 Token 统计字段与更新前一致——版本号变化未使既有凭据失效 | P0 | 基线：更新前的登录与用量行为 |
| TC-010 | [FNOS-012-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 版本不一致时给出可诊断结果 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-02) | 构造服务端拒绝旧版本指纹的场景（如手工改回旧版本号） | 1.用旧版本号发起请求 2.观察错误呈现 | 错误可理解（不在界面暴露堆栈）；恢复正确版本号后立即恢复正常——用于确认版本号确实参与服务端判定 | P2 | 新增行为，无回归基线 |

### [FNOS-012-03 profile 依赖重建自愈](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 失效豁免条目触发清理重装 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 测试 profile 的 `pnpm-workspace.yaml` 存在指向失效版本的 `minimumReleaseAgeExclude` 条目 | 1.执行安装/升级 2.观察清理动作与安装结果 | 检测到失效条目 → 删除该 profile 的 `pnpm-lock.yaml` 与 `node_modules` → 在 profile 目录重新 `pnpm install`；日志含可理解的「检测到残留并重建」提示 | P0 | 新增行为，无回归基线 |
| TC-012 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 条目有效时不触发清理 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 豁免条目与清单版本一致 | 1.记录 `node_modules` 与 lockfile 的 mtime 2.执行安装/升级 3.复核 mtime | 不触发清理与重装；lockfile 与 `node_modules` 未被改写；安装流程与现状一致 | P1 | 新增行为，无回归基线 |
| TC-013 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 无该字段的 profile 不受影响 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | profile 内不存在 `minimumReleaseAgeExclude` | 执行安装/升级 | 跳过全部清理逻辑，流程与未引入该功能时一致 | P1 | 基线：引入自愈前的安装流程 |
| TC-014 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 字段本身不被删除 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 存在豁免条目（失效或有效均可） | 1.执行安装/升级 2.读取 `pnpm-workspace.yaml` | `minimumReleaseAgeExclude` 字段保留（它是让新发布插件正常安装的机制），仅失效条目引发依赖重建 | P0 | 新增行为，无回归基线 |
| TC-015 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 清理重装后安装不再被发布日期拦截 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 存在失效条目且清单含新发布插件 | 1.执行安装/升级 2.查看安装日志与结果 | 清单内插件全部按清单版本安装成功；不再出现 `NO_MATURE_MATCHING_VERSION` 类发布日期拦截 | P0 | 新增行为，无回归基线 |
| TC-016 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 清理不触碰用户配置与凭据 | [AC-04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 测试 profile 已有插件配置与登录凭据，且已记录其内容摘要 | 1.记录配置与凭据文件的 hash 2.触发一次清理重装 3.复核 hash 并实际使用 | 配置与凭据文件**逐字节未变**（hash 一致）；重装后既有登录与账号配置直接可用，无需重新配置 | P0 | 新增行为，无回归基线 |
| TC-017 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 自愈发生在插件安装之前 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 含失效条目的 profile | 1.执行完整安装流程 2.核对步骤顺序 | 清理重装先于插件安装；安装阶段不再遇到发布日期拦截 | P1 | 新增行为，无回归基线 |
| TC-018 | [FNOS-012-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 真实 NAS 上的自愈耗时与可理解性 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-03) | 真实 fnOS NAS，构造残留条目 | 1.在 NAS 上执行升级 2.记录耗时与日志 | 自愈成功完成；耗时可观测且有日志说明（用户能理解等待原因）；失败时不回滚用户数据 | P1 | 新增行为，无回归基线 |

### [FNOS-012-04 npm latest 标签校正](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-019 | [FNOS-012-04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 四个包的 latest 指向上一代最新版 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 可访问 npm registry | 1.`npm view <包> dist-tags` 2.对四个包逐一核对 | `latest` 均为 `0.1.7-rc.2.2`；`next` 仍指向 `0.2.0-rc.2.0` | P0 | 基线：校正前（`latest` 停在 `0.1.0-rc.7` 等早期版本） |
| TC-020 | [FNOS-012-04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 默认安装不再落到早期版本 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 校正已完成 | 1.在临时目录 `npm i @tnnevol/<插件>`（不带 tag）2.读取实际安装版本 | 安装到 `0.1.7-rc.2.2`；`0.2.0-rc.2.0` 仍只能通过 `next` 获取 | P0 | 新增行为，无回归基线 |
| TC-021 | [FNOS-012-04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 新代际首版发布时自动维护 latest | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 发布命令已实现 latest 维护；具备发布权限 | 1.用 CLI 单测覆盖代际判定（新代际→动 latest、同代际→不动）2.真实发布一次同代际版本后核对 dist-tags | 同代际迭代版（如 `0.2.0-rc.2.1`）**不移动** `latest`；新代际首版发布时把 `latest` 指向上一代最新稳定版 | P1 | 新增行为，无回归基线 |
| TC-022 | [FNOS-012-04](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 发布流程文档含 latest 约定 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-04) | 文档可读 | 阅读 [发布流程](/build/release) 中 dist-tag 相关章节 | 明确「`latest` 由发布命令自动维护」、给出代际规则与应急校正命令（`npm dist-tag add/rm/ls`），并说明 registry 全量写的备选方式 | P2 | 新增行为，无回归基线 |

### [FNOS-012-05 插件发布内容完整性校正](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05)
| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-023 | [FNOS-012-05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 清单与 peer 依赖集合一致 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 源码可读 | 1.读 `compatibility.json` 的 `dshPluginApi.packages` 2.读 `package.json` 的 `@deepseek-ai/dsh-*` peer 集合 3.比对 | 两者完全相等（当前 16 个包），含 `dsh-tools`、`dsh-agent`、`dsh-client-ui-conversation`、`dsh-web-fetch-http`——无缺口、无多余 | P0 | 基线：修正前清单（10 个包） |
| TC-024 | [FNOS-012-05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 仓库内一致性用例守门 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 仓库可执行测试 | 运行 `tooling/fnos-dsh-cli` 的 `keeps each compatibility package list aligned with source imports` 用例 | 用例通过；人为删除一个包声明后该用例**失败**（确认断言有牙齿而非恒真） | P0 | 新增行为，无回归基线 |
| TC-025 | [FNOS-012-05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 线上包确实含修正后的清单 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 修正已随某版本发布 | 1.`npm pack <包>@<版本>` 下载已发布产物 2.解包读取其 `compatibility.json` | 包内清单**已含全部 16 个依赖**——不是只看 `package.json` 版本号，而是核对产物内容 | P0 | 基线：`0.2.0-rc.2.1` 的线上包（仍为旧清单 10 个包） |
| TC-026 | [FNOS-012-05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 发布前复核产物的约定已落文档 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 发布流程文档可读 | 阅读 [发布流程](/build/release) 中产物复核相关章节 | 明确「发布后若源码再改动产物相关文件（`compatibility.json`、`cordis.patch.yml`、`package.json`）须随下次版本发布」；说明现有两条用例只校验仓库内清单、不校验已发布产物的边界 | P1 | 新增行为，无回归基线 |
| TC-027 | [FNOS-012-05](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 安装命令版本与已发布版本一致 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-05) | 文档与发布清单可读 | 运行 `keeps every documented install command on the released plugin version` 用例 | 用例通过；每个文档页的安装命令版本等于该插件当前发布版本（用户照抄不会装到旧包） | P1 | 新增行为，无回归基线 |

### [FNOS-012-06 智能搜索控件改为药丸按钮样式](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06)

实现见 [PLAN-FNOS-012 T01-10/T01-11](/plans/PLAN-FNOS-012-codebuddy-model-speed-and-client-version#阶段一实现与验证t01-01t01-11)；行为基线沿用 [FNOS-010-12 会话级智能搜索开关](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-028 | [FNOS-012-06](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 控件呈药丸按钮形态且无 Switch 与状态文案 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | DSH Web 已启动，插件已启用 | 1.观察消息框左下角控件 2.分别观察开启与关闭状态下的文案 | 控件为药丸按钮形态、可见文案固定为「智能搜索」；原 Switch 与「智能搜索已关」类状态文案均不再出现 | P0 | 基线：[FNOS-010-12 的 Switch+双态文案形态](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) |
| TC-029 | [FNOS-012-06](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 开启时激活态、关闭时普通态（仅样式区分） | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 控件可见（默认开启） | 1.观察开启态样式 2.点击切到关闭 3.再切回 4.全程核对可见文案是否变化 | 开启呈激活态样式、关闭呈普通态，两态**仅通过样式区分**且视觉可辨；可见文案始终为「智能搜索」不变；切换后下一次搜索行为与 [FNOS-010-12-AC-02/03](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) 一致 | P0 | 基线：[FNOS-010-12 开关行为](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) |
| TC-030 | [FNOS-012-06](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 亮暗主题下两态均可辨 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 控件可见 | 1.亮色主题观察激活/普通两态 2.切暗色主题重复 | 两个主题下激活态与普通态对比清晰，样式使用 DSH 语义变量 | P1 | 新增行为，无回归基线 |
| TC-031 | [FNOS-012-06](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 键盘可达与可访问名称保持 | [AC-03](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 控件可见 | 1.用 Tab 聚焦控件 2.按 Enter/Space 切换 | 聚焦可见、键盘切换生效；可访问名称随状态更新（沿用 [FNOS-010-12 TC-080](/tests/FNOS-010-thirdparty-web-search-failover) 约束） | P1 | 基线：[FNOS-010-12 键盘可达约束](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) |
| TC-032 | [FNOS-012-06](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 会话级语义与默认开启不变 | [AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | 打开两个会话 | 1.确认新会话默认开启 2.在 A 会话关闭 3.切到 B 会话观察 | 新会话默认开启；A 会话关闭不影响 B 会话（沿用 [FNOS-010-12-AC-01/04](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12)） | P1 | 基线：[FNOS-010-12 会话级语义](/requirements/FNOS-010-thirdparty-web-search-failover#fnos-010-12) |
| TC-033 | [FNOS-012-06](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | Desktop 端药丸按钮一致 | [AC-01](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06)、[AC-02](/requirements/FNOS-012-codebuddy-model-speed-and-client-version#fnos-012-06) | DSH Desktop（项目 `.dsh/profiles/desktop`） | 1.在 Desktop 中执行 TC-028/TC-029 | Desktop 与 Web 形态、激活态一致 | P1 | 新增行为，无回归基线 |

## 测试执行结果

### 自动化用例（包级，可重复执行）

| 命令 | 范围 | 预期 |
| --- | --- | --- |
| `pnpm --filter @tnnevol/dsh-codebuddy test` | FNOS-012-01 倍速映射、FNOS-012-02 版本常量与指纹 | 全绿 |
| `pnpm --filter @tnnevol/dsh-failover-search test` | FNOS-012-05 清单一致性（间接） | 全绿 |
| `pnpm --filter fnos-dsh-cli test` | FNOS-012-04/05 仓库级一致性守门（清单、安装命令、latest 代际判定） | 全绿 |
| `pnpm run check -- --all` | 全仓（含 SDD 文档检查与文档构建） | exit 0 |

### 用例执行记录

> 本需求尚未进入实施（需求状态「规划中」），用例表已按规范建立；执行记录在实施与验收阶段逐条回填。当前仅补充一项**已核实事实**的实测结论：

| 用例 | 结果 | 日期 | 证据 |
| --- | --- | --- | --- |
| TC-023 | 阻塞→已提前修复 | 2026-10-10 | 修正前 `compatibility.json` 声明 10 个包、实际依赖 16 个；已在提交 `f86a7e7` 补齐并加入守门用例（TC-024）。**但该修正晚于 `v0.2.0-rc.2.1` 发布数十秒，未进入线上包**——故 TC-025 仍待随下次版本发布后核对 |
| TC-025 | 未通过（基线确认） | 2026-10-10 | 解包 `0.2.0-rc.2.1` 线上产物：其 `compatibility.json` 仍为 10 个包（缺 `dsh-tools`/`dsh-agent`/`dsh-client-ui-conversation`/`dsh-web-fetch-http`）。该结果即本功能的立项依据 |
| TC-028（自动化部分） | 通过 | 2026-10-10 | `tests/client/toggle-control.spec.ts`（FNOS-012-06）：控件为单个 button（`dsh-failover-pill`）、无 `DshSwitch`/`dsh-failover-toggle` 残留、可见文案固定 `toggleOn`、locales 无「智能搜索已关」 |
| TC-029（自动化部分） | 通过 | 2026-10-10 | 激活态 `--active` 类独立、样式用 DSH 语义变量、乐观更新 + 失败回滚沿用 |
| TC-031（自动化部分） | 通过 | 2026-10-10 | button 原生键盘可达、`aria-pressed` + `aria-label` 含状态描述 |
| TC-030、TC-032、TC-033 | 待验收 | — | 亮暗主题两态可辨、会话级语义、Desktop 形态一致性：需 Web/Desktop 走查（FNOS-012-06） |
| 其余（TC-001~TC-027 本地部分） | 通过 | 2026-10-10 | FNOS-012-01~05 本地自动化全绿（kit 12 / codebuddy 909 / codex-auth 137 / gateway 116 / cli 46）；Registry/Desktop/NAS 部分待验收 |

## Bug 记录

| 编号 | 问题 | 影响 | 状态 | 关联用例 | 说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | `compatibility.json` 包清单落后于实际依赖（10 vs 16） | 中 | 源码已修，待随版本发布 | TC-023、TC-025 | 漏声明时「宿主缺包」不被安装期拦下，要到编译或运行才失败。源码修正在 `f86a7e7`，因发布时序未进入 `0.2.0-rc.2.1` |
| BUG-02 | 发布时序漏网：源码已修但线上包未含 | 中 | 待覆盖（AC-03） | TC-025、TC-026 | 现有两条一致性用例只校验仓库内清单与安装命令，**不校验已发布产物**；发布后源码再改即会漏网。AC-03 与 TC-026 用于约束该路径 |

## 测试结论

**整体结论：未执行（需求处于规划中）。**

- FNOS-012-01 至 05 的用例表已按[测试用例文档规范](/charter/tests-spec#固定章节)建立，每个功能点覆盖正向、逆向、边界、权限（或生命周期）、数据一致性五类中的适用维度：
  - **正向**：TC-001、TC-003、TC-007、TC-011、TC-019、TC-023；
  - **逆向**：TC-002（不编造数值）、TC-010（版本不一致）、TC-015（拦截不再出现）、TC-025（线上包核对）；
  - **边界**：TC-006（超长布局）、TC-013（无字段）、TC-014（字段保留）；
  - **权限 / 生命周期**：TC-016（清理不触碰凭据）、TC-018（NAS 耗时与降级）、TC-021/TC-022（发布权限与流程约定）；
  - **数据一致性**：TC-004（倍速不改行为）、TC-012（条目有效不清理）、TC-027（安装命令与发布版本一致）。
- **唯一已实测的功能是 FNOS-012-05**：其缺口（清单落后 + 发布时序漏网）已在 FNOS-010 的发布验收过程中被发现并登记，源码修正与守门用例已完成，线上包待随版本发布核对（TC-025）。
- **遗留风险**：
  - 发布类用例（TC-019–TC-022、TC-025）依赖 npm 发布权限；当前环境 `npm whoami` 曾返回 401，执行前需 `npm login`，无权限时标记「阻塞」。
  - FNOS-012-03 的自愈涉及删除 lockfile 与 `node_modules`：本地与 NAS 验证都必须先备份用户配置与凭据，TC-016 的 hash 比对是防数据丢失的关键断言，不可省略。
  - FNOS-012-01 的倍速字段依赖 CodeBuddy 服务端目录返回 `credits`；目录契约变更时该字段可能缺失，属外部依赖风险，用例 TC-002 已覆盖「缺失时不编造」的降级路径。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-10 | 新增 FNOS-012-06 用例 | 智能搜索控件改为药丸按钮：TC-028~TC-033 覆盖形态、激活/普通两态、亮暗主题可辨、键盘可达与会话级语义回归（沿用 FNOS-012-06 行为约束——仅改视觉，不改 FNOS-010-12 行为）；测试范围与环境同步到 06。 |
