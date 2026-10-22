---
id: FNOS-025
title: FNOS-025 测试用例
description: FNOS-025 CodeBuddy 插件下架的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-025-codebuddy-plugin-delisting
plan: /plans/PLAN-FNOS-025-codebuddy-plugin-delisting
status: 部分通过
lastVerified: 2026-10-22
verifiedAt: 2026-10-22
---

# FNOS-025 测试用例

| 项目 | 内容 |
| --- | --- |
| 需求编号 | [FNOS-025](/requirements/FNOS-025-codebuddy-plugin-delisting) |
| 计划编号 | [PLAN-FNOS-025](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| 覆盖功能 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01)、[FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02)、[FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03)、[FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04)、[FNOS-025-05](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) |
| 测试状态 | <Badge type="warning" text="部分通过（本地与构建链路全部通过；真实 NAS 升级验收待执行）" /> |

## 测试范围与需求分析

被测对象是「CodeBuddy 插件已下架」这一状态在四条链路上的体现：应用分发清单、文档站、仓库追踪状态、发布与版本维护链路，以及老用户环境在升级后的清理结果。

### 关键风险点

| 风险 | 用例方向 |
| --- | --- |
| 只解除仓库追踪、目录仍在磁盘上，插件被版本维护与发布链路继续捡起 | 版本维护与发布的候选列表里不得出现该插件 |
| 发布清单删了插件但内置守卫仍要求它，构建期直接失败 | FPK 构建必须通过，且包内清单不含该插件 |
| 文档站留下指向已删页面的链接，文档构建失败 | 文档构建（含死链检查）必须通过 |
| 文档站残留「六个插件」这类数量断言，下架后变成错误陈述 | 现行文档里不得再出现该插件或旧数量 |
| 仓库里仍能查到插件源码，等于没下架 | 版本管理的文件集合里查不到该目录 |
| 反向误删：本机源码被一并清掉 | 源码在本机必须完整保留 |
| 锁文件与工作区不一致，干净检出时冻结安装失败 | 干净检出（插件目录不存在）下冻结安装必须通过 |

## 测试环境

| 功能 | 执行环境 | 说明 |
| --- | --- | --- |
| [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 构建产物 + 真实 fnOS NAS | 本地构建 FPK 并检查包内清单；**真实 NAS 的安装与升级验收待执行** |
| [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档站构建环境 | `pnpm run build -- --docs`（含死链检查） |
| [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 仓库工具链 | 版本管理的文件集合与本机文件系统 |
| [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 仓库工具链 | 版本维护命令与插件市场索引 |
| [FNOS-025-05](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 真实 fnOS NAS | 依赖安装回调的孤儿自有插件清理机制；**真实 NAS 升级验收待执行** |

本需求不涉及 fnOS 插件的宿主桥接能力，DSH Web 与 DSH Desktop 不构成独立验收门槛；验收集中在分发链路、文档站与仓库工具链。

## 测试用例

### [FNOS-025-01 插件不再随应用内置](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 应用发布清单不含该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 工作区在版本控制下 | 1.读取应用发布清单 2.逐项核对插件名 | 清单里没有该插件，其余条目完整 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-002 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | FPK 构建通过内置守卫校验 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 本机具备打包工具 | 1.构建 FPK（跳过内置插件归档） 2.观察构建结果 | 构建成功，不因「必须内置该插件」报错 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-003 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | FPK 包内清单不含该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 已构建出 FPK | 1.解开包内应用归档 2.读取发布清单 | 包内清单与仓库一致，不含该插件 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-004 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 应用介绍文案的内置插件清单与实际一致 | [AC-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 仓库已更新 | 1.读取应用清单描述 2.与发布清单逐项比对 | 描述里的内置插件与实际分发内容一致，数量断言正确 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-005 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 真实 NAS 安装后插件管理器无该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 真实 fnOS NAS 可用 | 1.通过应用中心安装本构建 2.打开插件管理器 | 插件管理器里没有该插件 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |

### [FNOS-025-02 文档站不再收录该插件](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档构建通过（含死链检查） | [AC-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 依赖已安装 | 1.构建文档站 2.观察构建结果 | 构建成功，无指向已删页面的链接 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-007 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 插件总览与专页均无该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档已更新 | 1.读取插件总览表格 2.检索侧边栏条目 3.访问原专页地址 | 总览无该行、侧边栏无该条目、原专页地址不再存在 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-008 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 现行文档无旧数量断言 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档已更新 | 1.在现行文档中检索旧的插件数量表述 2.核对上下文 | 现行文档里的插件数量与实际一致 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-009 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 历史需求与验收记录保持可达 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档已更新 | 1.打开历史需求的索引行 2.顺着侧边栏进入 | 历史记录仍可访问（按规范保留，不回改已完成文档） | P2 | [既有行为回归](/requirements/FNOS-024-codebuddy-403-failover) |

### [FNOS-025-03 仓库不再追踪插件源码](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 版本管理的文件集合中查不到该目录 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 变更已提交 | 1.列出该目录下受版本管理的文件 | 结果为空 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-011 | [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 本机源码完整保留 | [AC-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 变更已提交 | 1.列出该目录内容 2.读取插件清单 | 源码、清单、配置与测试均在，可读可构建 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-012 | [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 干净检出下冻结安装通过 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 可移动该目录 | 1.把插件目录移出工作区 2.执行冻结锁文件安装 3.执行全量检查 4.恢复目录 | 安装与全量检查均通过，锁文件无漂移 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |

### [FNOS-025-04 发布链路不再包含该插件](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 版本维护的插件列表不含该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 工作区干净 | 1.执行版本维护命令 2.观察输出与提交内容 | 输出只含其余插件；该插件的清单版本号未被改动 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-014 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 发布候选列表不含该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 工作区干净 | 1.读取插件发现结果 2.核对候选列表 | 候选列表里没有该插件 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-015 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 插件市场索引不含该插件 | [AC-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 上游生成器可用 | 1.从源列表移除该包后重新生成索引 2.核对索引条目 | 索引条目与源列表一致，不含该插件 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-016 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 索引守卫与源列表联动 | [AC-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 索引已更新 | 1.执行市场索引守卫用例 | 用例按源列表核对条目数量与成员，通过 | P1 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |

### [FNOS-025-05 升级后清理老用户环境残留](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-017 | [FNOS-025-05](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 孤儿自有插件清理机制仍生效 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 安装回调的清理步骤可用 | 1.构造「清单里已无该插件、profile 里仍有」的现场 2.执行安装回调 | 该插件被一次性移除，其余插件不受影响 | P0 | [既有行为回归](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |
| TC-018 | [FNOS-025-05](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 真实 NAS 升级后插件管理器无该插件 | [AC-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 真实 fnOS NAS 上已装旧版本且装过该插件 | 1.通过应用中心升级到本构建 2.打开插件管理器 3.核对其它插件与凭据 | 该插件被清理；其它插件与凭据、会话、工作区不受影响 | P0 | [新增行为，无回归基线](/plans/PLAN-FNOS-025-codebuddy-plugin-delisting) |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 构建产物 | 通过 | 2026-10-22 | 应用版本 5.9.0-0.2.1-rc.2.13 / DSH 0.2.1-rc.2；清单 4 项（3 个自有插件 + 三方 dshmarket） |
| TC-002 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 构建产物 | 通过 | 2026-10-22 | 内置守卫改为反向断言后构建通过，不再要求内置该插件 |
| TC-003 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 构建产物 | 通过 | 2026-10-22 | 解包 FPK 内的应用归档核对发布清单，无该插件 |
| TC-004 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 构建产物 | 通过 | 2026-10-22 | 应用介绍文案的内置插件清单与发布清单一致 |
| TC-005 | [FNOS-025-01](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-01) | 真实 fnOS NAS | 未执行 | — | 需真实 NAS 环境执行安装验收，本轮未执行 |
| TC-006 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档站构建环境 | 通过 | 2026-10-22 | 文档构建完成，无死链报错 |
| TC-007 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档站构建环境 | 通过 | 2026-10-22 | 插件总览 5 行、侧边栏无该条目、原专页文件已删除 |
| TC-008 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档站构建环境 | 通过 | 2026-10-22 | 现行文档中的插件数量断言已统一为 5 |
| TC-009 | [FNOS-025-02](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-02) | 文档站构建环境 | 通过 | 2026-10-22 | 历史需求索引行与侧边栏条目保留，可达 |
| TC-010 | [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 仓库工具链 | 通过 | 2026-10-22 | 版本管理的文件集合中该目录为 0 条；仓库仅保留历史快照 |
| TC-011 | [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 仓库工具链 | 通过 | 2026-10-22 | 本机源码、清单、配置与测试完整保留，可读可构建 |
| TC-012 | [FNOS-025-03](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-03) | 仓库工具链 | 通过 | 2026-10-22 | 插件目录移出后冻结安装与全量检查（25 任务）均通过，锁文件无漂移 |
| TC-013 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 仓库工具链 | 通过 | 2026-10-22 | 版本维护输出 5 个插件；该插件清单版本号保持不变，未被一起升版本 |
| TC-014 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 仓库工具链 | 通过 | 2026-10-22 | 插件发现结果排除该目录，发布候选列表不含它 |
| TC-015 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 仓库工具链 | 通过 | 2026-10-22 | 索引重新生成后为 5 个插件，无该插件条目 |
| TC-016 | [FNOS-025-04](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-04) | 仓库工具链 | 通过 | 2026-10-22 | 守卫用例改为与源列表核对，不再写死数量 |
| TC-017 | [FNOS-025-05](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 仓库工具链 | 通过 | 2026-10-22 | 孤儿自有插件清理的既有用例全绿；机制无需新增代码 |
| TC-018 | [FNOS-025-05](/requirements/FNOS-025-codebuddy-plugin-delisting#fnos-025-05) | 真实 fnOS NAS | 未执行 | — | 需真实 NAS 上从旧版本升级验收，本轮未执行 |

## Bug 记录

本轮未产出缺陷。

## 测试结论

- **结论**：部分通过（遗留风险已列出）。
- 执行用例总数 18 条，通过 16 条，失败 0 条，未执行 2 条，遗留 Bug 0 个。
- 一句话结论：下架在分发清单、文档站、仓库追踪与发布链路四条链路上均已验证生效，仅剩真实 NAS 上的安装与升级验收未执行。

### 遗留风险

1. **真实 NAS 安装与升级验收未执行**（TC-005、TC-018）：本地已验证包内清单与守卫，但「安装后插件管理器里确实没有该插件」「老用户升级后残留确实被清理」需要在真实 fnOS 上确认。清理机制是既有实现，路径与本仓库其它插件出清单时相同，但结论仍以真机为准。
2. **已发布到 npm 的包未做下架**：`@tnnevol/dsh-codebuddy` 在 npm 上仍可安装。仓库与文档不再推荐和分发它，但用户手动安装仍会遭遇上游拦截。这是本需求范围外的选择，已在需求文档的「不在本次范围内」登记。
3. **历史验收资产过期**：`packages/dsh-e2e-desktop` 下两份以该插件为载体的桌面端验收用例已无法执行，需改用其它插件承载或归档。该项不在本需求的处理范围内，已单独记录待后续决定。
4. **网关 `/codebuddy` 通道保留**：仍持有该插件的用户（手动安装或升级窗口期）不至于静默失效；代价是网关里保留了一条指向已下架插件的路径。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-22 | 建立 FNOS-025 测试用例文档 | 登记 18 条用例，覆盖分发清单、文档站、仓库追踪、发布链路与升级清理五条链路；执行 16 条全部通过，真实 NAS 安装与升级验收 2 条待执行。 |
