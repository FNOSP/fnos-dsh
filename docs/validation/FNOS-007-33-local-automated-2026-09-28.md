---
feature: FNOS-007-33
acceptance: FNOS-007-33-AC-01, FNOS-007-33-AC-02, FNOS-007-33-AC-03, FNOS-007-33-AC-04, FNOS-007-33-AC-05, FNOS-007-33-AC-06
environment: 本地 DSH Host 服务组合（真实 WebServer + 真实 SettingsForms）
fnosVersion: 不适用
appVersion: 5.4.3
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-28
status: passed
---

# FNOS-007-33 三方插件 API 反代配置保存修复本地验证记录（2026-09-28）

本记录是 **本地与源码级证据**。修复直接对应真实 NAS 浏览器中观察到的失败，但本机没有 fnOS 运行时，因此「真实 NAS 上的反代请求实际生效」仍待 NAS 回归，见「未完成部分」。

## 环境与前置

- 仓库：`fn-packages/fnos-dsh`，插件 `@tnnevol/dsh-fnos` 版本 `0.1.7-rc.2`。
- 运行时契约依据：`@deepseek-ai/dsh-settings@0.1.7-rc.2`、`@deepseek-ai/dsh-host-webserver@0.1.7-rc.2`、`@deepseek-ai/dsh-config-editor@0.1.7-rc.2`、`@deepseek-ai/cordis@4.0.4` 的已安装产物。
- 端到端测试使用**真实的** `WebServer`（真实 HTTP socket）与**真实的** `SettingsForms`，只对 `configEditor`、`profileContext`、`loader` 三个需要完整 Loader 的服务提供替身。

## 缺陷与根因

浏览器报告：

```
PUT http://192.168.119.6:5666/app/fn-deepseek-harness/plugins/dsh-fnos/gateway/proxy-paths 400 (Bad Request)
```

`400` 的响应体是**空的**，页面只能显示「保存失败」。根因是两个缺陷叠加：

1. **缺少运行时 settings schema。** `plugins/dsh-fnos-plugin/src/index.ts` 只声明了 TypeScript `interface Config`。接口在构建时被擦除，而 `@deepseek-ai/dsh-settings` 的 `SettingsForms.write()` 通过 `entry.fiber?.runtime?.Config` 查找该命名空间的 schema（且要求有 `toJSON`）；Cordis 只从模块中**字面名为 `Config` 的导出**填充该字段。因此 `settings.update('dsh-fnos', …)` 抛出 `No configurable plugin entry "dsh-fnos"`。
2. **路由让异常逃逸。** `@deepseek-ai/dsh-host-webserver` 对任何从 route handler 逃逸的 rejection 统一回 `res.writeHead(400); res.end()`，即无响应体的 400。原 handler 的 `await settings.update(...)` 只被一个**重新抛出**的 `catch` 包着，异常因此直达 webserver。

因此浏览器看到的是「400 且没有任何原因」，日志里才有真正的 `No configurable plugin entry`。

## 本次实现

| 变更 | 说明 |
| --- | --- |
| 导出运行时 `Config` | `src/index.ts` 以 `export const Config = FnosSettingsSchema` 提供值导出，同时保留同名类型 `Config = FnosConfig`；schema 字段全部 `.volatile()`，Cordis 因此把每个字段作为稳定引用交给 `apply` |
| schema 与共享契约分离 | schema 移入 host-only 的 `src/contracts/theme-schema.ts`。共享契约 `theme-contract.ts` 被**客户端**引用，若在其中导入 `schemastery` 会把 host 依赖带进浏览器 bundle |
| 读取 volatile 引用 | 新增 `volatileValue()`，兼容 volatile 引用与普通值；主题缓存改为每次调用实时读取，写设置后无需重挂载 |
| 路由错误收口 | 网关代理路径 handler 整体 try/catch，失败返回 JSON `500 fnos-gateway-proxy-paths-unavailable`，并保留进程日志中的堆栈 |
| 允许清单写入串行化 | 按文件串行队列 + 每次唯一的临时文件名。原实现用 `pid` 作为临时名，设置镜像与 PUT 并发时一方 `rename` 掉另一方的临时文件，导致 `ENOENT` 丢写 |
| session-log 路由补 try | `readJsonBody`（畸形/超大 body 会 reject）与 `validatePathForOpen`（解析授权根可能 reject）此前在 try 之外，属于同一类空白 400 来源 |
| 其余 fnOS 路由兜底 | 七个路由统一经过 `register()` 包装，任何逃逸 rejection 都记录并返回 JSON 500 `fnos-route-failed` |
| 版本判定对齐 | 插件与网关都要求 `version === 1`；插件额外接受设置字段的裸数组形态。`validateGatewayProxyPaths` 内部改用裸数组，避免重复要求文档版本 |

## 验证证据

| 验收条件 | 证据 | 结果 |
| --- | --- | --- |
| FNOS-007-33-AC-01 | `tests/host/gateway-proxy-e2e.spec.ts`「saves proxy paths with 200 and a JSON body」：真实 `WebServer` 上 `PUT` 返回 200 与规范化后的 JSON | 通过 |
| FNOS-007-33-AC-02 | 同一文件的「persists the accepted paths into the gateway allowlist file」与「reads back the saved paths over GET」：设置值与 `${TRIM_PKGVAR}/gateway/path-allowlist.json` 一致，GET 回读一致 | 通过 |
| FNOS-007-33-AC-03 | 同一文件的「never answers a bodyless error for an invalid snapshot」：非法路径返回 `400 {"error":"invalid-gateway-proxy-paths"}` | 通过 |
| FNOS-007-33-AC-04 | `tests/host/gateway-proxy-route.spec.ts`「restores the previous allowlist file when the settings write rejects」与「reports a diagnosable JSON error instead of an empty 400」：补偿写恢复原文件，响应为 JSON 500 | 通过 |
| FNOS-007-33-AC-05 | `packages/fnos-gateway/tests/path-allowlist.spec.ts`：逐例断言插件与网关对每个文档形态判定一致（含 `version: 2`、`version: '1'`、缺 `version`），并单独断言只有插件接受裸数组 | 通过 |
| FNOS-007-33-AC-06 | `tests/host/route-rejection-envelope.spec.ts`：七个路由均经兜底包装；session-log 的畸形 JSON、超大 body、传输错误都返回可诊断 JSON | 通过 |
| 构建产物 | `tests/contracts/package-contract.spec.ts`「ships a built entry that exports the runtime Config schema value」读取 `lib/index.js` 而非 `src/`，防止源已修但产物未重建 | 通过 |
| Client bundle | `tests/client/client-bundle.spec.ts` 在引入 schema 文件后会因意外 external 失败；`grep -c schemastery lib/client.js` 为 0 | 通过 |

## 红绿验证（证明测试真的能捕获该缺陷）

1. 仅移除运行时 `Config`（保留路由兜底）：端到端测试失败，`expected 500 to be 200` / 文件未写入。
2. 进一步还原 HEAD 的未包裹 handler，使异常逃逸：端到端测试失败，**`expected 400 to be 200`** —— 与浏览器上报的空白 400 一致。
3. 恢复修复后：`gateway-proxy-e2e.spec.ts` 5/5 通过。
4. 交叉包契约测试在收紧 `version` 判定前即失败于 `{"paths":["/x"]}`（缺 `version`），据此发现 `validateGatewayProxyPaths` 内部仍以 `{ paths: [item] }` 调用归一化函数，已一并修正。

## 命令与结果

```text
pnpm --filter @tnnevol/dsh-fnos run typecheck   # 通过
pnpm --filter @tnnevol/dsh-fnos run test        # 27 files, 155 tests 全部通过
packages/fnos-gateway: vitest run               # 17 files, 76 tests 全部通过
pnpm exec fnos-dsh-cli build --fpk --app fn-deepseek-harness --bundle-dsh-plugins --skip-bundle-dsh-native
# 产物校验：dsh-fnos.tgz 与 fn-deepseek-harness.fpk 内的 lib/index.js 均导出 Config；lib/client.js 无 schemastery
```

## 未完成部分

- **真实 NAS 回归**：本机没有 fnOS 运行时，`${TRIM_PKGVAR}` 下的实际写入、fnOS 统一网关反代后的真实请求、以及反代路径在 NAS 上实际放行三方插件 API 需要真实环境验证。
- **`TRIM_PKGVAR` 缺失时的不一致**：`packages/fnos-gateway/src/cli.ts` 的 `GATEWAY_PATH_ALLOWLIST` 兜底值是历史硬编码路径 `/var/apps/fn-deepseek-harness/var/gateway/path-allowlist.json`，与当前 fnOS 布局不符；`TRIM_PKGVAR` 未设置时插件侧返回 503 并停用该功能，而网关仍监听旧路径。本记录不改变该行为，仅在 FNOS-007-33 中记录为遗留项。
- **其余插件的同级问题**：审计确认本仓库只有 `dsh-fnos` 拥有可写 settings 命名空间，`dsh-codebuddy` 与 `dsh-semi-ui-showcase` 不导出 `Config` 也从不被写入；Codex Auth 写入的是官方 `llm-pi-ai`（自身导出 `Config`），并且其 route 已用 try/catch 收口。

## 验收人

- 本地自动化与源码级核验：本次会话（Lead）。
- 真实 NAS 结论：待执行。
