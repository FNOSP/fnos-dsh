---
feature: FNOS-008-06, FNOS-008-07
acceptance: FNOS-008-06-AC-02, FNOS-008-06-AC-03, FNOS-008-07-AC-06
environment: 本机 DSH Desktop 0.1.7-rc.2（Electron 壳 + app.asar 内 Host）+ 探针 profile
fnosVersion: 不适用
appVersion: 0.1.7-rc.2
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-29
status: blocked
---

# FNOS-008 Desktop 安装后激活失败本地验证记录（2026-09-29）

本记录针对用户报告的两个 Desktop 实机现象，给出**可复现的根因**与修复后的端到端证据。
它仍是**本机与运行时级证据**，不是 fnOS/目标机验收，因此状态保持 `blocked`。

## 现象

1. CodeBuddy 插件在 Desktop 安装后启用报错：
   `dsh: warning: 1 entry did not activate … Error: cannot get property "webServer" without inject`。
2. Codex Auth 插件安装后，插件详情页不显示配置区。

## 复现与定位方法

Desktop profile 由 Electron 独占（`apps/cli/src/args.ts` `rejectElectronProfile`），CLI 拒绝
`--profile desktop`。因此改用**应用自带运行时**在探针 profile 上复现：

- Host：`ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "<app.asar>/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile desk --port <free> --no-open`
- 前端：同一 `app.asar` 的 `dsh-web-frontend` 由 `~/.dsh/electron` 的 Electron 以无头窗口加载，
  并用 preload 包装 `window.__ModuleLoader__.load` 抓取被吞掉的抛错。

## 根因一：Codex Auth 客户端 fiber 抛错（现象 2 的直接原因）

桌面客户端启动审计（`dsh-web-frontend/dist/assets/index-*.js`）会把未激活条目渲染成
`<name>: <state>`；应用崩溃日志 `~/Library/Logs/DeepSeek Harness/crash-*-web-boot.log`
中 `Error: web boot: 1 entry did not activate` / `@tnnevol/dsh-codex-auth: failed`
即 `fiber.state = FAILED(3)`，说明 `apply()` 抛出而非导入失败。

preload 包装后捕获到确切抛错：

```
apply() called; inject=["slots","locale","connection","remote","remote.session","timer"]
APPLY-THREW: Error: cannot get property "remote.llm" without inject
    at installCodexModelDiscoveryBridge (.../@tnnevol/dsh-codex-auth/client.js)
```

Cordis 的服务代理对**未在 `inject` 中声明的命名空间读取会直接抛错**
（`@deepseek-ai/cordis` `ReflectService.handler.get`：`cannot get property "${prop}" without inject`）。
本插件 `inject` 只声明了 `remote.session`，而模型目录桥接要读 `remote.llm`，于是 `apply()`
在注册任何 slot 之前就抛错——`plugins.bundle.config` 的注册永不执行，详情页因此没有配置区。
同一个抛错也解释了应用崩溃日志里的 `@tnnevol/dsh-codex-auth: failed`。

官方同类消费者 `@deepseek-ai/dsh-client-ui-settings-models` 的 `inject` 显式列出
`remote.credentials` / `remote.llm` / `remote.settings` / `remote.session`，即正确写法。

## 修复一

- `plugins/dsh-codex-auth-plugin/src/client/index.tsx`：`inject` 增补 `'remote.llm'`。
- `plugins/dsh-codex-auth-plugin/src/client/services/model-discovery.ts`：命名空间读取包进
  `try/catch`，读不到即返回 no-op disposer。**任何单个命名空间缺失都不再拖垮整个客户端条目**。
- 回归测试：
  - `tests/client/model-discovery.spec.ts`：Proxy 模拟「未声明即抛错」，断言不抛且返回 disposer；断言缺
    catalog 时返回可安全调用的 no-op。
  - `tests/client/client-registration.spec.ts`：从源码派生所有 `remote.<ns>` 访问，断言每个都在
    `inject` 中声明（防止再次漂移）。

## 根因二：CodeBuddy 的 `connection` 覆盖与安装状态

`connection.rpc.handle()` 用「读取 `connection` 的那个 Context」作为路由所有者，
最终执行 `owner.effect(() => owner.webServer.register(route))`
（`@deepseek-ai/dsh-client-connection` `register()`）。应用内置的 `dsh-web-app` 层把该行
声明为 `inject: [webRuntime]`，因此插件必须自带一层把 `webServer` 补进 `connection.inject`。
本插件的 `cordis.patch.yml` 正是这样做的，且生效顺序正确——合成后的树中该行被标注为：

```
# == @deepseek-ai/dsh-web-app, patched by @tnnevol/dsh-codebuddy
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject: [webRuntime, webServer]
```

应用崩溃日志三份均为 `@tnnevol/dsh-codex-auth: failed`，**没有** CodeBuddy 的失败记录；
用户截图中的 `webServer` 报错出现在 `@tnnevol/dsh-codebuddy` 未进入
`dsh.profile.bundles` 的窗口期（当时该 profile 的 bundles 只有 base/web-app/codex-auth）。
插件管理器的 `reconcile()` 只在依赖「本次新增」时把 bundle 追加进 `dsh.profile.bundles`；
`codebuddy` 已存在于 `dependencies`、再次安装走 `Already up to date`，不会再被追加。

以「探针 profile + codebuddy ∈ bundles」复现，结果为**全绿**：

| 检查 | 结果 |
| --- | --- |
| 启动激活告警 | 0 条（`grep -c "did not activate"` = 0） |
| 合成树 `connection.inject` | `webRuntime, webServer` |
| `POST /codebuddy/auth/status` | `200`，返回合法 RPC 信封 |

结论：仓库内 CodeBuddy 的适配**已经是正确的**；实机报错来自安装状态（未回到 bundles），
不是代码缺陷。修复动作是让插件重新进入 profile 的组合列表，而不是改插件代码。

## 修复后的端到端证据（现象 2）

同一无头渲染器加载探针 profile（codebuddy + codex-auth 同时在 bundles）：

```
BOOT ERRORS: []
hasConfigSection: true
configText: "Codex Auth — 使用 ChatGPT 账户登录，为 Codex 兼容插件提供认证状态。
             尚未登录 登录 全局模型 请选择模型 · 提供方默认 取消 设置为全局模型"
pageText:   "… 包含的组件 共 1 个 · 1 运行中 … dsh-codex-auth 运行中"
```

即：客户端条目激活成功，`[data-plugin-config]` 配置区在插件详情页正常渲染，组件状态为「运行中」。

## 门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @tnnevol/dsh-codex-auth run check` | 19 文件 / 100 测试通过（修复前 97） |
| `pnpm --filter @tnnevol/dsh-codebuddy run check` | 68 文件 / 888 测试通过 |
| `pnpm run check -- --packages --plugins` | 13/13 任务通过 |

## 未完成部分（状态 blocked 的原因）

- 上述复现在**探针 profile** 上完成，未改写 Electron 独占的 `~/.dsh/profiles/desktop`。
  实机最终确认需用户在 Desktop 应用内重新安装/启用两个插件后重启客户端。
- 未在 fnOS 或目标发行环境验收；`FNOS-008-06-AC-01`、`FNOS-008-07-AC-01/AC-05/AC-07` 仍缺真实环境证据。
- 真实 NAS 与 Desktop 目标机的登录、取消、复制、模型目录同步与重启恢复尚未实测。

## 回滚

- 客户端修复：还原 `src/client/index.tsx` 的 `inject` 与 `model-discovery.ts` 的 `try/catch` 即可。
- 不涉及凭据、账号或持久化数据，回退无数据风险。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：两个现象的根因均已复现定位，Codex 客户端缺陷已修复并由端到端渲染证据与回归测试锁定；
  CodeBuddy 侧确认仓库实现正确、实机问题为安装状态。目标环境验收待补，故状态为 `blocked`。
