---
id: FNOS-057
title: FNOS-057 DSH 0.2.2-rc.5 基线升级
description: 把仓库运行基线、七个入库插件的依赖锚定与兼容声明从 DSH 0.2.2-rc.4 迁移到 0.2.2-rc.5，复核该版本相对 rc.4 的唯一行为变更（网页搜索提供方默认值）对本仓库的影响，并在 DSH Web 与真实 fnOS NAS 上验收。
status: in-progress
owner: tnnevol
targetVersion: 8.3.0
lastVerified: 2026-11-19
---

# FNOS-057 DSH 0.2.2-rc.5 基线升级

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-057 |
| 状态 | 进行中 |
| 负责人 | tnnevol |
| 目标版本 | 8.3.0 |
| 创建日期 | 2026-11-19 |
| 关联计划 | [PLAN-FNOS-057 DSH 0.2.2-rc.5 基线升级](/plans/PLAN-FNOS-057-dsh-022-rc5-adaptation) |
| 上一个基线 | DSH 0.2.2-rc.4（FNOS-056） |
| 本次基线 | DSH 0.2.2-rc.5 |

## 需求背景

FNOS-056 把运行基线从 0.2.2-rc.1 迁到了 0.2.2-rc.4。上游随后发布 0.2.2-rc.5，`next`
分发标签已指向该版本，`latest` 仍是 0.2.2-rc.1。

本需求把基线推进到 rc.5。与 FNOS-056 跨三个版本不同，本次只跨一个版本，且经验证
其改动面很小，因此实施重点是「确认没有需要适配的契约变化」，而不是逐个版本重做契约
复核。

## 调研结论

用 `npm pack` 拉取 `@deepseek-ai/dsh@0.2.2-rc.4` 与 `@0.2.2-rc.5` 两个发布产物解包后
逐文件比对，结论如下。

### 一、改动面：7 个文件

```text
docs/config-catalog.md
docs/config-catalog.zh.md
docs/subsystems/web.md
docs/subsystems/web.zh.md
docs/upgrade-guide/README.md
docs/upgrade-guide/v0.2.2-rc.4/web-search-deepseek-model-default/  （新增）
package.json
```

除 `package.json` 的版本号替换外，全部是文档。**没有代码变更，没有插槽增删，没有
导出签名变化，没有包增删。**

### 二、`engines.node` 未变

| 版本 | engines |
| --- | --- |
| rc.4 | `{"node": ">=24.9.0"}` |
| rc.5 | `{"node": ">=24.9.0"}` |

`apps/fn-deepseek-harness/cmd/install_callback` 里的 `DSH_MIN_NODE_VERSION` 保持
`24.9.0`，本次不需要改。

### 三、唯一行为变更：网页搜索提供方默认值

rc.5 带出 rc.4 引入的一条升级指南
`v0.2.2-rc.4/web-search-deepseek-model-default`：

- 过去共享基础组合把 `web.searchProvider` 固定为 `deepseek-search-api`；
- 现在基础组合**不设置** `searchProvider`，由 `dsh-web` 按模型提供方路由选择；
- `deepseek-official` / `deepseek-account` 路由上的模型请求发起的搜索走
  `deepseek-official` 提供方（辅助 Messages 请求，按 token 计费，会话日志追加
  `web/deepseek-search-llm-request` 事件）；其他路由与不在模型请求内的搜索仍走
  `deepseek-search-api`；
- 设置页的「网页搜索提供方」菜单新增**自动选择**，没有已存选择时即选中它。

**对本仓库的影响：无。** 该指南明确写了「自行设置了 `web.searchProvider` 的组合或
profile 不受影响」，而本仓库的 `plugins/dsh-failover-search-plugin/cordis.patch.yml`
正是自行设置 `searchProvider: dsh-failover-search`，因此走的是自己的故障转移链，
不落入新的默认值分支。

需要留意的是这条指南挂在 `v0.2.2-rc.4` 目录下：它在 rc.4 就已生效，rc.5 只是把
指南文件补进发布产物。FNOS-056 期间未单独处理它，本需求一并记录为「确认无影响」。

### 四、基线承载处仍是四处

与 FNOS-056 相同，`readDshBaselineFromCatalog()` 以 `pnpm-workspace.yaml` 第 16 行
为唯一事实源，另有三个必须同源的承载处：

| 承载处 | 位置 |
| --- | --- |
| 默认 catalog | `pnpm-workspace.yaml` 第 16 行 |
| 命名 catalog | `catalogs.dsh` 段 |
| 发布龄期豁免 | `minimumReleaseAgeExclude` 段 |
| 安装回调常量 | `apps/fn-deepseek-harness/cmd/install_callback` 的 `DSH_VERSION` |

另有七处插件侧锚定需要同步：`plugins/*/package.json` 的 `engines.dsh` 与
`plugins/*/compatibility.json` 的 `dshPluginApi.version`。

FNOS-056 已为「四处一致」补了守卫用例
（`tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts` 的「基线承载处一致性」），
本次沿用，不需要新写。

## 需求目标

1. 运行基线推进到 DSH `0.2.2-rc.4` → `0.2.2-rc.5`，四处承载处保持同源。
2. 七个入库插件的 `engines.dsh` 与 `compatibility.json` 同步到 rc.5。
3. 确认 `attachment-local` 等需要安装期补丁的包在 rc.5 上的锚点仍然成立。
4. 在 DSH Web 与真实 fnOS NAS 上验收，安装回调能正确识别并替换旧基线。

## 功能列表

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| F1 | 基线承载处同步 | 四处承载处从 rc.4 改为 rc.5 |
| F2 | 插件锚定同步 | 七插件的 `engines.dsh` 与 `compatibility.json` |
| F3 | 安装期补丁复核 | 确认补丁锚点在 rc.5 产物上仍命中 |
| F4 | 文案同步 | 应用 `desc`/`changelog` 与插件 README 里的基线字样 |
| F5 | 守卫沿用 | 复用 FNOS-056 的「四处一致」守卫用例 |

## 行为约束

- 基线变更必须用 `pnpm run version -- major --baseline 0.2.2-rc.5`，不能用
  `patch`/`minor` 静默掩盖。
- `pnpm-workspace.yaml` 的三段（默认 catalog / 命名 catalog / 豁免清单）必须与
  安装回调常量同时改，只改其一会让安装期解析到旧版本。
- 不得通过 SSH 改动测试 NAS 上已安装的应用；验证只走「改代码 → 构建 FPK →
  应用中心安装」。
- 装 FPK 时必须一边操作一边看界面，不能只轮询安装日志。

## 不在本次范围内

- 不处理上游 `latest` 仍指 0.2.2-rc.1 的事实：`latest` 是对外分发标签，与运行基线
  无关，不改。
- 不新增插件功能。
- 不处理搜索默认值变更：经核实对本仓库无影响（见调研结论三）。
- 不修正官方「在应用中打开」把 `/usr/sbin/zed` 误认成 Zed 编辑器的问题：该问题在
  rc.4 期间已确认无干净解法，rc.5 未改善，仍不在范围内。

## 既有功能变更关系

| 既有能力 | 本次影响 |
| --- | --- |
| 四处基线承载处一致性守卫（FNOS-056） | 沿用，目标值改为 rc.5 |
| 七插件 `engines.dsh` 锚定（FNOS-056） | 沿用流程，目标值改为 rc.5 |
| 安装回调基线识别与重装（FNOS-056） | 沿用，验证 rc.4 → rc.5 的替换 |
| `attachment-local` 安装期补丁（FNOS-056） | 需在 rc.5 产物上复核锚点 |
| `dsh-failover-search` 自设 `searchProvider` | 不受 rc.5 搜索默认值变更影响 |

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-11-19 | 创建 | 完成 rc.4 → rc.5 产物级差异调研，确认改动面 7 文件、无代码变更 |
