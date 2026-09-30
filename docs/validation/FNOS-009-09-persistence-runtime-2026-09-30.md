---
feature: FNOS-009-09
acceptance: FNOS-009-09-AC-01, FNOS-009-09-AC-03
environment: DSH Desktop 自带运行时 0.2.0-rc.2 + 隔离探针 profile（`pnpm pack` 后的插件归档）
fnosVersion: 不适用
appVersion: 0.2.0-rc.2
pluginVersion: 0.2.0-rc.2.0
verifiedAt: 2026-09-30
status: passed
---

# FNOS-009-09 授权目录持久化运行时验证记录（2026-09-30）

本记录验证**新宿主代码在真实 DSH 运行时中确实被执行**，而不只是通过单测。
单测可以证明函数逻辑，但不能证明路由真的挂上、settings 命名空间真的可写。

## 环境与安装方式

| 项 | 值 |
| --- | --- |
| 运行时 | DSH Desktop 应用自带 dsh `0.2.0-rc.2`（`ELECTRON_RUN_AS_NODE`） |
| `DSH_HOME` | `/tmp/dsh-fnos-probe`（隔离） |
| 端口 | `8125`（一次性探针） |
| 插件来源 | `pnpm pack` 产出的 `tnnevol-dsh-fnos-0.2.0-rc.2.0.tgz` |

**为什么必须用打包产物**：源码 `package.json` 的 peer 依赖写的是 `catalog:dsh`，
这是 pnpm **工作区内**才存在的协议。直接 `dsh plugin add <插件目录>` 会失败：

```
dsh: installation rejected: Plugin @tnnevol/dsh-fnos@0.2.0-rc.2.0 is incompatible
with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-api-remotes":"catalog:dsh", …}
```

`pnpm pack` 会把 `catalog:dsh` 改写为字面版本 `0.2.0-rc.2`（已核实：打包后 peer 唯一值为
`{'0.2.0-rc.2'}`、不含 `catalog`），这与 npm 发布产物和 FPK 归档形态一致，因此才是真实路径。
这一点同时解释了本地开发 profile 为什么能直接用目录安装：`local-profile.ts` 的
`normalizeLinkedPluginManifest()` 会就地改写 `catalog:dsh` 为当前运行时版本。

## 步骤与结果

### 启动

装入打包归档后 `bundles` 为 `['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@tnnevol/dsh-fnos']`，
启动日志中 `dsh-fnos` 相关无 error/warn，无 `did not activate`，端口正常监听。

### 新增路由的实际响应

| # | 请求 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| 1 | `POST /plugins/dsh-fnos/authorized-directories/persist` `{"paths":[]}` | `{"paths":[]}` | 通过 |
| 2 | 同上，`{"paths":"nope"}`（非数组） | `HTTP 400` | 通过 |
| 3 | 同上，`GET` 方法 | `HTTP 405` | 通过 |
| 4 | `GET /plugins/dsh-fnos/authorized-directories` | `{"error":"fnos-authorized-directory-request-failed"}` | 通过（macOS 无 fnOS 宿主，属预期降级） |

### 持久化回合（09-AC-01）

| 回合 | 请求体 | 响应 | 说明 |
| --- | --- | --- | --- |
| 1 | `{"paths":["/vol4/demo"]}` | `{"paths":["/vol4/demo"]}` | 写入成功 |
| 2 | `{"paths":["/vol4/demo","/vol4/demo/","relative","bad"]}` | `{"paths":["/vol4/demo"]}` | 去重与非法项剔除生效 |

写盘结果（profile 的 `cordis.patch.yml`）：

```yaml
  name: "@tnnevol/dsh-fnos"
  config:
    authorizedDirectories:
      - /vol4/demo
```

即 `settings.update()` 真的把新字段持久化到了 profile 配置里，重启后可从同一位置读回。

## 遗留问题

- 本记录只验证**宿主侧**的持久化读写与路由行为；客户端「持久化优先展示」与
  「SDK 逐项校验剔除」需要 fnOS 宿主桥，必须在真实 NAS 上验收（FNOS-009-09-AC-02、
  09-10 全部 AC）。
- 第 4 行返回的是「fnOS 授权接口不可用」类错误，属于本机非 fnOS 环境的预期结果，
  不代表真实 NAS 上的行为。
- 探针 `DSH_HOME` 与打包产物位于 `/tmp`，为一次性验证环境，未写入用户数据。

## 结论

`FNOS-009-09-AC-01`（写入持久化）与 `FNOS-009-09-AC-03`（失败不破坏既有数据的行为边界）
在真实 DSH 运行时中**通过**：新路由可访问、入参校验生效、持久化确实落盘且可去重清洗。
客户端展示与 SDK 校验部分仍待真实 fnOS NAS 验收。
