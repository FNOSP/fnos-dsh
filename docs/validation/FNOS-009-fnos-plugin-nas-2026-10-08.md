# FNOS-009 fnos 插件真机验收与 BUG-04/05 修复记录

- 执行日期：2026-10-08
- 目标环境：飞牛 fnOS，`192.168.124.181:5666`（主机名 `fnos-mi`），`x86_64`
- 应用版本：`fn-deepseek-harness` 5.5.2（修复包），DSH `0.2.0-rc.2`
- 安装位置：存储空间 1
- 关联需求：[FNOS-009-02](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-02)、
  [FNOS-009-09](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-09)、
  [FNOS-009-10](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-10)
- 关联缺陷：BUG-04、BUG-05

## 背景

本轮目标是走查 **fnos 插件**（`@tnnevol/dsh-fnos`）在真实 NAS 上的全部功能。走查在
「授权目录」一处连续暴露两个 P0 缺陷，修复后在同一设备上复验通过。

## 缺陷 1（BUG-04）：授权目录列表永久停留加载中

**现象**：进入插件详情页后，授权目录区长期显示「正在加载授权目录…」，列表 0 行。

**取证**：

| 环节 | 观测 |
| --- | --- |
| 后端接口 | `GET /plugins/dsh-fnos/authorized-directories` → 200，返回 5 个目录 |
| 前端日志 | `[dsh-fnos][authorized-directories] refresh-start` → `refresh-success` |
| 校验日志 | **无任何 `validate-*` 日志**（模块共 3 条分支日志） |
| DOM | `.dsh-fnos-authorized-path-list` 节点不存在 |

无 `validate-*` 日志说明执行停在 `await sdk.ready()` 之前/之中，未进入任何分支。

**根因**：两个叠加因素。

1. `config/resource` 的 `api-scope` 未声明 `trim.file.userAccess`，而校验逻辑调用
   `authorizeUserFile`（需要该 scope）。
2. 更关键：fnOS SDK 的桥接调用**没有超时**。反编译 `@trimjs/web-app@0.4.2` 可见
   call sender 仅 `postMessage` 后等待宿主 `Reply`，宿主不回复则 Promise 永不 settle；
   `ready()` 的最后回退分支（Penpal 握手）同样没有超时。

因此表现为「静默挂起」而非报错。

**修复**：

- `config/resource` 补 `trim.file.userAccess`。
- `authorizeSharedFile` / `authorizeUserFile` 每次调用加超时（默认 10s），超时按
  「问不到」处理而不是「没权限」。
- `sdk.ready()` 加超时，超时走既有的 `validateUnavailable` 降级路径。

## 缺陷 2（BUG-05）：合法授权目录被误剔除并回写持久化

**现象**：在 fnOS「申请访问以下文件」弹框中点「允许」后，该目录不仅未出现在列表，
持久化记录还被清空。

**取证**：

```text
控制台：validate-evicted {"count":1}
落盘：  cordis.patch.yml → authorizedDirectories: []      # 授权记录被删除
```

**根因**：校验逻辑按错误契约读取 SDK 应答。

```ts
// 实现的假设
export type FnosAuthorizeResult = { ok: boolean } | undefined
if (response.ok === true) return 'valid'        // ok 恒为 undefined

// fnOS 的真实契约（官方文档 AppBridgeResponse<T>）
type AppBridgeResponse<T> = { code: number, msg: string, data: T }   // code: 0 为成功
```

`response.ok` 永远是 `undefined`，因此**每个** `removable` 目录都会走完两个接口、
两次判定为假，最终落到 `return 'invalid'` —— 用户刚授权成功的目录被判为「无权限」，
从展示列表移除，并因 `evicted === true` 同步回写持久化。

**为什么测试没拦住**：单测替身也按 `{ ok: true }` 构造，**替身与实现同错**，一路绿灯。
这与 [版本管理规范](/build/versioning) 记录过的 v5.5.0 事故同类：校验与被校验对象
共享同一份错误假设时，测试无法提供保护。

**修复**：

- 改用 `code === 0` 判定成功；单个接口返回非 0 只说明它不管辖该路径（用户目录必然
  不被共享目录接口接受），继续探测下一个接口，只有**两个接口都明确拒绝**才判为无效。
- 测试改用真实应答结构，并新增「调用永不 settle」「ready 永不 settle」两个用例。

## 复验结果（5.5.2）

### 降级路径（BUG-04 修复）

```text
控制台：validate-skipped {"reason":"sdk-unavailable"}          # 不再 validate-evicted
界面：  已按保存的记录展示目录；当前无法校验权限。                  # 降级提示
列表：  5 行（含 存储空间2/1000/fnos-fpk）                        # 目录未被剔除
按钮：  「添加授权目录」「刷新」均可用，加载文案已消失
```

### 目录保留与持久化（BUG-05 修复）

授权 `fnos-fpk` 后：

```text
列表（5 行）：
  存储空间2/1000/fnos-fpk            [取消授权]        ← 用户目录，可移除
  存储空间1/@appshare/fn-deepseek-harness  [应用共享目录]
  存储空间1/@apphome/fn-deepseek-harness   [应用共享目录]
  存储空间1/@appdata/fn-deepseek-harness   [应用共享目录]
  存储空间1/@appconf/fn-deepseek-harness   [应用共享目录]

落盘（cordis.patch.yml）：
  authorizedDirectories:
    - /vol2/1000/fnos-fpk
```

刷新列表后该目录仍从持久化记录展示。对比修复前同一路径被判无效并删除，行为已逆转。

## 本轮同时验证的 fnos 插件功能

| 功能 | 结果 | 证据 |
| --- | --- | --- |
| 插件详情页结构 | 通过 | 配置区常展开；`.dsh-fnos-authorized-path-list` 为 `max-height: 300px` + `overflow-y: auto`；插件根节点 `border-width: 0`（无外层框） |
| 应用共享目录为只读 | 通过 | 4 个 `removable: false` 项不参与校验、不出现「取消授权」 |
| 授权目录添加 | 通过 | 点击「添加授权目录」调起 fnOS 原生选择器，含「我的文件/外接存储/远程挂载/他人共享/我的收藏」分组 |
| 主题跟随系统 | 通过 | `<html data-ds-theme-source="system" style="color-scheme: light">`，与 `systemTheme: light` 一致 |
| 三方插件 proxy 保存 | 通过 | 输入 `/plugin-api` 保存后提示「已保存」，落盘 `gatewayProxyPaths: [/plugin-api]` |
| proxy 保留路径校验 | 通过 | 输入 `/api` 被拒绝，提示不可使用 `/api`、`/plugins` 或网关保留路径 |
| 插件安装状态 | 通过 | 插件页「已安装 4」，「异常」与「不兼容」均为 0 |

## 权限校验的修复过程与最终结果

段首那次「校验不可用」不是环境限制，而是实现选错了接口。修复分四步，每步都在
本设备上复验，逐层暴露下一个问题：

| 步骤 | 版本 | 问题 | 真机结果 |
| --- | --- | --- | --- |
| 1 | 5.5.2 | 按 `{ ok: boolean }` 读应答，真实契约是 `AppBridgeResponse`（`code: 0` 为成功），导致合法目录被判无权限并清空持久化（BUG-05）；另加超时兜底（BUG-04） | 列表不再卡死、不再误删 |
| 2 | 5.5.3 | 校验调用 `authorizeSharedFile` / `authorizeUserFile`，而这两个是**申请授权**接口——每次刷新都弹「申请访问以下文件」，且返回值只表示这次申请的结果 | 弹框消失 |
| 3 | 5.5.4 | `trim.file.getUserAccessibleFolders` 的 `uid` 是必填参数，漏传导致 fnOS 返回 `Appstore Error` | 后端响应转为 `valid: true` |
| 4 | 5.5.5 | 客户端解析响应时丢弃了 Host 标注的 `valid` 字段，导致每条目录都被当成「无法判定」 | 降级提示消失，校验真正生效 |

**5.5.5 复验（最终状态）**：

```text
后端：GET /plugins/dsh-fnos/authorized-directories
      → {"path":"/vol2/1000/fnos-fpk","removable":true,"valid":true}

界面：插件详情页显示 5 行，fnos-fpk 标注「取消授权」
      · 无「申请访问以下文件」弹框
      · 无「已按保存的记录展示目录」降级提示
      · 点「刷新」后状态不变（幂等）
```

权限校验至此真正生效：`valid === true` 保留、`valid === false` 剔除并回写持久化、
`valid === undefined`（查询接口不可用）保留并提示降级。

## 遗留
- 本次未覆盖：无。上述三项已在同一设备的后续走查中完成（见下节）。
- 持久化记录在修复前被 BUG-05 清空过一次，本轮已重新授权恢复。

## 后续走查（同一设备，同日）

### 会话日志导出

在真实会话（含 1 轮对话）上执行两条导出路径：

| 路径 | 结果 | 证据 |
| --- | --- | --- |
| 导出到 NAS | 通过 | 菜单列出 5 个已授权目录；选择 `存储空间2/1000/fnos-fpk` 后实际落盘 `dsh-session-session-bb00b361-…-1791442490409.zip`（10957 字节，属主 `fn-deepseek-harness`） |
| 导出到电脑 | 通过 | 界面提示「导出已开始下载」，走上游 `sessionLogDownload.download()` |

导出产物校验：

```text
ZIP 条目：session.v4.jsonl（1 个）
完整性：  OK
JSONL：   20 行，首行键 type/version/id/createdAt/cwd/isSeeded/delegationDepth/agentPreset
内容：    含会话 ID bb00b361 与本次消息「你好」
```

### 路径交文件管理器打开

点击会话头部的「在文件管理打开」，fnOS 文件管理器被调起并**定位到会话工作区目录**：

```text
面包屑：应用文件 > fn-deepseek-harness
内容：  .agents / .cache / .local / .bash_history / .npmrc
```

其中 `.npmrc` 的修改时间为本次安装写入镜像源的时间，说明打开的是当前实际目录而非固定路径。

### FNOS-009-11 父子勾选解耦

「插入 NAS 文件或目录」的 TreeSelect 展开 `存储空间2/1000/fnos-fpk` 后得到真实父子结构
（父目录 + 导出产物 ZIP + FPK 文件），据此逐步验证：

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| 1 | 勾选父目录 | 父目录 `checked`；**两个子项保持未勾选** |
| 2 | 再勾选子项 `fn-deepseek-harness.fpk` | 父与子**同时处于勾选状态**（Semi 默认 related 模式不允许此组合） |
| 3 | 取消父目录勾选 | 父目录取消；**子项 `fn-deepseek-harness.fpk` 仍保持勾选** |

第 3 步即 AC-01 的核心：取消父目录不再连带取消已选子项，父子状态相互独立。

## 本轮走查的完整功能清单

| 功能 | 结果 |
| --- | --- |
| 插件详情页结构与目录列表 | 通过 |
| 授权目录添加 / 列出 / 保留 / 持久化 | 通过（修复 BUG-04/05 后） |
| 权限校验与失效剔除 | 通过（5.5.5 起真正生效：无弹框、无降级提示、`valid: true` 保留） |
| 应用共享目录只读 | 通过 |
| 主题跟随系统 | 通过 |
| 三方插件 proxy 保存与保留路径校验 | 通过 |
| 会话日志导出（NAS / 电脑） | 通过 |
| 路径交文件管理器打开 | 通过 |
| 对话内引用 NAS 文件（父子勾选解耦） | 通过 |

## FNOS-009-06 用户数据兼容

### 升级前基线快照

在 5.5.5 状态、准备下一次升级前记录关键数据文件的哈希，用于升级后逐项比对
（`sha256` 取前 16 位）：

| 数据文件 | 内容 | sha256(前16) | 大小 |
| --- | --- | --- | --- |
| `codebuddy-auth.json` | CodeBuddy 账号凭据（6 个账号） | `2a92dfd037de584d` | 31770 |
| `.credentials.yaml` | DSH 凭据 | `e13d0fbfa1478e4a` | 161 |
| `profiles/web/cordis.patch.yml` | 插件设置（授权目录、主题、默认模型） | `97eb09c1ee154b62` | 450 |
| `storages/workspace.json` | 工作区与会话索引 | `443396b8d585ea9a` | 680 |

### 累计升级过程的保留结果

本设备在 2026-10-08 连续执行 5 次安装/升级：

```text
5.5.0 → 5.5.2 → 5.5.3 → 5.5.4 → 5.5.5
```

每次升级后确认以下数据均保留、无需手动迁移：

| 数据项 | 结果 |
| --- | --- |
| CodeBuddy 账号凭据 | 6 个账号持续保留（5.5.x 期间未丢失） |
| 授权目录 | `authorizedDirectories: [/vol2/1000/fnos-fpk]` 保留 |
| 主题偏好 | `systemTheme: light` 保留 |
| 默认模型配置 | `provider: codebuddy / model: deepseek-v4.1-flash` 保留 |
| 工作区与会话 | 1 个工作区、2 个会话保留 |

> 说明：`authorizedDirectories` 在 BUG-05 期间曾被清空一次（缺陷本身，已修复），
> 修复后重新授权并稳定保留；其余数据项全程未受影响。

## FNOS-009-12 真实 NAS 回调链路

安装日志 `/var/log/apps/fn-deepseek-harness.log` 的全量统计（截至 5.5.5 安装完成）：

| 指标 | 数值 |
| --- | --- |
| 带 release-age 放行的插件调用 | **68** 次 |
| `✓ Lockfile passes supply-chain policies` | **65** 次 |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | **0** 次 |
| 自有插件（`bundled-dsh-plugins` 归档）放行调用 | 36 次 |
| 三方插件（registry 安装）放行调用 | 2 次 |

日志形态（每次调用都同时出现放行标记与策略通过行）：

```text
[17:00:42] Running dsh plugin --profile web remove @tnnevol/dsh-codebuddy with the minimum release age disabled.
✓ Lockfile passes supply-chain policies (verified 7s ago)
[17:00:43] Running dsh plugin --profile web add file:.../dsh-codebuddy.tgz with the minimum release age disabled.
✓ Lockfile passes supply-chain policies (verified 1s ago)
```

判定：**自有插件与三方插件表现一致**，均使用放行调用；真实回调链路全程未出现
发布日期违规报错，即 FNOS-009-12-AC-01 在真机成立。三方插件 `dshmarket@1.66.11`
在多次升级中保持 `exact version already matches` 的版本收敛行为。

## FNOS-009-03 未验证说明

Codex Auth 的登录流程（AC-01）与对话区用量显示（AC-03）**未做真机验证**，原因：
需要真实 ChatGPT/OpenAI 账号完成浏览器授权，本次不具备该条件。已完成的 Web 走查
覆盖 AC-02（模型目录同步、模型选择与全局模型设置）。

按用户决定（2026-10-08）：本项**不做进一步验证**，保留已完成部分，不作为本次
验收的完成结论。
