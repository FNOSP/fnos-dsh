---
id: FNOS-050
title: FNOS-050 测试用例
description: fnOS 插件「依赖修复」的用例设计、执行结果与问题记录。
requirement: /requirements/FNOS-050-dependency-repair
plan: /plans/PLAN-FNOS-050-dependency-repair
status: 部分通过

lastVerified: 2026-11-09
verifiedAt: 2026-11-09
---

# FNOS-050 测试用例

被测对象是 fnOS 插件详情页的「依赖修复」卡片：环境推导、只读诊断、三步修复与安全边界。需求见 [FNOS-050](/requirements/FNOS-050-dependency-repair)，执行任务见 [PLAN-FNOS-050](/plans/PLAN-FNOS-050-dependency-repair)。

## 测试范围与需求分析

| 编号 | 功能 | 关键风险点 |
| --- | --- | --- |
| [FNOS-050-01](/requirements/FNOS-050-dependency-repair#fnos-050-01-入口与用途说明) | 入口与用途说明 | tip 只说用途不说安全边界，用户不敢点；或只在详情页出现却没有说明何时该用 |
| [FNOS-050-02](/requirements/FNOS-050-dependency-repair#fnos-050-02-只读诊断) | 只读诊断 | 诊断过程写文件；把清单外的插件误判为失效 |
| [FNOS-050-03](/requirements/FNOS-050-dependency-repair#fnos-050-03-一键修复) | 一键修复 | 破坏性操作没有二次确认；中途失败留下更坏的状态 |
| [FNOS-050-04](/requirements/FNOS-050-dependency-repair#fnos-050-04-安全边界) | 安全边界 | 误删凭据、会话或用户自己装的插件 |

## 测试环境

| 功能 | 环境 | 说明 |
| --- | --- | --- |
| FNOS-050-01 | DSH Web 走查 + 源码断言 | 卡片与 tip 是否渲染、tip 文案是否含安全边界 |
| FNOS-050-02、04 | 单元测试 | `cd plugins/dsh-fnos-plugin && pnpm run test` |
| FNOS-050-03 | 单元测试 + 真机（待执行） | 修复属写操作，真机须走应用内界面 |

### 版本三元组

| 环境 | 记录项 | 实测值 |
| --- | --- | --- |
| 本地单元测试 | 插件版本 | `8.1.4` |
| 真实 fnOS NAS | DSH 运行基线 | `0.2.2-rc.1` |

## 测试用例

### FNOS-050-01 入口与用途说明

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-050-01](/requirements/FNOS-050-dependency-repair#fnos-050-01-入口与用途说明) | 详情页出现「依赖修复」卡片 | [AC-01](/requirements/FNOS-050-dependency-repair#fnos-050-01-入口与用途说明) | 打开本插件详情页 | 查看区块 | 授权目录之后出现依赖修复卡片 | P0 | 新增行为，无回归基线 |
| TC-002 | 同上 | 标题旁有 tip 气泡 | AC-01 | 同上 | 悬浮 info 图标 | 显示气泡，文案说明「应用内装插件失败时可试」 | P0 | 新增行为 |
| TC-003 | 同上 | tip 同时说明安全边界 | AC-01 | 同上 | 读气泡全文 | 明确「不影响凭据、会话和配置」 | P0 | 新增行为 |
| TC-004 | 同上 | 非本插件详情页不渲染 | AC-01 | 打开其他插件详情页 | 查看区块 | 不出现该卡片 | P1 | 基线：授权目录卡的 subject 过滤 |
| TC-022 | [FNOS-050-02](/requirements/FNOS-050-dependency-repair#fnos-050-02-只读诊断) | 只有一个动作按钮，没有「检查」 | AC-02 | 打开详情页 | 查看按钮区 | 只有「修复依赖」，无独立检查入口 | P0 | 新增行为 |
| TC-023 | FNOS-050-01 | 标题与 tip 图标垂直居中、间距 10px | AC-01 | 打开详情页 | 量取标题行 | 图标与文本按中线对齐，间距 10px | P1 | 实机截图反馈 |
| TC-005 | 同上 | 八语言文案齐全 | AC-01 | — | 检查各语言键数 | 均为 155 项，且含修复相关键 | P1 | 基线：[FNOS-045](/requirements/FNOS-045-app-plugin-i18n) 键集合约束 |

### FNOS-050-02 只读诊断

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-006 | [FNOS-050-02](/requirements/FNOS-050-dependency-repair#fnos-050-02-只读诊断) | 版本不匹配的条目被判 stale | [AC-02](/requirements/FNOS-050-dependency-repair#fnos-050-02-只读诊断) | 豁免 `dshmarket@1.73.5`，清单 `1.73.12` | 诊断 | 报出该条目并标注目标版本 | P0 | 新增行为 |
| TC-007 | 同上 | `\|\|` 联合残留被判 pipe-union | AC-02 | 豁免 `dsh-opencode@8.1.3 \|\| 8.1.2` | 诊断 | 报出为格式残留，与版本是否匹配无关 | P0 | 新增行为 |
| TC-008 | 同上 | 仍有效的条目不报 | AC-02 | 豁免版本与清单一致 | 诊断 | 返回空数组 | P0 | 新增行为 |
| TC-009 | 同上 | 清单外的包不判失效 | AC-02 | 豁免含清单里没有的包 | 诊断 | 不报告该包 | P0 | 新增行为 |
| TC-010 | 同上 | 诊断前后文件内容不变 | AC-02 | 真实失效 profile | 诊断前后读文件比对 | 内容完全一致 | P0 | 新增行为 |
| TC-011 | 同上 | profile 缺失时报 profile-missing | AC-02 | 指向不存在的目录 | 诊断 | `available: false`、原因 `profile-missing` | P1 | 新增行为 |
| TC-012 | 同上 | 非 fnOS 环境报 fnos-host-unavailable | AC-02 | 无 `DSH_HOME` | 诊断 | `available: false`、原因 `fnos-host-unavailable` | P1 | 新增行为 |

### FNOS-050-03 一键修复

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-050-03](/requirements/FNOS-050-dependency-repair#fnos-050-03-一键修复) | 修复前必须二次确认 | [AC-03](/requirements/FNOS-050-dependency-repair#fnos-050-03-一键修复) | 诊断出失效条目 | 点「修复依赖」 | 弹出确认框，列出三步与安全说明 | P0 | 新增行为 |
| TC-014 | 同上 | 无失效条目时点修复不重建 | AC-03 | 依赖状态健康 | 点「修复依赖」 | 报「依赖状态正常」，不执行清理与重装 | P0 | 新增行为 |
| TC-015 | 同上 | 按行精确删除，保留其余条目与排版 | AC-03 | 失效条目与有效条目混排 | 执行删除 | 只删失效行，注释与其它行不变 | P0 | 新增行为 |
| TC-016 | 同上 | 分步记录状态，前一步失败不再继续 | AC-03 | 模拟 `pnpm clean` 失败 | 执行修复 | `rebuild` 记为 failed，不再执行 reinstall | P1 | 新增行为 |
| TC-017 | 同上 | 真机修复后插件可正常安装 | AC-03 | 真实失效 profile | 应用内点修复 | 依赖重建成功，插件可安装 | P0 | 待执行（写操作，须走应用内界面） |

### FNOS-050-04 安全边界

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-018 | [FNOS-050-04](/requirements/FNOS-050-dependency-repair#fnos-050-04-安全边界) | 可重建产物守卫只认两个名字 | [AC-04](/requirements/FNOS-050-dependency-repair#fnos-050-04-安全边界) | — | 传入各类路径 | 仅 `pnpm-lock.yaml`、`node_modules` 为真 | P0 | 新增行为 |
| TC-019 | 同上 | 环境推导不编造路径 | AC-04 | 只给 `DSH_HOME` | 推导 | 只返回 profile 目录，不补 pnpm/dsh 路径 | P0 | 新增行为 |
| TC-020 | 同上 | 跨站请求被拒 | AC-04 | 伪造 `Origin` | 调两条路由 | 返回 403，不执行任何动作 | P0 | 基线：网关白名单路由的同源校验 |
| TC-021 | 同上 | 修复后凭据与会话文件不变 | AC-04 | 真实环境 | 修复前后比对哈希 | 凭据、会话、工作区文件哈希一致 | P0 | 待执行（真机） |

## 测试执行结果

执行时间 2026-11-07。本地单元测试与类型、构建、文案一致性均已执行；真机写操作用例待执行。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-050-01 | 源码断言 | 通过 | 2026-11-07 | 卡片注册于 `plugins.detail.section`，`order: 50` |
| TC-002 | FNOS-050-01 | 源码断言 | 通过 | 2026-11-07 | `DshTooltip` + `DshIconInfoCircle`，与授权目录同款 |
| TC-003 | FNOS-050-01 | 源码断言 | 通过 | 2026-11-07 | tip 文案含「不影响凭据、会话和配置」 |
| TC-004 | FNOS-050-01 | 源码断言 | 通过 | 2026-11-07 | 按 `subject.kind` 与 `pkg.name` 过滤 |
| TC-005 | FNOS-050-01 | 键数核对 | 通过 | 2026-11-09 | 八份语言文件各 155 键（移除「检查」两键后） |
| TC-022 | FNOS-050-02 | 源码断言 | 通过 | 2026-11-09 | 仅剩 `theme="solid"` 主按钮；`dependencyRepairCheck` 已从八份语言文件移除 |
| TC-023 | FNOS-050-01 | 源码断言 | 通过 | 2026-11-09 | `.dsh-fnos-authorized-card-name` 为 `display: flex` + `align-items: center` + `gap: 10px`；标题内图标 `margin: 0` |
| TC-006 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | 报出 stale 并附 `targetVersion` |
| TC-007 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | `\|\|` 判 `pipe-union` |
| TC-008 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | 一致时返回空数组 |
| TC-009 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | 清单外包不报告 |
| TC-010 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | 诊断前后文件内容逐字相同 |
| TC-011 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | `profile-missing` |
| TC-012 | FNOS-050-02 | 单元测试 | 通过 | 2026-11-07 | `fnos-host-unavailable` |
| TC-013 | FNOS-050-03 | 源码断言 | 通过 | 2026-11-07 | 修复按钮打开 `DshModal` 确认框，列出三步 |
| TC-014 | FNOS-050-03 | 源码断言 | 通过 | 2026-11-09 | 诊断为空时直接报 healthy 并 return，不调 `runDependencyRepair` |
| TC-015 | FNOS-050-03 | 单元测试 | 通过 | 2026-11-07 | 只删失效行，其余行与注释保留 |
| TC-016 | FNOS-050-03 | 源码断言 | 通过 | 2026-11-07 | 每步失败即 `return`，不继续下一步 |
| TC-017 | FNOS-050-03 | 真实 fnOS NAS | **待执行** | — | 写操作，须构建 FPK 后走应用中心安装并在界面内触发 |
| TC-018 | FNOS-050-04 | 单元测试 | 通过 | 2026-11-07 | 凭据、会话路径均判为否 |
| TC-019 | FNOS-050-04 | 单元测试 | 通过 | 2026-11-07 | 缺变量时不编造 pnpm/dsh 路径 |
| TC-020 | FNOS-050-04 | 源码断言 | 通过 | 2026-11-07 | 两条路由均先判 `trusted(req)` |
| TC-021 | FNOS-050-04 | 真实 fnOS NAS | **待执行** | — | 需与 TC-017 同批执行 |

此外全量回归：插件单元测试 **467 条通过**，`typecheck` 与 `build` 均通过。

### 真机安装与只读诊断（2026-11-09 补测）

在真实 fnOS NAS（`xiaomi-cn.fnos.net`，`TRIM_SYS_ARCH=x86`）上以应用中心「手动安装 → 从电脑上传」安装 `fn-deepseek-harness-x86-v8.1.4-dsh-0.2.2-rc.1.fpk`，补齐「8.1.4 新构建确实装上去」与只读诊断的真机证据。

| 判据 | 实测值 | 结论 |
| --- | --- | --- |
| 应用中心详情页版本 | `8.1.4`，来源「手动安装」 | 本次构建已覆盖安装 |
| DSH 运行时 `__DSH_BOOT__.release` | `0.2.2-rc.1`（commit `c59d10a`） | 运行时基线正确 |
| 客户端模块图自有插件 | 仅 `@tnnevol/dsh-fnos`、`dshmarket` | **`codex-auth`、`failover-search` 均不在图中**，证明是 8.1.4 的「移出内置」新构建 |
| 模块图条目总数 | 82 | — |
| 插件页异常 / 不兼容 | 均为 0 | 加载正常 |
| 依赖修复卡片 | 已渲染，tip、`检查`、`修复依赖` 三处齐全 | TC-001/TC-002 在真机成立 |
| 真机诊断结果 | 「依赖状态正常，无需修复」 | 见下方核对 |

对「依赖状态正常」做了独立核对，确认是正确判定而非漏报：NAS 上 `/vol2/@apphome/fn-deepseek-harness/profiles/web/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 实际只有三条干净条目（`dshmarket@1.73.12`、`@tnnevol/dsh-opencode@8.1.3`、`@tnnevol/dsh-midscene@8.1.3`），不含 `||` 联合，也不含历史上那些 `@6.0.0` 残留——它们已在本次安装的依赖重建中被收敛掉。

安装回调日志同样干净：`dsh-fnos` 走 `file:` 归档安装成功、`dshmarket@1.73.12` 因精确版本已存在被跳过（`Keeping installed dshmarket@1.73.12; exact version already matches.`），`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 出现 **0 次**。

因此 TC-006 至 TC-012 的**判定逻辑**仍以单元测试为准；本次真机得到的是「干净 profile 下不误报」这一侧的实证，故障侧（真正失效的条目）仍需构造失效现场后才能覆盖。

### 真机点击验收（2026-11-09，v8.1.6 / v8.1.7）

用户要求「点击【修复依赖】按钮检查操作是否正确」，因此给宿主侧补了日志（v8.1.6）再实测。

**v8.1.6 实测暴露缺陷（BUG-02）**：点按钮先弹确认框、确认后才诊断。日志与界面数据互相矛盾：

```
[dsh-fnos][dependency-repair] diagnose: profile=/vol2/@apphome/fn-deepseek-harness/profiles/web 豁免=3 条 清单目标=2 个 失效=0 条
```

诊断明确判出 `失效=0 条`，界面却先展示「将清理依赖」的破坏性警告。直接查诊断接口同样返回 `entries: []`。

**v8.1.7 修复后复验（通过）**：

| 观察点 | 结果 |
| --- | --- |
| 点「修复依赖」 | 直接显示「依赖状态正常，无需修复」 |
| 确认框 | **不再出现**（`confirmedModal: false`） |
| 诊断日志 | `豁免=3 条 清单目标=2 个 失效=0 条` |
| 是否调用重建接口 | **否**，仅有 1 次 `diagnose` 请求 |
| 依赖目录 | 未被清理 |

日志前缀 `[dsh-fnos][dependency-repair]` 统一，可直接 `grep` 检索，用于区分「请求没到 / 判定为健康 / 命令失败」三种情况。

### 完整重装复验（2026-11-09，v8.1.8）

为排除「只验证了升级路径」的可能，按规范重新推进版本到 **8.1.8**、重新构建 FPK，并用 Chrome MCP 走**完整安装流程**重装后再点一次按钮。

安装链路：[应用中心] → 手动安装 → 从电脑上传（注入 8.1.8 FPK）→ 未经验证应用的安全提示「同意」→ 服务配置「下一步」→ 更新中 100% → 回调完成。

| 判据 | 实测 | 结论 |
| --- | --- | --- |
| 设备内置插件包版本 | `8.1.8` | 装的是本次构建 |
| `client.js` 含 `requestRepair` | 2 处 | 修复顺序修正已进产物 |
| `index.js` 含「无失效条目，跳过重建」 | 1 处 | 路由守卫已进产物 |
| 安装回调 | `upgrade callback completed` | 走正常升级链路 |
| 客户端模块图自有插件 | `@tnnevol/dsh-fnos`、`dshmarket` | 与 8.1.5 起的清单一致 |

点击复验（健康 profile）：

| 观察点 | 实测 | BUG-02 是否复现 |
| --- | --- | --- |
| 发出的请求 | 仅 1 次 `diagnose` | **否** |
| 确认框 | 未出现 | **否** |
| 界面结果 | 「依赖状态正常，无需修复」 | 正确 |
| 新增日志 | 2 条（4 → 6） | 正常 |

直接调用修复路由（绕过界面，验证第二道防线）：

```json
POST /plugins/dsh-fnos/dependency-repair/run
→ 200 {"ok":true,"steps":[],"removed":[],"durationMs":0}
```

日志出现「无失效条目，跳过重建」，`pnpm-lock.yaml` 与 `node_modules` 均在，`repair: rebuild` / `clean 退出码` 计数为 **0** —— 健康 profile 未被重建。

**结论：BUG-02 在 8.1.8 上未复现，修复有效。**

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-02 | TC-022 | 健康 profile 点「修复依赖」也先弹破坏性确认框，确认后才告知「无需修复」 | P1 | 已修复 | 按钮改为先诊断：健康则直接报「状态正常」并返回，判出失效条目才开确认框；路由侧补第二道防线，诊断为空时不进入重建 |
| BUG-01 | TC-015 | 测试断言用 `.filter()` 掩盖了真实判定 | P2 | 已修复 | 初版断言先构造三元素期望值再用 `.filter()` 剔除 codex-auth，等于让期望值迁就实现。改为直接断言两元素，并在用例注释里说明 codex-auth 已移出清单、其豁免不归本应用维护 |

## 测试结论

**结论：部分通过。** 23 条用例中 21 条通过，2 条（TC-017、TC-021）为真机写操作用例，待构建 FPK 并在应用内验收后回填。2026-11-09 新增 TC-022（单一动作按钮）与 TC-023（标题与图标对齐），并因去掉「检查」按钮把 TC-014 的判据从「按钮禁用」改为「点修复不重建」。

覆盖情况：

- [FNOS-050-01](/requirements/FNOS-050-dependency-repair#fnos-050-01-入口与用途说明) 至 [FNOS-050-04](/requirements/FNOS-050-dependency-repair#fnos-050-04-安全边界) 四个功能点与 [AC-01](/requirements/FNOS-050-dependency-repair#fnos-050-01-入口与用途说明) 至 [AC-04](/requirements/FNOS-050-dependency-repair#fnos-050-04-安全边界) 四条验收条件均有对应用例；AC-03、AC-04 的写操作部分尚未真机验证。
- 只读性是本功能的关键安全属性，已由「诊断前后文件内容逐字相同」的用例钉住。

遗留风险：

1. **真机修复未执行**：`pnpm clean --lockfile` 与 `pnpm install` 在真实 NAS 上耗时未知，重建期间应用不可用的时长也无实测。建议按 [测试用例文档规范](/charter/tests-spec) 走一次完整验收。
2. **`pnpm clean` 的可用性依赖 pnpm 版本**：本实现按 pnpm 11.x 的 `clean --lockfile` 编写。若目标设备 pnpm 版本更低，该子命令可能不存在——失败时会记录在 `rebuild` 步骤并给出输出尾部，不会误删其它内容。
3. **故障侧现场未构造**：2026-11-09 的真机验证发生在 profile 已经干净的设备上，只证明了「无误报」。TC-006/TC-007 描述的失效条目（版本不匹配、`||` 联合）与 TC-017 的修复动作，仍需在测试 profile 内构造失效现场后用应用内界面验证。
