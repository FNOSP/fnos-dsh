---
id: FNOS-027
title: FNOS-027 测试用例
description: FNOS-027 ZCode 设备授权登录、账号权益驱动的模型目录、模型能力、托管 app-server 执行通道、按模型额度与通道诊断的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-027-dsh-zcode-plugin
plan: /plans/PLAN-FNOS-027-dsh-zcode-plugin
status: 执行中
lastVerified: 2026-10-24
verifiedAt: 2026-10-24
---

# FNOS-027 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | [FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) |
| 关联计划 | [PLAN-FNOS-027](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| 覆盖功能 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) 至 [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) |
| 测试状态 | <Badge type="info" text="执行中（2026-10-24：接口级实测、桥接通道级实测与 DSH Web 三轮端到端对话已回填；DSH Desktop 与真实 fnOS NAS 待执行）" /> |
| 用例总数 | 36 |

## 测试范围与需求分析

被测对象是新增插件 `@tnnevol/dsh-zcode` 的八项功能：ZCode 账号的 OAuth 设备授权登录（BigModel 国内 / Z.ai 海外两个家族）、以账号权益为真源的动态模型目录、模型能力适配、**托管官方 agent 运行时的 Start Plan 执行通道**（含 Ultra HTTP 通道与业务码诊断）、按「模型 × 周期」的额度展示、插件详情页与用量胶囊、登录态与偏好持久化，以及文档站与插件登记。

三份文档的分工：功能范围与验收条件见[需求文档](/requirements/FNOS-027-dsh-zcode-plugin)，实现任务与验证方式见[计划文档](/plans/PLAN-FNOS-027-dsh-zcode-plugin)，本页只登记用例设计、执行结果、Bug 与结论。

用例与计划阶段的对应关系：

| 计划阶段 | 覆盖功能 | 用例范围 |
| --- | --- | --- |
| [阶段一：宿主侧登录与凭据](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段一-宿主侧登录与凭据) | FNOS-027-01 | TC-001 至 TC-006 |
| [阶段二：模型目录与供应商适配](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段二-模型目录与供应商适配) | FNOS-027-02、FNOS-027-03 | TC-007 至 TC-015 |
| [阶段三：执行通道、请求与上游诊断](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段三-执行通道、请求与上游诊断) | FNOS-027-04 | TC-016 至 TC-022 |
| [阶段四：插件详情页与用量胶囊](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段四-插件详情页与用量胶囊) | FNOS-027-05、FNOS-027-06、FNOS-027-07 | TC-023 至 TC-035 |
| [阶段五：文档站与发布登记](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段五-文档站与发布登记) | FNOS-027-08 | TC-036 |
| [阶段六：验证与收尾](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段六-验证与收尾) | 全部 | 汇总执行结果与结论 |

### 关键风险点

| 风险 | 用例方向 |
| --- | --- |
| 账号 JWT 或家族访问令牌泄漏到浏览器 | 在页面源码、网络响应与本地存储中检索明文（TC-006） |
| 授权中刷新页面产生第二条轮询，或替换用户已打开的授权链接 | 授权中刷新详情页，核对授权地址与上游请求次数（TC-003） |
| 两个家族的授权页混淆，用户选错后拿不到令牌 | 两个家族各完成一次登录，核对授权页域名与账号家族（TC-002、TC-033） |
| 模型清单写死或读错来源，与账号权益不一致 | 对照额度接口的 `capabilities` 核对选择器与目录（TC-007、TC-008） |
| 额度接口失败后目录被清空 | 制造额度接口失败，核对目录仍可用并标注来源（TC-009） |
| 缺少设备标识导致 `3001`，被误判为代码缺陷 | 用缺少 `X-Device-Mid` 的响应夹具核对诊断归类（TC-022） |
| 能力字段投影错误，模型看似可选但容量不对 | 对照客户端配置核对上下文窗口、最大输出与思考等级（TC-012 至 TC-014） |
| **执行通道依赖 ZCode 客户端**：未安装或布局变化导致回合不可用 | 移除或改指 CLI 路径，核对诊断可读且不退回 HTTP 直连（TC-018） |
| **通道三个静默失败前提**：数据目录只读、revision 不匹配、提交过快都会卡住且不报错 | 分别构造只读目录、错误 revision 与零延迟提交，核对可诊断性与日志（执行通道实测） |
| 工具由 ZCode agent 原生执行，用户误以为 DSH 工具生效 | 走查回复是否说明工具归属；检查伪调用标记被拦截（TC-016、TC-022） |
| 同一会话并发回合交叉或撞锁后无法恢复 | 上一回合未结束时再发送，核对串行与撞锁自愈（TC-020） |
| 会话标题把英文指令当标题 | 构造标题请求的 JSON 数组与缺数组两种形态（TC-021） |
| 图片缺少扩展名导致模型 `Read` 失败 | 图文回合核对图片被正确读取（TC-017） |
| 额度被合并成一个百分比，掩盖「日额度用完但活动额度还有」 | 对照上游条目核对日额度与一次性额度是否分列（TC-023、TC-024） |
| 额度缺失被补成 0%，用户误以为额度充足 | 制造额度接口失败，断言不显示 0%（TC-026） |
| 登录态或偏好没有真正落盘，重启即丢 | 重启 DSH 后逐项核对（TC-034、TC-035） |
| 插件禁用后仍残留供应商分组或影响其它供应商 | 禁用插件后检查模型选择器（TC-035） |
| 新增页面与菜单断链 | 文档构建 + 逐个打开菜单目标（TC-036） |

### 待确认项

- ❓ DSH Desktop 的托管通道尚未走查：Desktop 的宿主进程模型与 Web 不同，需确认子进程 spawn、Node 定位与 profile 共享在同一套运行时下可用。本轮只登记 DSH Web 结果，Desktop 按待执行处理。
- ❓ 真实 fnOS NAS 未执行：本插件不依赖 fnOS 宿主桥接，按需求口径不设 NAS 门槛；如后续随应用内置分发，再补安装后可用性走查。
- ❓ 账号权益里没有 capability 的额度条目（账号级或活动级记录）是否需要在界面单独成组，尚未形成产品结论。本轮按「不生成模型、只在额度卡片标注」登记。

### 已知限制（上游与通道）

以下限制来自 ZCode 上游策略或托管通道的固有边界，不是插件缺陷；对应用例只验证「行为可读、结果不伪装」。

| 限制 | 实测表现 | 对用例的影响 |
| --- | --- | --- |
| 插件自己构造的 Start Plan HTTP 请求被风控拦截 | HTTP 405 与业务码 `3012`（`request has been blocked due to unusual activity.`）；带/不带签名、Ed25519 请求签名 V4、HTTP/1.1 与 HTTP/2、源站浏览器 fetch 均一致（2026-10-24 穷举探测） | 该路径已不作为执行通道；TC-016 起以托管通道为预期。`3012` 仅作为兜底诊断（本次回合未经过托管通道） |
| 托管通道依赖 ZCode 客户端发行包 | 未安装客户端或找不到 `zcode-builtin.json` 时通道不可用；数据目录只读时回合静默卡住 | TC-018 覆盖缺失诊断；执行通道实测覆盖只读目录与 revision 前提 |
| 托管通道的工具由 ZCode agent 原生执行 | DSH 侧工具与批准流程不参与该回合；正文出现伪 `antml` 调用标记时由桥接层拦截 | TC-016 核对工具归属说明与伪调用处理 |
| 一个 agent 会话同一时刻只允许一个在途回合 | 并发提交会撞「已在运行」，插件补发 `session/stop` 后重试一次 | TC-020 覆盖串行与撞锁自愈 |
| 会话标题请求携带英文指令 + 人话 JSON 数组 | 照抄指令会把标题变成 `Generate the session tit`；插件改为取数组第一条人话，取不到回退默认标题 | TC-021 覆盖两种形态 |
| 未授权模型返回另一业务码，反证鉴权已通过 | `400` 与 `3006`（`model not allowed`）：账号没有该模型权益时才出现（2026-10-24 实测） | TC-022 用未授权模型验证 `3006` 分支 |
| Ultra 端点计费归属不同 | 家族 MaaS 令牌可被 `ultra/anthropic` 接受，但计费落到个人按量余额；余额为 0 时返回 `429 / 1113` | TC-022 覆盖 Ultra 与 `1113` 分支 |
| API Key 形态没有可用路径 | Start Plan 的模型请求只接受账号身份 | TC-001、TC-005 断言界面不出现 Key 入口；不设「用 Key 登录成功」用例 |
| 额度接口强制要求稳定设备标识 | 缺少 `X-Device-Mid` 时返回 `3001`（`parameter error`）；标识变化会让同一账号被当成新设备 | TC-022 覆盖该分支；设备标识稳定性在 TC-035 观察 |
| 模型清单与额度随账号权益变化 | 本账号 2026-10-24 为 GLM-5.3 与 GLM-5.3-Flash；套餐变体会改变清单 | TC-007、TC-008 以执行时的权益为准，不硬编码完整清单 |

### 执行顺序与数据清理

- 按[账号状态测试顺序](/charter/tests-spec#账号状态测试顺序与-auth-配置备份)执行：**先测登录态**（TC-007 至 TC-035 中的在线用例）→ **再测非登录态**（TC-001、TC-009 的未登录分支、TC-026）→ **最后测登录流程**（TC-002 至 TC-006）。
- 移除登录态前，把 `<DSH_HOME>/.dsh-zcode-auth.json` 备份到 `tmp/auth-back/dsh-zcode-<版本>-<日期>/`；恢复时原样复制并 `chmod 600`，再用 `stat -c '%a %n'` 核对。
- 桥接通道的数据目录为 `<DSH_HOME>/zcode-bridge/`：测试结束后删除该目录即可清空凭据副本、会话库与 workspace；它不包含用户会话历史。删除前确认没有其它实例正在使用。
- 测试数据清理：退出测试账号或恢复备份、把胶囊策略与隐藏模型恢复默认、删除测试产生的临时截图与报告；测试账号、凭据与备份不得进入仓库。
- UI 类用例（账号卡片、额度卡片、目录卡片、用量胶囊）在**亮色与暗色主题**下各执行一遍，并核对[UI 测试](/charter/tests-spec#ui-测试-视觉与样式)要求的对比度、间距与毛玻璃层级。

## 测试环境

| 功能 | 执行环境 | 说明 |
| --- | --- | --- |
| [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01)、[FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web 与 DSH Desktop | 需要真实 ZCode 账号与可直连 `zcode.z.ai` 的网络；两个家族各需一个可用账号 |
| [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web 与 DSH Desktop | 容量与思考等级比对以账号的客户端配置为准；需要可构造配置不可读的分支 |
| [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web（已实测）、DSH Desktop（待执行） | 需要真实账号、可直连网络，并在运行环境安装 ZCode 客户端（或用 `DSH_ZCODE_CLI` 指定）；缺少客户端时按阻塞/待执行登记 |
| [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05)、[FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web 与 DSH Desktop | 额度数据需要处于 Start Plan 订阅内的账号；UI 用例需亮暗主题各执行一遍 |
| [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web 与 DSH Desktop | 持久化用例需要重启对应客户端 |
| [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站构建环境 | `pnpm run check -- --docs`（或 `pnpm run build -- --docs`）与 `git diff --check` |

执行环境口径：

- **DSH Web**：`pnpm run start -- --web`，`DSH_HOME` 指向仓库 `.dsh`；用启动日志里带 `?token=` 的地址访问。
- **DSH Desktop**：使用上游源码检出 `fork-pj/deepseek-harness` 的开发态 Desktop（`DSH_DESKTOP_APP_DIR` 指定），profile 使用项目根 `.dsh/profiles/desktop`，不触碰 `~/.dsh/profiles/desktop`。
- 本插件不依赖 fnOS 宿主桥接，**不要求真实 fnOS NAS 验收**；登录、通道与额度依赖外部账号与客户端条件，缺少条件时按阻塞登记。
- 执行前记录版本三元组（DSH 运行时、插件版本、Desktop 来源与版本），写入执行结果备注；版本不匹配时结果无效。

## 测试用例

### [FNOS-027-01 用 ZCode 账号登录](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 未登录时账号卡片显示两个账号家族 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 插件已安装且未登录 | 1.打开插件管理 2.进入 `ZCode` 详情页 3.查看账号卡片 | 卡片显示 BigModel（国内）与 Z.ai（海外）两个入口与授权页域名差异说明；无账号、套餐与额度数据 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-002 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 设备授权登录全流程 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 未登录；可直连 `zcode.z.ai`；具备测试账号 | 1.选择一个账号家族并发起登录 2.读取授权地址与剩余有效期 3.在浏览器打开授权地址并完成登录 4.回到 DSH 查看账号卡片（不手动刷新页面） | 授权中显示授权地址、复制按钮与剩余有效期；完成后卡片自动变为已登录并显示账号信息；已登录状态只保留退出登录 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-003 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 授权中刷新页面不新建轮询、不换链接 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 已发起设备授权 | 1.记录当前授权地址 2.刷新详情页两次 3.再次查看授权地址 4.观察上游轮询请求 | 授权地址与刷新前一致；上游轮询链路只有一条；页面不出现两个不同的授权地址 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-004 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 取消与授权链接过期 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 已发起设备授权 | 1.点「取消」并查看卡片 2.重新发起登录 3.等待超过有效期后查看卡片 4.再次发起 | 取消后回到未登录且未写入凭据；重新发起可拿到新链接；过期后回到未登录并说明原因 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-005 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 不存在 API Key 登录入口 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 未登录与已登录各一份 | 1.在未登录状态查看账号卡片全部操作 2.在页面内检索「API Key」「Key 登录」等等价文案 3.登录后再次查看 4.向登录路由提交 Key 形态请求 | 两种状态下都不出现 Key 输入入口与等价文案；提交 Key 形态请求被拒绝，不写入凭据 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-006 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 凭据不出现在浏览器侧 | [AC-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 已完成登录 | 1.在页面内检索源码与 `localStorage` 2.抓取状态、目录与额度接口的响应 3.检索账号 JWT 与家族访问令牌的明文 | 页面源码、存储与响应中均无令牌明文；响应只含状态、账号与账号家族信息 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-02 按账号权益动态出现的模型目录](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 供应商唯一且清单与账号权益一致 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 已登录；额度接口可读 | 1.读取额度接口的 `capabilities` 2.打开 DSH 模型选择器 3.打开详情页目录卡片比对 | 选择器只出现一个 `ZCode` 供应商（路由 `dsh-zcode`）；模型清单与 `capabilities` 一致（本账号为 GLM-5.3 与 GLM-5.3-Flash）；模型 id 为官方大小写形态 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-008 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 权益变化后刷新即生效 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 已登录；账号权益可变化（新增套餐、活动赠送或到期） | 1.记录当前目录 2.在 ZCode 侧使权益变化 3.在详情页点「刷新」 4.查看目录与选择器 | 目录出现新增模型或移除已失效模型；不需要升级插件或改配置；获取时间更新 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-009 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 额度不可读时回退内置清单并标注来源 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 已登录；可构造额度接口失败（桩或网络规则） | 1.使额度接口返回失败 2.刷新目录 3.查看选择器与目录卡片 4.查看来源说明 | 仍显示 `GLM-5.3-Flash`、`GLM-5.2`、`GLM-5-Turbo` 三个内置模型；卡片说明清单未经账号确认与失败原因；上一份目录不被清空 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-010 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 未登录时的目录与登录后的变化 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 未登录 | 1.打开模型选择器 2.查看是否出现 `ZCode` 分组 3.登录后再次查看 | 未登录时按内置清单展示并提示需登录，或不出现在选择器；登录后切换为账号权益清单并去掉未确认标注 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-011 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 手工配置 `zcode` / 同名 `dsh-zcode` 路由时的注册表现 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 已登录；`llm-pi-ai` 设置中已手工配置 `zcode` 或 `zhipu` 路由 | 1.保留手工配置 2.在插件详情页重新登录或刷新 3.打开模型选择器确认 `ZCode` 出现且手工配置未被覆盖 4.再预置同名 `dsh-zcode` 配置并重启 5.查看详情页诊断与选择器 | 手工配置与插件并存，`ZCode` 正常出现；同名 `dsh-zcode` 冲突时插件给出可诊断提示，不静默替换用户配置 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-03 模型能力完整适配](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 上下文窗口与最大输出与上游一致 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；客户端配置可读 | 1.读取 `client/configs` 中每模型的 `contextWindow` 与 `maxCompletionTokens` 2.查看目录卡片与模型信息 3.逐项比对 | GLM-5.3 与 GLM-5.3-Flash 显示 1000000 上下文与 128000 最大输出，与上游一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-013 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 思考等级可选项与上游声明一致 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；模型声明了 low / high / max 三档 | 1.查看可选思考等级集合 2.逐档查看是否可选 3.选择 High 发消息并抓包 4.切换模型后观察是否重切模型 | 七档选择器可用，按 `off` / `minimal` / `low` → `low`、`medium` / `high` → `high`、`xhigh` / `max` → `max` 归并；请求体带 `output_config.effort`；不额外出现上游不存在的档位；换模型或换等级会在既有会话上重新 `setModel` | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-014 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 图片输入能力与上游一致 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录 | 1.查看声明支持图片输入的模型是否有图片入口 2.查看未声明图片输入的模型 3.向支持图片的模型附一张含文字的图片并发送 | 声明支持的模型有图片入口；模型能读出图中文字；未声明的不出现图片入口，附加图片时给出可读提示且不发送 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-015 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 客户端配置不可读时用保守默认值 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；可构造客户端配置接口失败 | 1.使客户端配置接口返回失败 2.刷新目录 3.查看容量与思考等级 4.查看说明文案 | 模型仍出现在列表中；容量显示保守默认值；详情页说明能力来自默认值而非上游声明 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-04 选中模型可发起对话并得到可读诊断](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-016 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 托管通道完成纯文本回合并回显用量 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；运行环境已安装 ZCode 客户端（或已用 `DSH_ZCODE_CLI` 指定） | 1.选中 `ZCode` 下的模型发送一条文本消息 2.等待回复 3.查看会话正文与 token 用量 4.查看输入区用量胶囊 | 回合由托管 agent 运行时完成并返回真实回复与 token 用量；胶囊同步反映消耗；回复中不出现伪工具调用文本 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-017 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 图文与思考等级在同一回合生效 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；选择支持图片输入的 GLM-5.3-Flash | 1.选择思考等级 High 2.附一张含文字「DSH ZCODE」「图文可用 7」的图片发送 3.核对回复与吞吐/缓存指标 | 模型正确读出图中文字；回复内容与图片一致；思考等级映射生效；回合正常结束并回显用量 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-018 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 缺少客户端或内置配置时给出可读诊断 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可临时把 `DSH_ZCODE_CLI` 指向不存在的文件或移走内置 provider 配置 | 1.发送一条消息 2.查看会话诊断 3.恢复配置后重发 | 会话显示「未找到 ZCode 客户端自带的 CLI（zcode.cjs）」或「安装不完整」类中文诊断，并提示安装客户端或指定 CLI；不出现空白回复、不静默重试，也不退回 HTTP 直连；恢复后可正常发送 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-019 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 失败、超时、中止与进程退出的收尾 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可构造长回合与子进程终止 | 1.构造超过回合超时的请求 2.在回合中中止请求 3.直接结束 agent 子进程 4.每次后查看会话并重发一条 | 三种情况都以明确错误结束，不出现空白助手消息、不显示为成功；插件补发 `session/stop`；下一轮自动重建会话并可继续 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-020 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 同一会话回合串行与撞锁自愈 | [AC-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录 | 1.上一回合未结束时再发一条消息 2.观察两轮执行顺序 3.构造未释放的回合锁后再发送 | 两个回合串行执行、不交叉；撞锁时插件补发 `session/stop` 后重试一次；仍失败时显示「上一轮仍在运行」类可读诊断 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-021 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 会话标题本地生成且不误取英文指令 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录 | 1.新建会话并观察标题 2.构造标题请求（英文指令 + 人话 JSON 数组） 3.构造只有英文指令、没有 JSON 数组的请求 | 标题取 JSON 数组第一条人话；取不到时保留默认标题（不产出文本块）；不出现 `Generate the session tit` 类英文指令；标题生成不触发模型调用、不消耗额度 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-022 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | Ultra 通道与业务码诊断 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)、[AC-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可切换推理端点并构造业务码响应 | 1.切换到 Ultra 发请求 2.用未授权模型发请求 3.构造 `3007` 与 `1113` 4.查看各诊断 | Ultra 使用家族令牌与 `ultra/anthropic`；`3006` / `3007` / `1113` 分别可读；`3012` 作为兜底说明「本次未经过托管通道」；文案不承诺绕过、不引导改用非官方转发 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-05 按模型展示额度窗口](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-023 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 套餐与按模型额度窗口 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录；账号处于 Start Plan 订阅内 | 1.打开详情页额度卡片 2.与额度接口的 `plans[]` 与 `balances[]` 比对 | 显示当前生效的两份套餐（`zcode-v3-start-plan-0817` 与 `zcode-v3-start-plan-1024`）与每个模型各自的窗口；窗口的模型名与上游 `show_name` 对应 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-024 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 日额度与一次性额度分别展示 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录；账号同时有日额度与一次性活动额度 | 1.查看 GLM-5.3 与 GLM-5.3-Flash 各自的窗口数 2.核对每块的周期标记 3.核对剩余量 | 每个模型显示两个独立窗口（日额度 3,000,000 / 5,000,000 与一次性 200,000,000 / 300,000,000）；周期按上游原样标记；不合并成一个百分比 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-025 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 百分比、剩余量与重置倒计时 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度卡片已有数据 | 1.记录某窗口的已用百分比、剩余量与倒计时 2.等待 60 秒 3.再次查看 | 三项数值与接口一致；倒计时相应减少；跨越重置时间后该窗口重新开始计时 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-026 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度不可用时显示未知而不是 0% | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录 | 1.使额度接口返回失败 2.点刷新 3.查看卡片 | 显示失败原因与最近一次获取时间；未读取到的窗口显示未知，不显示 0% | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-027 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 手动刷新更新数据与获取时间 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度卡片已有数据 | 1.记录获取时间 2.点「刷新」 3.观察按钮状态与结果 | 按钮在刷新期间禁用并显示进行中；成功后获取时间更新、数值重新读取 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-06 插件详情页与用量胶囊](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-028 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 详情页四块卡片 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录 | 1.自上而下阅读详情页 2.逐个区块执行一次操作（登录态查看、刷新额度、搜索目录、修改设置） 3.检查是否影响其它插件 | 账号、额度、目录、设置四块齐备且各自可操作；操作只影响本插件；其它插件详情页不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-029 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录搜索与获取时间 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录卡片已有数据 | 1.输入模型名称片段并核对结果 2.清空搜索框 3.核对计数与获取时间 | 列表即时过滤为匹配项；清空后恢复全部模型；计数随搜索更新；获取时间可见 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-030 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 隐藏模型后选择器不再出现 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录卡片已有数据 | 1.隐藏一个模型 2.打开模型选择器 3.恢复该模型后再次查看 | 被隐藏的模型不再出现在选择器；恢复后重新出现 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-031 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 三种胶囊策略与数字一致性 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06)、[AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录 | 1.auto 下分别选中 `ZCode` 与其它供应商模型，查看输入区 2.改为 always 后重复 3.改为 off 后重复 4.比对胶囊与额度卡片的已用比例 | auto 仅在选中 `ZCode` 模型时显示且不请求额度；always 常驻；off 隐藏并停止自动刷新；两处比例一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-032 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 用量图标样式与悬停信息 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录并选中 `ZCode` 模型 | 1.查看输入区右侧图标 2.悬停查看 tooltip 3.点击展开 popover 4.比对详情页额度 | 26px 环形进度 + 环心品牌标记与 Codex 插件一致；tooltip 与 popover 显示各份额度与重置时间；比例与详情页一致；亮暗主题可读 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-07 登录态与偏好持久化](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-033 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 两个账号家族登录后状态一致 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 具备 BigModel 与 Z.ai 各一个账号 | 1.用第一个家族登录并记录账号家族 2.退出后改用第二个家族登录 3.核对账号卡片与目录 | 两次登录分别显示对应家族；账号信息与目录按当前账号显示；切换家族后不残留上一账号的目录 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-034 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 重启后登录态与偏好保持 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07)、[AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录；已修改偏好 | 1.隐藏一个模型、把胶囊策略改为 always、把刷新间隔改为非默认值 2.重启 DSH Web（或 DSH Desktop） 3.逐项核对 | 仍为已登录且无需重新登录；三项偏好保持；非法值回落到默认值 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-035 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 凭据文件权限与插件禁用影响 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录；已配置其它供应商 | 1.核对凭据文件权限 2.禁用本插件并重启 3.查看模型选择器与其它供应商用量 4.重新启用后查看登录态 | 凭据文件权限为 `600`；禁用后其它供应商模型与用量正常、无 `ZCode` 残留分组；重新启用后登录态保持 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-08 文档站与插件登记](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-036 | [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站、菜单、说明页与市场源列表 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站依赖已安装；插件已或未发布 | 1.打开 `/plugins/` 查找该插件行并从菜单进入说明页 2.逐节阅读说明页并对照需求的「不在本次范围内」 3.读取市场源列表 4.执行 `pnpm run check -- --docs` 与 `git diff --check` | 总览与菜单均可进入 `/plugins/dsh-zcode`；说明页含安装（含客户端要求）、两个家族登录、模型与能力、按模型额度、执行通道（工具归属、单在途回合、标题本地生成）与直连限制；发布后源列表含 `@tnnevol/dsh-zcode` 且生成的索引未被手改；构建通过、无死链 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

## 测试执行结果

> 用例定义已在上一节固定；本节只回填执行状态与证据。DSH Web 的部分结论来自 2026-10-24 的走查，DSH Desktop 与真实 fnOS NAS 尚未执行。

### 接口级实测（2026-10-24，真实账号）

2026-10-24 用真实 ZCode 账号完成一轮控制面接口实测。以下是**接口层面**的证据：

| 项目 | 实测结果 |
| --- | --- |
| 设备授权发起 | `POST /api/v1/oauth/cli/init` 对两个家族均返回 HTTP 200，响应含 `flow_id`、`poll_token`、`authorize_url`、`expires_at` 与 `poll_interval_sec` |
| 两个家族的授权页 | BigModel 返回 `bigmodel.cn/login?appId=zcode&…`；Z.ai 返回 `chat.z.ai/api/oauth/authorize?client_id=client_P8X5CMWmlaRO9gyO-KSqtg&…`，与调研结论一致 |
| 设备授权轮询 | `GET /api/v1/oauth/cli/poll/<flowId>` 携带同一 pollToken 时按 `pending` → `ready` 迁移；`ready` 返回账号 JWT、账号信息与家族 `access_token`，HTTP 200 |
| Start Plan 额度 | `GET /api/v1/zcode-plan/billing/balance` 返回两份套餐与按模型额度，HTTP 200；缺少 `X-Device-Mid` 时返回 HTTP 200 但信封为 `{"code":3001,"msg":"parameter error"}` |
| 客户端配置 | `GET /api/v1/client/configs` 返回 GLM-5.3 与 GLM-5.3-Flash 的 1000000 上下文、128000 最大输出与 low / high / max 三档思考等级 |
| 模型清单 | 从额度条目的 `capabilities` 解析出 GLM-5.3 与 GLM-5.3-Flash，与账号权益一致 |
| 未授权模型 | 返回 HTTP 400 与 `{"code":3006,"msg":"model not allowed"}`，证明鉴权与权益解析通过；该结论用于 TC-022 |
| Ultra 端点 | 家族令牌访问返回 HTTP 429 + `1113`；账号 JWT 访问返回 HTTP 401，均为业务层响应；用于 TC-022 |

### 执行通道级实测（2026-10-24，`zcode.cjs app-server`）

用官方客户端发行包内的 agent 运行时做托管通道实测。这是本需求从「HTTP 直连被拦」转为「通道可用」的决定性证据：

| 项目 | 实测结果 |
| --- | --- |
| 回合完成 | `turn.completed` 返回真实回复：`response`「通道可用」，usage `inputTokens 19714` / `outputTokens 31` / `cacheReadTokens 15744`；`baseURL` = `https://zcode.z.ai/api/v1/zcode-plan/anthropic`，transport = `sse`，`finishReason` = `stop` |
| 数据目录可写性 | 把数据目录设为只读时，`session/send` 返回 accepted、状态变 `running`，但**永远没有 model 请求**；换成可写目录后恢复 |
| revision 精确匹配 | `basedOnZCodeBuiltinRevision` 与 `zcode-builtin:<revision>:<sha256(绝对路径)>` 不一致时，注入返回 `received` 但模型进不了 registry（被合并守卫静默丢弃） |
| 提交垫时 | 零延迟提交的回合被丢弃；`session/create` → `subscribe` → `setModel` → `send` 之间分别垫约 2s / 1.5s / 1.5s 后正常 |
| 思考等级 | 七档按 `off` / `minimal` / `low` → `low`、`medium` / `high` → `high`、`xhigh` / `max` → `max` 归并；换模型或换等级会在既有会话上重切 `session/setModel` |
| 会话标题 | 标题请求内容为英文指令 + 人话 JSON 数组；改为取数组第一条人话后标题正常，取不到时保留默认标题 |
| 工具归属 | 首轮注入硬规则后，模型不再把 DSH 工具清单当成本通道可用工具；正文出现伪 `antml` 标记时由桥接层拦截并说明 |

### DSH Web 端到端对话（2026-10-24，真实账号）

| 轮次 | 输入 | 结果 |
| --- | --- | --- |
| 1 | 纯文本消息 | 模型回复「通道可用」，用时 18 秒 |
| 2 | 图文 + 思考等级 High（GLM-5.3-Flash） | 15 秒完成，正确读出图中文字「DSH ZCODE」「图文可用 7」；吞吐 256 tok/s，缓存命中 28% |
| 3 | 观察额度 | 输入区用量胶囊由「剩余 100%」变为「剩余 93% · 6 小时后重置」，证明套餐额度确实被消耗 |

### 单元测试与类型检查（2026-10-24）

- `plugins/dsh-zcode-plugin/tests/host/bridge/` 下 5 个 spec：`protocol.spec.ts`、`runtime-paths.spec.ts`、`transcript.spec.ts`、`adapter.spec.ts`、`composite.spec.ts`。
- 插件测试全量 18 个文件 / 212 条用例通过；`npx tsc --noEmit -p tsconfig.json` 干净。
- 覆盖重点：env 白名单与 `ELECTRON_RUN_AS_NODE` 删除、反向请求应答、CLI 与 provider 配置定位、revision 组合、凭据加密、消息压平与模型 id 映射、伪调用识别、标题分支 chunk 序列与不触碰依赖、端点分流与资源释放。

### 用例执行状态

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 部分通过 | 2026-10-24 | 登录态账号卡片已走查（显示脱敏邮箱与用户 ID）；未登录态的两个家族入口与说明待补走查 |
| TC-002 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 部分通过 | 2026-10-24 | 两个家族的设备授权接口均走通并建立登录态；浏览器授权页逐步与自动刷新时序未单独取证 |
| TC-003 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-004 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-005 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；含路由拒绝 Key 形态请求 |
| TC-006 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-007 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 通过 | 2026-10-24 | 选择器仅一个 `ZCode` 分组，GLM-5.3 与 GLM-5.3-Flash 与权益一致 |
| TC-008 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需可变化权益的账号 |
| TC-009 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-010 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行 |
| TC-011 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需预置手工 `zcode` 与同名 `dsh-zcode` 配置 |
| TC-012 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 通过 | 2026-10-24 | 两个模型显示 1M 上下文 / 128K 输出 |
| TC-013 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 通过 | 2026-10-24 | 七档选择器可用；抓包断言请求体带 `output_config.effort`；换模型/等级重切模型 |
| TC-014 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 通过 | 2026-10-24 | GLM-5.3-Flash 接受图片并读出文字；GLM-5.3 不提供图片入口 |
| TC-015 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 未执行 | — | 待执行；需可构造客户端配置失败 |
| TC-016 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-24 | 纯文本回合 18 秒；回复「通道可用」；用量回显 |
| TC-017 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-24 | 图文 + High 15 秒；读出「DSH ZCODE」「图文可用 7」；256 tok/s、缓存命中 28% |
| TC-018 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需构造 CLI / provider 配置缺失 |
| TC-019 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 未执行 | — | 待执行；需构造超时、中止与子进程退出 |
| TC-020 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 未执行 | — | 待执行；需构造并发与未释放回合锁 |
| TC-021 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过（单测） | 2026-10-24 | 标题分支 chunk 序列、截断与回退由 `adapter.spec.ts` 覆盖；Web 标题误取英文指令的缺陷已修复 |
| TC-022 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 部分通过（接口级） | 2026-10-24 | `3006` / `1113` 已实测；`3007` 与 `3012` 兜底文案待会话走查 |
| TC-023 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 通过 | 2026-10-24 | 两份套餐与四个窗口按上游返回显示 |
| TC-024 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 通过 | 2026-10-24 | 日额度与一次性额度分列；「模型 + 周期」去重后无重复行 |
| TC-025 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 通过 | 2026-10-24 | 周期与重置时间按 Unix 秒正确显示（每日 / 本期内有效；10 小时 / 43 小时后重置） |
| TC-026 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-027 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行 |
| TC-028 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 通过 | 2026-10-24 | 账号、额度、目录、设置四块齐备 |
| TC-029 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 未执行 | — | 待执行 |
| TC-030 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 未执行 | — | 待执行 |
| TC-031 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web、DSH Desktop | 部分通过 | 2026-10-24 | `auto` 策略与图标显隐已修复并走查；`always` / `off` 与额度请求次数未逐项验证 |
| TC-032 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 部分通过 | 2026-10-24 | 26px 环形进度、环心标记、tooltip 与 popover 已对齐 Codex 插件；与额度卡片的逐项数值比对待补 |
| TC-033 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 部分通过（接口级） | 2026-10-24 | 两个家族的授权均已完成；会话内切换与目录不残留待执行 |
| TC-034 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需重启客户端 |
| TC-035 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-036 | [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站构建环境 | 通过 | 2026-10-24 | `pnpm run check -- --sdd` 与 `pnpm run check -- --docs` 通过；页面、菜单与索引已更新；市场条目依赖发布 |

### DSH Web 走查记录（2026-10-24，HTTP 直连阶段）

以下记录来自直连 HTTP 阶段，用于说明缺陷与修复；其中「端到端对话」当时受阻的原因已被托管通道解决。

| 走查项 | 结果 |
| --- | --- |
| 插件出现在「已安装插件」并可进入详情页 | 首次失败：插件未注册、四条路由全部 404、客户端模块表中没有该包。原因是 `locale/*.json` 写成 `displayName/description`，DSH 只认 `meta.title` / `meta.description`，改结构后恢复正常 |
| 账号卡片 | 通过：显示已登录、脱敏邮箱、登录入口与用户 ID |
| 模型目录与能力 | 首次失败：上下文与最大输出显示成 400K / 80K，思考与图片标记全缺。原因是能力读的是 `data.providers[].models[]`、把 `reasoning.levels` 当数组读、把图片开关当成 `capabilities.inputFormat.supportsImage`。改读 `data.builtinModels`、按对象取键、改读 `capabilities.vision` 后恢复正常 |
| 额度卡片 | 首次失败：四份额度的周期全部显示「其它」、重置时间全部显示「无重置时间」。原因是上游时间是 Unix 秒且没有 `period` 字段；改为按窗口时长推导周期、按秒转毫秒后正确 |
| 额度去重 | 通过：按「模型 + 周期」合并后不再出现重复行；不同周期仍分别展示 |
| 输入区用量图标 | 首次失败：`auto` 策略下图标从不出现。原因是读会话投影里不存在的 `pending` 字段，退回 `lastUsed`；改为 `next ?? lastUsed` 后正常，样式随后按 Codex 插件对齐 |
| 思考等级（GLM-5.3-Flash） | 通过：七档选择器映射到上游 low / high / max；抓包断言请求体带 `output_config.effort` |
| 图文输入（GLM-5.3-Flash） | 通过：图片被接受并显示缩略图，模型正确读出图中文字 |
| 端到端对话 | 当时阻塞：带图片与 Max 思考等级发出的请求仍返回 HTTP 405 与 `3012`；该路径已被托管 app-server 通道取代，见「执行通道级实测」与「DSH Web 端到端对话」 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-027-01 | TC-001 | `locale/*.json` 用了 `displayName/description`，插件整体不注册、路由 404 | 严重 | 已修复 | 改为 DSH 认的 `meta.title` / `meta.description` |
| BUG-027-02 | TC-012、TC-013、TC-014 | 模型能力读错路径：`providers[].models[]` 而非 `data.builtinModels`；`reasoning.levels` 当数组读；图片开关读 `inputFormat.supportsImage` | 严重 | 已修复 | 三处判定均按真实载荷改正，能力从假默认值变为上游真实值 |
| BUG-027-03 | TC-024、TC-025 | 额度周期恒显示「其它」、重置时间恒为空 | 严重 | 已修复 | 上游时间是 Unix 秒且无 `period` 字段；改为按秒解析并按窗口时长推导周期 |
| BUG-027-04 | TC-024 | 同一模型跨套餐的多条额度出现重复行 | 一般 | 已修复 | 按「模型 + 周期」合并，不同周期不合并 |
| BUG-027-05 | TC-031 | `auto` 策略下用量图标从不出现 | 严重 | 已修复 | 投影字段名应为 `next`（不是 `pending`），并取 `next ?? lastUsed` |
| BUG-027-06 | TC-016 | 把用户 `~/.zcode` 当子进程数据目录；目录只读时回合静默卡住（send accepted、状态 running，但无 model 请求） | 严重 | 已修复 | 改为 DSH home 下的插件自有可写目录 `zcode-bridge`，每次启动对账三份文件 |
| BUG-027-07 | TC-016 | `basedOnZCodeBuiltinRevision` 不精确，账号注入被 registry 合并守卫静默丢弃 | 严重 | 已修复 | 直接对实际加载的 `zcode-builtin.json` 取 `revision` 与绝对路径 sha256 |
| BUG-027-08 | TC-016 | 零延迟提交的回合被丢弃（send accepted、事件流为空） | 严重 | 已修复 | `create` → `subscribe` → `setModel` → `send` 之间垫 2s / 1.5s / 1.5s |
| BUG-027-09 | TC-021 | 会话标题把英文指令当标题（实测标题变成 `Generate the session tit`） | 一般 | 已修复 | 从标题请求的 JSON 数组取第一条人话；取不到时保留默认标题，不产出文本块 |
| BUG-027-10 | TC-017 | 图片路径缺扩展名，模型 `Read` 先失败再自行复制副本 | 一般 | 已修复 | 在工作区准备带正确扩展名（`.png` / `.jpg` / `.webp` / `.gif`）的副本，回合结束删除 |
| BUG-027-11 | TC-017 | `AttachmentStore.imageHostPath` 被解构后调用，抛 `Cannot read properties of undefined (reading 'root')` | 严重 | 已修复 | 改为带 `this` 调用 |
| BUG-027-12 | TC-016、TC-022 | DSH Desktop（Electron 宿主）里回合直接失败，报 `zcode: app-server 没能启动`：宿主 `process.execPath` 是 Electron 二进制（DSH Desktop 用 `ELECTRON_RUN_AS_NODE=1` 当 node 用），而插件拉起子进程时把该变量删掉了，子进程被当成 GUI 应用启动并立即退出 | 严重 | 已修复 | Electron 宿主下显式给子进程带 `ELECTRON_RUN_AS_NODE=1`（与 DSH Desktop 自带的 node 壳同一做法）；启动失败时把子进程 stderr 尾部与退出码带进错误，不再只报「没能启动」。用 Electron 二进制当 node 跑桥接通道实测完成回合（`response`「通道可用」，11.3 秒） |

## 测试结论

- **结论**：执行中（用例级）。2026-10-24 完成真实账号的控制面接口实测、托管 app-server 通道级实测与 DSH Web 三轮端到端对话：纯文本 18 秒回复「通道可用」；图文 + 思考等级 High 15 秒完成并正确读出图中文字，吞吐 256 tok/s、缓存命中 28%；用量胶囊由剩余 100% 变为剩余 93%（6 小时后重置）。插件单测全量 18 文件 / 212 用例通过，`tsc --noEmit` 干净。
- 用例总数 36 条：通过 12 条（TC-007、TC-012、TC-013、TC-014、TC-016、TC-017、TC-021、TC-023、TC-024、TC-025、TC-028、TC-036）；部分通过 6 条（TC-001、TC-002、TC-022、TC-031、TC-032、TC-033）；未执行 18 条；失败 0 条；阻塞 0 条。DSH Desktop 与真实 fnOS NAS 全部未执行。
- 一句话结论：登录、目录、能力、额度、用量胶囊与托管通道的实际对话已在 DSH Web 走通；直连 HTTP 的 `3012` 限制仍真实存在，但通过托管官方 agent 运行时已不再阻断对话。剩余工作是 DSH Desktop 走查、失败分支走查与发布相关登记。

### 遗留风险

1. **执行通道依赖 ZCode 客户端发行包**：未安装客户端、发行包布局变化或升级都会影响通道；`DSH_ZCODE_CLI` 与两种 provider 配置布局提供兜底，但客户端大版本升级后仍需实账号冒烟。
2. **三个静默失败前提不会自证**：数据目录只读、revision 不匹配与提交过快都表现为「没有反应」而不是报错；已由实现与单测固定，但真实环境出现新变体时排查成本高，需要日志与诊断继续增强。
3. **工具归属可能被误解**：该通道的工具由 ZCode agent 原生执行，DSH 工具与批准流程不参与；说明页与首轮提示已写明，仍可能被用户当成缺陷。
4. **单在途回合限制**：同一会话并发发送会等待或撞锁；插件已做串行化与自愈，极端情况下仍需用户稍后重试。
5. **DSH Desktop 未走查**：Desktop 的宿主进程模型与 Web 不同，子进程与 profile 行为需要单独验证，不能从 Web 结果外推。
6. **外部账号与网络依赖**：登录、目录与通道依赖真实 ZCode 账号与可直连 `zcode.z.ai` 的网络；两个家族需要各自可用的账号。
7. **设备标识稳定性只在进程内保证**：进程重启后若未注入已保存值，同一账号可能被上游当成新设备并要求重新授权；该行为需在 TC-022 与 TC-035 中继续观察。
8. **上游接口与协议可能漂移**：额度、配置与 `app-server` 协议字段变化会影响解析与通道；当前按夹具与最小可用语义兜底，出现新字段时需补用例。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-24 | 建立 FNOS-027 测试用例文档 | 按八个功能分节登记 34 条用例，覆盖正向、逆向、边界、权限与数据一致性五类。登记「已知限制（上游）」六条（含风控拦截 `3012`、未授权 `3006` 的反证意义、额度接口强制设备标识），执行结果回填 2026-10-24 真实账号的控制面接口实测与风控穷举探测，TC-015、TC-018、TC-019、TC-031 记为接口级部分通过，TC-016 因上游限制记为阻塞；Bug 记录为空并说明理由。 |
| 2026-10-25 | 登记 DSH Desktop 启动失败并修复 | 在 DSH Desktop（Electron 宿主）中引入插件后，回合报 `zcode: app-server 没能启动`。定位：DSH Desktop 的宿主进程即 Electron 二进制，靠 `ELECTRON_RUN_AS_NODE=1` 当 node 用，插件拉起子进程时删掉了该变量，子进程按 GUI 应用启动并立即退出。修复为 Electron 宿主下显式携带该变量，并把子进程 stderr 与退出码并入启动错误。以 Electron 二进制当 node 运行桥接通道实测完成回合（11.3 秒、`response`「通道可用」）；单测 19 文件 / 220 用例通过。登记 BUG-027-12。 |
| 2026-10-24 | 回填托管执行通道与 DSH Web 端到端结果 | 用例按顺序重排为 36 条：FNOS-027-04 扩为 7 条（托管通道、图文与思考等级、客户端缺失诊断、失败收尾、回合串行、标题、Ultra 与业务码），其余功能用例顺延重编号。回填决定性证据：`zcode.cjs app-server` 的 `turn.completed` 返回真实回复与 usage，三个静默失败前提逐项实测；DSH Web 三轮对话（纯文本 18 秒；图文 + High 15 秒、256 tok/s、缓存命中 28%；胶囊 100% → 93%）；单测 18 文件 / 212 用例通过、`tsc --noEmit` 干净。新增 BUG-027-06 至 BUG-027-11（数据目录只读、revision、垫时、标题误取指令、图片扩展名、`imageHostPath` 的 `this`）。原「端到端受上游风控阻塞」的结论作废，`3012` 仅保留为兜底诊断。DSH Desktop 与真实 fnOS NAS 标记为待执行。 |
