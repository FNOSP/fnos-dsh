---
feature: FNOS-008-06
acceptance: FNOS-008-06-AC-01, FNOS-008-06-AC-05
environment: 本机 DSH Desktop 0.1.7-rc.2（Electron 壳 + app.asar 内 Host）
fnosVersion: 不适用
appVersion: 0.1.7-rc.2
pluginVersion: 0.1.7-rc.2（`link:` 指向本仓库源码，构建于 2026-09-29 16:09）
verifiedAt: 2026-09-29
status: blocked
---

# FNOS-008-06 Desktop 运行时复验记录（2026-09-29）

本记录**追加**于 [FNOS-008-06 CodeBuddy Desktop 适配本地验证记录（2026-09-28）](/validation/FNOS-008-06-codebuddy-desktop-local-2026-09-28)，
补充该记录「未完成部分」中已被后续事实取代的两点。旧记录按验收规范保持原样，不改写。

## 被取代的两点

旧记录（2026-09-28）的「未完成部分」写着：

> 未执行真实 DSH Desktop 运行时验收：本机未安装 Electron、`apps/desktop` 未构建
> （无 `.desktop-build`），无法启动 Desktop 客户端。

该结论在当时成立，但**依据的前提已不成立**：它检查的是「仓库内 `apps/desktop` 是否构建」，
而目标运行时并不需要构建仓库内的 Electron——机器上已安装官方发行的
`/Applications/DeepSeek Harness.app`（`CFBundleShortVersionString = 0.1.7-rc.2`），
且 `~/.dsh/profiles/desktop` 已把两个插件以 `link:` 指向本仓库源码：

```
~/.dsh/profiles/desktop/node_modules/@tnnevol/dsh-codebuddy
  -> ../../../../../workspace/fn-packages/fnos-dsh/plugins/dsh-codebuddy-plugin
~/.dsh/profiles/desktop/node_modules/@tnnevol/dsh-codex-auth
  -> ../../../../../workspace/fn-packages/fnos-dsh/plugins/dsh-codex-auth-plugin
```

因此第二条（「AC-02/AC-07 只有源码级证据」）也需要按本轮结果重新表述，见「结论」。

## 判别方法

Desktop Host 只监听回环并**要求浏览器 Cookie 鉴权**，无法从 CLI 直接调用插件业务逻辑。
但「路由是否已被插件注册」可以只读判别，依据是 DSH 的路由实现：

- 插件的 RPC 通道由 `connection.rpc.handle(channel, …)` 注册
  （`dsh-codebuddy` 的 channel 为 `CODEBUDDY_AUTH_CHANNEL = '/codebuddy'`）；
- 该方法注册的是 **`kind: 'prefix'` 的前缀路由**，且其 handler **先鉴权、后转发**：
  鉴权不通过时写 `401 unauthorized`（`@deepseek-ai/dsh-client-connection`
  `lib/index.js` 的 `register()`：`if ("rejection" in admission) res.writeHead(admission.rejection)`）；
- **未注册**的路径不进入该 handler，由 Web 服务器回落为 `404`。

因此判别式是：**同族路径中只有被显式注册的那个返回 401，未注册的返回 404**。

## 实测

运行中的 Desktop Host：`127.0.0.1:19387`（由 Desktop 应用内的 Host 监听）。

| 探测 | 结果 | 判读 |
| --- | --- | --- |
| `GET /codebuddy` | `401 unauthorized` | **前缀路由已注册** → CodeBuddy 插件在 Desktop 上已激活并完成 RPC 挂载 |
| `GET /codebuddy2` | `404` | 对照：未注册的同族路径 |
| `GET /zzz-not-a-channel` | `404` | 对照：未注册路径 |
| `GET /plugins/dsh-codex-auth-plugin/auth/status` | `200 {"status":"signed-in","expiresAt":"2026-10-07T10:25:10.636Z"}` | Codex Auth 插件在 Desktop 上已激活，且**已登录**（真实业务响应） |

对照组是关键：`/codebuddy` 与 `/codebuddy2` 只差一个字符，前者 401、后者 404，
说明 401 来自**该 channel 自己的鉴权 handler**，而不是「凡是不存在的路径都返回 401」。
（本轮曾误判为「401 即已挂载」，`/api/nonexistent-xyz` 同样返回 401 推翻了该推断，
故补做上述同族对照实验后重下结论。）

## 结论

| 验收项 | 本轮结论 |
| --- | --- |
| `FNOS-008-06-AC-01`（随 web 客户端载体加载） | **已有目标运行时证据**：Desktop 应用内 Host 上 `/codebuddy` 前缀路由已注册 |
| `FNOS-008-06-AC-05`（读取账号/用量/偏好） | **部分证据**：Codex Auth 侧返回真实业务响应（`signed-in` + 过期时间）；CodeBuddy 侧因无 Cookie 只能证到「通道已挂载」，未取回业务数据 |

**仍未完成**：

- `AC-02`（Desktop 与 Web 结果一致）：需要同一时刻两侧取回同一业务数据做比对，本轮未做；
- `AC-03`（OAuth 授权页在系统浏览器打开、完成、取消、退出）与 `AC-04`（`window.open` 返回
  `null` 仍继续）：需要人眼交互，只读探测覆盖不到；`AC-04` 目前只有契约测试；
- `AC-07`（重启后凭据与当前账号恢复、Web/fnOS 不回归）：需要重启客户端实测；
- 真实 fnOS / 目标发行环境验收未执行。

因此状态保持 `blocked`。

## 遗留与建议

- 本轮**未修改** `~/.dsh/profiles/desktop`，也未在应用内启用/停用任何插件；探测全部为只读 GET。
- Desktop 运行时启用插件仍有上游缺陷（`dsh-web-app` 的 `connection` 行缺 `webServer`，
  详见 [FNOS-008-08](/validation/FNOS-008-08-desktop-install-activation-local-2026-09-29)）：
  安装/启用后需**重启应用**，不要依赖应用内热启用。
- 下一步：由用户在 Desktop 内完成 AC-03/AC-04/AC-07 的交互走查，本记录追加复验结果。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：Desktop 运行时**确实可用**，两个插件均已激活；`AC-01` 取得目标运行时证据，
  `AC-05` 取得部分证据；其余交互类验收项仍待人工走查，状态 `blocked`。
