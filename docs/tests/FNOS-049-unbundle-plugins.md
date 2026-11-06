---
id: FNOS-049
title: FNOS-049 测试用例
description: 把 Codex Auth 与 Failover Search 移出 FPK 内置清单的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-049-unbundle-plugins
plan: /plans/PLAN-FNOS-049-unbundle-plugins
status: 通过
lastVerified: 2026-11-06
verifiedAt: 2026-11-06
---

# FNOS-049 测试用例

被测对象是 FPK 的插件内置清单、内置白名单门禁，以及两个插件在「不再内置」后的可安装性与升级行为。需求见 [FNOS-049](/requirements/FNOS-049-unbundle-plugins)，执行任务见 [PLAN-FNOS-049](/plans/PLAN-FNOS-049-unbundle-plugins)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-049-01](/requirements/FNOS-049-unbundle-plugins#fnos-049-01-移出内置清单) | 移出内置清单 | 清单改了白名单没改会让构建失败；白名单清空后误把其它插件放进清单也会失败 |
| [FNOS-049-02](/requirements/FNOS-049-unbundle-plugins#fnos-049-02-保留可安装性) | 保留可安装性 | 「不内置」被误做成「不发布」，用户无从安装 |
| [FNOS-049-03](/requirements/FNOS-049-unbundle-plugins#fnos-049-03-升级不误动) | 升级不误动 | 老用户升级后插件被卸载、凭据丢失 |
| [FNOS-049-04](/requirements/FNOS-049-unbundle-plugins#fnos-049-04-构建门禁一致) | 构建门禁一致 | 清单与白名单静默不一致 |

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-049-01、04 | 本地单元测试 | `pnpm --filter @tnnevol/fnos-dsh-cli run test`、`pnpm --filter @tnnevol/fnos-gateway run test` |
| FNOS-049-01 | 本地构建 | 构建 FPK 并解包核对 |
| FNOS-049-02 | npm registry 与市场索引 | 查询版本与索引条目 |
| FNOS-049-03 | 代码审阅 + 既有用例 | 安装回调只处理清单内插件 |

## 测试用例

### FNOS-049-01 移出内置清单

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-049-01](/requirements/FNOS-049-unbundle-plugins#fnos-049-01-移出内置清单) | 发布清单只含 fnos 与 dshmarket | [AC-01](/requirements/FNOS-049-unbundle-plugins#fnos-049-01-移出内置清单) | — | 读取 `published-dsh-plugins.json` | 插件为 `@tnnevol/dsh-fnos` 与 `dshmarket` 两项 | P0 | 基线：8.1.3 清单含四项 |
| TC-002 | 同上 | 必含白名单只剩 fnos | AC-01 | — | 读取 `build.ts` 常量 | `FPK_REQUIRED_BUNDLED_PLUGIN_NAMES` 只有 fnos | P0 | 基线：8.1.3 含 Codex 与 fnos |
| TC-003 | 同上 | 可选白名单清空 | AC-01 | — | 读取 `build.ts` 常量 | `FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES` 为空数组 | P0 | 基线：8.1.3 含 Failover Search |
| TC-004 | 同上 | FPK 产物不再内置两个插件 | AC-01 | 可构建 | 解包 FPK 核对清单与归档目录 | 清单两份均为两项；`bundled-dsh-plugins/` 不含这两个插件的 tgz | P0 | 基线：8.1.3 内置二者 |

### FNOS-049-02 保留可安装性

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | [FNOS-049-02](/requirements/FNOS-049-unbundle-plugins#fnos-049-02-保留可安装性) | 两个插件仍在 npm 可安装 | [AC-02](/requirements/FNOS-049-unbundle-plugins#fnos-049-02-保留可安装性) | 已发布 | 查询 registry 的 `next` 版本 | 均能取到版本，不被下架 | P0 | 新增行为，无回归基线 |
| TC-006 | 同上 | 两个插件仍在插件市场索引 | AC-02 | 索引已生成 | 读取 `docs/public/plugins/market/index.json` | 七项俱全，含这两个插件 | P1 | 基线：8.1.3 索引含七项 |

### FNOS-049-03 升级不误动

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-049-03](/requirements/FNOS-049-unbundle-plugins#fnos-049-03-升级不误动) | 安装回调不会卸载清单外插件 | [AC-03](/requirements/FNOS-049-unbundle-plugins#fnos-049-03-升级不误动) | — | 审阅安装回调的插件遍历逻辑 + 跑既有用例 | 只对清单内条目执行安装/收敛，清单外插件不出现 `remove` | P0 | 基线：[FNOS-004](/requirements/FNOS-004-dsh-015-rc2-adaptation) 安装回调语义 |
| TC-008 | 同上 | 凭据文件不被触碰 | AC-03 | — | 审阅安装回调对 DSH_HOME 的写操作 | 只清理可重建产物（lockfile、node_modules），不碰凭据 | P0 | 基线：FNOS-009-12 重建逻辑 |

### FNOS-049-04 构建门禁一致

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | [FNOS-049-04](/requirements/FNOS-049-unbundle-plugins#fnos-049-04-构建门禁一致) | 清单出现未登记插件时构建报错 | [AC-04](/requirements/FNOS-049-unbundle-plugins#fnos-049-04-构建门禁一致) | — | 审阅校验逻辑 | 报错并点名该插件与两个白名单常量 | P1 | 基线：8.1.3 允许清单机制 |
| TC-010 | 同上 | 基线测试跟随新清单 | AC-04 | — | 跑 CLI 测试 | 清单项数断言为 2，只校验 fnos 版本对齐 | P0 | 基线：8.1.3 断言 4 项 |

## 测试执行结果

执行时间 2026-11-06，环境：本机单元测试、FPK 构建与解包、npm registry 查询。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-049-01 | 文件核对 | 通过 | 2026-11-06 | 清单为 `@tnnevol/dsh-fnos` 与 `dshmarket` |
| TC-002 | FNOS-049-01 | 源码核对 | 通过 | 2026-11-06 | 必含白名单只剩 `@tnnevol/dsh-fnos` |
| TC-003 | FNOS-049-01 | 源码核对 | 通过 | 2026-11-06 | 可选白名单为空数组 |
| TC-004 | FNOS-049-01 | FPK 构建 | 通过 | 2026-11-06 | 构建产物核对见备注：两处清单均只含 fnos 与 dshmarket，归档目录无这两个插件 |
| TC-005 | FNOS-049-02 | npm registry | 通过 | 2026-11-06 | 两个插件仍在 registry，`next` 可取到版本 |
| TC-006 | FNOS-049-02 | 索引文件 | 通过 | 2026-11-06 | 市场索引仍为七项，含这两个插件 |
| TC-007 | FNOS-049-03 | 单元测试 | 通过 | 2026-11-06 | gateway 179 条用例全通过，含「只移除清单外悬空引用」的既有覆盖 |
| TC-008 | FNOS-049-03 | 源码审阅 | 通过 | 2026-11-06 | 重建只 `pnpm clean --lockfile` 与重装，凭据在 DSH_HOME 其它路径 |
| TC-009 | FNOS-049-04 | 源码审阅 | 通过 | 2026-11-06 | 未登记内置插件会 `throw` 并点名 |
| TC-010 | FNOS-049-04 | 单元测试 | 通过 | 2026-11-06 | CLI 161 条用例全通过 |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 本轮未发现缺陷 | — | — | — |

## 测试结论

**结论：通过。** 10 条用例全部通过（0 失败 / 0 阻塞 / 0 未执行）。

覆盖情况：

- [FNOS-049-01](/requirements/FNOS-049-unbundle-plugins#fnos-049-01-移出内置清单) 至 [FNOS-049-04](/requirements/FNOS-049-unbundle-plugins#fnos-049-04-构建门禁一致) 四个功能点与 [AC-01](/requirements/FNOS-049-unbundle-plugins#fnos-049-01-移出内置清单) 至 [AC-04](/requirements/FNOS-049-unbundle-plugins#fnos-049-04-构建门禁一致) 四条验收条件均有对应用例。
- 关键判断已验证：两个插件源码均无 `settingsNamespace` 引用，内置当年的技术前提不复存在。

遗留风险：

1. **未做真实 NAS 升级验证**：升级后不卸载清单外插件这一点由代码语义与既有用例保证，但未在真机走一次「已装两插件 → 升级到 8.1.4」的路径。涉及用户数据保留的事项，建议在真机升级时确认。
2. **用户感知变化**：新装用户不再自动获得 Codex Auth 与 Failover Search，需要在插件市场自行安装。应用文档已给出安装命令，但属于对用户的可见变化，应写入发版说明。
