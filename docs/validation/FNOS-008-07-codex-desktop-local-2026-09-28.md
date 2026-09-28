---
feature: FNOS-008-07
acceptance: FNOS-008-07-AC-02, FNOS-008-07-AC-03, FNOS-008-07-AC-04, FNOS-008-07-AC-06
environment: 本地 DSH Web 组合 + Desktop 契约源码核实
fnosVersion: 不适用
appVersion: 不适用
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-28
status: blocked
---

# FNOS-008-07 Codex Auth Desktop 登录修复本地验证记录（2026-09-28）

本记录是 **本地与源码级证据**，不是 Desktop 目标环境验收。真实 DSH Desktop 运行时验收仍待执行，原因见「未完成部分」。

## 环境与前置

- 仓库：`fn-packages/fnos-dsh`，插件 `@tnnevol/dsh-codex-auth` 版本 `0.1.7-rc.2`。
- 上游契约依据：DSH 源码检出 `~/workspace/fork-pj/deepseek-harness`，提交 `477b4f4205`（`release(dsh): 0.1.7-rc.2`）。
- 本地实例：`DSH_HOME=<仓库根>/.dsh`，`dsh web --no-open --port 8124`，profile `web` 已链接本插件。

## 缺陷与根因

`CodexAuthSection.signIn()` 原实现：

```ts
const popup = window.open(CODEX_AUTH_VERIFICATION_URI, '_blank')
if (popup === null) { setStatus({ status: 'error', message: t('popupBlocked') }); return }
await jsonRequest(CODEX_AUTH_LOGIN_PATH, 'POST')   // ← Desktop 下永不执行
```

DSH Desktop 的 Electron 壳在主窗口安装 `setWindowOpenHandler`（`apps/desktop/src/main.ts:235-238`）：对 http/https 调 `shell.openExternal(url)` 后**一律返回** `{ action: 'deny' }`。因此 Desktop 下 `window.open` 恒为 `null`：

- 授权页**确实已在系统浏览器打开**；
- 但函数在 `null` 分支 `return`，设备码请求永不发出；
- 用户看到「浏览器阻止了登录窗口」，且无论如何重试都不会成功——**Desktop 上 Codex Auth 完全无法登录**。

第二处开窗（「打开授权页面」按钮）同样在 `null` 时 `return`，仅丢失窗口句柄，表现为「取消时关不掉授权窗口」，不阻断流程。

## 本次实现

- 新增 `src/client/window-opener.ts` 的 `openAuthorizationWindow(url)`：返回窗口句柄、吞掉开窗异常；**刻意不带 `noopener`**（`noopener` 会让返回值恒为 `null`，也会在跨域导航后让 `close()` 静默失效）。
- `signIn()`：`null` 不再判为失败；改为 `if (popup !== null) authWindowsRef.current.add(popup)`，登录继续请求设备码并进入「等待授权」。取消作废路径改用 `popup?.close()`。
- 「打开授权页面」按钮：`null` 时静默跳过登记，不再提前 `return`。
- 保留既有语义：保留 opener、`signIn` 内不自动复制授权码、取消走独立 `cancel` 端点而非 `logout`、关窗不等于放弃；未改动 `/plugins/.../auth/*` 路由、`trustedRequest` 判定与 `dsh.client.platform: web`。
- 测试：新增 `tests/client/desktop-window.spec.ts`（10 条）；同步更新 `authorization-window.spec.ts` 与 `authorization-code-copy.spec.ts` 中绑定旧写法 `window.open(...)` 的断言（断言语义不变：仍要求「请求设备码前先打开固定授权页」）。

## 已核实无缺口的路径

| 路径 | 依据 | 结论 |
| --- | --- | --- |
| `/plugins/dsh-codex-auth-plugin/auth/*` 路由 | `apps/desktop/src/main.ts:629` → `forwardWebRequest()` | 由壳转发并注入 Cookie，可用 |
| 落点校验 | `apps/desktop/src/web-document.ts`（删除 origin、重设 cookie） | 无 origin |
| Host 信任判定 | `src/host/auth-routes.ts` `trustedRequest()`：无 origin 时回落 `localPeer(req)` | Desktop 转发来自 loopback，放行 |
| 剪贴板（授权码复制） | `apps/desktop/src/microphone-permissions.ts:18`：非 `media` 权限返回 `true` | Semi `copyable` 可用 |
| 客户端载体 | `packages/client/modules/src/index.ts:841` 只接受 `platform === 'web'` | 不得改动，Desktop 复用同一载体 |

## 实际操作与结果

1. **插件检查**：`pnpm --filter @tnnevol/dsh-codex-auth run check` → 18 个测试文件、88 条测试全部通过；`typecheck` 通过。
2. **构建**：`pnpm run build` 通过；`lib/client.js` 2,254,253 字节、`lib/index.js` 34,457 字节；Host 产物不含客户端开窗实现（分层未被打破）。
3. **组合级端到端**：本地 `dsh web` 下 `GET /plugins/dsh-codex-auth-plugin/auth/status` → `200`，返回 `{"status":"signed-in","expiresAt":"..."}`，证明 Desktop 转发路径上的该路由可用。
4. **客户端产物**：从真实 boot graph 取回含本插件的组合包（`200`），产物内确认 `if (popup !== null) authWindowsRef.current.add(popup)`，且组件内已无 `popupBlocked` 中断路径。
5. **静态审计**：`window.open` 仅剩 `src/client/window-opener.ts` 一处；两处句柄登记均有判空守卫；客户端无 `node:` 内建导入与绝对路径。

## 未完成部分（状态 blocked 的原因）

- **未执行真实 DSH Desktop 运行时验收**：本机未安装 Electron、`apps/desktop` 未构建（无 `.desktop-build`），无法启动 Desktop 客户端。
- 因此 `FNOS-008-07-AC-01`、`AC-05`、`AC-07` 目前只有源码级与本地组合证据；`AC-02`/`AC-03`/`AC-04` 的核心判据（`null` 开窗后登录继续）已由单元测试锁定，但尚未在 Desktop 实测。
- 待补：在目标 DSH Desktop 版本安装同一 bundle，实测登录、取消、复制、模型目录同步与重启恢复。

## 回滚

删除 `src/client/window-opener.ts`，把两处开窗恢复为原先的 `window.open(...)` 写法即可；不涉及凭据、账号或持久化数据，回退无数据风险。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：本地实现与组合级验证通过；Desktop 目标环境验收待补，故状态为 `blocked`。
