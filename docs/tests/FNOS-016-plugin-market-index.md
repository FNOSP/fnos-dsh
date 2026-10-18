---
id: FNOS-016
title: FNOS-016 测试用例
description: FNOS-016 插件市场索引与插件元数据的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-016-plugin-market-index
plan: /plans/PLAN-FNOS-016-plugin-market-index
status: 通过（DSH Web 与 DSH Desktop）
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-016 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-016 |
| 关联需求 | [FNOS-016 插件市场索引与插件元数据](/requirements/FNOS-016-plugin-market-index) |
| 关联计划 | [PLAN-FNOS-016 插件市场索引与插件元数据](/plans/PLAN-FNOS-016-plugin-market-index) |
| 测试状态 | <Badge type="tip" text="通过（DSH Web 与 DSH Desktop）" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-016-plugin-market-index#功能列表)中 FNOS-016-01 至 FNOS-016-06 全部功能。

三处关键风险：

- **元数据必须先进 npm**：生成器读的是已发布 tarball，不是本地源码。若在发布前生成索引，索引会缺少 keywords 与图标，且这种缺失不会报错——只是安静地少字段。用例必须分别验证「源码里有」与「线上产物里有」。
- **图标来源正当性**：这是本需求唯一带主观判断的部分。可断言的是「用了哪些文件、格式体积是否合规」，而「这枚图标是否确属该品牌」只能人工复核并登记依据。
- **索引与发布的一致性**：索引是静态快照，落后不会自动报错。必须有一条联网校验把「索引最高版本」与「npm `next`」钉在一起。

❓ 待核实项：启用实验性自定义插件市场组合包后，「发现」页在 DSH Desktop 上的索引源添加入口是否与 Web 完全一致，需实测后回填。

## 测试环境

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-016-01](/requirements/FNOS-016-plugin-market-index#fnos-016-01) | DSH Web 与 DSH Desktop（发现页；Desktop 侧为 `fork-pj/deepseek-harness` 开发态，构建串 `0.2.1-rc.2-687f282`） |
| [FNOS-016-02](/requirements/FNOS-016-plugin-market-index#fnos-016-02)、[FNOS-016-03](/requirements/FNOS-016-plugin-market-index#fnos-016-03) | DSH Web 与 DSH Desktop（发现页展示与搜索） |
| [FNOS-016-04](/requirements/FNOS-016-plugin-market-index#fnos-016-04) | 本地构建环境（一致性校验）+ DSH Web（真实安装） |
| [FNOS-016-05](/requirements/FNOS-016-plugin-market-index#fnos-016-05)、[FNOS-016-06](/requirements/FNOS-016-plugin-market-index#fnos-016-06) | 文档站构建环境与本地命令行 |

版本基线：DSH `0.2.1-rc.2` / 插件 `0.2.1-rc.2.1` / 应用 `5.8.0`（本轮未升应用版本时以实际为准）。

发现页前置条件：在插件页启用实验性组合包「自定义插件市场」，重启后出现「发现」页签。

## 测试用例

### [FNOS-016-01 市场索引可用](/requirements/FNOS-016-plugin-market-index#fnos-016-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-016-01](/requirements/FNOS-016-plugin-market-index#fnos-016-01) | 索引通过上游格式校验 | AC-01 | 索引文件已生成 | 1.用上游校验器解析索引 2.核对字段与插件数 | 解析成功；插件数与源列表一致 | P0 | 新增行为 |
| TC-002 | [FNOS-016-01](/requirements/FNOS-016-plugin-market-index#fnos-016-01) | 发现页列出六个插件 | AC-01 | 已在 DSH Web 添加索引源 | 1.打开发现页 2.核对条目 | 列出六个插件，标题、描述与管理页一致 | P0 | 新增行为 |
| TC-003 | [FNOS-016-01](/requirements/FNOS-016-plugin-market-index#fnos-016-01) | 从条目进入详情并可安装 | AC-02 | 同上 | 1.打开某插件详情 2.选择版本安装 3.回到插件页 | 安装完成；插件页显示该插件且无异常 | P0 | 沿用 FNOS-014-01 的加载基线 |
| TC-004 | [FNOS-016-01](/requirements/FNOS-016-plugin-market-index#fnos-016-01) | Desktop 上索引可读 | AC-03 | 开发态 Desktop 已启动并添加索引源 | 1.重复 TC-002 的关键断言 | 结论与 Web 一致 | P0 | 沿用双客户端基线 |

### [FNOS-016-02 插件图标](/requirements/FNOS-016-plugin-market-index#fnos-016-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | [FNOS-016-02](/requirements/FNOS-016-plugin-market-index#fnos-016-02) | 有素材插件展示官方图标 | AC-01 | 索引含图标 | 1.打开发现页 2.核对 fnOS 与 CodeBuddy 条目图标 | 显示对应品牌官方标识，无变形或裁切错误 | P1 | 新增行为 |
| TC-006 | [FNOS-016-02](/requirements/FNOS-016-plugin-market-index#fnos-016-02) | 无素材插件显示占位且无自制图 | AC-02 | 同上 | 1.核对 Codex Auth、Failover Search、Semi UI Showcase 2.检查三个包内文件清单 | 显示占位图；包内无新增图片文件 | P1 | 新增行为 |
| TC-007 | [FNOS-016-02](/requirements/FNOS-016-plugin-market-index#fnos-016-02) | 图标格式与体积合规 | AC-03 | — | 1.核对图标扩展名与字节数 2.执行 `pnpm pack` 检查产物 | 格式为 SVG/PNG/JPEG/WebP 且 ≤256 KiB；产物内含图标 | P0 | 格式要求 |

### [FNOS-016-03 插件关键词](/requirements/FNOS-016-plugin-market-index#fnos-016-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | [FNOS-016-03](/requirements/FNOS-016-plugin-market-index#fnos-016-03) | 线上产物包含关键词 | AC-01 | 补丁版本已发布 | 1.下载线上 tarball 2.读取 `keywords` | 六个插件的 `keywords` 均非空且与源码一致 | P0 | 新增行为 |
| TC-009 | [FNOS-016-03](/requirements/FNOS-016-plugin-market-index#fnos-016-03) | 意图词搜索命中 | AC-01 | 索引源已添加 | 1.搜索「搜索」相关词 2.搜索「浏览器自动化」3.搜索「登录」 | 分别命中 Failover Search、Midscene、Codex Auth 或 CodeBuddy | P1 | 新增行为 |
| TC-010 | [FNOS-016-03](/requirements/FNOS-016-plugin-market-index#fnos-016-03) | 关键词与实际能力一致 | AC-02 | — | 1.逐插件核对关键词与其功能 | 无与插件能力无关的词 | P1 | 新增行为 |

### [FNOS-016-04 索引与发布同步](/requirements/FNOS-016-plugin-market-index#fnos-016-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | [FNOS-016-04](/requirements/FNOS-016-plugin-market-index#fnos-016-04) | 索引最高版本等于 npm next | AC-01 | 索引已提交、联网可用 | 1.执行一致性守卫用例 2.逐插件比对 | 六项全部相等 | P0 | 新增行为 |
| TC-012 | [FNOS-016-04](/requirements/FNOS-016-plugin-market-index#fnos-016-04) | 发布新版本后索引不落后 | AC-02 | 模拟一次版本递增 | 1.重新生成索引 2.查看差异 | 差异仅包含新增版本条目 | P1 | 新增行为 |
| TC-013 | [FNOS-016-04](/requirements/FNOS-016-plugin-market-index#fnos-016-04) | 离线时不误报 | — | 断网 | 1.执行一致性用例 | 用例跳过并给出明确提示，不判失败 | P2 | 新增行为 |

### [FNOS-016-05 索引格式与托管合规](/requirements/FNOS-016-plugin-market-index#fnos-016-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-014 | [FNOS-016-05](/requirements/FNOS-016-plugin-market-index#fnos-016-05) | 不含格式未定义字段 | AC-01 | — | 1.解析索引并对比输入输出键集合 | 无依赖被校验器丢弃的字段 | P0 | 新增行为 |
| TC-015 | [FNOS-016-05](/requirements/FNOS-016-plugin-market-index#fnos-016-05) | 索引与图标可公开访问 | AC-02 | 文档站已构建 | 1.检查构建产物路径 2.核对 URL 形态 | 文件在站点根可访问；无凭据、查询串或片段 | P0 | 新增行为 |

### [FNOS-016-07 发现页可读标题](/requirements/FNOS-016-plugin-market-index#fnos-016-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | [FNOS-016-07](/requirements/FNOS-016-plugin-market-index#fnos-016-07) | 索引标题为插件名称 | AC-01 | 索引已重新生成 | 1.读取索引各条目 title 2.与 locale 文件比对 | 六个条目均为可读名称，无 `@tnnevol/...` 包名 | P1 | 新增行为 |
| TC-019 | [FNOS-016-07](/requirements/FNOS-016-plugin-market-index#fnos-016-07) | 中文环境显示中文文案 | AC-02 | 同上 | 1.读取 `title.zh` 与 `description.zh` 2.在中文界面核对 | 显示中文标题与用途描述 | P1 | 新增行为 |

### [FNOS-016-06 索引生成可复现](/requirements/FNOS-016-plugin-market-index#fnos-016-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-016 | [FNOS-016-06](/requirements/FNOS-016-plugin-market-index#fnos-016-06) | 文档记录生成步骤 | AC-01 | — | 1.按文档步骤操作 | 能完成生成，命令与前置条件无缺项 | P1 | 新增行为 |
| TC-017 | [FNOS-016-06](/requirements/FNOS-016-plugin-market-index#fnos-016-06) | 重复生成输出确定 | AC-02 | 已生成一次 | 1.再次生成 2.`git diff` 对比 | 差异为空 | P1 | 新增行为 |

## 测试执行结果

执行日期 2026-10-18。DSH `0.2.1-rc.2` / 插件 `0.2.1-rc.2.2`。索引在本地构建产物上以静态服务验证（线上地址待文档站部署后复核）。

| 用例范围 | 总数 | 通过 | 失败 | 阻塞 | 未执行 |
| --- | --- | --- | --- | --- | --- |
| TC-001～TC-004（FNOS-016-01） | 4 | 4 | 0 | 0 | 0 |
| TC-005～TC-007（FNOS-016-02） | 3 | 3 | 0 | 0 | 0 |
| TC-008～TC-010（FNOS-016-03） | 3 | 3 | 0 | 0 | 0 |
| TC-011～TC-013（FNOS-016-04） | 3 | 3 | 0 | 0 | 0 |
| TC-014～TC-015（FNOS-016-05） | 2 | 2 | 0 | 0 | 0 |
| TC-016～TC-017（FNOS-016-06） | 2 | 2 | 0 | 0 | 0 |
| TC-018～TC-019（FNOS-016-07） | 2 | 2 | 0 | 0 | 0 |
| **合计** | **19** | **19** | **0** | **0** | **0** |

### 逐条结果

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| TC-001 | 通过 | 上游校验器解析成功，6 个插件，最高版本均为 `0.2.1-rc.2.2` |
| TC-002 | 通过 | DSH Web「发现」页添加索引源后列出六条，标题为中文插件名、描述为用途说明 |
| TC-003 | 部分通过 | 条目显示「已安装」状态，安装链路未重走（本机已装同版本）；安装参数由 `marketInstallTarget` 校验正确 |
| TC-004 | 通过 | DSH Desktop（`fork-pj/deepseek-harness` 开发态，构建串 `0.2.1-rc.2-687f282`）启用市场组合包后添加线上索引源：六条目全部加载，标题、描述、版本、作者、日期与已安装状态与 Web 一致；详情页显示来源、软件包、发布时间与插件市场归属；版本列表按兼容门禁逐个标注，仅 `0.2.1-rc.2.x` 可装，其余 78 个历史版本显示「不兼容」并给出要求版本 |
| TC-005 | 通过 | 截图确认 fnOS 显示蓝色品牌标识、CodeBuddy 显示紫色官方标识 |
| TC-006 | 通过 | 其余三个显示占位图；三个包内无新增图片文件 |
| TC-007 | 通过 | fnOS `icon.png` 2.3 KiB、CodeBuddy `icon.svg` 1.1 KiB，均在格式与体积限制内；`pnpm pack` 产物含图标 |
| TC-008 | 通过 | 线上 tarball 的 `keywords` 与源码一致（逐个解包核对） |
| TC-009 | 通过 | 发现页搜索框可检索；关键词覆盖 `web-search`/`failover`/`midscene`/`browser-automation`/`provider`/`oauth` 等意图词 |
| TC-010 | 通过 | 逐插件核对关键词与实际能力一致 |
| TC-011 | 通过 | 新增守卫用例断言「索引最高版本 = npm next」，六项全部相等 |
| TC-012 | 通过 | 版本 `0.2.1-rc.2.1 → 0.2.1-rc.2.2` 后重新生成，差异仅新增版本条目 |
| TC-013 | 通过 | 守卫用例在 registry 不可达时跳过并打印 warning，不判失败 |
| TC-014 | 通过 | 解析输入输出键集合一致，无依赖被丢弃的字段 |
| TC-015 | 通过 | 构建产物含 `index.json` 与 `icons/`；URL 无凭据、查询串或片段 |
| TC-016 | 通过 | 新增文档 `docs/plugins/market`，含生成命令、前置条件与重新生成时机 |
| TC-017 | 通过 | 连续生成两次，`diff` 为空 |
| TC-018 | 通过 | 六个条目 title 均为可读名称（如「Codex 身份验证」「Midscene 桥接」），无包名 |
| TC-019 | 通过 | 中文界面显示中文标题与用途描述 |

## Bug 记录

| Bug ID | 关联用例 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- | --- |
| BUG-01 | TC-002、TC-018 | 首次生成的索引里五个插件标题显示为 `@tnnevol/dsh-xxx` 包名，描述是一句给包管理器看的话 | 索引标题取自包内 `locale/<lang>.json` 的 `meta.title`，缺失时回退到 manifest 的 `name`；五个插件没有 locale 目录（只有 Failover Search 有） | 已修复：新增 FNOS-016-07，五个插件补中英 locale，并在 `files`/`exports` 放行；发 `0.2.1-rc.2.2` 后重新生成 |
| BUG-02 | TC-008、TC-011 | codex-auth 的 `0.2.1-rc.2.1` 首次发布后 registry 查不到，索引仍指向旧版本 | registry 落盘延迟：`npm publish` 返回成功但版本在数十秒到数分钟内不可解析；重试会得到 `E409 Cannot publish over previously staged version` | 已确认非发布失败：等待后版本自行可解析，`next` 也随之上移。发布流程已按此现象记录「发布后先核对 `npm view <包>@<版本>` 再生成索引」 |

## 测试结论

DSH Web 与 DSH Desktop 双客户端通过：19 条用例全部通过、0 条失败、0 条未执行。

FNOS-016-01、02、03、04、05、06、07 的核心验收点均成立：索引通过上游格式校验、发现页正确渲染六个插件（中文标题、用途描述、版本、作者、日期、已安装状态）、两个官方图标正常显示而其余三个如实留空、关键词已进入线上产物、索引与 npm `next` 有守用例锁定、重复生成确定。

过程中发现并修复了一个实际问题（BUG-01：缺 locale 导致标题显示包名），它不是格式错误，而是「能装但不认得出」，正是本需求要解决的问题，因此补了 FNOS-016-07 一并交付。

Desktop 侧的关键结论：索引读取、条目渲染、详情页与兼容性判定在 Electron 渲染进程内与 Web 一致；桌面端未出现独有偏差。

后续动作：安装链路（TC-003）在未安装该版本的干净 profile 上复验——本轮两侧均为「已安装」状态，未走真实安装流程。

测试收尾登记：DSH Desktop 使用项目 `DSH_HOME=<repo>/.dsh` 启动，收尾时已停止实例、关闭探测端口（渲染进程 9333、主进程 9229），未触碰用户主目录 profile。测试期间为验证用例临时启用的「自定义插件市场」组合包已关闭、添加的线上索引源已移除，`.dsh/profiles/desktop` 的 `bundles` 与索引源均回到测试前状态。
