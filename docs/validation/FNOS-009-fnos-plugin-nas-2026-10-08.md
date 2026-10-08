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

## 遗留

- **权限校验当前不可用**：本机降级为「按保存记录展示」。这是因为校验所依赖的授权
  接口在用户未响应确认框时不会返回；修复后不再阻塞界面，但**校验本身尚未真正生效**。
  需要在 fnOS 侧确认 `authorizeUserFile` 对已授权路径的预期应答（`code` 取值），
  才能让剔除逻辑真正工作。已登记为后续事项。
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
| 应用共享目录只读 | 通过 |
| 主题跟随系统 | 通过 |
| 三方插件 proxy 保存与保留路径校验 | 通过 |
| 会话日志导出（NAS / 电脑） | 通过 |
| 路径交文件管理器打开 | 通过 |
| 对话内引用 NAS 文件（父子勾选解耦） | 通过 |
