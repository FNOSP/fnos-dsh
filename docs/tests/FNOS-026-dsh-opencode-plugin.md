---
id: FNOS-026
title: FNOS-026 测试用例
description: FNOS-026 OpenCode Go 模型接入与套餐用量的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-026-dsh-opencode-plugin
plan: /plans/PLAN-FNOS-026-dsh-opencode-plugin
status: 规划中
lastVerified: 2026-10-23
verifiedAt: 2026-10-23
---

# FNOS-026 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | [FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) |
| 关联计划 | [PLAN-FNOS-026](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| 覆盖功能 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) 至 [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) |
| 测试状态 | <Badge type="info" text="规划中（用例已登记，尚未执行）" /> |
| 用例总数 | 41 |

## 测试范围与需求分析

被测对象是新增插件 `@tnnevol/dsh-opencode` 的九项功能：OpenCode Console 登录、OpenCode Go 模型目录与能力适配、对话可用性、套餐额度、用量胶囊、目录管理、登录态与偏好持久化，以及文档站与插件登记。

三份文档的分工：功能范围与验收条件见[需求文档](/requirements/FNOS-026-dsh-opencode-plugin)，实现任务与验证方式见[计划文档](/plans/PLAN-FNOS-026-dsh-opencode-plugin)，本页只登记用例设计、执行结果、Bug 与结论。

用例与计划阶段的对应关系：

| 计划阶段 | 覆盖功能 | 用例范围 |
| --- | --- | --- |
| [阶段一：宿主侧账号与凭据](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段一-宿主侧账号与凭据) | FNOS-026-01 | TC-001 至 TC-008 |
| [阶段二：模型目录与供应商适配](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段二-模型目录与供应商适配) | FNOS-026-02、FNOS-026-03、FNOS-026-05（额度读取）、FNOS-026-07 | TC-009 至 TC-017、TC-022 至 TC-025、TC-031 至 TC-034 |
| [阶段三：插件详情页与用量胶囊](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段三-插件详情页与用量胶囊) | FNOS-026-01、FNOS-026-05、FNOS-026-06、FNOS-026-08 | TC-022 至 TC-030、TC-035 至 TC-037 |
| [阶段四：文档站与发布登记](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段四-文档站与发布登记) | FNOS-026-09 | TC-038 至 TC-041 |
| [阶段五：验证与收尾](/plans/PLAN-FNOS-026-dsh-opencode-plugin#阶段五-验证与收尾) | 全部 | 汇总执行结果与结论 |

### 关键风险点

| 风险 | 用例方向 |
| --- | --- |
| 账号令牌或 API Key 泄漏到浏览器 | 在页面源码、网络响应与本地存储中检索明文（TC-008） |
| 模型全集来源与账号覆盖叠加逻辑错误（例如把 Console 的 `models` 为空当成没有模型） | 分别验证公开清单、公开目录与内置目录三种来源，并覆盖空覆盖条目、账号配置不可读与全源失败（TC-009 至 TC-012） |
| 协议族、容量或模态投影错误，模型看似可选但发不出去 | 四种协议族各选代表模型对话；容量与上游逐项比对（TC-013 至 TC-017） |
| 额度数据缺失被补成 0%，用户误以为额度充足 | 制造额度接口失败，断言不显示 0%（TC-024） |
| 胶囊与额度卡片来自不同快照，两处数字不一致 | 同一次刷新后比对两处比例（TC-029） |
| 登录态或偏好没有真正落盘，重启即丢 | 重启 DSH 后逐项核对（TC-035、TC-036） |
| 插件禁用后仍残留供应商分组或影响其它供应商 | 禁用插件后检查模型选择器（TC-037） |
| 新增页面与菜单断链 | 文档构建 + 逐个打开菜单目标（TC-041） |

### 待确认项

- ❓ 用户此前已在模型页显式配置过同名 `opencode-go` 路由时，插件应以可诊断错误停下，还是改用独立路由名？两种方案的产品表现不同（前者模型不出现、后者出现两个供应商），当前用例以「未配置同名路由」为前置。处置方式确定后补一条冲突场景用例。

### 执行顺序与数据清理

- 按[账号状态测试顺序](/charter/tests-spec#账号状态测试顺序与-auth-配置备份)执行：**先测登录态**（TC-009 至 TC-034 中的在线用例）→ **再测非登录态**（TC-001、TC-012、TC-024 等）→ **最后测登录流程**（TC-002 至 TC-006）。
- 移除登录态前，把 `<DSH_HOME>/.dsh-opencode-auth.json` 备份到 `tmp/auth-back/dsh-opencode-<版本>-<日期>/`；恢复时原样复制并 `chmod 600`，再用 `stat -c '%a %n'` 核对。
- 测试数据清理：退出测试账号或恢复备份、把胶囊策略与隐藏模型恢复默认、删除测试产生的临时截图与报告；测试账号、凭据与备份不得进入仓库。
- UI 类用例（账号卡片、额度卡片、目录卡片、用量胶囊）在**亮色与暗色主题**下各执行一遍，并核对[UI 测试](/charter/tests-spec#ui-测试-视觉与样式)要求的对比度、间距与毛玻璃层级。

## 测试环境

| 功能 | 执行环境 | 说明 |
| --- | --- | --- |
| [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01)、[FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02)、[FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | DSH Web 与 DSH Desktop | 需要真实 OpenCode Console 账号与可直连 `opencode.ai` 的网络 |
| [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | DSH Web 与 DSH Desktop | 容量与协议族比对以上游公开目录为准；对话部分需真实账号 |
| [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05)、[FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | DSH Web 与 DSH Desktop | 额度数据需要 Go 或 Go Plus 订阅内的账号；无订阅时按「阻塞」登记 |
| [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07)、[FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | DSH Web 与 DSH Desktop | 持久化用例需要重启对应客户端 |
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
| TC-001 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录时账号卡片显示登录入口 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 插件已安装且未登录 | 1.打开插件管理 2.进入 `OpenCode` 详情页 3.查看账号卡片 | 卡片显示设备码登录与 API Key 登录两种方式说明；无账号、组织与额度数据 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-002 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 设备码登录全流程 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录；可直连 `opencode.ai`；具备测试账号 | 1.点「设备码登录」 2.读取一次性代码与验证地址 3.在浏览器打开验证地址并输入代码确认 4.回到 DSH 查看账号卡片（不手动刷新页面） | 授权中显示代码、复制按钮、验证地址与有效期；确认后卡片自动变为已登录，显示账号与组织 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-003 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 取消设备码登录 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已发起设备码登录 | 1.在授权中状态点「取消」 2.查看账号卡片 3.重新发起登录 | 回到未登录并说明已取消；未写入任何凭据；可重新拿到新的一次性代码 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-004 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 设备码过期后可重新发起 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已发起设备码登录 | 1.等待超过一次性代码有效期 2.查看账号卡片 3.重新发起登录 | 过期后回到未登录并说明原因；重新发起可正常获得新的代码与地址 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-005 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 用服务账号 API Key 登录 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录；具备 Console 服务账号 API Key | 1.点「用 API Key 登录」 2.粘贴有效 Key 3.确认 4.打开模型选择器 | 进入已登录状态，卡片显示账号信息，与设备码登录一致；模型选择器出现 `OpenCode Go` | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-006 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 无效 API Key 的失败提示 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 未登录 | 1.打开 API Key 登录 2.输入无效 Key 3.确认 | 显示可读的错误说明；仍为未登录；不写入凭据；可用有效 Key 重试 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-007 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 退出登录后模型与状态一并撤销 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已登录 | 1.点「退出登录」 2.查看账号卡片 3.打开模型选择器 4.打开任一历史会话 | 回到未登录；选择器不再出现 `OpenCode Go`；历史会话仍可正常打开 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-008 | [FNOS-026-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 凭据不出现在浏览器侧 | [AC-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-01) | 已完成登录 | 1.在页面内检索源码与 `localStorage` 2.抓取登录、状态与额度接口的响应 3.检索令牌与 Key 的明文 | 页面源码、存储与响应中均无令牌或 Key 明文；响应只含状态、账号与组织信息 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-02 OpenCode Go 模型出现在模型选择器](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 目录以公开清单为全集并叠加账号覆盖 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已登录，账号有 Go 订阅；已知公开清单内容 | 1.读取公开模型清单（不可用时读取公开目录的非弃用条目）作为模型全集 2.在 Console 记录覆盖条目（含 `models` 为空的账号）与停用标记 3.打开 DSH 模型选择器与目录卡片逐项比对 | 模型集合与公开清单一致，不多也不少；账号配置可读时目录来源显示为账号目录（即使 `models` 为空）且停用标记与能力覆盖生效 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-010 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 账号配置不可读时仍服务公开目录 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已登录；可构造账号配置接口失败（桩或网络规则） | 1.使账号配置接口返回失败 2.刷新目录 3.查看选择器与目录卡片 | 仍显示公开清单与公开目录中的 OpenCode Go 模型；目录卡片说明当前目录来源与未应用账号覆盖的原因 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-011 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 全部目录来源不可用时保留上一份目录 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 已有一份可用目录 | 1.阻断到 `opencode.ai` 的出站请求 2.点刷新 3.查看目录卡片与选择器 | 保留上一份目录与获取时间；显示失败原因与重试入口；选择器不被清空 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-012 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 未登录时不出现该供应商 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | 未登录 | 1.打开模型选择器 2.检索 `OpenCode Go` | 不出现该供应商分组；其它供应商不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-03 模型能力完整适配](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 四种协议族的代表模型均可对话 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；上游目录含四种协议族模型 | 1.分别选择 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI 各一个代表模型 2.各发送一条文本消息 | 四种协议族均收到回复，无协议错误或 4xx 错误；对话记录完整 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-014 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 上下文窗口与最大输出与上游一致 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；上游目录可读 | 1.选一个上游声明了容量的模型 2.查看模型信息中的上下文与最大输出 3.与公开目录逐项比对 | 两项数值与上游一致；上游未声明时显示保守默认值并说明 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-015 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 声明图片输入的模型可发送图片 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；选中声明图片输入的模型 | 1.查看输入区是否有图片入口 2.附带图片发送消息 | 有图片入口；图片随消息发出并得到回复；回复内容与图片相关 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-016 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 纯文本模型不提供图片入口 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；选中未声明图片输入的模型 | 1.查看输入区 2.尝试附加图片 | 不出现图片入口；附加图片时给出可读提示且不发送 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-017 | [FNOS-026-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 图片生成模型不进入可对话列表 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03) | 已登录；公开目录含输出为图片的模型 | 1.在目录卡片搜索该模型 2.查看模型选择器 | 目录卡片与选择器均不出现该模型；目录卡片说明中可见跳过原因 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-04 选中模型可正常对话](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 文本对话正常返回 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录 | 1.新开会话并选择 `OpenCode Go` 模型 2.发送一条文本消息 3.等待回复 | 收到回复；会话历史新增用户与助手各一条；流式输出正常结束 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-019 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 图片随消息发送并得到回复 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；选中支持图片输入的模型 | 1.附带一张可识别的图片 2.提问图片内容 3.查看回复 | 回复能描述图片内容；会话中保留图片缩略图 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-020 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 思考等级按上游声明执行 | [03-AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-03)、[04-AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；选中支持思考等级的模型 | 1.查看可选等级集合 2.选择上游声明的一档 3.发送消息并观察回复 | 可选等级与上游声明一致；未声明的等级不在列表中；所选档位在请求中体现（或用上游可见的思考输出确认） | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-021 | [FNOS-026-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 调用失败时显示可读错误 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-04) | 已登录；可构造失败（断网或额度耗尽） | 1.发送一条消息 2.等待失败返回 | 会话中显示可读的错误信息（含失败原因）；不出现空白回复；可重试 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-05 套餐额度展示](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-022 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 三个窗口的已用百分比 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 已登录；账号在 Go 或 Go Plus 订阅内 | 1.打开详情页额度卡片 2.与 Console 的用量页比对 | 5 小时、每周、每月三个窗口均显示已用百分比，数值与 Console 一致 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-023 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 重置倒计时递减 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 额度卡片已有数据 | 1.记录某窗口的倒计时 2.等待 60 秒 3.再次查看 | 倒计时相应减少；跨越重置时间后该窗口重新开始计时 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-024 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 额度不可用时显示未知而不是 0% | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 已登录 | 1.使额度接口返回失败 2.点刷新 3.查看卡片 | 显示失败原因与最近一次获取时间；未读取到的窗口不显示 0% | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-025 | [FNOS-026-05](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 手动刷新更新数据与获取时间 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-05) | 额度卡片已有数据 | 1.记录获取时间 2.点「刷新」 3.观察按钮状态与结果 | 按钮在刷新期间禁用并显示进行中；成功后获取时间更新、数值重新读取 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-06 对话输入区用量胶囊](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-026 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | auto 策略只在 OpenCode 模型下显示 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 auto | 1.选中 OpenCode Go 模型并查看输入区右侧 2.切换到其它供应商模型再查看 | 前者显示用量胶囊；后者不显示，也不触发额度请求 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-027 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | always 策略常驻显示 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 always | 1.分别选中 OpenCode Go 与其它供应商模型 2.查看输入区右侧 | 两种情况下胶囊都显示；数值随刷新更新 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-028 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | off 策略隐藏并停止刷新 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 off | 1.选中 OpenCode Go 模型 2.查看输入区 3.观察一段时间内的额度请求 | 胶囊不显示；不再产生额度自动刷新请求；详情页额度卡片仍可手动刷新 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-029 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 胶囊与额度卡片数字一致 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；策略为 auto 或 always | 1.记录额度卡片的已用比例 2.在同一时刻查看胶囊 3.查看胶囊的重置时间 | 两处比例一致；胶囊可查看重置时间且与卡片一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-030 | [FNOS-026-06](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 修改策略后即时生效 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-06) | 已登录；存在进行中的会话 | 1.在设置区把策略从 auto 改为 off 2.不重启 DSH，回到会话查看 3.再改回 auto 查看 | 策略变化后下一次进入会话或下一次对话即按新策略显示 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-07 模型目录管理](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-031 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 搜索即时过滤目录 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有数据 | 1.输入某个模型名称片段 2.清空搜索框 | 列表即时过滤为匹配项；清空后恢复全部模型 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-032 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 隐藏模型后选择器不再出现 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有数据 | 1.隐藏某个模型 2.打开模型选择器 3.恢复该模型的开关 | 隐藏后选择器不出现该模型；恢复后重新出现 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-033 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 刷新目录更新数据与获取时间 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有数据 | 1.记录获取时间 2.点「刷新」 3.比对模型集合与上游目录 | 目录更新为最新读取结果；获取时间更新；刷新期间有进行中提示 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-034 | [FNOS-026-07](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 刷新失败保留上一份目录 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-07) | 目录卡片已有数据 | 1.阻断目录来源 2.点「刷新」 3.查看列表与提示 | 列表保持上一份可用目录；显示失败原因；选择器不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-08 登录态与偏好持久化](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-035 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 重启后登录态保持 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 已登录且凭据未过期 | 1.重启 DSH Web（或 DSH Desktop） 2.重新打开详情页 3.查看账号卡片 | 仍为已登录；无需重新登录；模型选择器仍有 `OpenCode Go` | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-036 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 偏好设置在重启后保持 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 已登录 | 1.隐藏一个模型、把策略改为 always、把刷新间隔改为非默认值 2.重启客户端 3.逐项核对 | 三项设置保持；隐藏的模型仍不可选；策略与间隔为修改后的值 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-037 | [FNOS-026-08](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 禁用插件不影响其它供应商 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-08) | 已登录；已配置其它供应商 | 1.禁用本插件 2.重启客户端 3.查看模型选择器与其它供应商用量 | 其它供应商模型与用量正常；选择器无 `OpenCode Go` 残留分组；历史会话可打开 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

### [FNOS-026-09 文档站与插件登记](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-038 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 插件总览与菜单可达 | [AC-01](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档站依赖已安装 | 1.打开 `/plugins/` 2.查找该插件的行 3.从左侧菜单点击 `dsh-opencode` | 总览包含该插件行并链接到说明页；菜单可进入 `/plugins/dsh-opencode`；版本号与插件清单一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-039 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 说明页内容完整 | [AC-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 说明页已发布 | 1.逐节阅读说明页 2.对照需求「不在本次范围内」与已知约束 | 包含安装命令、登录方式、模型与能力、套餐额度与胶囊、设置说明、已知约束与常见问题；未把未上线能力写成已可用 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-040 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 市场源列表包含该包 | [AC-03](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 插件已发布到 npm | 1.读取 `docs/public/plugins/market/plugins.txt` 2.检查生成的索引文件状态 | 源列表含 `@tnnevol/dsh-opencode`；生成的 `index.json` 未被手工改写 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |
| TC-041 | [FNOS-026-09](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 文档构建与链接检查 | [AC-04](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-09) | 依赖已安装 | 1.执行文档站构建 2.逐个打开新增菜单目标 3.执行 `git diff --check` | 构建通过；新增菜单目标文件均存在；无死链；`git diff --check` 无输出 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-026-dsh-opencode-plugin) |

## 测试执行结果

> 本轮只登记用例设计，结果列为「待执行」。执行后只回填本表与后两节，不修改上方用例定义。

### 已完成的联调记录（2026-10-23）

2026-10-23 在本地 DSH Web（`DSH_HOME` 指向仓库 `.dsh`，独立端口）用真实账号完成一轮联调。以下是接口与端点层面的证据，**不替代上方任何用例，也不产生用例通过结论**：

| 项目 | 实测结果 |
| --- | --- |
| 插件加载 | 插件加载成功，详情页可打开 |
| API Key 登录 | `/plugins/dsh-opencode/auth/key` 返回 200 |
| 套餐额度 | `/plugins/dsh-opencode/usage` 返回 rolling 24% / weekly 78% / monthly 53% |
| 模型目录 | `/plugins/dsh-opencode/catalog` 返回 36 个公开目录模型 |
| 协议端点直连探测 | 路径正确：OpenAI Chat Completions 与 Anthropic Messages 返回 200；OpenAI Responses 因上游地区限制返回 403；Google Generative AI 因工作空间隐私设置返回 400（两者均为上游策略，不是路径错误） |
| 网关会话头 | 网关强制要求 `x-opencode-session`，缺失时返回 400 `MissingSessionID` |

**未执行单模型对话用例**：TC-013、TC-018、TC-019、TC-020、TC-021 等在线用例仍为「未执行」，本轮不产生通过/失败结论；版本三元组在正式执行用例时记录。

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
| TC-009 | [FNOS-026-02](/requirements/FNOS-026-dsh-opencode-plugin#fnos-026-02) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需 Go 订阅账号 |
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

## Bug 记录

本轮尚未执行，暂无 Bug 记录。执行后按用例填写 `BUG-##`，并注明严重级别、状态与修复说明；修复引起需求或计划范围变化时，登记到当前开发中的需求与计划。

## 测试结论

- **结论**：尚未执行。
- 用例总数 41 条，未执行 41 条，通过 0 条，失败 0 条，遗留 Bug 0 个。
- 一句话结论：用例设计与覆盖范围已登记，待插件实现完成并通过包级验证后，在 DSH Web 与 DSH Desktop 执行；执行结论回填本页后，再判定需求状态。

### 遗留风险

1. **外部账号与网络依赖**：登录、目录与额度依赖真实 OpenCode Console 账号、Go 或 Go Plus 订阅与可直连 `opencode.ai` 的网络。缺条件时用例按阻塞登记，不据此判定功能缺陷。
2. **同名路由冲突尚未定案**：用户已配置同名 `opencode-go` 路由时的产品表现待确认（见「待确认项」），该场景暂无验收条件与用例。
3. **上游目录与额度接口未公开完整契约**：字段漂移时插件按降级处理，用例以夹具固定已知形态；真实账号下出现新字段时需补用例。
4. **桌面端仅覆盖开发态客户端**：DSH Desktop 结论来自 `fork-pj/deepseek-harness` 的开发态客户端，不作为发行版客户端的独立验收结论。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-23 | 按真实账号联调结果更正目录口径与补充证据 | 更正 TC-009（目录以公开清单为全集、账号配置只叠加覆盖，`models` 为空不代表没有模型）与 TC-010（账号配置不可读时仍服务公开目录并说明来源），补充一条风险点；在「测试执行结果」新增 2026-10-23 本地 DSH Web 联调记录（插件加载、API Key 登录、额度、36 个目录模型、四种协议端点直连探测与 `x-opencode-session` 要求），并标注未执行单模型对话用例。 |
| 2026-10-23 | 建立 FNOS-026 测试用例文档 | 按九个功能分节登记 41 条用例，覆盖正向、逆向、边界、权限与数据一致性五类；执行结果全部为「未执行」，Bug 与结论待回填。登记四条遗留风险（含同名路由冲突）与一条待确认项。 |
