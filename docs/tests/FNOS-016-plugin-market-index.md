---
id: FNOS-016
title: FNOS-016 测试用例
description: FNOS-016 插件市场索引与插件元数据的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-016-plugin-market-index
plan: /plans/PLAN-FNOS-016-plugin-market-index
status: 规划中
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-016 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-016 |
| 关联需求 | [FNOS-016 插件市场索引与插件元数据](/requirements/FNOS-016-plugin-market-index) |
| 关联计划 | [PLAN-FNOS-016 插件市场索引与插件元数据](/plans/PLAN-FNOS-016-plugin-market-index) |
| 测试状态 | <Badge type="info" text="规划中（用例已登记，尚未执行）" /> |

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
| [FNOS-016-01](/requirements/FNOS-016-plugin-market-index#fnos-016-01) | DSH Web 与 DSH Desktop（发现页） |
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

### [FNOS-016-06 索引生成可复现](/requirements/FNOS-016-plugin-market-index#fnos-016-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-016 | [FNOS-016-06](/requirements/FNOS-016-plugin-market-index#fnos-016-06) | 文档记录生成步骤 | AC-01 | — | 1.按文档步骤操作 | 能完成生成，命令与前置条件无缺项 | P1 | 新增行为 |
| TC-017 | [FNOS-016-06](/requirements/FNOS-016-plugin-market-index#fnos-016-06) | 重复生成输出确定 | AC-02 | 已生成一次 | 1.再次生成 2.`git diff` 对比 | 差异为空 | P1 | 新增行为 |

## 测试执行结果

| 用例范围 | 总数 | 通过 | 失败 | 阻塞 | 未执行 |
| --- | --- | --- | --- | --- | --- |
| TC-001～TC-004（FNOS-016-01） | 4 | 0 | 0 | 0 | 4 |
| TC-005～TC-007（FNOS-016-02） | 3 | 0 | 0 | 0 | 3 |
| TC-008～TC-010（FNOS-016-03） | 3 | 0 | 0 | 0 | 3 |
| TC-011～TC-013（FNOS-016-04） | 3 | 0 | 0 | 0 | 3 |
| TC-014～TC-015（FNOS-016-05） | 2 | 0 | 0 | 0 | 2 |
| TC-016～TC-017（FNOS-016-06） | 2 | 0 | 0 | 0 | 2 |
| **合计** | **17** | **0** | **0** | **0** | **17** |

## Bug 记录

| Bug ID | 关联用例 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- | --- |
| — | — | 尚未执行 | — | — |

## 测试结论

尚未执行。用例已按 FNOS-016 的 6 项功能登记完毕，共 17 条，覆盖索引格式与托管、图标与关键词的「源码 → 线上产物 → 索引」三段链路、索引与发布的一致性，以及生成的可复现性。

执行顺序受生成器取数方式约束：必须先完成补丁版本发布（TC-008），才能生成有意义的索引（TC-001），再做发现页走查（TC-002～TC-006、TC-009）。
