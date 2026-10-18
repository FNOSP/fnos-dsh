---
id: PLAN-FNOS-015
title: PLAN-FNOS-015 主题缓存写入死循环修复
description: 实施 FNOS-015，修复 fnOS 插件主题缓存写入的自持循环（issue #13）：按宿主 revision 收敛写入抑制、对 unset 不生效做一次性降级，并保证主题缓存与首屏防闪在新旧运行时上都可用。
status: in_progress
owner: tnnevol
planDate: 2026-10-18
targetVersion: 5.8.0
lastVerified: 2026-10-18
---

# PLAN-FNOS-015 主题缓存写入死循环修复

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-015 |
| 计划日期 | 2026-10-18 |
| 对应需求 | [FNOS-015 主题缓存写入死循环修复](/requirements/FNOS-015-theme-cache-write-loop) |
| 本轮功能 | FNOS-015-01 至 FNOS-015-05 |
| 实施前置 | [PLAN-FNOS-014](/plans/PLAN-FNOS-014-dsh-021-rc2-adaptation)（含 FNOS-014-15 的 `ConfigFormSnapshot.mode` 适配） |
| 计划状态 | <Badge type="warning" text="阶段一完成；阶段二/三目标环境验收待执行" /> |

## 计划目标

消除 `theme-persistence.sync()` 的自持写入循环，同时保住主题缓存这条优化的全部价值（首屏防闪、主题变化后更新、显式偏好下不注入旧缓存）。修复在 DSH `0.2.0-rc.2` 与 `0.2.1-rc.2` 上都成立。

**排期约束（用户指定）**：本计划的实施排在 [PLAN-FNOS-014](/plans/PLAN-FNOS-014-dsh-021-rc2-adaptation) 之后。两者存在交付耦合：FNOS-014-15 恢复写入门槛后，issue #13 的循环会重新暴露，因此 FNOS-014-15 落地时必须**同时带上本计划 T01-03 的最小守卫**（或与 T01-03 同批次发布），不允许"先恢复写入、后修循环"的中间态进入用户版本。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 写入抑制 | `sync()` 用 `pendingOperation` + `lastRequestedOperation` 两个标记；`current === target` 时清后者、写入 reject 时也清后者 | 抑制以「**宿主 revision 已超过本次写入返回的 revision**」为解除条件，并叠加最小重发间隔；不再用「快照值是否等于目标」作为唯一解除依据 | 仅改写入时序；`set`/`unset` 调用面不变 |
| unset 不生效 | 只要快照里字段还在，就每轮重发 unset（unset 被宿主转换成 `set: inherited` 时永远收敛不了） | 首次 unset 后若下一份宿主视图仍返回原值，把该字段标记为**本次会话不可写**，停止回写并记录调试日志 | 缓存可能长期缺失（允许），但不再产生风暴 |
| 新运行时门槛 | `snapshot.mode !== 'host'` 判定；`0.2.1-rc.2` 移除 `mode` 后恒真 → 一次都不写 | 门槛改按新 API 表达（`status === 'ready'` 且 `writable`），由 [FNOS-014-15](/requirements/FNOS-014-dsh-021-rc2-adaptation) 落地（工作区已落地，写入已恢复）；本计划负责在其之上保证写入收敛 | 与 FNOS-014 有先后耦合：**写入恢复即重新具备 #13 的复现条件** |
| 首屏注入 | 宿主读 `config.systemTheme` 注入 bootstrap（`injectCachedFnosTheme`） | 不变 | 无 |

## 影响范围分析

| 需求功能 | 代码模块 | 配置/数据 | 测试 | 文档 | 目标环境 |
| --- | --- | --- | --- | --- | --- |
| FNOS-015-01 | `plugins/dsh-fnos-plugin/src/client/services/theme-persistence.ts` | 无（不改字段与存储位置） | 抑制收敛单测：反复通知不重复写、revision 前进后才允许重发 | — | DSH Web、DSH Desktop |
| FNOS-015-02 | 同上 | 会话内不可写标记（内存态，不持久化） | 降级单测：unset 后视图仍返回原值 → 只写一次且后续不再写 | 排错文档补充该降级说明 | DSH Web、DSH Desktop |
| FNOS-015-03 | `theme-persistence.ts`、`host/theme-bootstrap.ts`（只读消费） | `dsh-fnos.systemTheme`（写入时机变化，语义不变） | 主题变化必须写、显式偏好必须清、首屏注入回归 | 插件文档如涉及主题缓存说明则更新 | DSH Web + 真实 fnOS NAS |
| FNOS-015-04 | 无需代码改动（随 01 收敛） | 无 | 20 秒窗口请求量与 DOM 变更量测 | — | DSH Web、DSH Desktop |
| FNOS-015-05 | `theme-persistence.ts` 的门槛表达式（与 FNOS-014-15 协同） | 无 | 新运行时上写入恢复且不复发 | — | DSH Web、DSH Desktop |

不涉及：fnOS 网关、FPK 与安装脚本、DSH 官方源码、其它插件的重渲染实现、凭据与授权目录数据。

## 分阶段任务

### 阶段一：修复与本地验证（T01-01–T01-04）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-015-T01-01 | FNOS-015-01 / AC-01、AC-02 | 复现与埋点：在本地 DSH Web 上构造「unset 不收敛」的宿主响应（可注入的 scope 桩），用时间线记录 `sync()` 调用与写入次数，作为修复前后对照基线 | 无 | 复现脚本产出写入次数≥N 的时间线（存 `tmp/`），修复后归零 |
| PLAN-FNOS-015-T01-02 | FNOS-015-01 / AC-02 | 抑制收敛：把解除条件改为「宿主 revision 已超过本次写入返回的 revision」，写入期间与最小间隔内不重发；保留「目标值真实变化必须能写」的通路 | T01-01 | 单测：连续 20 次通知只写 1 次；revision 前进后才允许下一次；目标变化立即允许 |
| PLAN-FNOS-015-T01-03 | FNOS-015-02 / AC-01、AC-02 | unset 降级：首次 unset 后若下一份宿主视图仍返回原值，标记该字段本次会话不可写；降级不阻塞其它字段写入与主题跟随；输出可诊断调试日志 | T01-02 | 单测：降级后不再写；其它字段仍可写；日志可断言 |
| PLAN-FNOS-015-T01-04 | FNOS-015-03 / AC-01～AC-03 | 语义回归保障：主题 light↔dark 变化必须写入；偏好 system→显式 light/dark 必须清除缓存；显式偏好下不使用 fnOS 缓存 | T01-02 | 单测三态 + 本地 Web 走查（含清缓存后首屏主题核对） |

### 阶段二：与 FNOS-014 的协同（T02-01）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-015-T02-01 | FNOS-015-05 / AC-01、AC-02 | 与新运行时写入门槛协同：确认 FNOS-014-15 落地后的门槛表达式在本计划口径下仍收敛；若 FNOS-014 先发布，确保其携带 T01-03 的最小守卫（不允许中间态带循环上线） | [PLAN-FNOS-014](/plans/PLAN-FNOS-014-dsh-021-rc2-adaptation) 相关任务完成 | 新运行时上写入恢复且 20 秒窗口无重复写；发布批次核对 |

### 阶段三：目标环境验收（T03-01）

| 任务 ID | 对应需求/验收 | 修改内容 | 前置条件 | 验证方式 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-015-T03-01 | FNOS-015-01、03、04 全部 AC | 真机复测：按 issue #13 的方法在 DSH Web 与真实 fnOS NAS 上量化（20 秒窗口的 mutate/describe/credentials/modelCatalog 次数与 DOM 变更），核对首屏防闪与主题跟随 | 阶段一、二完成 | 证据登记 `docs/validation/`；与 issue #13 的报告值逐项对照 |

## 交互和行为设计

本次不改变任何用户可见交互与界面结构；用户可观察的变化是**症状消失**：

- 打开 DSH Web 后不再整页周期性重渲染，模型选择器不再持续「正在刷新模型列表」。
- 首屏主题行为与升级前一致：跟随系统时按 fnOS 主题渲染、不闪；显式 light/dark 时按 DSH 偏好渲染。
- 主题缓存若因宿主不收敛而长期缺失，仅表现为「首屏可能闪一次」，不出现错误主题，也不产生任何循环。

## 数据、权限和错误处理

- 不新增持久化：降级标记只存在于客户端内存（会话级），刷新后重新评估。
- 不触碰用户数据：凭据、授权目录、其它设置字段的写入路径不变。
- 错误处置：写入被拒（`ok:false`）走既有 `recover()` 恢复读；传输失败（reject）不立即重试，进入最小间隔后再评估；上述两种失败都不得形成重试风暴。
- 权限不变：仍只写插件自有命名空间 `dsh-fnos` 的自有字段。

## 依赖、风险和决策

| 项 | 内容 | 应对 |
| --- | --- | --- |
| 依赖：FNOS-014-15 的 `ConfigFormSnapshot.mode` 适配 | 新运行时上当前门槛恒真（不写），必须由 FNOS-014 适配后才谈得上"写入收敛" | T02-01 核对交付批次；中间态必须带最小守卫 |
| 风险：抑制过强导致主题变化后不写缓存 | 首屏退回「可能闪一次」而非错误主题 | T01-04 单测强制「主题变化必须写」；真机 T03-01 复核 |
| 风险：抑制过松仍偶发重复写 | 只影响性能，不影响正确性 | T01-02 单测用 20 次连续通知断言只写 1 次 |
| 风险：降级误判（宿主只是暂时未收敛） | 会话内不再回写，刷新后重试 | 降级只影响缓存优化；日志可诊断；不使用持久化标记 |
| 决策：不采用"永不 unset、读取时忽略旧缓存"方案 | 该方案改动更小，但依赖宿主注入侧同步改读取逻辑，跨版本回归面更大 | 保留 unset 通路 + 失败降级，语义与现状一致 |
| 决策：不引入定时器/轮询 | 修复方向是收敛条件，不是节流 | T01-02 代码审查项 |
| 回滚 | 回退 `theme-persistence.ts` 到修复前版本；本改动无数据迁移，回退不丢用户数据（循环会恢复，故回滚需同时回退 FNOS-014-15 的写入门槛或保留最小守卫） | 单插件回退 |

## 测试、打包、发布和回滚

- 包级：`dsh-fnos` typecheck、单测（抑制收敛、unset 降级、三态语义回归）、构建。
- DSH Web：`pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`）本地走查主题跟随与首屏；用 Performance API 量化写入次数。
- DSH Desktop：项目 `.dsh/profiles/desktop`（按[测试用例文档规范](/charter/tests-spec#dsh-desktop-测试)）。
- 真实 NAS：安装 FPK 后在设备上复测首屏注入与主题跟随，日志与量化数据登记 `docs/validation/`。
- 回滚：见上表"回滚"行；发布前确认同一批次包含 FNOS-014-15 的门槛适配与本计划的守卫，避免带循环上线。

## 参考资料

- issue：[FNOSP/fnos-dsh#13](https://github.com/FNOSP/fnos-dsh/issues/13)
- 需求调研结论：[FNOS-015 调研结论](/requirements/FNOS-015-theme-cache-write-loop#调研结论)
- 现有实现：`plugins/dsh-fnos-plugin/src/client/services/theme-persistence.ts`、`theme-controller.ts`、`theme-bridge.ts`
- 首屏注入：`plugins/dsh-fnos-plugin/src/host/theme-bootstrap.ts`
- 上游两个 tag 的差异核实：`git diff dsh-v0.2.0-rc.2..dsh-v0.2.1-rc.2`（`packages/settings/settings/src/index.ts`、`packages/client/ui-settings/src/client/`）——宿主 unset/revision 逻辑未变，`ConfigFormSnapshot.mode` 被移除
- 复现/仿真脚本（本地证据，git 忽略）：`tmp/issue13/loop-sim.mjs`、`tmp/issue13/loop-sim2.mjs`

## 完成状态

| 阶段 | 状态 |
| --- | --- |
| 阶段一：修复与本地验证 | <Badge type="tip" text="已完成" /> |
| 阶段二：与 FNOS-014 的协同 | <Badge type="info" text="规划中" /> |
| 阶段三：目标环境验收 | <Badge type="info" text="规划中" /> |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-18 | 初始计划 | 建立 PLAN-FNOS-015，三阶段五个任务；按用户指定排在 PLAN-FNOS-014 之后实施，并写明两者交付耦合（FNOS-014-15 恢复写入门槛时必须携带最小守卫）。根因链、0.2.1-rc.2 差异与量化验收口径已在需求调研结论核实。 |
| 2026-10-18 | 阶段一完成 | T01-01 复现脚本落地（`tmp/issue13/repro-reject.ts`），并核实历史 `loop-sim.mjs` 三场景基线（reject 才放大、成功但值不变已被抑制）；T01-02 抑制改为 revision 收敛 + 在途抑制 + 最小间隔；T01-03 reject / false / 同步抛错统一降级为「本次会话不可写」并输出调试日志；T01-04 单测覆盖主题变化必写、显式偏好必清、同值不重写。fnos 插件 230 条用例全绿。阶段二衔接 FNOS-014-15 的门槛已确立（该门槛已恢复写入，本修复即其配套守卫）。FPK 已本地编译（5.9.0，插件内置形态）供手动验证。 |
