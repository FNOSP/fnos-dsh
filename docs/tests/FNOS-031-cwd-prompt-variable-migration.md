---
id: FNOS-031
title: FNOS-031 测试用例
description: FNOS-031 升级迁移 cwd 提示词变量引用的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-031-cwd-prompt-variable-migration
plan: /plans/PLAN-FNOS-031-cwd-prompt-variable-migration
status: 部分通过
lastVerified: 2026-10-26
verifiedAt: 2026-10-26
---

# FNOS-031 测试用例

## 测试范围与需求分析

被测对象是升级回调新增的 profile 迁移步骤：`install-callback-helper` 的 `migrate-cwd-prompt-variable` 子命令，以及 `install_callback` 对它的调用。执行任务与阶段见 [PLAN-FNOS-031](/plans/PLAN-FNOS-031-cwd-prompt-variable-migration)，覆盖[需求功能](/requirements/FNOS-031-cwd-prompt-variable-migration#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-031-01](/requirements/FNOS-031-cwd-prompt-variable-migration#fnos-031-01) 升级后可以直接发消息 | 移除的是子句还是只删变量名（只删变量名会留下残句）；是否误伤同字段其它文本；是否破坏 YAML 结构 |
| [FNOS-031-02](/requirements/FNOS-031-cwd-prompt-variable-migration#fnos-031-02) 迁移过程可见且可回溯 | 备份内容是否等于原文；未命中时是否真的零改动（内容与 mtime）；重复执行是否重复写备份 |

❓ 资料缺口：用户 profile 的真实布局不可穷举（自定义 patch 结构、块标量、单双引号混用）。实现按「解析不出即跳过并告警」处理，用例只覆盖已知形态；未知形态的兜底是「不改动」而非猜测改写。

## 测试环境

| 功能 | 目标环境 | 说明 |
| --- | --- | --- |
| FNOS-031-01 | 包级测试 ＋ 真实 fnOS NAS（升级路径） | 迁移逻辑可包级断言；「发消息能得到回复」必须在真机确认 |
| FNOS-031-02 | 包级测试 ＋ 真实 fnOS NAS | 备份与幂等可包级断言；升级日志与零改动需真机核对 |

包级测试环境：网关仓库工作区，`pnpm --filter @tnnevol/fnos-gateway run check`。

## 测试用例

### FNOS-031-01 升级后可以直接发消息

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-001 | FNOS-031-01-AC-03 | 对 `Your working directory is <code v-pre>{{cwd}}</code>. Always answer in Chinese. Be concise.` 执行移除 | 移除 1 处；结果等于 `Always answer in Chinese. Be concise.`（整句移除，不留残句） | 包级 |
| TC-002 | FNOS-031-01-AC-03 | 三行文本中间一行含该变量，且同字段另有其它提示词变量引用 | 只移除目标子句；其余文本与其它变量引用逐字保留 | 包级 |
| TC-003 | FNOS-031-01-AC-03 | YAML 单引号包裹的 `personaSuffix` 命中 | 引号成对、`personaSuffix: 'Reply briefly.'` 结构完整 | 包级 |
| TC-004 | FNOS-031-01-AC-03 | 字段值只有目标子句 | 清空字段值（`personaSuffix: ''`），不留 `Your working directory is .` 残句 | 包级 |
| TC-005 | FNOS-031-01-AC-03 | `package.json` 的 persona 字段命中，其余字段含依赖与非目标配置 | 只改 persona 值；字段顺序、缩进、其余内容逐字不变 | 包级 |
| TC-006 | FNOS-031-01-AC-01 | 真实 NAS 上构造含该变量的 profile，升级后发送一条消息 | 得到模型回复，不再静默无响应 | 真实 fnOS NAS |

### FNOS-031-02 迁移过程可见且可回溯

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-007 | FNOS-031-02-AC-01 | 命中并改写后检查目录 | 存在 `cordis.patch.yml.fnos-migrate.bak-<时间戳>`，内容等于改写前原文 | 包级 |
| TC-008 | FNOS-031-02-AC-02 | 对不含该变量的 profile 执行迁移 | 内容不变、mtime 不变、不产生备份文件 | 包级 |
| TC-009 | FNOS-031-02-AC-03 | 同一 profile 连续执行两次 | 第二次 `rewritten=0`；内容不变；备份数量不增加 | 包级 |
| TC-010 | 全部 | `package.json` 内容损坏（非合法 JSON），同目录另有命中文件 | 损坏文件被跳过并记录告警，保持原样；另一个文件仍被迁移 | 包级 |
| TC-011 | FNOS-031-01-AC-02 | profile 目录不存在或两个候选文件都不存在 | 不报错，`rewritten=0`，安装流程继续 | 包级 |
| TC-012 | FNOS-031-01-AC-02 | 真实 NAS 升级后查应用日志 | 出现迁移步骤日志行（命中则含移除数量，未命中则「未发现引用」），安装未因此失败 | 真实 fnOS NAS |
| TC-013 | FNOS-031-02-AC-02 | 真实 NAS 升级前后对比 profile 文件 | 不含该变量的 profile 内容与 mtime 均未变化，且无新增备份文件 | 真实 fnOS NAS |

## 执行结果

### 包级

| ID | 结果 | 备注 |
| --- | --- | --- |
| TC-001 | 通过 | `cwd-migration.spec.ts`「FNOS-031-01-AC-03: 移除整句并保留同字段的其余文本」 |
| TC-002 | 通过 | 同名 spec「PLAN-FNOS-031-T02-02: 多行文本只移除目标子句，其它变量引用与文本逐字保留」 |
| TC-003 | 通过 | 同名 spec「不破坏 YAML 单引号结构（实测缺陷回归）」 |
| TC-004 | 通过 | 同名 spec「整段只有目标子句时清空字段值而不留残句」 |
| TC-005 | 通过 | 同名 spec「PLAN-FNOS-031-T02-02: package.json 只改 persona 值，其余字段与格式逐字保留」 |
| TC-007 | 通过 | 同名 spec「FNOS-031-02-AC-01: 改写前写带时间戳备份，内容等于原文」 |
| TC-008 | 通过 | 同名 spec「FNOS-031-02-AC-02: 未命中时不改内容、不改 mtime、不写备份」 |
| TC-009 | 通过 | 同名 spec「FNOS-031-02-AC-03: 幂等——二次执行不再改动、不新增备份」 |
| TC-010 | 通过 | 同名 spec「损坏的 JSON 只告警并跳过，不影响其它文件与调用方」 |
| TC-011 | 通过 | 同名 spec「文件缺失时不报错」 |

包级汇总：`pnpm --filter @tnnevol/fnos-gateway run check` 通过（24 个测试文件、**147 条用例全绿**，其中本需求新增 15 条）；`build` 通过；ESLint 无报错。

### 真实 fnOS NAS

| ID | 结果 | 备注 |
| --- | --- | --- |
| TC-006 | 待执行 | 见下方「真机验收口径说明」 |
| TC-012 | 待执行 | 待 v6.0.3 构建安装后核对应用日志 |
| TC-013 | 待执行 | 待 v6.0.3 构建安装前后对比 |

### 真机验收口径说明

计划 T03-01 原写「在真实 NAS 构造含该变量的 profile」，与本仓库[测试规范的 SSH 禁令](/charter/tests-spec)冲突：向测试设备写入构造的 profile 属于「改配置/手工灌数据」，禁止通过 SSH 实施。因此真机侧的可行范围是：

- **可做**：安装 v6.0.3 构建，核对升级回调确实执行了迁移步骤、日志有记录、未命中的 profile 零改动（TC-012、TC-013）。
- **不可做**：在真机上凭空构造「含该变量的 profile」再复现静默失败——这需要改写测试设备的用户数据。
- **替代覆盖**：移除路径由包级 15 条用例覆盖（含多行、其它变量、YAML 结构、JSON 保真、幂等、备份、损坏文件）。

## Bug 记录

| ID | 描述 | 状态 |
| --- | --- | --- |
| BUG-01 | 实现初版按句末标点切除子句，会吞掉 YAML 包裹引号，产出 `Reply briefly.'` 这类不成对引号，使 profile 变成非法 YAML | 已修复（保护行首结构前缀与引号；TC-003 回归覆盖） |
| BUG-02 | 字段值被删空时留下空行，YAML 出现多余空行 | 已修复（删空即整行移除；TC-004 覆盖） |

## 测试结论

包级 15 条用例全部通过，覆盖命中改写、文本保真、YAML 结构保护、`package.json` 格式保真、备份内容、未命中零改动、幂等、损坏文件与目录缺失。

真实 fnOS NAS 侧 3 条待执行（TC-006、TC-012、TC-013），阻塞点是**需要安装 v6.0.3 构建**；其中 TC-006 受 SSH 禁令限制无法在真机凭空构造命中场景，改由包级用例覆盖移除路径，真机只验证「升级回调执行了迁移且未破坏 profile」。

结论：**实现与包级验证完成**；真机验收待 v6.0.3 构建安装后回填。
