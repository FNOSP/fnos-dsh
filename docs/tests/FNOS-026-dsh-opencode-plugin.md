---
id: FNOS-026
title: FNOS-026 测试用例
description: FNOS-026 OpenCode Zen 与 OpenCode Go 双供应商模型接入、模型列表 UI 与 Go 套餐用量的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-026-dsh-opencode-plugin
plan: /plans/PLAN-FNOS-026-dsh-opencode-plugin
status: 执行中
lastVerified: 2026-10-23
verifiedAt: 2026-10-23
---

# FNOS-026 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | [FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) |
| 关联计划 | [PLAN-FNOS-026](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| 覆盖功能 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) 至 [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) |
| 测试状态 | <Badge type="info" text="执行中（2026-10-23 接口与联调证据已回填；完整用例待执行）" /> |
| 用例总数 | 47 |

## 测试范围与需求分析

被测对象是新增插件 `@tnnevol/dsh-opencode` 的九项功能：OpenCode Console 登录、OpenCode Zen（按量）与 OpenCode Go（套餐）双供应商模型目录、能力适配、对话可用性、Go 套餐额度、用量胶囊、模型列表 UI 与目录管理、登录态与偏好持久化，以及文档站与插件登记。

三份文档的分工：功能范围与验收条件见[需求文档](/requirements/FNOS-026-dsh-opencode-plugin)，实现任务与验证方式见[计划文档](/plans/PLAN-FNOS-026-dsh-opencode-plugin)，本页只登记用例设计、执行结果、Bug 与结论。

用例与计划阶段的对应关系：

| 计划阶段 | 覆盖功能 | 用例范围 |
| --- | --- | --- |
| [阶段一：宿主侧账号与凭据](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段一-宿主侧账号与凭据) | FNOS-026-01 | TC-001 至 TC-008 |
| [阶段二：模型目录与双供应商适配](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段二-模型目录与双供应商适配) | FNOS-026-02、FNOS-026-03、FNOS-026-05（额度读取）、FNOS-026-07 | TC-009 至 TC-017、TC-022 至 TC-025、TC-031 至 TC-034、TC-044 |
| [阶段三：插件详情页与模型列表 UI](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段三-插件详情页与模型列表-ui) | FNOS-026-01、FNOS-026-05、FNOS-026-06、FNOS-026-07、FNOS-026-08 | TC-022 至 TC-030、TC-035 至 TC-037、TC-042、TC-043、TC-045、TC-046、TC-047 |
| [阶段四：文档站与发布登记](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段四-文档站与发布登记) | FNOS-026-09 | TC-038 至 TC-041 |
| [阶段五：验证与收尾](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段五-验证与收尾) | 全部 | 汇总执行结果与结论 |

### 关键风险点

| 风险 | 用例方向 |
| --- | --- |
| 账号令牌或 API Key 泄漏到浏览器 | 在页面源码、网络响应与本地存储中检索明文（TC-008） |
| 双 roster 来源与账号覆盖叠加逻辑错误（例如把 Console 的 `models` 为空当成没有模型） | 分别验证 Zen、Go 两组 roster、公开目录与内置目录来源，并覆盖空覆盖条目、账号配置不可读与全源失败（TC-009 至 TC-012） |
| 路由同名冲突导致登录后模型整体不出现 | 预置手工 `opencode-go` 路由后登录，断言两组供应商仍出现（TC-044） |
| 能力字段或协议族投影错误，模型看似可选但发不出去 | 两种 plan 各选代表模型对话；七项能力字段与上游逐项比对（TC-013 至 TC-017、TC-045） |
| Zen 余额不足或免费模型受限被误判为插件缺陷 | 分别制造 402 与 403，断言错误可读且不自动重试（TC-021，见「已知限制」） |
| 额度数据缺失被补成 0%，用户误以为额度充足 | 制造额度接口失败，断言不显示 0%（TC-024） |
| 胶囊与额度卡片来自不同快照，两处数字不一致 | 同一次刷新后比对两处比例（TC-029） |
| 胶囊在选中 Zen 模型时仍出现，误导为套餐额度 | 分别选中 Zen 与 Go 模型查看输入区（TC-026） |
| 登录态或偏好没有真正落盘，重启即丢 | 重启 DSH 后逐项核对（TC-035、TC-036） |
| 插件禁用后仍残留供应商分组或影响其它供应商 | 禁用插件后检查模型选择器（TC-037） |
| 目录固定高度、分组筛选或能力气泡影响可用性 | 滚动、窗口缩放与亮暗主题下核对（TC-043、TC-045、TC-046） |
| 新增页面与菜单断链 | 文档构建 + 逐个打开菜单目标（TC-041） |

### 待确认项

- ❓ OpenCode Zen 免费模型在目录中的默认可见性尚未形成产品结论。本轮按「保留 roster 条目、调用失败时显示 403 上游原因」登记；若后续改为默认隐藏，需要同步更新需求 FNOS-026-02/03 与 TC-009、TC-017。

### 已知限制（上游）

以下限制来自 OpenCode 上游策略，不是插件缺陷；对应用例只验证「错误可读、不绕过限制」，不把「调用成功」作为预期结果。

| 限制 | 实测表现 | 对用例的影响 |
| --- | --- | --- |
| OpenCode Zen 按量模型需要 Console 余额 | 余额不足时调用返回 402 `Insufficient account funds`；模型目录与选择器仍正常 | TC-018 在无余额账号上登记为「阻塞」；TC-021 以 402 作为预期错误，可正常执行并记录上游原文 |
| OpenCode Zen 免费模型只允许在 OpenCode 客户端内使用 | 调用返回 403 `FreeTierError`；目录条目仍可能按 roster 展示 | TC-018 改用付费 Zen 模型或 Go 模型执行；TC-021 用免费模型验证 403 错误可读，不要求调用成功 |
| 两组模型来自不同计费口径 | Go 套餐模型用 OAuth 或 API Key 均可调用；Zen 按量模型受余额约束 | TC-002、TC-005、TC-018 分别在两种登录方式下执行；额度相关用例只对 Go 断言 |
| 上游 roster 与目录条目会变化 | 模型数量与名称随上游增删；文档只写约数 | TC-009、TC-014 以执行时的活 roster 为基准，不硬编码完整清单 |

### 执行顺序与数据清理

- 按[账号状态测试顺序](/charter/tests-spec#账号状态测试顺序与-auth-配置备份)执行：**先测登录态**（TC-009 至 TC-034、TC-042 至 TC-047 中的在线用例）→ **再测非登录态**（TC-001、TC-012、TC-024 等）→ **最后测登录流程**（TC-002 至 TC-006）。
- 移除登录态前，把 `<DSH_HOME>/.dsh-opencode-auth.json` 备份到 `tmp/auth-back/dsh-opencode-<版本>-<日期>/`；恢复时原样复制并 `chmod 600`，再用 `stat -c '%a %n'` 核对。
- 测试数据清理：退出测试账号或恢复备份、把胶囊策略与隐藏模型恢复默认、删除测试产生的临时截图与报告；测试账号、凭据与备份不得进入仓库。
- UI 类用例（账号卡片、额度卡片、目录卡片、用量胶囊）在**亮色与暗色主题**下各执行一遍，并核对[UI 测试](/charter/tests-spec#ui-测试-视觉与样式)要求的对比度、间距与毛玻璃层级。

## 测试环境

| 功能 | 执行环境 | 说明 |
| --- | --- | --- |
| [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01)、[FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02)、[FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | DSH Web 与 DSH Desktop | 需要真实 OpenCode Console 账号与可直连 `opencode.ai` 的网络；TC-044 需要可构造/预置手工 `opencode-go` 路由 |
| [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web 与 DSH Desktop | 容量与协议族比对以两组活 roster 与公开目录为准；对话部分需真实账号 |
| [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05)、[FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web 与 DSH Desktop | 额度数据需要 Go 或 Go Plus 订阅内的账号；无订阅时按「阻塞」登记；Zen 按量不纳入套餐额度 |
| [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07)、[FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | DSH Web 与 DSH Desktop | 持久化用例需要重启对应客户端；UI 用例需亮暗主题各执行一遍 |
| [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站构建环境 | `pnpm exec vitepress build docs` 与 `git diff --check` |

执行环境口径：

- **DSH Web**：`pnpm run start -- --web`，`DSH_HOME` 指向仓库 `.dsh`；用启动日志里带 `?token=` 的地址访问。
- **DSH Desktop**：使用上游源码检出 `fork-pj/deepseek-harness` 的开发态 Desktop（`DSH_DESKTOP_APP_DIR` 指定），profile 使用项目根 `.dsh/profiles/desktop`，不触碰 `~/.dsh/profiles/desktop`。
- 本插件不依赖 fnOS 宿主桥接，**不要求真实 fnOS NAS 验收**；登录与额度依赖外部账号条件，缺少条件时按阻塞登记。
- 执行前记录版本三元组（DSH 运行时、插件版本、Desktop 来源与版本），写入执行结果备注；版本不匹配时结果无效。

## 测试用例

### [FNOS-026-01 用 OpenCode Console 账号登录](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录时账号卡片显示两种登录入口 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 插件已安装且未登录 | 1.打开插件管理 2.进入 `OpenCode` 详情页 3.查看账号卡片 | 卡片显示设备码登录与 API Key 登录两种方式说明；无账号、组织与额度数据 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-002 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 设备码登录全流程 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录；可直连 `opencode.ai`；具备测试账号 | 1.点「设备码登录」 2.读取一次性代码与验证地址 3.在浏览器打开验证地址并输入代码确认 4.回到 DSH 查看账号卡片（不手动刷新页面） | 授权中显示代码、复制按钮、验证地址与有效期；确认后卡片自动变为已登录，显示账号与组织；已登录状态不再显示 API Key 登录入口 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-003 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 取消设备码登录 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已发起设备码登录 | 1.在授权中状态点「取消」 2.查看账号卡片 3.重新发起登录 | 回到未登录并说明已取消；未写入任何凭据；可重新拿到新的一次性代码 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-004 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 设备码过期后可重新发起 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已发起设备码登录 | 1.等待超过一次性代码有效期 2.查看账号卡片 3.重新发起登录 | 过期后回到未登录并说明原因；重新发起可正常获得新的代码与地址 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-005 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 用服务账号 API Key 登录 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录；具备 Console 服务账号 API Key | 1.点「用 API Key 登录」 2.粘贴有效 Key 3.确认 4.打开模型选择器 | 进入已登录状态，卡片显示账号信息，与设备码登录一致；模型选择器出现 `OpenCode` 与 `OpenCode Go` 两组 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-006 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 无效 API Key 的失败提示 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录 | 1.打开 API Key 登录 2.输入无效 Key 3.确认 | 显示可读的错误说明；仍为未登录；不写入凭据；可用有效 Key 重试 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-007 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 退出登录后两组模型与状态一并撤销 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已登录 | 1.点「退出登录」 2.查看账号卡片 3.打开模型选择器 4.打开任一历史会话 | 回到未登录；选择器不再出现 `OpenCode` 与 `OpenCode Go`；历史会话仍可正常打开 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-008 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 凭据不出现在浏览器侧 | [AC-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已完成登录 | 1.在页面内检索源码与 `localStorage` 2.抓取登录、状态与额度接口的响应 3.检索令牌与 Key 的明文 | 页面源码、存储与响应中均无令牌或 Key 明文；响应只含状态、账号与组织信息 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-042 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已登录时隐藏 API Key 登录入口 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已登录 | 1.查看账号卡片全部操作 2.在页面内检索「使用 API Key 登录」或等价文案 3.退出登录后再次查看 | 已登录时账号卡片不出现 API Key 登录入口，只保留退出登录；退出后未登录状态重新显示两种登录入口 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-02 OpenCode Zen 与 OpenCode Go 模型出现在模型选择器](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 两组目录分别以活 roster 为全集并叠加账号覆盖 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已登录；账号有 Go 订阅；已知 Zen 与 Go 活 roster 内容 | 1.读取 Zen 与 Go 活 roster 2.在 Console 记录两组的增补条目、停用标记与能力覆盖 3.打开 DSH 模型选择器与目录卡片逐组比对 | 选择器出现 `OpenCode` 与 `OpenCode Go` 两组；每组模型集合与各自 roster 一致（Zen 约 85、Go 约 36），不多也不少；Console 的增补、停用与能力覆盖按组生效 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-010 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 账号配置不可读时仍服务两组 roster | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已登录；可构造账号配置接口失败（桩或网络规则） | 1.使 Console 配置接口返回失败 2.刷新目录 3.查看选择器与目录卡片 | 两组仍显示各自 roster 与公开目录中的模型；目录卡片按组说明当前目录来源与未应用账号覆盖的原因 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-011 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 某组目录来源不可用时保留该组上一份目录 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 两组已有一份可用目录 | 1.阻断某组 roster 与公开目录对应段 2.点刷新 3.查看该组与另一组目录 | 该组回退公开目录或保留上一份目录与获取时间，并显示失败原因；另一组目录不受影响；选择器不被清空 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-012 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 未登录时不出现两组供应商 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 未登录 | 1.打开模型选择器 2.检索 `OpenCode` 与 `OpenCode Go` | 不出现两组供应商分组；其它供应商不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-043 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 分组筛选与 plan 标签 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已登录；目录已有两组数据 | 1.分别在目录卡片选择「全部」「Go」「按量」 2.查看每行 plan 标签与计数 3.在某个筛选下输入搜索词 | 「全部」显示两组；「Go」只显示套餐模型；「按量」只显示 Zen 模型；每行 plan 标签与所属组一致；计数随筛选与搜索更新 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-044 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 手工配置 `opencode-go` 路由时两组仍出现 | [AC-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已登录；`llm-pi-ai` 设置中已手工配置 `opencode-go` 路由 | 1.保留手工配置 2.在插件详情页重新登录/刷新 3.打开模型选择器 | `OpenCode` 与 `OpenCode Go` 两组仍注册成功并出现；手工 `opencode-go` 配置保持不变，不被覆盖 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-03 模型能力完整适配](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 两种 plan 的四种协议族代表模型均可对话 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；两组 roster 含四种协议族模型 | 1.在 `OpenCode` 与 `OpenCode Go` 中分别选择 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI 各一个代表模型 2.各发送一条文本消息 | 四种协议族均收到回复，无协议错误或 4xx 错误；对话记录完整 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-014 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 七项能力字段与上游一致 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；两组 roster 与公开目录可读 | 1.各选一个上游声明了容量的 Zen 与 Go 模型 2.查看模型信息中的推理、工具、图片、文本、免费、上下文与最大输出 3.与公开目录逐项比对 | 七项字段与上游一致；未声明时按保守默认值并说明；免费与工具能力可辨别 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-015 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 声明图片输入的模型可发送图片 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；选中声明图片输入的 Zen 或 Go 模型 | 1.查看输入区是否有图片入口 2.附带图片发送消息 | 有图片入口；图片随消息发出并得到回复；回复内容与图片相关 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-016 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 纯文本模型不提供图片入口 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；选中未声明图片输入的模型 | 1.查看输入区 2.尝试附加图片 | 不出现图片入口；附加图片时给出可读提示且不发送 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-017 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 图片生成模型不进入可对话列表 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；公开目录含输出为图片的模型 | 1.在目录卡片搜索该模型 2.查看模型选择器 | 目录卡片与选择器均不出现该模型；目录卡片说明中可见跳过原因 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-045 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 能力图标与悬浮气泡 | [AC-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；目录已有数据 | 1.查看模型行的「推理 / 工具 / 图片 / 文本 / 免费」图标 2.悬浮图标查看气泡 3.比对气泡勾选与 TC-014 的字段 | 五项能力以图标表示；悬浮气泡逐项显示勾选/未勾选；勾选状态与 TC-014 的字段一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-04 选中模型可正常对话](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 两种 plan 的文本对话正常返回 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；Zen 账号有 Console 余额，Go 账号在套餐内 | 1.新开会话并分别选择 `OpenCode`（付费 Zen 模型）与 `OpenCode Go` 模型 2.各发送一条文本消息 3.等待回复 | 两组均收到回复；会话历史新增用户与助手各一条；流式输出正常结束 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-019 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 图片随消息发送并得到回复 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；选中支持图片输入的模型 | 1.附带一张可识别的图片 2.提问图片内容 3.查看回复 | 回复能描述图片内容；会话中保留图片缩略图 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-020 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 思考等级按上游声明执行 | [03-AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03)、[04-AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；选中支持思考等级的模型 | 1.查看可选等级集合 2.选择上游声明的一档 3.发送消息并观察回复 | 可选等级与上游声明一致；未声明的等级不在列表中；所选档位在请求中体现（或用上游可见的思考输出确认） | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-021 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 调用失败时显示可读错误（含 402/403） | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04)、[AC-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；可构造失败（断网、Zen 余额不足或免费模型） | 1.分别用断网、余额不足的 Zen 付费模型、Zen 免费模型发送消息 2.等待失败返回 | 会话显示可读错误；402 显示 `Insufficient account funds`，403 显示 `FreeTierError` 与仅限 OpenCode 客户端的说明；不出现空白回复；不自动重试 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-05 套餐额度展示](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-022 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | OpenCode Go 三个窗口的已用百分比 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 已登录；账号在 Go 或 Go Plus 订阅内 | 1.打开详情页额度卡片 2.与 Console 的用量页比对 3.切换到 `OpenCode`（Zen）模型查看额度区域 | 5 小时、每周、每月三个窗口均显示已用百分比，数值与 Console 一致；Zen 模型不显示套餐额度，也不出现按量费用 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-023 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 重置倒计时递减 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 额度卡片已有数据 | 1.记录某窗口的倒计时 2.等待 60 秒 3.再次查看 | 倒计时相应减少；跨越重置时间后该窗口重新开始计时 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-024 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 额度不可用时显示未知而不是 0% | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 已登录 | 1.使额度接口返回失败 2.点刷新 3.查看卡片 | 显示失败原因与最近一次获取时间；未读取到的窗口不显示 0% | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-025 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 手动刷新更新数据与获取时间 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 额度卡片已有数据 | 1.记录获取时间 2.点「刷新」 3.观察按钮状态与结果 | 按钮在刷新期间禁用并显示进行中；成功后获取时间更新、数值重新读取 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-047 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 无 Go 订阅时显示未订阅说明 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 已登录；账号只有 Zen 按量权限，没有 Go 或 Go Plus 订阅 | 1.打开详情页额度卡片 2.查看三个窗口 3.打开输入区 | 卡片显示未订阅说明，不显示 0%、不显示按量费用；输入区不出现套餐用量胶囊 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-06 对话输入区用量胶囊](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-026 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | auto 策略只在 Go 模型下显示 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 auto | 1.选中 `OpenCode Go` 模型并查看输入区右侧 2.切换到 `OpenCode`（Zen）模型再查看 3.切换到其它供应商模型 | 只有 Go 模型显示用量胶囊；Zen 与其它供应商模型都不显示，也不触发套餐额度请求 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-027 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | always 策略常驻显示 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 always | 1.分别选中 `OpenCode Go`、`OpenCode`（Zen）与其它供应商模型 2.查看输入区右侧 | 三种情况下胶囊都显示；数值随刷新更新；没有 Go 数据时显示未知或未订阅，不补 0% | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-028 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | off 策略隐藏并停止刷新 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 off | 1.选中 OpenCode Go 模型 2.查看输入区 3.观察一段时间内的额度请求 | 胶囊不显示；不再产生额度自动刷新请求；详情页额度卡片仍可手动刷新 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-029 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 胶囊与额度卡片数字一致 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 auto 或 always | 1.记录额度卡片的已用比例 2.在同一时刻查看胶囊 3.查看胶囊的重置时间 | 两处比例一致；胶囊可查看重置时间且与卡片一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-030 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 修改策略后即时生效 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；存在进行中的会话 | 1.在设置区把策略从 auto 改为 off 2.不重启 DSH，回到会话查看 3.再改回 auto 查看 | 策略变化后下一次进入会话或下一次对话即按新策略显示 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-07 模型目录管理](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-031 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 搜索即时过滤目录 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有两组数据 | 1.输入某个模型名称片段 2.清空搜索框 3.在「Go」筛选下重复搜索 | 列表即时过滤为匹配项；清空后恢复当前筛选下的全部模型；搜索与筛选组合生效 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-032 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 隐藏模型后选择器不再出现 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有两组数据 | 1.隐藏某个模型 2.打开模型选择器 3.恢复该模型的开关 4.重启客户端后再查看 | 隐藏后选择器不出现该模型；恢复后重新出现；隐藏状态在重启后保持 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-033 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 刷新目录更新两组数据与获取时间 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有两组数据 | 1.记录获取时间 2.点「刷新」 3.分别比对两组模型集合与各自活 roster | 两组目录都更新为最新读取结果；获取时间更新；刷新期间有进行中提示 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-034 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 刷新失败保留上一份目录 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有两组数据 | 1.阻断某组目录来源 2.点「刷新」 3.查看该组列表与提示 | 该组保持上一份可用目录；显示失败原因；另一组与模型选择器不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-046 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片固定高度与内部滚动 | [AC-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有两组数据，模型数量超过卡片高度 | 1.查看目录卡片高度 2.滚动模型列表到底部 3.观察搜索框、分组筛选与计数 4.缩放窗口/切换亮暗主题 | 卡片高度固定，只有列表区滚动；搜索框、筛选与计数始终可见；窗口缩放与亮暗主题下布局不溢出、不被裁切 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-08 登录态与偏好持久化](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-035 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 重启后登录态保持 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 已登录且凭据未过期 | 1.重启 DSH Web（或 DSH Desktop） 2.重新打开详情页 3.查看账号卡片 | 仍为已登录；无需重新登录；模型选择器仍有 `OpenCode` 与 `OpenCode Go` 两组 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-036 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 偏好设置在重启后保持 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 已登录 | 1.隐藏一个模型、把策略改为 always、把刷新间隔改为非默认值 2.重启客户端 3.逐项核对 | 三项设置保持；隐藏的模型仍不可选；策略与间隔为修改后的值 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-037 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 禁用插件不影响其它供应商 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 已登录；已配置其它供应商 | 1.禁用本插件 2.重启客户端 3.查看模型选择器与其它供应商用量 | 其它供应商模型与用量正常；选择器无 `OpenCode` 与 `OpenCode Go` 残留分组；历史会话可打开 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-09 文档站与插件登记](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-038 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 插件总览与菜单可达 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站依赖已安装 | 1.打开 `/plugins/` 2.查找该插件的行 3.从左侧菜单点击 `dsh-opencode` | 总览包含该插件行并链接到说明页；菜单可进入 `/plugins/dsh-opencode`；版本号与插件清单一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-039 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 说明页内容完整 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 说明页已发布 | 1.逐节阅读说明页 2.对照需求「不在本次范围内」与已知约束 | 包含安装命令、两组模型与路由说明、能力字段、Go 套餐额度与胶囊、设置说明、Zen 402/403 已知限制与常见问题；未把未上线能力写成已可用 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-040 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 市场源列表包含该包 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 插件已发布到 npm | 1.读取 `docs/public/plugins/market/plugins.txt` 2.检查生成的索引文件状态 | 源列表含 `@tnnevol/dsh-opencode`；生成的 `index.json` 未被手工改写 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-041 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档构建与链接检查 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 依赖已安装 | 1.执行文档站构建 2.逐个打开新增菜单目标 3.执行 `git diff --check` | 构建通过；新增菜单目标文件均存在；无死链；`git diff --check` 无输出 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

## 测试执行结果

> 用例定义已在上一节固定；本节只回填执行状态与联调证据。下面两轮 2026-10-23 记录属于接口/端点级证据，除特别说明外不改变用例的「未执行」状态；完整用例需在 DSH Web 与 DSH Desktop 上按版本三元组执行。

### 已完成的联调记录（2026-10-23，单供应商阶段）

2026-10-23 在 DSH Web（`DSH_HOME` 指向仓库 `.dsh`，独立端口）用真实账号完成一轮单供应商联调。以下是接口与端点层面的证据，**不替代上方任何用例，也不产生用例通过结论**。该轮目录为 36 个 Go 模型，双供应商修复后的复测见下一小节：

| 项目 | 实测结果 |
| --- | --- |
| 插件加载 | 插件加载成功，详情页可打开 |
| API Key 登录 | `/plugins/dsh-opencode/auth/key` 返回 200 |
| 套餐额度 | `/plugins/dsh-opencode/usage` 返回 rolling 24% / weekly 78% / monthly 53% |
| 模型目录 | `/plugins/dsh-opencode/catalog` 返回 36 个 Go 目录模型（当时仅单供应商） |
| 协议端点直连探测 | 路径正确：OpenAI Chat Completions 与 Anthropic Messages 返回 200；OpenAI Responses 因上游地区限制返回 403；Google Generative AI 因工作空间隐私设置返回 400（两者均为上游策略，不是路径错误） |
| 网关会话头 | 网关强制要求 `x-opencode-session`，缺失时返回 400 `MissingSessionID` |

### 双供应商与路由修复复测（2026-10-23）

在 DSH Web（DSH 运行时 `0.2.1-rc.2`；插件工作区构建 `0.2.1-rc.2.21`）用同一真实账号完成修复后的接口级复测。本轮**未执行**分组筛选、固定高度、能力图标、API Key 入口隐藏与 DSH Desktop 用例，因此不产生这些用例的通过/失败结论：

| 项目 | 实测结果 |
| --- | --- |
| 根因 | 登录后模型未出现在选择器：用户此前手工配置过 `opencode-go` 路由（llm-pi-ai），与插件注册的同名路由冲突（`DUPLICATE_ADAPTER`），不是目录读取失败 |
| 修复 | 插件路由改为 `dsh-opencode`（`OpenCode`）与 `dsh-opencode-go`（`OpenCode Go`），与手工 `opencode-go` 路由并存 |
| 修复后目录 | 模型选择器出现 `OpenCode` 与 `OpenCode Go` 两组；Zen 活 roster 85 个、Go 活 roster 36 个 |
| Go 模型调用 | OAuth 登录状态下调用 OpenCode Go 模型返回 HTTP 200 |
| Zen 付费模型 | 返回 402 `Insufficient account funds`（账号无余额；属上游限制，见「已知限制」） |
| Zen 免费模型 | 返回 403 `FreeTierError`（仅允许在 OpenCode 客户端使用；属上游限制，见「已知限制」） |
| 版本记录 | DSH 运行时 `0.2.1-rc.2`、插件 `0.2.1-rc.2.21`；DSH Desktop 版本待执行 Desktop 用例时补充 |

### 协议可用性与真实会话测试（2026-10-23，DSH Web 会话级）

在 DSH Web（插件 `0.2.1-rc.2.22` 构建 + 协议继承修复）用同一真实账号、同一会话逐个切换模型，提示词为「只回复 ok，不要调用任何工具」，每个模型 1 轮 1 步。目的是验证四种协议在 DSH 中端到端可用，并尽量选择最便宜（优先免费）的模型：

| 协议 | 模型（OpenCode Go） | 价格（输入/输出，USD/1M） | 结果 | 说明 |
| --- | --- | --- | --- | --- |
| OpenAI Chat Completions | MiMo-V2.6-Flash | 0.14 / 0.28 | 通过：回复 `ok`，4 秒，19.4K tok | 免费 `beam-free` 在当前地区返回 403 `RegionError`，改用最便宜可用模型 |
| OpenAI Responses | Grok 4.6 | 2.00 / 6.00 | 通过：回复 `ok`，5 秒，19.1K tok | `gpt-6-luna`、`muse-spark-1.3-contributor` 均因地区限制 403；Grok 为当前地区最便宜可用 Responses 模型 |
| Anthropic Messages | Claude Haiku 5.5 | 0.10 / 0.50 | 通过：回复 `ok`，2 秒，29.1K tok | 本轮最便宜的可用模型 |
| Google Generative AI | Gemini 4 Argon Contributor | 4.00 / 20.00 | 阻塞：上游 400（工作空间隐私设置未允许「会用于训练的付费端点」） | 请求已到达上游，路径与鉴权正确；需在 Console Privacy 设置中允许后才能使用 |

本轮同时发现并修复一个协议继承缺陷：Go roster 独有模型若只在 Zen 目录段有元数据（`grok-4.6` 为 Responses、`qwen3.6-plus` 为 Anthropic），此前会被 Go 的 provider 级 `@ai-sdk/openai-compatible` 覆盖，导致 DSH 返回 `ModelProtocolUnsupported`。修复后逐模型声明优先于 provider 缺省，两个模型已复测（Grok 4.6 会话级通过、Qwen3.6 Plus 端点级通过）。

费用：以上 3 次会话级调用合计约 67.6K 输入 token（含系统提示），按各自价格估算 **< 0.05 USD**；未测试高价位模型。

说明：这些是会话级联调证据，不改变上方用例的「未执行」状态；DSH Desktop 与设备码授权流程仍待完整验收。

**未执行说明**：TC-042 至 TC-047 为本轮新增用例，均未执行；TC-044 有接口级修复证据，但完整回归仍需在预置手工 `opencode-go` 配置的环境中按步骤执行并覆盖 DSH Desktop。版本三元组中的 Desktop 一栏在正式执行时补充。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-002 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需真实账号 |
| TC-003 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web | 未执行 | — | 待执行 |
| TC-004 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web | 未执行 | — | 待执行 |
| TC-005 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需服务账号 Key |
| TC-006 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web | 未执行 | — | 待执行 |
| TC-007 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-008 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web | 未执行 | — | 待执行 |
| TC-009 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需真实账号，建议含 Go 订阅 |
| TC-010 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web | 未执行 | — | 待执行；需可构造账号配置失败 |
| TC-011 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web | 未执行 | — | 待执行 |
| TC-012 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-013 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web、DSH Desktop | 未执行 | — | 待执行；覆盖四种协议族 |
| TC-014 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web | 未执行 | — | 待执行 |
| TC-015 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-016 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web | 未执行 | — | 待执行 |
| TC-017 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web | 未执行 | — | 待执行 |
| TC-018 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-019 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-020 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | DSH Web | 未执行 | — | 待执行 |
| TC-021 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | DSH Web | 未执行 | — | 待执行 |
| TC-022 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需 Go 订阅账号 |
| TC-023 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | DSH Web | 未执行 | — | 待执行 |
| TC-024 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-025 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | DSH Web | 未执行 | — | 待执行 |
| TC-026 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web、DSH Desktop | 未执行 | — | 待执行；亮暗主题各一遍 |
| TC-027 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web | 未执行 | — | 待执行 |
| TC-028 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web | 未执行 | — | 待执行 |
| TC-029 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-030 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web | 未执行 | — | 待执行 |
| TC-031 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | DSH Web | 未执行 | — | 待执行 |
| TC-032 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-033 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | DSH Web | 未执行 | — | 待执行 |
| TC-034 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | DSH Web | 未执行 | — | 待执行 |
| TC-035 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需重启客户端 |
| TC-036 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | DSH Web | 未执行 | — | 待执行 |
| TC-037 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-038 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站构建环境 | 未执行 | — | 待执行 |
| TC-039 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站构建环境 | 未执行 | — | 待执行 |
| TC-040 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站构建环境 | 未执行 | — | 待执行 |
| TC-041 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站构建环境 | 未执行 | — | 待执行 |
| TC-042 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；已登录隐藏 API Key 入口 |
| TC-043 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web、DSH Desktop | 未执行 | — | 待执行；分组筛选与 plan 标签 |
| TC-044 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web | 未执行 | — | 待执行；接口级复测已确认修复，完整用例含 Desktop 待执行 |
| TC-045 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web、DSH Desktop | 未执行 | — | 待执行；能力图标与悬浮气泡 |
| TC-046 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行；固定高度、内部滚动与固定工具栏 |
| TC-047 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需无 Go 订阅账号 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | [TC-044](/tests/FNOS-026-dsh-opencode-plugin) | 登录后模型不出现在选择器（路由同名冲突） | P0 | 已修复 | 插件原先注册 `opencode-go`，与用户手工配置的同名路由冲突；改用 `dsh-opencode` / `dsh-opencode-go` 后两组供应商正常出现，2026-10-23 接口级复测确认 |

本轮接口联调未发现其它 Bug。路由修复本身不扩大需求范围；双供应商与模型列表口径已在需求 FNOS-026-02 与计划 T02-04/T02-07 的变更记录登记。

## 测试结论

- **结论**：尚未执行（用例级）。2026-10-23 完成两轮接口/端点联调并修复 BUG-01，但 47 条用例尚未在 DSH Web 与 DSH Desktop 上按步骤执行，不产生通过/失败结论。
- 用例总数 47 条，未执行 47 条，通过 0 条，失败 0 条，遗留 Bug 0 个（BUG-01 已修复）。
- 一句话结论：双供应商与路由冲突修复已有接口级证据，模型列表 UI 改版与两端完整走查仍待执行；执行结论回填本页后，再判定需求状态。

### 遗留风险

1. **外部账号与网络依赖**：登录、目录与对话依赖真实 OpenCode Console 账号与可直连 `opencode.ai` 的网络；Zen 付费模型需要 Console 余额，Go 模型需要 Go 或 Go Plus 订阅。缺条件时用例按阻塞登记，不据此判定功能缺陷。
2. **Zen 402/403 属上游限制**：余额不足返回 402 `Insufficient account funds`，免费模型返回 403 `FreeTierError`；插件只保证错误可读，不绕过限制，也不因此隐藏 roster 条目。
3. **路由冲突已缓解但未完全消除**：`opencode-go` 手工配置不再冲突；若用户手工配置了 `dsh-opencode` 或 `dsh-opencode-go`，仍会触发单组冲突，需要用例覆盖并给出诊断。
4. **上游目录与额度接口未公开完整契约**：字段漂移时插件按降级处理，用例以夹具固定已知形态；真实账号下出现新字段时需补用例。
5. **模型列表 UI 改版尚未完成视觉验收**：固定高度滚动、分组筛选、能力图标与气泡目前只有接口/设计口径，未在 DSH Web 与 DSH Desktop 亮暗主题下走查。
6. **桌面端仅覆盖开发态客户端**：DSH Desktop 结论需来自 `fork-pj/deepseek-harness` 的开发态客户端，不作为发行版客户端的独立验收结论。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-23 | 改为双供应商与模型列表 UI 改版用例，并回填路由修复证据 | 用例改为 `OpenCode`（Zen 按量）与 `OpenCode Go`（套餐）双供应商口径：更新 TC-001、TC-005、TC-007、TC-009 至 TC-017、TC-018 至 TC-021、TC-022 至 TC-027、TC-031 至 TC-037、TC-039；新增 TC-042（已登录隐藏 API Key 入口）、TC-043（分组筛选与 plan 标签）、TC-044（`opencode-go` 路由冲突回归）、TC-045（能力图标与气泡）、TC-046（固定高度与内部滚动）、TC-047（无 Go 订阅）。补充「已知限制（上游）」登记 Zen 402/403；在执行结果新增双供应商与路由修复复测，记录根因 `DUPLICATE_ADAPTER`、`dsh-` 前缀修复、OAuth 调用 Go 模型 200、Zen 402/403；新增 BUG-01（已修复）。用例总数 41 → 47，状态改为执行中。 |
| 2026-10-23 | 回填协议可用性与真实会话测试 | 在 DSH Web 同一会话逐个切换模型，验证 Chat Completions（MiMo-V2.6-Flash）、Responses（Grok 4.6）、Anthropic Messages（Claude Haiku 5.5）端到端通过；Google Generative AI 因工作空间隐私设置阻塞；记录免费/低价模型选择、费用估算与协议继承缺陷修复。 |
| 2026-10-23 | 按真实账号联调结果更正目录口径与补充证据 | 更正 TC-009（目录以公开清单为全集、账号配置只叠加覆盖，`models` 为空不代表没有模型）与 TC-010（账号配置不可读时仍服务公开目录并说明来源），补充一条风险点；在「测试执行结果」新增 2026-10-23 本地 DSH Web 联调记录（插件加载、API Key 登录、额度、36 个目录模型、四种协议端点直连探测与 `x-opencode-session` 要求），并标注未执行单模型对话用例。 |
| 2026-10-23 | 建立 FNOS-026 测试用例文档 | 按九个功能分节登记 41 条用例，覆盖正向、逆向、边界、权限与数据一致性五类；执行结果全部为「未执行」，Bug 与结论待回填。登记四条遗留风险（含同名路由冲突）与一条待确认项。 |
