---
id: FNOS-050
title: FNOS-050 fnOS 插件增加「依赖修复」
description: 在 fnOS 插件详情页提供只读诊断与一键依赖修复，解决用户在应用内无法安装插件（发布龄期豁免失效、依赖树不一致）的问题。
status: in-review
owner: tnnevol
targetVersion: 8.1.4
lastVerified: 2026-11-06
---

# FNOS-050 fnOS 插件增加「依赖修复」

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-050 |
| 提出日期 | 2026-11-06 |
| 需求状态 | 待验收 |
| 关联计划 | [PLAN-FNOS-050 依赖修复](/plans/PLAN-FNOS-050-dependency-repair) |
| 适用范围 | `plugins/dsh-fnos-plugin`（详情页卡片、宿主侧诊断与修复路由）、相关文案与文档 |
| 明确排除 | 修改上有的 pnpm 策略；不经 SSH 改测试设备；处理非本应用（`fn-deepseek-harness`）的 profile |

## 需求背景

真实 NAS 上出现过这样的失败（2026-11-06，`profiles/web/.plugin-manager/logs/operation-DV001s/pnpm.log`）：

```text
✗ Lockfile failed supply-chain policy check (8 entries in 2.1s)
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
  dshmarket@1.73.12 was published at 2026-11-05T20:38:00.000Z,
  within the minimumReleaseAge cutoff (2026-11-05T10:28:38.530Z)
```

用户在应用内安装插件失败，界面上只有一段 pnpm 英文错误。根因是 profile 的 `minimumReleaseAgeExclude` 里残留着旧版本的豁免条目（如 `@tnnevol/dsh-codex-auth@6.0.0`、`dshmarket@1.73.5`），而 pnpm 按 First-Match-Wins 短路：条目锚在已被取代的版本上就不再放行任何东西，反而锁住了围绕它构建的 lockfile。

同类失效还有第二形态：历史上用 `||` 把多版本合并成一行的条目，即便版本仍匹配也会让后续 `pnpm add` 解析异常。

用户侧的可恢复路径其实很短——清空失效豁免、`pnpm clean --lockfile`、`pnpm install`、再把插件装回来——但没有界面入口，也没有文档，用户只能放弃或求助。本需求把这条路径做成界面功能。

## 需求目标

| 编号 | 功能 | 用户可观察结果 |
| --- | --- | --- |
| FNOS-050-01 | 入口与用途说明 | 插件详情页出现「依赖修复」卡片，标题旁有 tip 气泡说明「应用内无法安装插件时可尝试」 |
| FNOS-050-02 | 只读诊断 | 点「检查」列出失效的豁免条目与原因，不改动任何文件 |
| FNOS-050-03 | 一键修复 | 确认后清空失效条目、重建依赖并重装本应用插件，全程显示日志 |
| FNOS-050-04 | 安全边界 | 只动可重建产物；凭据、会话、配置与已装插件不被删除 |

### FNOS-050-01 入口与用途说明

卡片挂在 fnOS 插件详情页（`plugins.detail.section`，与「授权目录」同座位）。标题「依赖修复」右侧放 info 图标，悬浮显示 tip：

> 应用内安装插件失败时可以先试这个：它会重建 Web profile 的依赖。只清理可重建的缓存与锁文件，不影响凭据、会话和配置。

tip 必须说清两件事：**能解决什么场景**（应用内装不上插件）、**不会动什么**（凭据/会话/配置）。后者决定用户敢不敢点。

### FNOS-050-02 只读诊断

「检查」按钮走一次只读诊断，列出：

- 哪些豁免条目的版本已不匹配当前清单（附「当前 X → 目标 Y」）
- 哪些条目是 `||` 联合残留
- 是否需要重建（两者都无时明确显示「依赖状态正常」）

诊断不写文件、不调 pnpm，纯读 `pnpm-workspace.yaml` 与 `package.json` 比对。

### FNOS-050-03 一键修复

「修复依赖」需二次确认，弹窗列出将执行的动作：

1. 从 `minimumReleaseAgeExclude` 清空失效条目（保留仍有效的条目）
2. `pnpm clean --lockfile && pnpm install`
3. 重新安装发布清单内的插件

执行期实时展示日志，完成后给出结果（成功/失败原因）与耗时。

### FNOS-050-04 安全边界

- 只删 `pnpm-lock.yaml` 与 `node_modules` 两个可重建产物，删前按 basename 校验。
- 不触碰 `DSH_HOME` 下的凭据（`.dsh-opencode-auth.json`、`.openai-codex-auth.json`、`.credentials.yaml` 等）、会话、工作区与偏好。
- 不卸载用户自行安装的插件；第 3 步只重装发布清单内的插件。
- 修复入口仅对 fnOS 宿主可用（依赖应用自身的安装目录与 pnpm 可执行文件）。

## 验收条件

| 编号 | 验收条件 | 判定方式 |
| --- | --- | --- |
| [AC-01](/requirements/FNOS-050-dependency-repair#fnos-050-01-入口与用途说明) | 详情页出现卡片与 tip；tip 同时说明用途与安全边界 | DSH Web / Desktop 走查 + 源码断言 |
| [AC-02](/requirements/FNOS-050-dependency-repair#fnos-050-02-只读诊断) | 用真实失效 profile 诊断出条目与原因；诊断前后文件哈希不变 | 单元测试 + 真机只读核对 |
| [AC-03](/requirements/FNOS-050-dependency-repair#fnos-050-03-一键修复) | 修复后 `pnpm install` 通过、插件可安装，日志可见 | 真机执行（修复属写操作，须走应用内界面） |
| [AC-04](/requirements/FNOS-050-dependency-repair#fnos-050-04-安全边界) | 修复后凭据与会话文件哈希不变；只删两个可重建产物 | 单元测试 + 真机前后比对 |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-06 | 建立需求：确认真实失败日志与根因（豁免条目 First-Match-Wins 短路 + 冷静期拦截），确定「依赖修复」入口、只读诊断与一键修复的范围 |
