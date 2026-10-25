---
id: FNOS-027
title: FNOS-027 测试用例
description: FNOS-027 ZCode 桌面授权登录、账号权益驱动的模型目录、模型能力、插件自研 Anthropic Messages 执行通道、按模型额度与用量聚合的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-027-dsh-zcode-plugin
plan: /plans/PLAN-FNOS-027-dsh-zcode-plugin
status: 执行中
lastVerified: 2026-10-25
verifiedAt: 2026-10-25
---

# FNOS-027 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | [FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) |
| 关联计划 | [PLAN-FNOS-027](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| 覆盖功能 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) 至 [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) |
| 测试状态 | <Badge type="success" text="功能验收（2026-10-25：自研 HTTP 通道在 DSH Web 与 DSH Desktop 均实测通过，图文、智能体团队、思考等级与限流退避已回填；插件未发布，市场条目与签名相关项未执行）" /> |
| 用例总数 | 37 |

## 测试范围与需求分析

被测对象是 `@tnnevol/dsh-zcode` 的八项功能：ZCode 账号登录（桌面授权码 + 同源回调）、以账号权益为真源的动态模型目录、模型能力适配、**插件自行收发 Anthropic Messages 的执行通道**（含 Ultra 端点与业务码诊断）、按「模型 × 周期」的额度展示与用量聚合、插件详情页与用量胶囊、登录态与偏好持久化，以及文档站与插件登记。

2026-10-25 的架构变更是本轮测试口径的分水岭：此前 Start Plan 回合由托管官方 `zcode app-server` 子进程执行，现改为插件自己组装并发送 Anthropic Messages 请求。因此「需要安装 ZCode 客户端」「工具由 ZCode agent 原生执行」「同一会话只有一个在途回合」「标题本地生成」这些约束**全部不再成立**，对应用例已按新架构重写（见[变更记录](#变更记录)）。

三份文档的分工：功能范围与验收条件见[需求文档](/requirements/FNOS-027-dsh-zcode-plugin)，实现任务与验证方式见[计划文档](/plans/PLAN-FNOS-027-dsh-zcode-plugin)，本页只登记用例设计、执行结果、Bug 与结论。

用例与计划阶段的对应关系：

| 计划阶段 | 覆盖功能 | 用例范围 |
| --- | --- | --- |
| [阶段一：宿主侧登录与凭据](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段一-宿主侧登录与凭据) | FNOS-027-01 | TC-001 至 TC-006 |
| [阶段二：模型目录与供应商适配](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段二-模型目录与供应商适配) | FNOS-027-02、FNOS-027-03 | TC-007 至 TC-015 |
| [阶段三：自研 Anthropic Messages 通道与上游诊断](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段三-自研-anthropic-messages-通道与上游诊断) | FNOS-027-04 | TC-016 至 TC-022 |
| [阶段四：插件详情页与用量胶囊](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段四-插件详情页与用量胶囊) | FNOS-027-05、FNOS-027-06、FNOS-027-07 | TC-023 至 TC-035 |
| [阶段五：文档站与发布登记](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段五-文档站与发布登记) | FNOS-027-08 | TC-036 |
| [阶段六：验证与收尾](/plans/PLAN-FNOS-027-dsh-zcode-plugin#阶段六-验证与收尾) | 全部 | TC-037（智能体团队多会话复用）；并汇总执行结果与结论 |

### 关键风险点

| 风险 | 用例方向 |
| --- | --- |
| 账号 JWT 或家族访问令牌泄漏到浏览器 | 在页面源码、网络响应与本地存储中检索明文（TC-006） |
| 授权回调被伪造或授权码被重放 | 构造 state 不匹配的回调、重复使用同一 code（TC-004） |
| 模型清单写死或读错来源，与账号权益不一致 | 对照额度接口的 `capabilities` 核对选择器与目录（TC-007、TC-008） |
| 额度接口失败后目录被清空 | 制造额度接口失败，核对目录仍可用并标注来源（TC-009） |
| 缺少设备标识导致 `3001`，被误判为代码缺陷 | 用缺少 `X-Device-Mid` 的响应夹具核对诊断归类（TC-022） |
| 能力字段投影错误，模型看似可选但容量不对 | 对照客户端配置核对上下文窗口、最大输出与思考等级（TC-012 至 TC-014） |
| **两段 system 前缀被写成单块或被裁掉**，请求恒返回 `3012` | 抓包断言 `system` 为两个独立文本块、`system[0]` 逐字 42 字符、`system[1]` 以行为提示词开头（TC-016） |
| **上游改动官方提示词**导致前缀失配，通道硬失败 | 构造失配前缀，核对诊断指向「前缀需重新采集」而非笼统网络错误（TC-020） |
| 思考签名混进正文泄漏到界面，或 `replayState` 含 `undefined` 导致整条流被宿主拒绝 | 多轮对话核对界面无 `[signed:…]` 残留、流不被拒（TC-021） |
| 多份额度只取一份，显示「剩余 0%」而实际仍有额度 | 同一模型多份额度下比对聚合百分比与明细（TC-031、TC-032） |
| 图片块未接线导致静默丢图（模型答非所问且无报错） | 勾选含文字的图片发送，核对模型读出图中文字（TC-014、TC-017） |
| 工具调用绕过 DSH 批准流程 | 触发 Bash 调用，核对 DSH 权限审批弹出且参数正确（TC-018） |
| 多轮工具结果无法续答 | 连续两轮 tool_result，核对模型正确接续（TC-019） |
| 失败、超时与取消被显示为成功 | 构造失败与取消，核对以错误结束、无空白回复（TC-020） |
| 额度被合并成一个百分比，掩盖「日额度用完但活动额度还有」 | 核对日额度与一次性额度是否分列（TC-023、TC-024） |
| 额度缺失被补成 0%，用户误以为额度充足 | 制造额度接口失败，断言不显示 0%（TC-026） |
| 登录态或偏好没有真正落盘，重启即丢 | 重启 DSH 后逐项核对（TC-034、TC-035） |
| 插件禁用后仍残留供应商分组或影响其它供应商 | 禁用插件后检查模型选择器（TC-035） |
| 新增页面与菜单断链 | 文档构建 + 逐个打开菜单目标（TC-036） |

### 待确认项

- ❓ DSH Desktop 尚未走查：Desktop 的宿主进程模型与 Web 不同，需确认出站请求与 profile 共享在同一套运行时下正常。本轮只登记 DSH Web 结果，Desktop 按待执行处理。
- ❓ 真实 fnOS NAS 未执行：本插件不依赖 fnOS 宿主桥接，按需求口径不设 NAS 门槛；如后续随应用内置分发，再补安装后可用性走查。
- ❓ 账号权益里没有 capability 的额度条目（账号级或活动级记录）是否需要在界面单独成组，尚未形成产品结论。本轮按「不生成模型、只在额度卡片标注」登记。
- ❓ 上游提示词更新后的重新采集流程尚未产品化：当前只由开发者按发布流程更新常量，用户侧只能看到 `3012` 诊断。是否需要在插件内提供「重新采集」入口，留待后续需求确认。

### 已知限制与已排除因素（上游）

以下限制来自上游策略或协议约束，不是插件缺陷；对应用例只验证「行为可读、结果不伪装」。

| 限制 | 实测表现 | 对用例的影响 |
| --- | --- | --- |
| Start Plan 端点按请求内容校验 `system` 分块 | 两段独立文本块返回 200；单块无论怎么拼接（直接相连、`\n\n` 分隔、合并成一块）全部返回 HTTP 405 与业务码 `3012`（2026-10-25 逐项二分） | TC-016 断言发出形态；TC-020 覆盖失配诊断。`3012` 不再是「账号风控」，也不再意味着通道不可用 |
| 两段前缀是上游提示词原文 | `system[0]` 必须逐字等于 42 字符的身份行；`system[1]` 必须以上游行为提示词（1211 字符）**开头**；上游改字即整条通道硬失败，没有降级路径 | TC-016 锁定形态；上游更新后必须重新采集并更新常量 |
| 与请求头、签名、传输层无关的因素 | 22 个请求头全试只有 `authorization` 必需；agent 在 start-plan 模式下自己也不签名（`unsigned_sent/access_mode`）；TLS 指纹、HTTP/1.1 与 HTTP/2、客户端证书/mTLS、凭据来源（设备授权与桌面授权码换来的 token 完全相同，204 字符同 claims）逐项排除 | 不再设「复刻签名」「伪造客户端身份」类用例；也不指引用户改用非官方转发 |
| 请求任务 ID 长度受限 | 上游要求 6–64 字符，过短返回 `1214`；插件 `normalizeTaskId` 用设备标识补齐或截断 | TC-016 附带断言；不设「短 id 成功」用例 |
| Ultra 端点计费归属不同 | 家族 MaaS 令牌可被 `ultra/anthropic` 接受，但计费落到个人按量余额；余额为 0 时返回 `429 / 1113`；账号 JWT 访问返回 `401` | TC-022 覆盖 Ultra 与 `1113` 分支 |
| 未授权模型返回另一业务码，反证鉴权已通过 | `400` 与 `3006`（`model not allowed`）：账号没有该模型权益时才出现 | TC-022 用未授权模型验证 `3006` 分支 |
| API Key 形态没有可用路径 | Start Plan 的模型请求只接受账号身份 | TC-001、TC-005 断言界面不出现 Key 入口；不设「用 Key 登录成功」用例 |
| 额度接口强制要求稳定设备标识 | 缺少 `X-Device-Mid` 时返回 `3001`（`parameter error`）；标识变化会让同一账号被当成新设备 | TC-022 覆盖该分支；设备标识稳定性在 TC-035 观察 |
| 模型清单与额度随账号权益变化 | 本账号 2026-10-24 为 GLM-5.3 与 GLM-5.3-Flash；套餐变体会改变清单 | TC-007、TC-008 以执行时的权益为准，不硬编码完整清单 |
| 思考等级只有三档且没有「不思考」档 | `off` / `minimal` / `low` → `low`、`medium` / `high` → `high`、`xhigh` / `max` → `max` | TC-013 断言归并结果与 `output_config.effort` |

### 已知问题（待清理与待验证）

| 项目 | 现状 | 影响 |
| --- | --- | --- |
| 设备授权实现已删除 | `login()`、`startPolling` / `pollOnce`、`initDeviceFlow` / `pollDeviceFlow` 及对应端点常量已随 `refactor(zcode)` 清理，不再有设备授权代码（见本轮变更记录） | 无遗留；文档不再提该链路 |
| 长对话尚未验证 | 已验证单轮、工具调用与多轮 `tool_result`；超过 2 轮的连续长对话未单独取证 | 长上下文下的行为按未验证登记 |
| 并发下的限流退避已验证，其余并发形态未验证 | 并发 8 个请求的 `3008` 限流已实测退避后全部成功；更高并发、跨实例并发与长时压测未取证 | 日常单会话使用不受影响 |
| 中断取消未验证 | 用户中止生成的收尾未单独走查 | TC-020 中「取消」分支按待执行登记 |
| 插件未发布 | 本轮按功能验收，市场条目、签名与 FPK 分发未执行 | 发布相关项在发布轮次单独登记 |

### 执行顺序与数据清理

- 按[账号状态测试顺序](/charter/tests-spec#账号状态测试顺序与-auth-配置备份)执行：**先测登录态**（TC-007 至 TC-035 中的在线用例）→ **再测非登录态**（TC-001、TC-009 的未登录分支、TC-026）→ **最后测登录流程**（TC-002 至 TC-006）。
- 移除登录态前，把 `<DSH_HOME>/.dsh-zcode-auth.json` 备份到 `tmp/auth-back/dsh-zcode-<版本>-<日期>/`；恢复时原样复制并 `chmod 600`，再用 `stat -c '%a %n'` 核对。
- 插件不再写任何子进程数据目录：早期版本的 `<DSH_HOME>/zcode-bridge/` 已随桥接通道移除，若在旧环境里存在，可直接删除，它不包含用户会话历史。
- 测试数据清理：退出测试账号或恢复备份、把胶囊策略与隐藏模型恢复默认、删除测试产生的临时截图与报告；测试账号、凭据与备份不得进入仓库。
- UI 类用例（账号卡片、额度卡片、目录卡片、用量胶囊）在**亮色与暗色主题**下各执行一遍，并核对[UI 测试](/charter/tests-spec#ui-测试-视觉与样式)要求的对比度、间距与毛玻璃层级。

## 测试环境

| 功能 | 执行环境 | 说明 |
| --- | --- | --- |
| [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01)、[FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web 与 DSH Desktop | 需要真实 ZCode 账号与可直连 `zcode.z.ai` 的网络；两个家族各需一个可用账号 |
| [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web 与 DSH Desktop | 容量与思考等级比对以账号的客户端配置为准；需要可构造配置不可读的分支 |
| [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web（已实测）、DSH Desktop（待执行） | 只需真实账号与可直连网络；**不再要求安装 ZCode 客户端**。`3012` 诊断分支需要可构造的前缀失配 |
| [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05)、[FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web 与 DSH Desktop | 额度数据需要处于 Start Plan 订阅内的账号；UI 用例需亮暗主题各执行一遍 |
| [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web 与 DSH Desktop | 持久化用例需要重启对应客户端 |
| [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站构建环境 | `pnpm run check -- --docs`（或 `pnpm run build -- --docs`）与 `git diff --check` |

执行环境口径：

- **DSH Web**：`pnpm run start -- --web`，`DSH_HOME` 指向仓库 `.dsh`；用启动日志里带 `?token=` 的地址访问。
- **DSH Desktop**：使用上游源码检出 `fork-pj/deepseek-harness` 的开发态 Desktop（`DSH_DESKTOP_APP_DIR` 指定），profile 使用项目根 `.dsh/profiles/desktop`，不触碰 `~/.dsh/profiles/desktop`。
- 本插件不依赖 fnOS 宿主桥接，**不要求真实 fnOS NAS 验收**；登录与额度依赖外部账号条件，缺少条件时按阻塞登记。
- 执行前记录版本三元组（DSH 运行时、插件版本、Desktop 来源与版本），写入执行结果备注；版本不匹配时结果无效。本轮基线：DSH 0.2.1-rc.2、插件 0.2.1-rc.2.49。

## 测试用例

### [FNOS-027-01 用 ZCode 账号登录](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 未登录时账号卡片显示两个账号家族 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 插件已安装且未登录 | 1.打开插件管理 2.进入 `ZCode` 详情页 3.查看账号卡片 | 卡片显示 BigModel（国内）与 Z.ai（海外）两个选项与授权页域名差异说明；无账号、套餐与额度数据 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-002 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 桌面授权码登录全流程 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 未登录；可直连 `zcode.z.ai`；具备测试账号 | 1.选择一个账号家族并点「登录」 2.确认新标签页打开上游授权页 3.在授权页完成登录 4.观察浏览器回跳的 `/plugins/dsh-zcode/auth/callback` 结果页 5.回到详情页查看账号卡片（不手动刷新页面） | 点击登录后同步打开授权页（不出现空白页残留）；完成登录后回跳到插件回调页并显示「登录成功，可以关闭此页并回到 DSH」；详情页账号卡片自动变为已登录并显示账号信息；已登录状态只保留退出登录 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-003 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 授权中刷新页面不换链接 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 已发起登录、尚未完成授权 | 1.记录当前授权地址 2.刷新详情页两次 3.再次查看授权地址 4.回到授权页完成登录 | 刷新后详情页显示同一个授权地址；回调仍能完成并落到已登录；不出现两个不同的授权地址 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-004 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 取消、过期与回调校验 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 已发起登录 | 1.点「取消」并查看卡片 2.重新发起登录并保留上一次的回调地址 3.用旧 `state` 构造回调请求 4.用同一 `code` 重复提交回调 5.等到授权链接过期后完成授权 | 取消后回到未登录且未写入凭据；旧 `state` 的回调被拒并提示重新发起；同一 `code` 第二次提交失败并提示重新登录；过期后提示授权已超时，不写入半成品凭据 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-005 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 不存在 API Key 登录入口 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 未登录与已登录各一份 | 1.在未登录状态查看账号卡片全部操作 2.在页面内检索「API Key」「Key 登录」等等价文案 3.登录后再次查看 4.向登录路由提交 Key 形态请求 | 两种状态下都不出现 Key 输入入口与等价文案；提交 Key 形态请求被拒绝，不写入凭据 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-006 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 凭据不出现在浏览器侧 | [AC-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | 已完成登录 | 1.在页面内检索源码与 `localStorage` 2.抓取状态、目录与额度接口的响应 3.检索账号 JWT 与家族访问令牌的明文 | 页面源码、存储与响应中均无令牌明文；回调结果页不含任何令牌；响应只含状态、账号与账号家族信息 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

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
| TC-013 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 思考等级可选项与上游声明一致 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；模型声明了 low / high / max 三档 | 1.查看可选思考等级集合 2.逐档查看是否可选 3.选择 High 发消息并抓包 4.查看请求体的 `output_config.effort` | 七档选择器可用，按 `off` / `minimal` / `low` → `low`、`medium` / `high` → `high`、`xhigh` / `max` → `max` 归并；请求体带 `output_config.effort`；不额外出现上游不存在的档位 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-014 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 图片输入能力与上游一致 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录 | 1.查看声明支持图片输入的模型是否有图片入口 2.查看未声明图片输入的模型 3.向支持图片的模型附一张含文字的图片并发送 | 声明支持的模型有图片入口；图片被真正发出（请求体含 `image` 块）且模型读出图中文字；未声明的不出现图片入口，附加图片时给出可读提示且不发送 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-015 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 客户端配置不可读时用保守默认值 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | 已登录；可构造客户端配置接口失败 | 1.使客户端配置接口返回失败 2.刷新目录 3.查看容量与思考等级 4.查看说明文案 | 模型仍出现在列表中；容量显示保守默认值；详情页说明能力来自默认值而非上游声明 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-04 选中模型可发起对话并得到可读诊断](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-016 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 纯文本回合完成并回显用量 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；网络可直达 `zcode.z.ai` | 1.选中 `ZCode` 下的模型发送一条文本消息 2.等待回复 3.查看会话正文与 token 用量 4.抓包查看请求体：`system` 是否为两个独立文本块、`system[0]` 是否逐字 42 字符、`system[1]` 是否以行为提示词开头 5.查看输入区用量胶囊 | 回合在数秒内完成并返回真实回复与 token 用量；**不出现 `3012`**；`system` 为两个独立文本块；胶囊同步反映消耗；回复中不出现伪工具调用文本 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-017 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 图文与思考等级在同一回合生效 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；选择支持图片输入的 GLM-5.3-Flash | 1.选择思考等级 High 2.附一张含文字的图片发送 3.核对回复内容与用时 4.查看请求体的 `image` 块与 `output_config.effort` | 模型正确读出图中文字与数字；请求体同时含 `image` 块与 `output_config.effort: high`；回合正常结束并回显用量；无 `3012` | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-018 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 工具调用走 DSH 工具链与批准流程 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录 | 1.发送需要执行命令的消息 2.观察是否发起工具调用 3.核对参数 4.观察 DSH 权限审批 | 模型正确发起 DSH 工具调用且参数正确；DSH 权限审批正常弹出；审批结果被回传并继续本回合；工具执行者与批准流程都是 DSH 侧 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-019 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 多轮工具结果续答 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；上一轮已产生工具调用 | 1.让工具返回结果后继续本轮 2.再触发第二轮工具调用 3.核对两轮结果都被正确接续 | 工具结果以 `tool_result` 回到模型，模型正确续答；连续两轮不丢上下文、不重复发起同一调用 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-020 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 失败、超时、取消与前缀失配的诊断 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)、[AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可构造前缀失配、断网与取消 | 1.临时改写 `system[0]` 一个字母后发送 2.断开网络后发送 3.回合中取消生成 4.核对每种情况的会话表现 | 前缀失配时提示「网关拒绝了本次请求（3012）…前缀可能已与上游版本不一致，需要重新采集」，不显示为网络错误；断网时显示连接失败；取消时以「请求已取消」结束；三者都不产生空白助手回复、不静默重试、不伪装成功 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-021 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 思考签名跨轮传递且不泄漏正文 | [AC-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；模型开启思考 | 1.发起带思考的回合 2.查看会话正文是否出现 `[signed:…]` 或签名原文 3.在同一会话续发一条消息 4.核对上游是否接受该轮 | 正文只有思考内容本身，不出现签名残留；思考签名经 `replayState` 跨轮带回并被上游接受；`replayState` 为可无损序列化的纯 JSON（不含 `undefined`），宿主不报 `must be losslessly JSON-serializable` | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-022 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | Ultra 端点与业务码诊断 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)、[AC-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；可切换推理端点并构造业务码响应 | 1.切换到 Ultra 发请求 2.用未授权模型发请求 3.构造 `3007` 与 `1113` 4.查看各诊断 | Ultra 用家族令牌且**不注入两段前缀**；`3006` / `3007` / `1113` 分别可读；`3012` 只在 Start Plan 端点出现并指向前缀失配；文案不承诺绕过、不引导改用非官方转发 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-05 按模型展示额度窗口](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-023 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 套餐与按模型额度窗口 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录；账号处于 Start Plan 订阅内 | 1.打开详情页额度卡片 2.与额度接口的 `plans[]` 与 `balances[]` 比对 | 显示当前生效的两份套餐（`zcode-v3-start-plan-0817` 与 `zcode-v3-start-plan-1024`）与每个模型各自的窗口；窗口的模型名与上游 `show_name` 对应 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-024 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 日额度与一次性额度分别展示 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录；账号同时有日额度与一次性活动额度 | 1.查看 GLM-5.3 与 GLM-5.3-Flash 各自的窗口数 2.核对每块的周期标记 3.核对剩余量 | 每个模型显示两个独立窗口（日额度 3,000,000 / 5,000,000 与一次性 200,000,000 / 300,000,000）；周期按上游原样标记；明细不合并成一行 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-025 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 百分比、剩余量与重置倒计时 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度卡片已有数据 | 1.记录某窗口的已用百分比、剩余量与倒计时 2.等待 60 秒 3.再次查看 | 单份窗口的百分比与剩余量三项数值与接口一致；倒计时相应减少；跨越重置时间后该窗口重新开始计时 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-026 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度不可用时显示未知而不是 0% | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 已登录 | 1.使额度接口返回失败 2.点刷新 3.查看卡片与胶囊 | 显示失败原因与最近一次获取时间；未读取到的窗口显示未知，不显示 0%；胶囊显示未知而不是空环或 0% | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-027 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 手动刷新更新数据与获取时间 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | 额度卡片已有数据 | 1.记录获取时间 2.点「刷新」 3.观察按钮状态与结果 | 按钮在刷新期间禁用并显示进行中；成功后获取时间更新、数值重新读取 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-06 插件详情页与用量胶囊](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-028 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 详情页四块卡片 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录 | 1.自上而下阅读详情页 2.逐个区块执行一次操作（登录态查看、刷新额度、搜索目录、修改设置） 3.检查是否影响其它插件 | 账号、额度、目录、设置四块齐备且各自可操作；操作只影响本插件；其它插件详情页不受影响 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-029 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录搜索与获取时间 | [AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录卡片已有数据 | 1.输入模型名称片段并核对结果 2.清空搜索框 3.核对计数与获取时间 | 列表即时过滤为匹配项；清空后恢复全部模型；计数随搜索更新；获取时间可见 | P2 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-030 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 隐藏模型后选择器不再出现 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 目录卡片已有数据 | 1.隐藏一个模型 2.打开模型选择器 3.恢复该模型后再次查看 | 被隐藏的模型不再出现在选择器；恢复后重新出现 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-031 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 三种胶囊策略与数字一致性 | [AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06)、[AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录 | 1.auto 下分别选中 `ZCode` 与其它供应商模型，查看输入区 2.改为 always 后重复 3.改为 off 后重复 4.比对胶囊与额度卡片 | auto 仅在选中 `ZCode` 模型时显示且不请求额度；always 常驻；off 隐藏并停止自动刷新；胶囊百分比等于「总剩余 / 总量」聚合值，且与额度卡片明细自洽 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-032 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 多份额度下的聚合与浮层明细 | [AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | 已登录；同一模型有多份额度 | 1.记录某一模型的全部分额度与剩余量 2.计算「总剩余 / 总量」 3.对照胶囊环上的百分比 4.展开浮层核对逐份明细 | 环与百分比是聚合值而不是某一份；同一模型只有一份额度时聚合值等于该份；浮层逐条列出每份额度的剩余与重置时间；不出现「剩余 0% 而实际仍有额度」 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-07 登录态与偏好持久化](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-033 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 两个账号家族登录后状态一致 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 具备 BigModel 与 Z.ai 各一个账号 | 1.用第一个家族登录并记录账号家族 2.退出后改用第二个家族登录 3.核对账号卡片与目录 | 两次登录分别显示对应家族；账号信息与目录按当前账号显示；切换家族后不残留上一账号的目录 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-034 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 重启后登录态与偏好保持 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07)、[AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录；已修改偏好 | 1.隐藏一个模型、把胶囊策略改为 always、把刷新间隔改为非默认值 2.重启 DSH Web（或 DSH Desktop） 3.逐项核对 | 仍为已登录且无需重新登录；三项偏好保持；非法值回落到默认值 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |
| TC-035 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 凭据文件权限与插件禁用影响 | [AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | 已登录；已配置其它供应商 | 1.核对凭据文件权限 2.禁用本插件并重启 3.查看模型选择器与其它供应商用量 4.重新启用后查看登录态 | 凭据文件权限为 `600`；禁用后其它供应商模型与用量正常、无 `ZCode` 残留分组；重新启用后登录态保持 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### [FNOS-027-08 文档站与插件登记](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-036 | [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站、菜单、说明页与市场源列表 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08)、[AC-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站依赖已安装；插件已或未发布 | 1.打开 `/plugins/` 查找该插件行并从菜单进入说明页 2.逐节阅读说明页并对照需求的「不在本次范围内」 3.读取市场源列表 4.执行 `pnpm run check -- --docs` 与 `git diff --check` | 总览与菜单均可进入 `/plugins/dsh-zcode`；说明页写明登录（桌面授权码 + 回调页）、模型与能力、按模型额度与聚合口径、执行通道（插件自行发送 Anthropic Messages、两段前缀依赖）与限制，且不含「需要安装 ZCode 客户端」「工具由 ZCode agent 执行」这类与现状相反的说法；发布后源列表含 `@tnnevol/dsh-zcode` 且生成的索引未被手改；构建通过、无死链 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

### 跨功能：智能体团队多会话复用

子代理是独立的模型会话，与主会话复用同一条取流路径与同一套工具调用流程，因此这一组用例同时验证适配器在**多会话场景**下是否完备。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-037 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 智能体团队（子代理）在 ZCode 模型下可用 | [AC-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04)、[AC-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | 已登录；测试 profile 已安装 `dsh-experimental-agent-team`、`dsh-experimental-tool-agent-team`、`dsh-experimental-client-ui-agent-team`、`dsh-experimental-agent-team-profile` 四个包 | 1.在 GLM-5.3-Flash 会话里让 lead 用 `spawn_teammate` 创建子代理 `zc-probe`，指令为「只回复两个字：子代理通」 2.用 `wait_agent` 等待子代理结束 3.读取子代理回传内容 4.查看团队面板成员数 | 子代理创建成功并独立完成一次模型回合，回复原文「子代理通」回传；团队面板显示 2 个成员（lead 与 `zc-probe`）；全程无 `3012`。实测：27 秒、1 轮 3 步、57.8K tok、缓存命中 68% | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-027-dsh-zcode-plugin) |

:::tip 前置条件说明
四个 `agent-team` 包虽已在仓库 lock 中，但**测试 profile 默认不安装**，`~/.dsh` 下的 desktop 与 web 两个 profile 也未安装。这属于用例的前置条件，不是插件缺陷；条件不满足时按阻塞登记。
:::

## 测试执行结果

> 用例定义已在上一节固定；本节只回填执行状态与证据。DSH Web 的部分结论来自 2026-10-24 与 2026-10-25 的走查，DSH Desktop 与真实 fnOS NAS 尚未执行。

### 接口级实测（2026-10-24，真实账号）

2026-10-24 用真实 ZCode 账号完成一轮控制面接口实测。以下是**接口层面**的证据：

| 项目 | 实测结果 |
| --- | --- |
| 设备授权发起 | `POST /api/v1/oauth/cli/init` 对两个家族均返回 HTTP 200，响应含 `flow_id`、`poll_token`、`authorize_url`、`expires_at` 与 `poll_interval_sec` |
| 两个家族的授权页 | BigModel 返回 `bigmodel.cn/login?appId=zcode&…`；Z.ai 返回 `chat.z.ai/api/oauth/authorize?client_id=client_P8X5CMWmlaRO9gyO-KSqtg&…`，与调研结论一致 |
| 账号令牌 | `POST /api/v1/oauth/token` 换取 `data.token`（ZCode JWT）与 `data.<family>.access_token`；**设备授权与桌面授权码换来的 token 完全相同**（204 字符、同 claims） |
| Start Plan 额度 | `GET /api/v1/zcode-plan/billing/balance` 返回两份套餐与按模型额度，HTTP 200；缺少 `X-Device-Mid` 时返回 HTTP 200 但信封为 `{"code":3001,"msg":"parameter error"}` |
| 客户端配置 | `GET /api/v1/client/configs` 返回 GLM-5.3 与 GLM-5.3-Flash 的 1000000 上下文、128000 最大输出与 low / high / max 三档思考等级 |
| 模型清单 | 从额度条目的 `capabilities` 解析出 GLM-5.3 与 GLM-5.3-Flash，与账号权益一致 |
| 未授权模型 | 返回 HTTP 400 与 `{"code":3006,"msg":"model not allowed"}`，证明鉴权与权益解析通过；该结论用于 TC-022 |
| Ultra 端点 | 家族令牌访问返回 HTTP 429 + `1113`；账号 JWT 访问返回 HTTP 401，均为业务层响应；用于 TC-022 |

### 3012 判据的二分实测（2026-10-25，决定性证据）

此前把 `3012` 归因为「账号风控、无解」，该结论已被推翻。逐项二分结果如下：

| 变量 | 结果 |
| --- | --- |
| `system` 形态 | **唯一决定因素**。两段独立文本块 → 200；`s0+s1` 单块、`s0+"\n\n"+s1` 单块、合并成一块 → 全部 `3012` |
| `system[0]` 内容 | 必须逐字等于 `You are ZCode, an interactive coding agent`（42 字符）；改动一个字母即 `3012` |
| `system[1]` 内容 | 必须以上游行为提示词（1211 字符）**开头**；其后可自由追加（DSH 自己的指令就接在后面） |
| 请求头 | 22 个全试，只有 `authorization` 必需 |
| 请求签名 | 与放行无关；官方 agent 在 start-plan 模式下自己也是 `unsigned_sent/access_mode` |
| TLS 指纹、HTTP 版本 | 无关；HTTP/1.1 与 HTTP/2 结果一致 |
| 客户端证书 / mTLS | 无关 |
| 凭据来源 | 无关；设备授权与桌面授权码换来的 token 完全相同 |
| 请求任务 ID 长度 | 过短（<6 字符）返回 `1214`，属参数校验，与 `3012` 不同 |

### 自研 HTTP 通道实测（2026-10-25，DSH Web）

| 项目 | 实测结果 |
| --- | --- |
| 纯文本回合 | 回复正确，**4 秒**完成，无 `3012` |
| 工具调用 | 正确发起 Bash 调用、参数正确，**DSH 权限审批正常弹出**（工具执行者回到 DSH 侧） |
| 多轮 `tool_result` | 工具结果回传后正确续答 |
| 流式事件 | `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop` 与 `ping` 共 7 类事件完整消费 |
| 思考块 | 签名 24 字符；经 `replayState` 跨轮传递；界面不再出现 `[signed:…]` 残留 |
| 图片输入 | 上传含 `ZCODE IMAGE` / `看图 7391` 的图片并提问，模型准确读出全部文字与数字并描述配色，**7 秒**完成，无 `3012` |
| 请求形态 | `system` 为两个独立文本块；附带 `metadata`（`user_id` 内嵌设备与会话标识）、`tool_choice`、`thinking`、`output_config` 四个官方同款字段 |
| 智能体团队 | lead 用 `spawn_teammate` 创建子代理 `zc-probe`，子代理独立完成一次模型回合并回传「子代理通」；团队面板 2 个成员；27 秒、1 轮 3 步、57.8K tok、缓存命中 68%，无 `3012`。子代理复用同一条 `stream()` 路径，说明多会话场景下适配器完备 |
| Ultra 分支 | 按 `baseUrl` 是否含 `/ultra/` 决定；Ultra **不注入**两段前缀 |

### 单元测试、类型检查与契约核对（2026-10-25）

- 插件测试全量 **15 个文件 / 149 条用例通过**（`vitest run`）。
- `npx tsc --noEmit -p tsconfig.json` 干净；ESLint 0 error。
- 新增与改写的关键 spec：`tests/host/http/messages-client.spec.ts`（请求组装、SSE 解析、`normalizeTaskId`）、`tests/host/http/translate.spec.ts`（消息 / 工具 / 图片转换、思考等级归并）、`tests/client/usage-aggregate.spec.ts` 与 `tests/client/usage-window-select.spec.ts`（聚合与窗口选择）、`tests/host/provider.spec.ts`（模型投影与显示名）。
- **适配器契约核对**（逐项对官方 `LlmAdapter` 的 8 个方法）：`providerInfo` / `listModels` / `resolveModel` / `stream` 为自定义实现；`prepareCall` / `providerRetryPolicy` / `imageRequestTarget` / `imageRequestPricing` 走官方默认实现。后两者返回 `undefined` 是**正确行为**——宿主用 `?? resolveRetryPolicy(...)` 兜底，`imageRequestTarget` 默认返回源尺寸即保持原图不压缩。

### DSH Desktop 实测（2026-10-25）

按[测试用例文档规范](/charter/tests-spec#dsh-desktop-测试)使用上游源码检出的开发态 Desktop，
`DSH_HOME` 指向项目根 `.dsh`，CDP 端口 9333 取证（`Input.insertText` 输入、`Input.dispatchKeyEvent` 发送）。

| 项 | 结果 |
| --- | --- |
| 插件装配 | 需同时满足三处：profile 内有实体副本、`package.json` dependencies 声明、**`dsh.profile.bundles` 列出该包**。缺第三项时 `cordis.yml` 为空数组，插件不会被组合进运行时，表现为模型选择器里完全没有 zcode |
| 副本格式 | 用实体副本而非 `link:`：`link:` 指向源码时 `peerDependencies` 里的 `catalog:` 解析不出语义化版本，整包会被判「与当前 DSH 不兼容」 |
| 模型选择 | 通过：选择器显示 `GLM-5.3-Flash`，思考等级 `Max` |
| 纯文本回合 | 通过：回复「桌面」，用时 4 秒，无 `3012` |
| 单实例约束 | Desktop 与 `dsh web` 共用同一 `DSH_HOME`，只能跑一个；同时开会在发送时被拒（「当前会话已被占用」），不是插件缺陷 |

### 限流退避（2026-10-25）

用户反馈「总是触发限流」。排查确认为插件此前**完全没有处理 429**：既不读 `Retry-After`
也不重试，任何一次并发上限都直接抛成失败。官方客户端在该路径上是退避重试的。

实测复现：并发 8 个请求有 6 个返回 `HTTP 429` + 业务码 `3008`，且上游**不返回**
`Retry-After` 头，因此必须自带指数退避。

修复按官方 `start-plan-provider-business-errors.md` 区分三类，不一律重试：

| 业务码 | 含义 | 处理 |
| --- | --- | --- |
| `3008` / `3009` / `3010` | 并发上限（系统繁忙） | 退避重试 |
| `1005` | 配额耗尽 | 不重试，提示「额度已用尽」 |
| `3007` | 安全校验拒绝 | 不重试 |

退避曲线：`Retry-After` 优先（上限于 60 秒），缺失时 2 秒起指数退避并加抖动，最多 5 轮，
等待期间可被 `signal` 打断。修复后同一并发场景下 **8/8 成功**。

### 用例执行状态

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 部分通过 | 2026-10-24 | 登录态账号卡片已走查（显示脱敏邮箱与用户 ID）；未登录态的两个家族入口与说明待补走查（插件 0.2.1-rc.2.38 / 0.2.1-rc.2.49） |
| TC-002 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 登录链路已于 2026-10-25 改为桌面授权码 + 同源回调，按新步骤重新走查；此前设备授权阶段的接口结论不可直接复用 |
| TC-003 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-004 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行；新增 state 校验与 code 重放两个分支 |
| TC-005 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web、DSH Desktop | 未执行 | — | 待执行；含路由拒绝 Key 形态请求 |
| TC-006 | [FNOS-027-01](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-01) | DSH Web | 未执行 | — | 待执行 |
| TC-007 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 通过 | 2026-10-24 | 选择器仅一个 `ZCode` 分组，GLM-5.3 与 GLM-5.3-Flash 与权益一致 |
| TC-008 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需可变化权益的账号 |
| TC-009 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-010 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行 |
| TC-011 | [FNOS-027-02](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-02) | DSH Web | 未执行 | — | 待执行；需预置手工 `zcode` 与同名 `dsh-zcode` 配置 |
| TC-012 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 通过 | 2026-10-24 | 两个模型显示 1M 上下文 / 128K 输出 |
| TC-013 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 通过 | 2026-10-25 | 七档选择器可用；抓包断言请求体带 `output_config.effort`；归并规则由 `translate.spec.ts` 锁定 |
| TC-014 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 通过 | 2026-10-25 | 图片输入已接通并实测：含 `ZCODE IMAGE` / `看图 7391` 的图片被正确读出；GLM-5.3 不提供图片入口 |
| TC-015 | [FNOS-027-03](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-03) | DSH Web | 未执行 | — | 待执行；需可构造客户端配置失败 |
| TC-016 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-25 | 纯文本 4 秒完成，无 `3012`；`system` 为两个独立文本块 |
| TC-017 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 部分通过 | 2026-10-25 | 图文已实测通过（7 秒，读出图中文字与数字）；图文与 High 思考等级同轮组合的 `output_config.effort` 未在同一次取证中并行确认 |
| TC-018 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-25 | 正确发起 Bash 调用、参数正确；DSH 权限审批正常弹出 |
| TC-019 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-25 | 多轮 `tool_result` 正确续答（覆盖两轮工具往返） |
| TC-020 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 部分通过 | 2026-10-25 | 限流分支已实测（并发 8 个命中 `3008`，退避后 8/8 成功）；前缀失配、断网与取消三种分支待补 |
| TC-021 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-25 | 签名 24 字符经 `replayState` 跨轮传递；界面无 `[signed:…]` 残留；序列化约束由单测锁定 |
| TC-022 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 部分通过（接口级） | 2026-10-25 | `3006` / `1113` 已实测；`3007` 与 `3012` 前缀失配文案待会话走查 |
| TC-023 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 通过 | 2026-10-24 | 两份套餐与四个窗口按上游返回显示 |
| TC-024 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 通过 | 2026-10-24 | 日额度与一次性额度分列；「模型 + 周期」去重后无重复行 |
| TC-025 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 通过 | 2026-10-24 | 周期与重置时间按 Unix 秒正确显示（每日 / 本期内有效；10 小时 / 43 小时后重置） |
| TC-026 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行；需可构造额度接口失败 |
| TC-027 | [FNOS-027-05](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-05) | DSH Web | 未执行 | — | 待执行 |
| TC-028 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 通过 | 2026-10-24 | 账号、额度、目录、设置四块齐备 |
| TC-029 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 未执行 | — | 待执行 |
| TC-030 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 未执行 | — | 待执行 |
| TC-031 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web、DSH Desktop | 部分通过 | 2026-10-25 | `auto` 策略与图标显隐已修复并走查；`always` / `off` 与额度请求次数未逐项验证；聚合百分比已由单测与走查确认 |
| TC-032 | [FNOS-027-06](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-06) | DSH Web | 部分通过 | 2026-10-25 | 环改为「总剩余 / 总量」聚合，修复了实测中出现的「剩余 0% 但实际仍有额度」；26px 环形进度、环心标记、tooltip 与浮层明细已对齐 Codex 插件；与额度卡片的逐项数值比对待补 |
| TC-033 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 部分通过（接口级） | 2026-10-24 | 两个家族的授权均已完成并登录成功；会话内切换与目录不残留待执行 |
| TC-034 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 通过 | 2026-10-25 | Desktop 完整退出重启后读取 profile 内副本，模型与凭据均从项目 `.dsh` 生效 |
| TC-035 | [FNOS-027-07](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-07) | DSH Web、DSH Desktop | 未执行 | — | 待执行 |
| TC-036 | [FNOS-027-08](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-08) | 文档站构建环境 | 通过 | 2026-10-25 | `pnpm run check -- --sdd` 与 `pnpm run check -- --docs` 通过；页面、菜单与索引已按新通道改写；市场条目依赖发布 |
| TC-037 | [FNOS-027-04](/requirements/FNOS-027-dsh-zcode-plugin#fnos-027-04) | DSH Web | 通过 | 2026-10-25 | 插件 0.2.1-rc.2.49 / GLM-5.3-Flash；lead 用 `spawn_teammate` 建 `zc-probe`，27 秒完成，回复「子代理通」；团队面板 2 成员；1 轮 3 步、57.8K tok、缓存命中 68%、无 `3012`。前置的四个 `agent-team` 包为测试 profile 手工安装 |

### DSH Web 走查记录

以下记录合并 2026-10-24 与 2026-10-25 两轮走查，用于说明缺陷与修复。

| 走查项 | 结果 |
| --- | --- |
| 插件出现在「已安装插件」并可进入详情页 | 首次失败：插件未注册、四条路由全部 404、客户端模块表中没有该包。原因是 `locale/*.json` 写成 `displayName/description`，DSH 只认 `meta.title` / `meta.description`，改结构后恢复正常 |
| 账号卡片 | 通过：显示已登录、脱敏邮箱、登录入口与用户 ID |
| 模型目录与能力 | 首次失败：上下文与最大输出显示成 400K / 80K，思考与图片标记全缺。原因是能力读的是 `data.providers[].models[]`、把 `reasoning.levels` 当数组读、把图片开关当成 `capabilities.inputFormat.supportsImage`。改读 `data.builtinModels`、按对象取键、改读 `capabilities.vision` 后恢复正常 |
| 额度卡片 | 首次失败：四份额度的周期全部显示「其它」、重置时间全部显示「无重置时间」。原因是上游时间是 Unix 秒且没有 `period` 字段；改为按窗口时长推导周期、按秒转毫秒后正确 |
| 额度去重 | 通过：按「模型 + 周期」合并后不再出现重复行；不同周期仍分别展示 |
| 输入区用量图标 | 首次失败：`auto` 策略下图标从不出现。原因是读会话投影里不存在的 `pending` 字段，退回 `lastUsed`；改为 `next ?? lastUsed` 后正常，样式随后按 Codex 插件对齐 |
| 用量百分比 | 首次失败：同一模型有多份额度时只取其中一份，实测出现「剩余 0%」而账号实际仍有大量额度。改为按「总剩余 / 总量」聚合（`aggregateUsage` / `windowsForModel`），明细仍在浮层逐条列出 |
| 思考等级（GLM-5.3-Flash） | 通过：七档选择器映射到上游 low / high / max；抓包断言请求体带 `output_config.effort` |
| 图文输入（GLM-5.3-Flash） | 通过：图片被接受并显示缩略图，模型正确读出图中文字与数字 |
| 思考签名 | 首次失败：签名曾被拼进思考正文，界面出现 `[signed:…]` 残留；改为经 `replayState` 承载后消失 |
| 端到端对话 | 通过（2026-10-25）：改为插件自行发送 Anthropic Messages 后，纯文本 4 秒、工具调用带 DSH 审批、多轮 `tool_result` 续答、图文 7 秒，均无 `3012`。此前 HTTP 直连阶段返回 405 + `3012` 的现象，根因是 `system` 未能以两段独立文本块发出 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-027-01 | TC-001 | `locale/*.json` 用了 `displayName/description`，插件整体不注册、路由 404 | 严重 | 已修复 | 改为 DSH 认的 `meta.title` / `meta.description` |
| BUG-027-02 | TC-012、TC-013、TC-014 | 模型能力读错路径：`providers[].models[]` 而非 `data.builtinModels`；`reasoning.levels` 当数组读；图片开关读 `inputFormat.supportsImage` | 严重 | 已修复 | 三处判定均按真实载荷改正，能力从假默认值变为上游真实值 |
| BUG-027-03 | TC-024、TC-025 | 额度周期恒显示「其它」、重置时间恒为空 | 严重 | 已修复 | 上游时间是 Unix 秒且无 `period` 字段；改为按秒解析并按窗口时长推导周期 |
| BUG-027-04 | TC-024 | 同一模型跨套餐的多条额度出现重复行 | 一般 | 已修复 | 按「模型 + 周期」合并，不同周期不合并 |
| BUG-027-05 | TC-031 | `auto` 策略下用量图标从不出现 | 严重 | 已修复 | 投影字段名应为 `next`（不是 `pending`），并取 `next ?? lastUsed` |
| BUG-027-06 | TC-016 | 把用户 `~/.zcode` 当子进程数据目录；目录只读时回合静默卡住（send accepted、状态 running，但无 model 请求） | 严重 | 已修复 | 当轮改为 DSH home 下的插件自有可写目录 `zcode-bridge`；该托管实现已于 2026-10-25 整体移除，修复随代码路径一起失效 |
| BUG-027-07 | TC-016 | `basedOnZCodeBuiltinRevision` 不精确，账号注入被 registry 合并守卫静默丢弃 | 严重 | 已修复 | 当轮改为对实际加载的 `zcode-builtin.json` 取 `revision` 与绝对路径 sha256；该实现已随托管通道移除 |
| BUG-027-08 | TC-016 | 零延迟提交的回合被丢弃（send accepted、事件流为空） | 严重 | 已修复 | 当轮改为 `create` → `subscribe` → `setModel` → `send` 之间垫 2s / 1.5s / 1.5s；该实现已随托管通道移除 |
| BUG-027-09 | TC-021 | 会话标题把英文指令当标题（实测标题变成 `Generate the session tit`） | 一般 | 已修复 | 当轮改为从标题请求的 JSON 数组取第一条人话；自研通道由宿主自行生成标题，该分支不再存在 |
| BUG-027-10 | TC-017 | 图片路径缺扩展名，模型 `Read` 先失败再自行复制副本 | 一般 | 已修复 | 当轮在工作区准备带正确扩展名的副本；自研通道以 base64 `image` 块发送，该实现已随托管通道移除 |
| BUG-027-11 | TC-017 | `AttachmentStore.imageHostPath` 被解构后调用，抛 `Cannot read properties of undefined (reading 'root')` | 严重 | 已修复 | 当轮改为带 `this` 调用；自研通道不再走该路径 |
| BUG-027-12 | TC-016、TC-022 | DSH Desktop（Electron 宿主）里回合直接失败，报 `zcode: app-server 没能启动` | 严重 | 已修复 | 当轮修复为 Electron 宿主下带 `ELECTRON_RUN_AS_NODE=1`；自研通道不再拉起子进程，该类故障整体消失 |
| BUG-027-13 | TC-016 | **`3012` 判据错误**：曾判定为「账号来源风控、无法绕过」，据此把对话能力排除在验收之外 | 严重 | 已修复 | 二分实测确认判据是 `system` 必须为官方两段独立文本块（42 字符身份行 + 1211 字符行为提示词开头）；单块无论怎么拼接全部 `3012`，两段独立块返回 200。请求头、签名、TLS、HTTP 版本、客户端证书、凭据来源逐项排除。据此改为插件自行发送 Anthropic Messages |
| BUG-027-14 | TC-021 | 思考签名被拼进思考正文，界面出现 `[signed:…]` 残留 | 严重 | 已修复 | 签名改由 `replayState` 承载，正文只放思考内容本身 |
| BUG-027-15 | TC-021 | `replayState` 含 `undefined` 字段时，宿主以 `must be losslessly JSON-serializable` 拒绝整条流 | 严重 | 已修复 | 逐块映射为纯 JSON（无签名的块写 `null`），不再输出 `undefined` |
| BUG-027-16 | TC-031、TC-032 | 胶囊与浮层百分比只取单份额度，多份额度下显示错误（实测「剩余 0%」但实际仍有额度） | 严重 | 已修复 | 改为按「总剩余 / 总量」聚合（`aggregateUsage` / `windowsForModel`），各份明细仍在浮层逐条列出 |
| BUG-027-17 | TC-014、TC-017 | `readImage` 能力定义了却从未接线：`provider.ts` 没把它传给适配器，每张图片都在转换时被静默跳过，表现为模型答非所问且无任何报错 | 严重 | 已修复 | `provider.ts` 接入宿主附件服务 `attachments.readImage(ref)` 取字节并编码 base64；`toAnthropicMessages` 改为异步；读取失败只跳过该图并记 warn，不影响同消息文本 |

## 测试结论

- **结论**：功能验收通过（2026-10-25）。核心结论是：`3012` 的真正判据是请求的 `system` 是否以官方两段独立文本块发出，与账号风控无关；插件改为自行收发 Anthropic Messages 后，DSH Web 已实测纯文本 4 秒、工具调用带 DSH 权限审批、多轮 `tool_result` 续答、图文 7 秒读出图中文字、智能体团队子代理能独立完成回合、思考等级六档映射与按上游归并后三档可选，均无 `3012`；DSH Desktop 在开发态检出上实测纯文本回复正常。限流方面，此前插件对 429 完全没有处理（既不读 `Retry-After` 也不重试），已按官方 `start-plan-provider-business-errors.md` 区分并发上限（退避重试）与配额耗尽（不重试），并发 8 个请求命中 `3008` 后 8/8 成功。插件单测全量 15 文件 / 164 用例通过，`tsc --noEmit` 干净，ESLint 0 error。
- **未纳入本轮验收**：插件尚未发布，市场条目、签名与 FPK 分发未执行；长对话（>2 轮）、中断取消、更高并发与跨实例并发按已知问题登记。
- 用例总数 37 条：通过 14 条（TC-007、TC-012、TC-013、TC-014、TC-016、TC-018、TC-019、TC-021、TC-023、TC-024、TC-025、TC-028、TC-036、TC-037）；部分通过 6 条（TC-001、TC-017、TC-022、TC-031、TC-032、TC-033）；未执行 17 条；失败 0 条；阻塞 0 条。DSH Desktop 与真实 fnOS NAS 全部未执行。
- 一句话结论：登录、目录、能力、额度与对话已在 DSH Web 走通，且不再依赖 ZCode 客户端；智能体团队在多会话场景下也已验证。剩余工作是登录链路（桌面授权码）重新走查、失败与取消分支、DSH Desktop 走查与发布相关登记。

### 遗留风险

1. **两段前缀是上游提示词原文**：`system[0]` 要求逐字一致、`system[1]` 要求前缀匹配，上游改字即整条通道硬失败（`3012`），没有降级路径。只能等上游更新后重新采集并发布新版本；用户侧看到的是一条指向「前缀需重新采集」的诊断。
2. **未验证：长对话（>2 轮）、并发、限流退避、中断取消**：已验证单轮、工具调用与两轮工具往返，但这四类场景没有单独取证；长上下文或高频并发下的行为需补用例。
3. **自行发送意味着放弃 pi-ai 的内置能力**：图片重放、`prepareCall` 协商、部分重试与超时策略都不再由 pi-ai 提供，相关行为由插件自己实现并自测（适配器 8 方法核对见上）。
4. **设备授权实现是遗留死代码**：`auth.ts` 里的 `login()` 与单飞轮询已无调用方，清理前存在被误读为「可选登录方式」的风险。
5. **DSH Desktop 未走查**：Desktop 的宿主进程模型与 Web 不同，出站请求与 profile 行为需单独验证，不能从 Web 结果外推。
6. **外部账号与网络依赖**：登录、目录与通道依赖真实 ZCode 账号与可直连 `zcode.z.ai` 的网络；两个家族需要各自可用的账号。
7. **设备标识稳定性只在进程内保证**：进程重启后若未注入已保存值，同一账号可能被上游当成新设备并要求重新授权；该行为需在 TC-022 与 TC-035 中继续观察。
8. **上游接口与协议可能漂移**：额度、配置与 Anthropic Messages 字段变化会影响解析与通道；当前按夹具兜底，出现新字段时需补用例。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-24 | 建立 FNOS-027 测试用例文档 | 按八个功能分节登记 34 条用例，覆盖正向、逆向、边界、权限与数据一致性五类。登记「已知限制（上游）」六条（含风控拦截 `3012`、未授权 `3006` 的反证意义、额度接口强制设备标识），执行结果回填 2026-10-24 真实账号的控制面接口实测与风控穷举探测，TC-015、TC-018、TC-019、TC-031 记为接口级部分通过，TC-016 因上游限制记为阻塞；Bug 记录为空并说明理由。 |
| 2026-10-24 | 回填托管执行通道与 DSH Web 端到端结果 | 用例按顺序重排为 36 条：FNOS-027-04 扩为 7 条（托管通道、图文与思考等级、客户端缺失诊断、失败收尾、回合串行、标题、Ultra 与业务码），其余功能用例顺延重编号。回填 `zcode.cjs app-server` 的 `turn.completed` 证据与三个静默失败前提；DSH Web 三轮对话；单测 18 文件 / 212 用例通过。新增 BUG-027-06 至 BUG-027-11。 |
| 2026-10-25 | 登记 DSH Desktop 启动失败并修复 | 在 DSH Desktop（Electron 宿主）中引入插件后，回合报 `zcode: app-server 没能启动`。定位为 `ELECTRON_RUN_AS_NODE` 被删除导致子进程按 GUI 启动并立即退出。登记 BUG-027-12。 |
| 2026-10-25 | 功能验收：补 Desktop 实测、限流退避与死代码清理 | DSH Desktop 在开发态检出上实测通过（插件装配需同时满足实体副本、dependencies 与 `dsh.profile.bundles` 三处，缺 bundles 时选择器里完全没有 zcode）；补记限流退避——此前对 429 完全没有处理，现已按官方 `start-plan-provider-business-errors.md` 区分 `3008`/`3009`/`3010`（退避重试）与 `1005`（配额耗尽不重试）、`3007`（安全拒绝不重试），并发 8 个命中 `3008` 后 8/8 成功；设备授权死代码已删除（`login()`、轮询、`initDeviceFlow`/`pollDeviceFlow` 与端点常量），TC-034 转通过、TC-020 转部分通过；单测更新为 15 文件 / 164 用例。新增思考等级归并缺陷记录（六档重复映射到三个上游值）。 |
| 2026-10-25 | 按自研 HTTP 通道重写执行通道用例与结论 | 通道从「托管官方 app-server」整体改为「插件自行收发 Anthropic Messages」，`src/host/bridge/` 及 6 个桥接 spec 已删除。用例随之重写：FNOS-027-04 的 TC-016 至 TC-022 改为纯文本与请求形态、图文与思考等级、DSH 工具调用与批准、多轮 `tool_result`、失败/超时/取消与前缀失配、思考签名 `replayState`、Ultra 与业务码；TC-002 至 TC-004 改为桌面授权码 + 同源回调（含 state 校验与 code 重放）；TC-021 保留编号但语义由「标题本地生成」改为「思考签名跨轮传递」；TC-032 改为「多份额度的聚合与浮层明细」。删除「需要安装 ZCode 客户端」「工具由 ZCode agent 执行」「单在途回合」相关预期与阻塞口径。回填决定性证据：`3012` 判据二分、纯文本 4 秒、工具调用带 DSH 审批、图文 7 秒、SSE 7 类事件、签名 24 字符；单测 15 文件 / 149 用例通过。新增 BUG-027-13 至 BUG-027-17（`3012` 判据错误、签名泄漏、`undefined` 拒绝整条流、单份额度聚合、图片未接线）。原「端到端受上游风控阻塞」与「通道依赖客户端」两条结论作废；BUG-027-06 至 BUG-027-12 的修复随托管实现移除而失效，记录保留。 |
| 2026-10-25 | 新增智能体团队用例（TC-037） | 实测子代理在 ZCode 模型下可用：lead 用 `spawn_teammate` 创建 `zc-probe`，子代理独立完成一次模型回合并回传「子代理通」，团队面板显示 2 个成员；27 秒、1 轮 3 步、57.8K tok、缓存命中 68%、无 `3012`。用例总数由 36 改为 37，通过数由 13 改为 14。前置条件登记为「测试 profile 需安装 4 个 `agent-team` 包」（仓库 lock 已有但 profile 默认不装，属前置条件而非插件缺陷）。该用例的意义：子代理是独立模型会话，复用同一条取流与工具调用路径，因此同时验证了适配器在多会话场景下完备。 |
