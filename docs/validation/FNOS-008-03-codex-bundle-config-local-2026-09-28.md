---
feature: FNOS-008-03
acceptance: FNOS-008-03-AC-01, FNOS-008-03-AC-02, FNOS-008-04-AC-01
environment: 本地 DSH Web 组合
fnosVersion: 不适用
appVersion: 不适用
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-28
status: blocked
---

# FNOS-008-03 Codex Auth 配置迁入插件详情页本地验证记录（2026-09-28）

本记录是 **本地与源码级证据**，不是目标环境验收。真实 NAS 与 DSH Desktop 运行时验收仍待执行，原因见「未完成部分」。

## 环境与前置

- 仓库：`fn-packages/fnos-dsh`，插件 `@tnnevol/dsh-codex-auth` 版本 `0.1.7-rc.2`。
- 上游契约依据：DSH 源码检出 `~/workspace/fork-pj/deepseek-harness`，提交 `477b4f4205`（`release(dsh): 0.1.7-rc.2`）。
- 本地实例：`DSH_HOME=<仓库根>/.dsh`，`dsh web --no-open --port 8125`，profile `web` 已链接本插件。

## 变更内容

配置入口从设置弹框的导航分区迁入插件管理页的组合包详情页：

| 项 | 迁移前 | 迁移后 |
| --- | --- | --- |
| slot | `settings.section`（id `codex-auth`、order 24） | `plugins.bundle.config`（key `@tnnevol/dsh-codex-auth`） |
| 位置 | 设置侧栏导航分区 | 侧栏「插件」→ 已安装 → Codex Auth 详情页（描述与组件列表之间） |
| 渲染视图 | 整屏设置分区 | `view: 'page'`（`PluginConfigViewProps`） |
| 导航元数据 | `label` / `order` | 不需要（详情页自绘标题与面包屑） |
| 数据读写 | `/plugins/.../auth/*` 路由 + settings 写入 RPC | **不变** |

上游契约（`packages/client/ui-plugin-manager/src/client/slot-contract.ts:94`、`slot-catalog.ts`）：`plugins.bundle.config` 为 keyed/root slot，key 用**包名**，仅以 `view: 'page'` 渲染；社区组合包范式见 `packages/experimental/client-ui-voice-input/src/client/mount.ts`。

## 依赖与清单

- `pnpm-workspace.yaml` `catalogs.dsh` 新增 `@deepseek-ai/dsh-client-ui-plugin-manager: 0.1.7-rc.2`。
- `package.json`：`peerDependencies` 与 `devDependencies`（`catalog:dsh`）各增一条；`dsh.client.inject` 增该包。
- `compatibility.json`：`dshPluginApi.packages` 增该包（保持字典序）。
- 客户端**仅 type-only** 引入（`import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'`）：运行时该包不在客户端模块表内，实际引用会抛模块缺失。
- `pnpm-lock.yaml` 由 `pnpm install --lockfile-only` 更新（catalog + importer 各一条）。

## 实际操作与结果

1. **插件检查**：`pnpm --filter @tnnevol/dsh-codex-auth run check` → 19 个测试文件、96 条测试全部通过；`typecheck` 通过。
2. **构建**：`pnpm run build` 通过；`lib/client.js` 含 `plugins.bundle.config` 注册（3 处命中）、**不含** `settings.section`。
3. **类型安全属实**：`plugins.bundle.config` 的 slot key 类型由该包声明（`lib/types/client/slot-contract.d.ts:100`）；补依赖前 typecheck 报 `TS2307`（模块找不到）与 `TS2345`（slot key 不在联合类型中），补后通过——证明断言不是靠宽松类型漏过。
4. **组合级渲染条件**：本地 `dsh web` 下查询 `pluginInventory/list`，Codex 条目为 `enabled: true`、`fiberPhase: active`，位于 profile 用户层 bundles；插件管理页据此为它渲染详情页，配置区块具备渲染条件。
5. **产物分发**：从真实 boot graph 取回含本插件的组合包（HTTP 200），确认服务端下发的是新注册版本。
6. **布局解耦**：详情页把配置区块放入普通纵向 flex（`.detailSections`/`.detailSection`，无固定高度、由页面整体滚动）；组件样式无 `100vh`/`100%` 高度、无 `position: fixed`，根容器为纵向 flex，因此不需要 CodeBuddy 那样的滚动约束。已加回归断言锁定该前提。
7. **设置侧清理**：`src/` 内已无 `settings.section` / `settings.plugins.tab` 引用。
8. **测试归属说明**：组合包产物中另有 2 处 `settings.section`，经逐包比对确认来自 **CodeBuddy**（其迁移属 T02-01，未在本次范围）。

## 未完成部分（状态 blocked 的原因）

- **未执行真实 NAS 与 DSH Desktop 运行时验收**：本机无 Electron 运行时，fnOS 侧也未实机验证。
- 因此「详情页配置区块在真实客户端可见可用」「设置弹框不再出现 Codex Auth 分区」目前是**源码级 + 组合级（插件清单条件）+ 单元测试**证据；尚未有真实界面截图或人工走查结论。
- 待补：在本地 `dsh web` 打开插件管理页确认区块渲染与登录/复制/全局模型交互；在目标 DSH Desktop 与真实 NAS 上完成 FNOS-008-03-AC-01/02 与 FNOS-008-04-AC-01。

## 回滚

把 `src/client/index.tsx` 的注册改回 `settings.section`（并恢复 `label`/`order`）即可；数据层未变动，回退无数据风险。新增的类型依赖可保留（仅类型，不影响运行时）。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：注册迁移、类型契约与组合级渲染条件已验证；真实界面与目标环境验收待补，故状态为 `blocked`。
