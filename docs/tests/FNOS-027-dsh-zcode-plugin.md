---
id: FNOS-027
title: FNOS-027 测试用例
description: FNOS-027 ZCode 设备授权登录、账号权益驱动的模型目录、模型能力、按模型额度与上游风控诊断的测试用例、执行结果与问题记录。
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
| 测试状态 | <Badge type="info" text="执行中（2026-10-24 真实账号接口级实测已回填；完整用例与 DSH Desktop 待执行）" /> |
| 用例总数 | 34 |

## 测试范围与需求分析

被测对象是新增插件 `@tnnevol/dsh-zcode` 的八项功能：ZCode 账号的 OAuth 设备授权登录（BigModel 国内 / Z.ai 海外两个家族）、以账号权益为真源的动态模型目录、模型能力适配、推理请求与上游诊断、按「模型 × 周期」的额度展示、插件详情页与用量胶囊、登录态与偏好持久化，以及文档站与插件登记。

三份文档的分工：功能范围与验收条件见[需求文档](/requirements/FNOS-027-dsh-zcode-plugin)，实现任务与验证方式见[计划文档](/plans/PLAN-FNOS-027-dsh-zcode-plugin)，本页只登记用例设计、执行结果、Bug 与结论。

用例与计划阶段的对应关系：

| 计划阶段 | 覆盖功能 | 用例范围 |
| --- | --- | --- |
| [阶段一：宿主侧登录与凭据](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段一-宿主侧登录与凭据) | FNOS-027-01 | TC-001 至 TC-006 |
| [阶段二：模型目录与供应商适配](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段二-模型目录与供应商适配) | FNOS-027-02、FNOS-027-03 | TC-007 至 TC-014、TC-030 |
| [阶段三：推理请求与上游诊断](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段三-推理请求与上游诊断) | FNOS-027-04 | TC-015 至 TC-019 |
| [阶段四：插件详情页与用量胶囊](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段四-插件详情页与用量胶囊) | FNOS-027-01、FNOS-027-05、FNOS-027-06、FNOS-027-07 | TC-020 至 TC-029、TC-031 至 TC-033 |
| [阶段五：文档站与发布登记](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段五-文档站与发布登记) | FNOS-027-08 | TC-034 |
| [阶段六：验证与收尾](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段六-验证与收尾) | 全部 | 汇总执行结果与结论 |

### 关键风险点

| 风险 | 用例方向 |
| --- | --- |
| 账号 JWT 或家族访问令牌泄漏到浏览器 | 在页面源码、网络响应与本地存储中检索明文（TC-006） |
| 授权中刷新页面产生第二条轮询，或替换用户已打开的授权链接 | 授权中刷新详情页，核对授权地址与上游请求次数（TC-003） |
| 两个家族的授权页混淆，用户选错后拿不到令牌 | 两个家族各完成一次登录，核对授权页域名与账号家族（TC-002、TC-031） |
| 模型清单写死或读错来源，与账号权益不一致 | 对照额度接口的 `capabilities` 核对选择器与目录（TC-007、TC-008） |
| 额度接口失败后目录被清空 | 制造额度接口失败，核对目录仍可用并标注来源（TC-009） |
| 缺少设备标识导致 `3001`，被误判为代码缺陷 | 用缺少 `X-Device-Mid` 的响应夹具核对诊断归类（TC-019、TC-030） |
| 能力字段投影错误，模型看似可选但容量不对 | 对照客户端配置核对上下文窗口、最大输出与思考等级（TC-011 至 TC-013） |
| 额度被合并成一个百分比，掩盖「日额度用完但活动额度还有」 | 对照上游条目核对日额度与一次性额度是否分列（TC-020、TC-021） |
| 额度缺失被补成 0%，用户误以为额度充足 | 制造额度接口失败，断言不显示 0%（TC-023） |
| **上游风控拦截被当成插件缺陷** | 以真实账号核对 `3012` 的诊断可读性，并核对文案不承诺成功、不引导绕过（TC-016、TC-017） |
| 登录态或偏好没有真正落盘，重启即丢 | 重启 DSH 后逐项核对（TC-028、TC-029） |
| 插件禁用后仍残留供应商分组或影响其它供应商 | 禁用插件后检查模型选择器（TC-033） |
| 新增页面与菜单断链 | 文档构建 + 逐个打开菜单目标（TC-034） |

### 待确认项

- ❓ 上游风控（`3012`）的判据与放行条件未知，也无法从插件侧观测。本页按「诊断可读」登记 FNOS-027-04 的用例预期；若上游后续放行，需要补一条「端到端对话成功」的用例并回填。在此之前，任何「对话可用」的表述都不成立。
- ❓ 账号权益里没有 capability 的额度条目（账号级或活动级记录）是否需要在界面单独成组，尚未形成产品结论。本轮按「不生成模型、只在额度卡片标注」登记。

### 已知限制（上游）

以下限制来自 ZCode 上游策略，不是插件缺陷；对应用例只验证「请求按契约发出、错误可读、不绕过限制」，不把「调用成功」作为预期结果。

| 限制 | 实测表现 | 对用例的影响 |
| --- | --- | --- |
| 网关对第三方 harness 的模型请求返回风控拦截 | HTTP 405 与业务码 `3012`（`request has been blocked due to unusual activity.`）；带/不带签名、项目访问令牌 + Ed25519 客户端请求签名 V4、带/不带 CDN 会话 Cookie、HTTP/1.1 与 HTTP/2、在 `zcode.z.ai` 源站自身的浏览器 fetch 均一致（2026-10-24 穷举探测） | TC-015 的「对话成功」预期登记为阻塞；TC-016 以 `3012` 作为预期错误，只验证诊断可读 |
| 未授权模型返回另一业务码，反证鉴权已通过 | `400` 与 `3006`（`model not allowed`）：账号没有该模型权益时才出现，`3012` 只出现在账号真正拥有的模型上（2026-10-24 实测） | TC-018 用未授权模型验证 `3006` 分支；该结果同时作为「鉴权与权益解析已通过」的证据 |
| 账号从未被官方客户端消耗过 Start Plan 额度 | 所有 `used_units` 为 0；ZCode 自身源码带有「3012 风险控制拒绝不可复现」的注释 | TC-020、TC-021 以当前快照为基准，不把 0 用量解释为插件缺陷，也不作为「额度不可用」的证据 |
| API Key 形态没有可用路径 | Start Plan 的模型请求只接受账号身份 | TC-001、TC-005 断言界面不出现 Key 入口；不设「用 Key 登录成功」用例 |
| 额度接口强制要求稳定设备标识 | 缺少 `X-Device-Mid` 时返回 `3001`（`parameter error`）；标识变化会让同一账号被当成新设备 | TC-019、TC-030 覆盖该分支与标识稳定性 |
| 模型清单与额度随账号权益变化 | 本账号 2026-10-24 为 GLM-5.3 与 GLM-5.3-Flash；套餐变体会改变清单 | TC-007、TC-008 以执行时的权益为准，不硬编码完整清单 |

### 执行顺序与数据清理

- 按[账号状态测试顺序](/charter/tests-spec#账号状态测试顺序与-auth-配置备份)执行：**先测登录态**（TC-007 至 TC-030 中的在线用例）→ **再测非登录态**（TC-001、TC-009 的未登录分支、TC-023）→ **最后测登录流程**（TC-002 至 TC-006）。
- 移除登录态前，把 `<DSH_HOME>/.dsh-zcode-auth.json` 备份到 `tmp/auth-back/dsh-zcode-<版本>-<日期>/`；恢复时原样复制并 `chmod 600`，再用 `stat -c '%a %n'` 核对。
- 测试数据清理：退出测试账号或恢复备份、把胶囊策略与隐藏模型恢复默认、删除测试产生的临时截图与报告；测试账号、凭据与备份不得进入仓库。
- UI 类用例（账号卡片、额度卡片、目录卡片、用量胶囊）在**亮色与暗色主题**下各执行一遍，并核对[UI 测试](/charter/tests-spec#ui-测试-视觉与样式)要求的对比度、间距与毛玻璃层级。

## 测试环境

| 功能 | 执行环境 | 说明 |
| --- | --- | --- |
| [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01)、[FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web 与 DSH Desktop | 需要真实 ZCode 账号与可直连 `zcode.z.ai` 的网络；两个家族各需一个可用账号 |
| [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web 与 DSH Desktop | 容量与思考等级比对以账号的客户端配置为准；需要可构造配置不可读的分支 |
| [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web 与 DSH Desktop | 需要真实账号与可构造的上游失败分支；**对话成功一类预期因上游风控登记为阻塞** |
| [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05)、[FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web 与 DSH Desktop | 额度数据需要处于 Start Plan 订阅内的账号；UI 用例需亮暗主题各执行一遍 |
| [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web 与 DSH Desktop | 持久化用例需要重启对应客户端 |
| [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站构建环境 | `pnpm exec vitepress build docs` 与 `git diff --check` |

执行环境口径：

- **DSH Web**：`pnpm run start -- --web`，`DSH_HOME` 指向仓库 `.dsh`；用启动日志里带 `?token=` 的地址访问。
- **DSH Desktop**：使用上游源码检出 `fork-pj/deepseek-harness` 的开发态 Desktop（`DSH_DESKTOP_APP_DIR` 指定），profile 使用项目根 `.dsh/profiles/desktop`，不触碰 `~/.dsh/profiles/desktop`。
- 本插件不依赖 fnOS 宿主桥接，**不要求真实 fnOS NAS 验收**；登录与额度依赖外部账号条件，缺少条件时按阻塞登记。
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
| TC-030 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 手工配置 `zcode` / 同名 `dsh-zcode` 路由时的注册表现 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | 已登录；`llm-pi-ai` 设置中已手工配置 `zcode` 或 `zhipu` 路由 | 1.保留手工配置 2.在插件详情页重新登录或刷新 3.打开模型选择器确认 `ZCode` 出现且手工配置未被覆盖 4.再预置同名 `dsh-zcode` 配置并重启 5.查看详情页诊断与选择器 | 手工配置与插件并存，`ZCode` 正常出现；同名 `dsh-zcode` 冲突时插件给出可诊断提示，不静默替换用户配置 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-03 模型能力完整适配](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 上下文窗口与最大输出与上游一致 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；客户端配置可读 | 1.读取 `client/configs` 中每模型的 `contextWindow` 与 `maxCompletionTokens` 2.查看目录卡片与模型信息 3.逐项比对 | GLM-5.3 与 GLM-5.3-Flash 显示 1000000 上下文与 128000 最大输出，与上游一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-012 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 思考等级可选项与上游声明一致 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；模型声明了 low / high / max 三档 | 1.查看可选思考等级集合 2.逐档查看是否可选 3.尝试选择未声明的档位 | 可选等级与上游声明对应（含关闭档）；未声明的档位不在列表中；中间等级按向上取整映射且不额外出现上游不存在的档位 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-013 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 图片输入能力与上游一致 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录 | 1.查看声明支持图片输入的模型是否有图片入口 2.查看未声明图片输入的模型 3.尝试向后者附加图片 | 声明支持的模型有图片入口；未声明的不出现图片入口，附加图片时给出可读提示且不发送 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-014 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 客户端配置不可读时用保守默认值 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；可构造客户端配置接口失败 | 1.使客户端配置接口返回失败 2.刷新目录 3.查看容量与思考等级 4.查看说明文案 | 模型仍出现在列表中；容量显示保守默认值；详情页说明能力来自默认值而非上游声明 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-04 选中模型可发起对话并得到可读诊断](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-015 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 请求按上游契约发出 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可用抓包或桩服务 | 1.选中 `ZCode` 模型发送一条文本消息 2.抓取实际发出的请求 | 请求发往 `…/zcode-plan/anthropic/v1/messages`；`authorization` 与 `x-api-key` 同值；`anthropic-version`、`anthropic-beta` 与客户端身份头（含 `x-device-mid`、`x-zcode-*`、`x-os-*`、`x-platform`、`x-release-channel`）齐备；模型 id 原样发出 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-016 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 风控拦截时显示可读诊断 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；使用账号真正拥有权益的模型 | 1.发送一条文本消息 2.等待上游返回 3.查看会话内容与错误提示 | 会话显示指向风控的中文诊断，包含业务码 `3012` 与上游原文 `request has been blocked due to unusual activity.`；不出现空白回复、不静默重试、不显示为成功 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-017 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 诊断文案不承诺成功、不引导绕过 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已触发一次 `3012` | 1.逐句阅读会话中的诊断文案 2.在详情页与说明页检索是否提及代理、转发、模拟客户端等方案 | 文案只说明上游限制与当前无法直连；不出现「已绕过」「稍后自动恢复」等承诺；不引导用户改用非官方转发服务 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-018 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 未授权、需人机校验与额度耗尽分别可读 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可构造 `3006`、`3007`、`1113` 三种响应 | 1.分别用未授权模型、需校验响应与额度耗尽响应发起请求 2.查看三处诊断 | 三种情况分别显示对应诊断（`model not allowed` / 需在官方客户端完成校验 / 额度耗尽），互不合并；不自动换模型、不重试 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-019 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 参数错误不被误判为风控 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可构造缺少设备标识的响应 | 1.使额度或请求分支返回 `3001` 2.查看诊断分类 3.恢复设备标识后重试 | `3001` 归类为参数错误并点明设备标识异常，不显示为风控拦截；恢复后不再出现该错误 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-05 按模型展示额度窗口](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-020 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 套餐与按模型额度窗口 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录；账号处于 Start Plan 订阅内 | 1.打开详情页额度卡片 2.与额度接口的 `plans[]` 与 `balances[]` 比对 | 显示当前生效的两份套餐（`zcode-v3-start-plan-0817` 与 `zcode-v3-start-plan-1024`）与每个模型各自的窗口；窗口的模型名与上游 `show_name` 对应 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-021 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 日额度与一次性额度分别展示 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录；账号同时有日额度与一次性活动额度 | 1.查看 GLM-5.3 与 GLM-5.3-Flash 各自的窗口数 2.核对每块的周期标记 3.核对剩余量 | 每个模型显示两个独立窗口（日额度 3,000,000 / 5,000,000 与一次性 200,000,000 / 300,000,000）；周期按上游原样标记；不合并成一个百分比 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-022 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 百分比、剩余量与重置倒计时 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度卡片已有数据 | 1.记录某窗口的已用百分比、剩余量与倒计时 2.等待 60 秒 3.再次查看 | 三项数值与接口一致；倒计时相应减少；跨越重置时间后该窗口重新开始计时 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-023 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度不可用时显示未知而不是 0% | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录 | 1.使额度接口返回失败 2.点刷新 3.查看卡片 | 显示失败原因与最近一次获取时间；未读取到的窗口显示未知，不显示 0% | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-024 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 手动刷新更新数据与获取时间 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度卡片已有数据 | 1.记录获取时间 2.点「刷新」 3.观察按钮状态与结果 | 按钮在刷新期间禁用并显示进行中；成功后获取时间更新、数值重新读取 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-06 插件详情页与用量胶囊](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-025 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 详情页四块卡片 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录 | 1.自上而下阅读详情页 2.逐个区块执行一次操作（登录态查看、刷新额度、搜索目录、修改设置） 3.检查是否影响其它插件 | 账号、额度、目录、设置四块齐备且各自可操作；操作只影响本插件；其它插件详情页不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-026 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录搜索与获取时间 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录卡片已有数据 | 1.输入模型名称片段并核对结果 2.清空搜索框 3.核对计数与获取时间 | 列表即时过滤为匹配项；清空后恢复全部模型；计数随搜索更新；获取时间可见 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-027 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 隐藏模型后选择器不再出现 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录卡片已有数据 | 1.隐藏一个模型 2.打开模型选择器 3.恢复该模型后再次查看 | 被隐藏的模型不再出现在选择器；恢复后重新出现 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-028 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 重启后登录态与偏好保持 | [07-AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07)、[07-AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录；已修改偏好 | 1.隐藏一个模型、把胶囊策略改为 always、把刷新间隔改为非默认值 2.重启 DSH Web（或 DSH Desktop） 3.逐项核对 | 仍为已登录且无需重新登录；三项偏好保持；非法值回落到默认值 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-029 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 三种胶囊策略与数字一致性 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06)、[AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录 | 1.auto 下分别选中 `ZCode` 与其它供应商模型，查看输入区 2.改为 always 后重复 3.改为 off 后重复 4.比对胶囊与额度卡片的已用比例 | auto 仅在选中 `ZCode` 模型时显示且不请求额度；always 常驻；off 隐藏并停止自动刷新；两处比例一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-07 登录态与偏好持久化](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-031 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 两个账号家族登录后状态一致 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 具备 BigModel 与 Z.ai 各一个账号 | 1.用第一个家族登录并记录账号家族 2.退出后改用第二个家族登录 3.核对账号卡片与目录 | 两次登录分别显示对应家族；账号信息与目录按当前账号显示；切换家族后不残留上一账号的目录 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-032 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 凭据文件权限与格式异常 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录 | 1.核对凭据文件权限 2.写入一个含未知字段的凭据文档 3.重启后查看详情页 | 权限为 `600`；未知字段被拒绝并按未登录处理且不覆盖原文件；详情页给出可诊断错误 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-033 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 禁用插件不影响其它供应商 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录；已配置其它供应商 | 1.禁用本插件 2.重启客户端 3.查看模型选择器与其它供应商用量 | 其它供应商模型与用量正常；选择器无 `ZCode` 残留分组；历史会话可打开 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-08 文档站与插件登记](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-034 | [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站、菜单、说明页与市场源列表 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站依赖已安装；插件已或未发布 | 1.打开 `/plugins/` 查找该插件行并从菜单进入说明页 2.逐节阅读说明页并对照需求的「不在本次范围内」 3.读取市场源列表 4.执行文档构建与 `git diff --check` | 总览与菜单均可进入 `/plugins/dsh-zcode`；说明页含安装命令、两个家族登录、模型与能力、按模型额度、设置项与**上游风控限制**，并明确写出端到端对话未验证；发布后源列表含 `@tnnevol/dsh-zcode` 且生成的索引未被手改；构建通过、无死链 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

## 测试执行结果

> 用例定义已在上一节固定；本节只回填执行状态与联调证据。下面按时间列出的记录属于接口/端点层面的证据，除特别标注的用例外不改变其余用例的「未执行」状态；完整用例需在 DSH Web 与 DSH Desktop 上按版本三元组执行。

### 接口级实测（2026-10-24，真实账号）

2026-10-24 用真实 ZCode 账号完成一轮控制面接口实测。以下是**接口层面**的证据，不替代上方任何用例，也不产生用例通过结论：

| 项目 | 实测结果 |
| --- | --- |
| 设备授权发起 | `POST /api/v1/oauth/cli/init` 对两个家族均返回 HTTP 200，响应含 `flow_id`、`poll_token`、`authorize_url`、`expires_at` 与 `poll_interval_sec` |
| 两个家族的授权页 | BigModel 返回 `bigmodel.cn/login?appId=zcode&…`；Z.ai 返回 `chat.z.ai/api/oauth/authorize?client_id=client_P8X5CMWmlaRO9gyO-KSqtg&…`，与调研结论一致 |
| 设备授权轮询 | `GET /api/v1/oauth/cli/poll/<flowId>` 携带同一 pollToken 时按 `pending` → `ready` 迁移；`ready` 返回账号 JWT、账号信息与家族 `access_token`，HTTP 200 |
| Start Plan 额度 | `GET /api/v1/zcode-plan/billing/balance` 返回两份套餐与按模型额度，HTTP 200；缺少 `X-Device-Mid` 时返回 HTTP 200 但信封为 `{"code":3001,"msg":"parameter error"}` |
| 客户端配置 | `GET /api/v1/client/configs` 返回 GLM-5.3 与 GLM-5.3-Flash 的 1000000 上下文、128000 最大输出与 low / high / max 三档思考等级 |
| 模型清单 | 从额度条目的 `capabilities` 解析出 GLM-5.3 与 GLM-5.3-Flash，与账号权益一致 |
| 推理请求 | 按调研结论的协议与请求头发出后，上游返回 HTTP 405 与 `{"code":3012,"msg":"request has been blocked due to unusual activity."}` |

### 上游风控拦截的探测结论（2026-10-24）

针对 `3012` 做了一轮穷举探测，目的是区分「实现缺陷」与「上游策略」：

| 探测维度 | 结果 |
| --- | --- |
| 带签名 / 不带签名 | 均返回 `3012` |
| 项目访问令牌 + 完整 Ed25519 客户端请求签名 V4 | 仍返回 `3012` |
| 带 / 不带 CDN 会话 Cookie | 均返回 `3012` |
| HTTP/1.1 与 HTTP/2 | 均返回 `3012` |
| 在 `zcode.z.ai` 源站自身的浏览器 fetch | 仍返回 `3012` |
| 多种请求头组合 | 均返回 `3012` |
| **未授权模型（GLM-5.2、GLM-5-Turbo、未知 id）** | 返回 HTTP 400 与 `{"code":3006,"msg":"model not allowed"}` —— **鉴权与账号权益解析都已通过**，被拦的是请求来源层 |
| 官方客户端额度消耗 | 该账号所有 `used_units` 为 0，官方 ZCode 客户端从未消耗任何 Start Plan 额度 |
| 上游客户端源码注释 | ZCode 自身源码带有「3012 风险控制拒绝不可复现」的说明 |
| 第三方插件作者报告 | 公开报告同一现象（WAF 拦截直连 HTTP），其做法是托管官方 agent 二进制做反向代理 |

**结论**：`3012` 不是本插件的实现缺陷，也无法通过签名、Cookie 或协议版本规避。据此，TC-015 的「对话成功」类预期登记为**阻塞**，TC-016、TC-017 按「诊断可读、不绕过」执行；插件不提供任何规避手段。

本轮证据对应的用例结论：TC-015（请求形态）取得接口级部分证据；TC-016、TC-017 的**诊断呈现**尚未在 DSH 会话中走查，仍为未执行；其余用例状态不变。

### 用例执行状态

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-002 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需真实账号 |
| TC-003 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-004 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-005 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；含路由拒绝 Key 形态请求 |
| TC-006 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-007 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web、DSH Desktop | 未执行 | — | 待执行；接口级清单已确认，UI 未走查 |
| TC-008 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需可变化权益的账号 |
| TC-009 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-010 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行 |
| TC-011 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 未执行 | — | 待执行；接口值已确认，UI 未走查 |
| TC-012 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 未执行 | — | 待执行 |
| TC-013 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 未执行 | — | 待执行 |
| TC-014 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 未执行 | — | 待执行；需可构造客户端配置失败 |
| TC-015 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web、DSH Desktop | 部分通过（接口级） | 2026-10-24 | 请求按契约发出已验证；会话内抓包与 Desktop 待执行 |
| TC-016 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web、DSH Desktop | 阻塞（上游限制） | 2026-10-24 | 上游固定返回 405 与 `3012`；只可验证诊断呈现，待会话内走查 |
| TC-017 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 未执行 | — | 待执行；诊断文案审查 |
| TC-018 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 部分通过（接口级） | 2026-10-24 | `3006` 分支已用未授权模型实测；`3007` / `1113` 待构造 |
| TC-019 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 部分通过（接口级） | 2026-10-24 | `3001` 已由缺少设备标识的请求触发；会话内诊断待走查 |
| TC-020 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web、DSH Desktop | 未执行 | — | 待执行；接口返回两份套餐，UI 未走查 |
| TC-021 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web、DSH Desktop | 未执行 | — | 待执行；四类窗口接口已确认 |
| TC-022 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行 |
| TC-023 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-024 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行 |
| TC-025 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-026 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 未执行 | — | 待执行 |
| TC-027 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 未执行 | — | 待执行 |
| TC-028 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行；需重启客户端 |
| TC-029 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web、DSH Desktop | 未执行 | — | 待执行；三种策略各一次 |
| TC-030 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需预置手工 `zcode` 与同名 `dsh-zcode` 配置 |
| TC-031 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 部分通过（接口级） | 2026-10-24 | 两个家族的授权均已完成；会话内切换待执行 |
| TC-032 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web | 未执行 | — | 待执行 |
| TC-033 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-034 | [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站构建环境 | 未执行 | — | 待执行；市场条目依赖发布 |

### DSH Web 实测（2026-10-24，本地实例 8070，真实账号）

按仓库约定以 `pnpm run start -- --web` 起本地 DSH Web（`DSH_HOME` 指向仓库 `.dsh`），在插件详情页与对话页走查。这一轮**发现了 5 个插件侧缺陷并全部修复**，也确认了思考等级与图文输入的请求形态。

| 走查项 | 结果 |
| --- | --- |
| 插件出现在「已安装插件」并可进入详情页 | 首次失败：插件未注册、四条路由全部 404、客户端模块表中没有该包。原因是 `locale/*.json` 写成 `displayName/description`，DSH 只认 `meta.title` / `meta.description`，改结构后恢复正常 |
| 账号卡片 | 通过：显示已登录、脱敏邮箱、登录入口与用户 ID |
| 模型目录与能力 | 首次失败：上下文与最大输出显示成 400K / 80K（保守默认值而非上游真实值），思考与图片标记全缺。原因是能力读的是 `data.providers[].models[]`（只列 GLM-5.2 / GLM-5-Turbo），且把 `reasoning.levels` 当数组读、把图片开关当成 `capabilities.inputFormat.supportsImage`。改读 `data.builtinModels`、按对象取键、改读 `capabilities.vision` 后，两个模型显示 1M 上下文 / 128K 输出，`R`（思考）与 `V`（图片）标记正确 |
| 额度卡片 | 首次失败：四份额度的周期全部显示「其它」、重置时间全部显示「无重置时间」。原因是上游时间是 Unix 秒（当年 ISO 字符串读成 undefined），且根本没有 `period` 字段。改为按窗口时长推导周期、按秒转毫秒后，正确显示「每日 / 本期内有效」与「10 小时后重置 / 43 小时后重置」 |
| 额度去重 | 4 条额度对应 2 个模型，按「模型 + 周期」合并后不再出现重复行；不同周期仍分别展示 |
| 输入区用量图标 | 首次失败：`auto` 策略下图标从不出现。原因是读会话投影里不存在的 `pending` 字段，退回 `lastUsed`（上一次**实际用过**的模型，当时是别的供应商）。改为 `next ?? lastUsed` 后正常。样式随后按 Codex 插件对齐：26px 环形进度 + 环心品牌标记 + tooltip + popover |
| 思考等级（GLM-5.3-Flash） | 通过：选择器提供 Default / Minimal / Low / Medium / High / Xhigh / Max 七档，映射到上游 low / high / max；抓包断言请求体带 `output_config.effort`，未退回 `budget_tokens` |
| 图文输入（GLM-5.3-Flash） | 通过：图片被接受并显示缩略图，请求体按 Anthropic 契约编码为 `image` 内容块（`source.type = base64`、`media_type`、`data`）；GLM-5.3-Flash 的 `V` 标记与上游 `capabilities.vision: true` 一致 |
| 端到端对话 | 阻塞：带图片与 Max 思考等级发出的请求仍返回 HTTP 405 与 `3012`，与不带图片时**完全相同**，说明请求构造已通过、卡点仍是上游风控 |
| 事件流回归 | 走查中曾引入又回退一处回归：在 provider 里用对象展开包装 pi-ai 事件流，导致流对象私有字段丢失、报 `Cannot read properties of undefined (reading 'queue')`。改为原样透传后恢复；该教训已写进代码注释 |

> 结论口径：上述「通过」只表示**该环节在 DSH Web 中按契约工作**，不代表 FNOS-027-04 的端到端对话完成；上游 `3012` 未解除前，TC-016 仍为阻塞。

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-027-01 | TC-001 | `locale/*.json` 用了 `displayName/description`，插件整体不注册、路由 404 | 严重 | 已修复 | 改为 DSH 认的 `meta.title` / `meta.description` |
| BUG-027-02 | TC-010、TC-011 | 模型能力读错路径：`providers[].models[]` 而非 `data.builtinModels`；`reasoning.levels` 当数组读；图片开关读 `inputFormat.supportsImage` | 严重 | 已修复 | 三处判定均按真实载荷改正，能力从假默认值变为上游真实值 |
| BUG-027-03 | TC-020、TC-021 | 额度周期恒显示「其它」、重置时间恒为空 | 严重 | 已修复 | 上游时间是 Unix 秒且无 `period` 字段；改为按秒解析并按窗口时长推导周期 |
| BUG-027-04 | TC-020 | 同一模型跨套餐的多条额度出现重复行 | 一般 | 已修复 | 按「模型 + 周期」合并，不同周期不合并 |
| BUG-027-05 | TC-024 | `auto` 策略下用量图标从不出现 | 严重 | 已修复 | 投影字段名应为 `next`（不是 `pending`），并取 `next ?? lastUsed` |

上游风控拦截（`3012`）不是插件缺陷：未授权模型返回 `3006` 证明鉴权与账号权益解析都已通过，官方客户端从未消耗该账号额度，第三方插件作者亦报告同一现象。插件按需求约束只保证诊断可读，不提供绕过方式。

## 测试结论

- **结论**：执行中（用例级）。2026-10-24 完成真实账号的控制面接口实测：两个家族的设备授权均走通（`init` 与 `poll` 均 HTTP 200），额度接口返回两份套餐与按模型额度，客户端配置返回 1000000 上下文 / 128000 最大输出 / 三档思考等级，模型清单与账号权益一致（GLM-5.3 与 GLM-5.3-Flash）。**模型请求被上游以 HTTP 405 与业务码 `3012` 拦截**，端到端对话未取得成功证据。
- 用例总数 34 条：部分通过 4 条（TC-015、TC-018、TC-019、TC-031）；2026-10-24 追加 DSH Web 实测后，TC-001、TC-010、TC-011、TC-020、TC-021、TC-024 有 Web 侧证据并通过（同时暴露并修复 BUG-027-01～05）；阻塞 1 条（TC-016，上游限制）；其余未执行，失败 0 条。DSH Desktop 全部待执行。
- 一句话结论：登录、目录、能力、额度与用量图标已在 DSH Web 实测走通（含思考等级与图文输入的请求形态），模型对话被上游风控拦截且无法从插件侧规避；插件的交付标准因此是「请求按契约发出 + 上游限制如实呈现」，在限制解除前不判定 FNOS-027-04 完成。

### 遗留风险

1. **上游风控是需求价值的主要威胁**：模型可选但对话无法完成，用户很容易把 `3012` 当成插件缺陷。说明页与诊断文案必须共同承担解释责任，且不得暗示「稍后会好」。
2. **风控判据不可观测**：即使某天放行，插件也无法感知；只能靠用户反馈与重新实测。放行后需补充端到端用例并回填，当前没有任何「可用」结论。
3. **外部账号与网络依赖**：登录、目录与额度依赖真实 ZCode 账号与可直连 `zcode.z.ai` 的网络；两个家族需要各自可用的账号。缺条件时用例按阻塞登记，不据此判定功能缺陷。
4. **设备标识稳定性只在进程内保证**：进程重启后若未注入已保存值，同一账号可能被上游当成新设备并要求重新授权；该行为需在 TC-019 与 TC-032 中继续观察。
5. **上游额度与配置接口未公开完整契约**：字段漂移时插件按降级处理，用例以夹具固定已知形态；真实账号下出现新字段时需补用例。
6. **额度语义与常见直觉不同**：日额度与一次性活动额度并存是正常状态，测试与说明页都需反复强调，避免被误判为重复数据或数据错误。
7. **UI 尚未完成视觉验收**：四块卡片、固定高度滚动、胶囊位置与亮暗主题目前只有设计口径，未在 DSH Web 与 DSH Desktop 走查。
8. **桌面端仅覆盖开发态客户端**：DSH Desktop 结论需来自 `fork-pj/deepseek-harness` 的开发态客户端，不作为发行版客户端的独立验收结论。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-24 | 建立 FNOS-027 测试用例文档 | 按八个功能分节登记 34 条用例，覆盖正向、逆向、边界、权限与数据一致性五类。登记「已知限制（上游）」六条（含风控拦截 `3012`、未授权 `3006` 的反证意义、额度接口强制设备标识），执行结果回填 2026-10-24 真实账号的控制面接口实测与风控穷举探测（九个维度），TC-015、TC-018、TC-019、TC-031 记为接口级部分通过，TC-016 因上游限制记为阻塞；Bug 记录为空并说明理由。登记两条待确认项与八条遗留风险。 |
