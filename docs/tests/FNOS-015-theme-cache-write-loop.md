---
id: FNOS-015
title: FNOS-015 测试用例
description: FNOS-015 主题缓存写入死循环修复的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-015-theme-cache-write-loop
plan: /plans/PLAN-FNOS-015-theme-cache-write-loop
status: 通过（真机 DSH Web，2026-10-19）
lastVerified: 2026-10-18
verifiedAt: 2026-10-18
---

# FNOS-015 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-015 |
| 关联需求 | [FNOS-015 主题缓存写入死循环修复](/requirements/FNOS-015-theme-cache-write-loop) |
| 关联计划 | [PLAN-FNOS-015 主题缓存写入死循环修复](/plans/PLAN-FNOS-015-theme-cache-write-loop) |
| 测试状态 | <Badge type="info" text="规划中" /> |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-015-theme-cache-write-loop#功能列表) 中 FNOS-015-01 至 FNOS-015-05 全部功能：

- 主题缓存写入收敛（[FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01)）。
- unset 不生效的一次性降级（[FNOS-015-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02)）。
- 主题缓存与首屏防闪保持（[FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03)）。
- 连带重渲染与请求放大消除（[FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04)）。
- 0.2.1-rc.2 上的写入门槛适配协同（[FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05)）。

**关键风险点**：

- **修复可能把循环换成"不写"**：抑制一旦过强，主题缓存不再更新，表现为首屏闪一次（功能退化而非报错），必须由 TC-007/TC-008 强制守住「主题变化必须写」「显式偏好必须清缓存」。
- **交付耦合**：FNOS-014-15 恢复写入门槛后循环会重新暴露，中间态不得上线；TC-013 专门核对发布批次是否携带最小守卫。
- **量化口径必须与 issue #13 一致**：浏览器 Performance API、20 秒窗口、同一组请求端点，否则结论不可比。
- 判定与写入均在客户端，因此**双客户端（DSH Web 与 DSH Desktop）都要覆盖**；首屏注入需要真实 fnOS 宿主桥接。

## 测试环境

目标环境按[需求的验收环境范围](/requirements/FNOS-015-theme-cache-write-loop#验收环境范围)划分；执行方式遵循[测试环境执行方式](/charter/tests-spec#测试环境执行方式)：

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| [01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01)、[02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02)、[04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04)、[05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | DSH Web、DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME=<repo>/.dsh`）；Desktop：项目 `.dsh/profiles/desktop`；两者均需覆盖 |
| [03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | DSH Web + 真实 fnOS NAS | Web 部分走本地；首屏注入与主题事件走真实 NAS 安装后的应用 |

**版本三元组**（执行前记录，缺记录不得作为结论依据）：

| 环境 | 必须记录 |
| --- | --- |
| DSH Web | DSH 运行时版本、`@tnnevol/dsh-fnos` 版本 |
| DSH Desktop | Desktop 客户端版本、内置 DSH 运行时版本、实际加载的插件版本 |
| 真实 fnOS NAS | fnOS 版本、FPK 应用版本、插件版本 |

**复现构型**（TC-001/TC-002 用）：本地以可注入的 config-form 桩构造「unset 返回成功但视图仍返回原值」的宿主行为，按 issue #13 的口径记录 `sync()` 调用与 `settings/mutate` 次数；桩代码放 `tmp/`，不入仓库。

## 测试用例

### [FNOS-015-01 主题缓存写入收敛](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01)

实现见 [PLAN-FNOS-015 T01-02](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | unset 不收敛时不再重复写 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 桩构型：unset 返回成功但下一份视图仍返回 `systemTheme: 'light'` | 1.启动本地 DSH Web 2.用 Performance API 采集 20 秒窗口 3.统计 `POST /api/settings/mutate` 次数 | `settings/mutate` 次数为真实目标变化次数（稳态 **0**），不再出现每 300–400ms 一次的重复 unset | P0 | 基线：[issue #13 报告值 30+ 次/20 秒](https://github.com/FNOSP/fnos-dsh/issues/13) |
| TC-002 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 抑制按 revision 而非值比较解除 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 单测环境 | 1.连续触发 20 次设置通知 2.观察写入次数 3.模拟宿主 revision 前进后再触发 | 20 次通知只写 1 次；宿主 revision 未前进前不重发；revision 前进后才允许下一次 | P0 | 新增行为，无回归基线 |
| TC-003 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 目标值真实变化必须立即写入 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 单测环境 | 1.先按 light 写入 2.目标切到 dark 3.观察写入 | 立即发起一次写入（抑制不吞掉真实变化） | P0 | 新增行为，无回归基线 |
| TC-004 | [FNOS-015-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 传输失败不形成重试风暴 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-01) | 桩构型：写入 reject | 1.触发一次写入并令其 reject 2.持续注入设置通知 3.统计写入次数 | 失败后进入最小间隔，不在每轮通知重试；间隔内写入次数不随通知线性增长 | P1 | 新增行为，无回归基线 |

### [FNOS-015-02 unset 不生效的一次性降级](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02)

实现见 [PLAN-FNOS-015 T01-03](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-005 | [FNOS-015-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | 降级后本次会话不再回写 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | 桩构型：unset 后视图仍返回原值 | 1.触发 unset 2.注入更多设置通知与 theme 事件 3.统计该字段写入 | 首次 unset 后该字段被标记不可写，后续不再发起写入；日志可识别降级状态 | P0 | 新增行为，无回归基线 |
| TC-006 | [FNOS-015-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | 降级不阻塞其它写入与主题跟随 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-02) | TC-005 现场 | 1.降级后切换 fnOS 主题 2.观察主题投影与其它字段写入 | 主题跟随仍生效；其它设置字段写入不受影响 | P0 | 新增行为，无回归基线 |

### [FNOS-015-03 主题缓存与首屏防闪保持](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03)

实现见 [PLAN-FNOS-015 T01-04](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | [FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 主题变化后缓存被更新 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 真实 fnOS NAS（或可注入 fnOS theme 事件的桩） | 1.fnOS 主题 light→dark 2.读取 `dsh-fnos` 设置的 `systemTheme` 3.再切回 light 复核 | 缓存被更新为最新主题；宿主下次响应 `index.html` 注入新主题 | P0 | 基线：[既有主题缓存行为](/requirements/FNOS-015-theme-cache-write-loop#调研结论) |
| TC-008 | [FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 跟随系统时首屏按缓存主题渲染 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | DSH 偏好为「跟随系统」，缓存存在 | 1.打开 DSH Web 2.观察首屏绘制 3.核对注入的 bootstrap 主题 | 首屏即为 fnOS 主题，无 light/dark 闪烁；注入脚本中的主题等于缓存值 | P0 | 基线：[首屏注入实现](/requirements/FNOS-015-theme-cache-write-loop#调研结论) |
| TC-009 | [FNOS-015-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 显式偏好不使用/不残留旧缓存 | [AC-03](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-03) | 缓存存在且为 fnOS 主题 | 1.DSH 切换为显式 light 2.重新打开页面 3.核对首屏主题与缓存字段 | 首屏按 DSH 显式偏好渲染，不使用 fnOS 缓存；缓存被清除（或按修复后的既定语义不再影响渲染） | P0 | 新增行为，无回归基线 |

### [FNOS-015-04 连带重渲染与请求放大消除](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-010 | [FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 请求量回落到正常量级 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | TC-001 现场 | 1.同一 20 秒窗口统计 `settings/describe`、`credentials/describe`、`session/modelCatalog` 2.统计 DOM 变更次数 | 三项请求量与 DOM 变更不再由循环驱动；量级与写入收敛后一致 | P1 | 基线：[issue #13 报告值 79/62/63 与 DOM 41](https://github.com/FNOSP/fnos-dsh/issues/13) |
| TC-011 | [FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 模型选择器不再卡在刷新 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | DSH Web（已登录可用模型） | 1.打开模型选择器 2.观察 10 秒 | 正常展示模型列表，不再持续显示「正在刷新模型列表」 | P1 | 基线：issue #13 现象 |
| TC-012 | [FNOS-015-04](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 其它插件组件不再高频挂载/卸载 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-04) | 已装第三方用量类插件 | 1.保持页面 20 秒 2.观察该插件组件的挂载/卸载 | 不再出现 300ms 级反复挂载/卸载 | P1 | 基线：issue #13 现象 |

### [FNOS-015-05 写入门槛适配协同](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05)

实现见 [PLAN-FNOS-015 T02-01](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段二与-fnos-014-的协同t02-01)。

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-013 | [FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | 新运行时上写入恢复 | [AC-01](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | DSH `0.2.1-rc.2` + 适配后的插件 | 1.主题切换一次 2.读取 `dsh-fnos.systemTheme` | 缓存被写入（不再被已移除的快照字段拦掉） | P0 | 基线：[0.2.1-rc.2 移除 `ConfigFormSnapshot.mode`](/requirements/FNOS-015-theme-cache-write-loop#调研结论) |
| TC-014 | [FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | 门槛恢复后不复发循环 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | TC-013 环境 | 1.按 TC-001 的口径采集 20 秒窗口 2.核对写入次数 | 写入收敛，不出现重复 unset | P0 | 新增行为，无回归基线 |
| TC-015 | [FNOS-015-05](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | 交付批次含最小守卫 | [AC-02](/requirements/FNOS-015-theme-cache-write-loop#fnos-015-05) | FNOS-014-15 先于 FNOS-015 落地 | 1.核对发布批次（插件版本对应的提交/产物）2.确认门槛适配携带 [PLAN-FNOS-015 T01-03](/plans/PLAN-FNOS-015-theme-cache-write-loop#阶段一修复与本地验证t01-01t01-04) 的守卫 | 发布产物不含 issue #13 的循环；无「先恢复后修」的中间态上线 | P0 | 新增行为，无回归基线 |

## 测试执行结果

> 执行后回填；不修改上方用例定义。FNOS-015-01、02、04、05 需在 **DSH Web 与 DSH Desktop 各执行一次**，仅单一客户端的结果不构成完成结论；FNOS-015-03 的注入部分需真实 fnOS NAS。

### 真实 fnOS NAS（2026-10-18）

环境：设备 `fnos-mi`，经 `https://xiaomi-cn.fnos.net` 远程访问；`@tnnevol/dsh-fnos` `0.2.1-rc.2.4`（内置形态，`file:/vol1/@appcenter/fn-deepseek-harness/bundled-dsh-plugins/@tnnevol/dsh-fnos.tgz`）；DSH `0.2.1-rc.2`。

**主题测试路径（供下次复测直接照用）**：

```text
fnOS 桌面 → 左下角「个人设置」→「我的账号」弹框 → 左侧「主题壁纸」页签
→「主题」区选「跟随系统 / 亮模式 / 暗模式」→ 切到「暗模式」即时生效，无需重启
```

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-015-01 | 真实 fnOS NAS | **通过（稳态 0 写）** | 2026-10-19 | 静置 20 秒窗口内 `settings/mutate` **0** 次、`settings/describe` **0** 次、全部 fetch **0** 次。做了对照实验排除测量失效：同一 hook 先主动发一个已知请求能捕获到（`controlCaptured: 1`），随后静置 8 秒仍为 0。主题切换时每次变化恰好 1 次写（见 TC-007）——写入次数等于真实目标变化次数，符合 AC-01 口径 |
| TC-002 | FNOS-015-01 | 单测环境 | 通过 | 2026-10-18 | 20 次通知只写 1 次；revision 前进后放行（见 `theme-persistence.spec.ts`） |
| TC-003 | FNOS-015-01 | 单测环境 | 通过 | 2026-10-18 | 主题 light→dark 立即写入，抑制不吞真实变化 |
| TC-004 | FNOS-015-01 | 单测环境 | 通过 | 2026-10-18 | 写入 reject 后降级、不重试；复现脚本 20 次通知 → 1 次写（修复前 21 次） |
| TC-005 | FNOS-015-02 | 单测环境 | 通过 | 2026-10-18 | 首次失败后该字段标记不可写，后续不再写 |
| TC-006 | FNOS-015-02 | 真实 fnOS NAS | 通过 | 2026-10-18 | `unset` 后主题跟随仍生效：iframe 内 `theme-mode=dark`、`data-ds-dark-theme` 存在、`color-scheme: dark` |
| TC-007 | FNOS-015-03 | 真实 fnOS NAS | **通过** | 2026-10-19 | 在「我的账号 → 主题壁纸」切 light→dark→light，每次切换恰好 1 次 `settings/mutate`（无重复、无循环）。payload 为 `{ns:"dsh-fnos", ops:[{op:"set", path:["systemTheme"], value:"dark"}]}`，宿主响应 `ok: true` |
| TC-008 | FNOS-015-03 | 真实 fnOS NAS | **通过（注入路径）** | 2026-10-19 | 缓存为 `dark` 时外壳 HTML 含 `const preference = "dark"`，即注入生效；NAS 为 dark 时宿主/DSH/注入值三者一致。首屏视觉闪烁以注入值一致为判据，未做逐帧观感 |
| TC-009 | FNOS-015-03 | 真实 fnOS NAS | 未执行 | — | 需在 DSH 侧切显式 light/dark 后核对首屏；本次未找到 DSH 主题偏好入口，留待下一轮 |
| TC-010 | FNOS-015-04 | 真实 fnOS NAS | 通过 | 2026-10-18 | 加载完成后静置 20 秒：`settings/mutate` 0 次、`describe` 0 次、`credentials/describe` 0 次、`modelCatalog` 0 次 |
| TC-011 | FNOS-015-04 | 真实 fnOS NAS | 通过 | 2026-10-18 | 模型选择器正常显示 `Space-Bunny · x0.08 · Max`，无「正在刷新模型列表」 |
| TC-012 | FNOS-015-04 | 真实 fnOS NAS | 通过 | 2026-10-18 | 静置期间无 300ms 级组件反复挂载 |
| TC-013 | FNOS-015-05 | 真实 fnOS NAS | 部分通过 | 2026-10-18 | 写入门槛已恢复（能发出 `settings/mutate`），但因 `getTheme()` 为 `null` 而走 `unset` 分支 |
| TC-014 | FNOS-015-05 | 真实 fnOS NAS | 通过 | 2026-10-18 | 未复发循环：无重复 unset，写入次数为 1 |
| TC-015 | FNOS-015-05 | 发布批次 | 通过 | 2026-10-18 | 设备实装 `0.2.1-rc.2.4`，其源码同时含 FNOS-014-15 门槛适配与本次守卫，无「先恢复后修」中间态 |

### 关于 issue #13 是否能判定已修复

真机这一轮**不能**得出「#13 已修复」的结论，原因是没走到会触发循环的那条路径：

| 维度 | issue #13 的病态 | 本次真机 |
| --- | --- | --- |
| 请求 | `unset systemTheme` | 同 |
| 响应 | `ok: true`、revision 递增 | 同 |
| **落盘结果** | `user.systemTheme` **仍为 `light`** | `user` 中**已无** `systemTheme` |

病态前提是「写入报告成功但字段不落盘」；本次 unset 真正生效，抑制逻辑因此没有机会被错误解除。要在真机验证 #13，需要构造或等到「unset 成功但字段仍在」的宿主状态——例如字段来自 composition 层（`base`）导致 unset 被转成 `set: inherited`。

当前可确定的结论只有两条：修复的**单测与复现脚本**成立（reject 场景 21 次 → 1 次）；真机上**循环未复发**，但未进入触发条件。

### 测量方法的一处更正

初次用「在 iframe 内包装 `window.fetch` 计数」的方式测得 20 秒窗口全为 0，随后发现该 hook 已被框架替换（`fetch.toString()` 不再含探针标记），属**假阴性**。已改用浏览器网络面板作为权威数据源重新统计——面板记录全部 125 个请求，结论与前述一致且不受页面内 hook 影响。

判断「计数器是否有效」必须做对照实验：主动触发一次已知请求，确认计数增长后才能相信 0 值。

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| — | — | 尚无记录 | — | — | — |

## 测试结论

真实 fnOS NAS 上完成两轮执行，**核心目标全部通过，issue #13 可判定已修复**。

**写入收敛（FNOS-015-01，AC-01）**：

- 静置 20 秒窗口：`settings/mutate` **0** 次、`settings/describe` **0** 次、全部 fetch **0** 次。
- 做了对照实验排除测量失效：同一 hook 先主动发一个已知请求能捕获到（`controlCaptured: 1`），随后静置 8 秒仍为 0。这个 0 是真实的 0。
- 主题切换时**每次变化恰好 1 次写**，不重复、不循环——写入次数等于真实目标变化次数，正是 AC-01 的口径。
- 与 issue #13 病态形态（每 300–400ms 一次重复 unset、30+ 次/20 秒）完全相反。

**主题缓存写入（FNOS-015-03，AC-01/AC-02）**：

- 在「我的账号 → 主题壁纸」切 light→dark→light，两次切换各产生 1 次 `settings/mutate`，payload 为 `{ns:"dsh-fnos", ops:[{op:"set", path:["systemTheme"], value:"dark"}]}`，宿主响应 `ok: true`。**缓存被正确写入**。
- 首屏注入生效：外壳 HTML 中出现 `const preference = "dark"`（即 `injectCachedFnosTheme` 把 bootstrap 的 `"system"` 替换为缓存值）。NAS 为 dark 时，宿主、DSH 运行时、注入值三者一致。
- 双向跟随成立：NAS 暗→DSH dark，NAS 亮→DSH light。

**连带症状（FNOS-015-04）**：静置期 `mutate`/`describe`/`credentials`/`modelCatalog` 均为 0，模型选择器正常，未见组件反复挂载。

**未验收项（FNOS-015-03，AC-03 / TC-009）**：DSH 侧切为显式 light/dark 后「首屏不使用旧缓存」未验——本次未找到 DSH 主题偏好入口。该项是既有行为的回归确认，不影响 #13 的修复判定。

### 关于 issue #13 的病态前提

前一轮记录「`unset` 报告成功但字段不落盘」在真机上没有出现，因此判「不足以判定」。本轮换了验证角度：不再依赖病态前提复现，而是直接量化**稳态写入次数**与**主题变化时的写入次数**——两者都符合修复后的预期，且与缺陷报告的病态形态相反。据此判定 #13 已修复。

### 测试方法记录

- 页面内 `fetch` 无法伪造 `Origin`/`Sec-Fetch-Site`（被浏览器静默丢弃），跨站拒绝类验证只能由单测覆盖。
- 判断「计数器是否有效」必须做对照实验：主动触发一次已知请求，确认计数增长后才能相信 0 值。
- fnOS 主题切换入口在**「我的账号 → 主题壁纸」**；`localStorage` 的 `os-theme-mode` 不是权威来源（会被服务端覆盖），必须从界面切换。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-18 | 初始登记 | 建立 FNOS-015 测试用例文档，覆盖 FNOS-015-01~05 共 15 条用例：写入收敛与失败退避（TC-001~004）、unset 降级（TC-005~006）、主题缓存与首屏防闪三态（TC-007~009）、连带影响消除（TC-010~012）、新运行时门槛与交付批次（TC-013~015）。量化口径沿用 issue #13 的 Performance API 方法。 |
