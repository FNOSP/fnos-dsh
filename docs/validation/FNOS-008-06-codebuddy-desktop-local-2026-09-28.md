---
feature: FNOS-008-06
acceptance: FNOS-008-06-AC-01, FNOS-008-06-AC-03, FNOS-008-06-AC-04, FNOS-008-06-AC-05
environment: 本地 DSH Web 组合 + Desktop 契约源码核实
fnosVersion: 不适用
appVersion: 不适用
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-28
status: blocked
---

# FNOS-008-06 CodeBuddy Desktop 适配本地验证记录（2026-09-28）

本记录是 **本地与源码级证据**，不是 Desktop 目标环境验收。真实 DSH Desktop 运行时验收仍待执行，原因见「未完成部分」。

## 环境与前置

- 仓库：`fn-packages/fnos-dsh`，插件 `@tnnevol/dsh-codebuddy` 版本 `0.1.7-rc.2`。
- 上游契约依据：DSH 源码检出 `~/workspace/fork-pj/deepseek-harness`，提交 `477b4f4205`（`release(dsh): 0.1.7-rc.2`）。
- 本地实例：`DSH_HOME=<仓库根>/.dsh`，`dsh web --no-open --port 8123`，profile `web` 已链接本插件。

## 契约核实（源码事实）

| 事实 | 位置 | 结论 |
| --- | --- | --- |
| Desktop 是 Electron 壳，加载打包内同一套 Web 前端 | `apps/desktop/src/main.ts`（`dsh-app://app/` → `dsh-web-frontend/dist`） | 复用同一客户端载体 |
| Desktop profile 使用 web 模板（含 `dsh-host-webserver`） | `apps/desktop/src/project-manager.ts:32`（`PROFILE_TEMPLATES.web`）；`packages/boot/app-boot/src/profile.ts:184` | `webServer`/`connection.rpc` 在 Desktop 可用 |
| 非静态请求转发给同一 Host，并由壳注入 Cookie | `apps/desktop/src/main.ts:629` → `apps/desktop/src/web-document.ts` `forwardWebRequest()` | 插件 `/codebuddy`、`/api`、Remote WebSocket 可用 |
| Host 信任栅栏放行转发请求 | `packages/client/connection/src/index.ts` `isTrustedApiRequest`：loopback 且 `origin === undefined` 时放行 | 转发（删除 origin、重设 cookie）通过 |
| `dsh.client.platform` 只接受 `web` | `packages/client/modules/src/index.ts:841`（`decl.platform !== 'web'` 即跳过） | 不得改为 desktop/electron |
| 壳对 http/https 调 `shell.openExternal` 后返回 deny | `apps/desktop/src/main.ts:235-238`（`setWindowOpenHandler`） | `window.open` 返回 `null` 属已外部打开 |

## 实际操作与结果

1. **组合加载**：`DSH_HOME=.dsh dsh --profile web --dump-config` 退出码 0；输出含 `# == @tnnevol/dsh-codebuddy` 行与插件层对 `connection` 的 patch（`inject: [webRuntime, webServer]`）。符合预期。
2. **RPC 通道端到端**：以启动 token 换取 Cookie 后，
   `POST /codebuddy/status` → `200`，返回 `{"ok":true,"value":{"loggedIn":true,"nickname":"...","uid":"..."}}`。符合预期，证明该通道在转发路径下可用。
3. **客户端 bundle**：从真实 boot graph 取到含 `@tnnevol/dsh-codebuddy/client.js` 的组合包地址，请求返回 `200`，产物内含 `openAuthUrl`。符合预期。
4. **插件检查**：`pnpm --filter @tnnevol/dsh-codebuddy run check` → 68 个测试文件、888 条测试全部通过；`typecheck` 通过。
5. **构建**：`pnpm run build` 通过，`lib/client.js` 6.04 MB、`lib/style.css` 510.09 kB；`lib/index.js` 不含客户端开窗实现（分层未被打破）。
6. **仓库检查**：`pnpm run check -- --sdd --docs` 通过；`git diff --check` 无输出。

## 本次实现要点

- 新增 `src/client/external-opener.ts`，提供 `openAuthUrl(url, open?)`。
- 三个登录入口（设置区块添加账号、设置区块重新登录、后台面板添加账号）统一改走 `openAuthUrl`，不再裸调 `window.open`。
- `openAuthUrl` **不检查 `window.open` 返回值**（Desktop 返回 `null` 但仍已外部打开），并吞掉开窗异常，避免未处理异常触发宿主 fail-loud。
- 登录结果仍以宿主 `pollLogin` 为准；未改动 Host、凭据、RPC 通道或上游行为指纹。
- 测试：新增 `tests/desktop-adaptation.spec.ts`（7 条），并同步更新 `tests/add-account-login-feedback.spec.ts` 中三处绑定旧调用写法的断言。

## 未完成部分（状态 blocked 的原因）

- **未执行真实 DSH Desktop 运行时验收**：本机未安装 Electron、`apps/desktop` 未构建（无 `.desktop-build`），无法启动 Desktop 客户端。
- 因此 `FNOS-008-06-AC-02`（Desktop 与 Web 结果一致）与 `FNOS-008-06-AC-07`（Desktop 重启恢复与 Web/fnOS 兼容）目前**只有源码级与本地组合证据**，尚无 Desktop 实测结论。
- 待补：在目标 DSH Desktop 版本安装同一 bundle，实测加载、配置详情页、OAuth 登录/取消、模型、用量、成长任务与重启恢复。

## 回滚

本次改动可整体回退：删除 `src/client/external-opener.ts`，把三处调用恢复为原先的 `window.open(...)` 写法即可；不涉及凭据、账号、偏好或持久化数据，回退无数据风险。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：本地实现与组合级验证通过；Desktop 目标环境验收待补，故状态为 `blocked`。
