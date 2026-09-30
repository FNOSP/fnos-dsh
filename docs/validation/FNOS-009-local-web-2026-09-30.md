---
feature: FNOS-009-01, FNOS-009-03, FNOS-009-05, FNOS-009-06
acceptance: FNOS-009-01-AC-01, FNOS-009-01-AC-02, FNOS-009-03-AC-02, FNOS-009-05-AC-01, FNOS-009-06-AC-01
environment: 本机 DSH Web（`pnpm run start -- --web`，DSH_HOME=仓库内 .dsh）
fnosVersion: 不适用
appVersion: 仓库工作区（DSH 0.2.0-rc.2 基线）
pluginVersion: 0.2.0-rc.2.0
verifiedAt: 2026-09-30
status: passed
---

# FNOS-009 插件重锚定本地 DSH Web 验证记录（2026-09-30）

本记录登记四个插件从 `0.1.7-rc.2` 重锚定到 `0.2.0-rc.2` 后，在本机 DSH Web 上的加载与功能证据。
它证明的是**运行时门禁与插件加载**，不是 fnOS 目标机验收。

## 环境

| 项 | 值 |
| --- | --- |
| 启动方式 | `pnpm run start -- --web`（Turbo `//#dev:web` → `dsh web --no-open --port 8070`） |
| 运行时 | `dsh --version` = `0.2.0-rc.2`（仓库 `node_modules/.bin/dsh`） |
| 访问地址 | `http://127.0.0.1:8070/`（仅监听回环） |
| profile | 仓库内 `.dsh/profiles/web`（`link:` 三个插件源目录） |
| 插件版本 | 三个插件均为 `0.2.0-rc.2.0`，peer 归一化为 `0.2.0-rc.2` |

前置基线变更：`pnpm-workspace.yaml` 的 `catalog`/`catalogs.dsh` 全量重锚定 `0.2.0-rc.2`，
pi-ai 基线 `0.85.1 → 0.87.1`，`minimumReleaseAgeExclude` 同步；四插件 `package.json`
`version → 0.2.0-rc.2.0`、`compatibility.json` 声明同步；`pnpm install` 重解析 lockfile。

## 步骤与结果

### FNOS-009-01 插件在新运行时正常加载

1. 打开 `http://127.0.0.1:8070/`，进入「插件」页面。
2. **实际结果**：「已安装」区显示 3 个插件（`@tnnevol/dsh-codebuddy`、`@tnnevol/dsh-codex-auth`、
   `@tnnevol/dsh-semi-ui-showcase`），启用开关全部为开；全页文本内「异常」出现 0 次、
   「不兼容」出现 0 次；浏览器控制台无错误级消息。符合 `FNOS-009-01-AC-01`。
3. 依次进入三个插件的详情页，`包含的组件` 区均显示「1 个 · 1 运行中」，
   详情页标题下版本徽章为 `v0.2.0-rc.2.0`。符合 `FNOS-009-01-AC-02`。

### FNOS-009-03-AC-02 Codex Auth 模型设置可用（pi-ai 0.87.1 基线）

1. 进入 `@tnnevol/dsh-codex-auth` 详情页。
2. **实际结果**：状态为「已登录」；「全局模型」区渲染出模型选择弹层，
   弹层左侧分组为「模型 / 思考强度」，模型项包含 `GPT-6-Luna`、`GPT-5.6-Terra`、
   `GPT-5.6-Luna`、`GPT-5.5`。模型目录在新 pi-ai 基线上正常同步，
   且分组的弹层是 0.2.0-rc.2 的上游增量行为，未造成回归。

### FNOS-009-04 CodeBuddy 详情页与账号数据

1. 进入 `@tnnevol/dsh-codebuddy` 详情页。
2. **实际结果**：「账号管理」区渲染 6 个账号卡片，显示剩余额度（541 / 724 / 0 / 611）、
   资源包数量与到期时间、「已签到」「今日已旅行」标记；面板状态、自动偏好、成长任务与
   Token 统计接口（`/codebuddy/panelStatus`、`/codebuddy/autoPrefs`、
   `/codebuddy/growthRunStatus`、`/codebuddy/tokenStats`）全部返回 `200`。

### FNOS-009-05 Semi UI Showcase 加载与渲染

1. 打开 hash 路由 `#/plugins/semi-ui/button`。
2. **实际结果**：展示页完整渲染——左侧组件导航按「基础类 / 输入类 / 导航类 / 数据展示类 /
   布局与导航 / 反馈类 / 案例演示」分组列出 34 个组件；主区「Button 按钮」页渲染出
   「如何引入」代码块、按钮类型（主要/次要/第三/警告/危险）、主题与尺寸矩阵
   （solid/light/outline/borderless × large/default/small）、按钮状态（加载/禁用/图标/块级）
   与组合浮层区域。页面控制台无新增错误。
   符合 `FNOS-009-05-AC-01`。

### FNOS-009-06 升级后用户数据保持

本次升级构成一次真实的数据兼容路径：用户数据文件在重锚定**之前**写入。

| 项 | 值 |
| --- | --- |
| `codebuddy-auth.json` 写入时间 | 2026-09-30 11:32 |
| `workspace.json` 写入时间 | 2026-09-30 13:17 |
| 会话存储最早文件 | 2026-09-24 17:57（重锚定前 6 天），共 31 个 |
| 依赖重锚定与 `pnpm install` 时间 | 2026-09-30 16:54 |

1. 升级后打开 `@tnnevol/dsh-codebuddy` 详情页。
2. **实际结果**：6 个账号全部显示，`activeId` 生效（当前账号标记正确），
   `prefs` 的自动切换/签到/旅行状态照常使用；账号额度为升级后实时拉取。
   `codebuddy-auth.json` 未被清空或改写为默认值（升级后结构与升级前一致：
   `activeId`、`accounts`(6)、`version`、`prefs`）。
3. 侧边栏工作区与升级前一致：`harness debugger`、`测试猜想`、`技能安装`、`fnos-dsh`
   四个工作区全部可见，其下 4 个历史会话条目正常列出；
   `workspace.json`（13:17 写入）与会话存储（最早 09-24）均未被改写。
   符合 `FNOS-009-06-AC-01`（CodeBuddy 凭据与偏好、工作区与会话数据部分）。

## 控制台与网络

- 错误级控制台消息：仅 2 条 `404`，来自本次验证脚本手工请求的两个不存在路径
  （`/plugins/@tnnevol/dsh-codebuddy/package.json`、`/api/plugin-manager.list`），
  与插件行为无关；页面自身运行期间未产生错误。
- 插件自身路由：`/codebuddy/*` 全部 `200`；`/plugins/dsh-codex-auth-plugin/auth/status`、
  `/auth/global-model` 均 `200`。

## 遗留问题

- `@tnnevol/dsh-fnos` 按设计**不**进入本地 Web profile（`local-profile.ts` 明确排除：
  它注册 fnOS settings 命名空间与网关前缀路由，离开 fnOS 宿主只会产生失败行）。
  因此 FNOS-009-02（fnOS 插件功能）与 FNOS-009-09/10（授权目录持久化与权限校验）
  的运行时证据必须来自真实 fnOS NAS，本记录不覆盖。
- DSH Desktop 本机安装版本为 `0.2.0-rc.2`，与本次基线一致，但其 profile 不包含本仓库三个插件。
  在 Desktop 上验收需要先把插件装入 Desktop profile 并重启应用；本次未执行，
  `FNOS-009-01` 的 Desktop 环境结论仍待补。

## 结论

四个插件在 DSH `0.2.0-rc.2` 运行时的加载门禁已通过：插件管理页与三个详情页均无「异常」，
`FNOS-009-01`、`FNOS-009-03-AC-02`、`FNOS-009-05`（加载部分）在本机 Web 环境**通过**。
真实 fnOS NAS 与 Desktop 的结论另见后续记录。
