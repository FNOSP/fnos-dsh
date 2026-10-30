---
id: FNOS-036
title: FNOS-036 测试用例
description: FNOS-036 DSH 0.2.1-rc.5 插件适配与基线迁移的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-036-dsh-021-rc5-adaptation
plan: /plans/PLAN-FNOS-036-dsh-021-rc5-adaptation
status: 执行中
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-036 测试用例

## 测试范围与需求分析

被测对象是 DSH 基线 `0.2.1-rc.3 → 0.2.1-rc.5` 迁移后的仓库运行时与七个入库插件。执行任务与阶段见 [PLAN-FNOS-036](/plans/PLAN-FNOS-036-dsh-021-rc5-adaptation)，覆盖需求功能：

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-036-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 七插件在新运行时加载与代表功能 | 门禁误拒、行挂起、宿主接缝行为差异 |
| [FNOS-036-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 界面插座位置、主题与 rc.5 插座契约复核 | rc.5 思考内容 Body 插座 props 变化波及插件区块 |
| [FNOS-036-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 基线多处一致与三方插件门禁 | 只改默认 catalog 造成假绿；发布龄期门禁拦截新版本 |
| [FNOS-036-04](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04) | 既有用户数据保持 | 迁移过程改写数据 |
| [FNOS-036-05](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | 联调检出与 Desktop 版本 | 检出 tag、启动版本与插件锚定不匹配 |
| [FNOS-036-07](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07) | 依赖版本单一事实来源 | 迁移时把版本字面量写回插件 manifest |

回归基线来源：[FNOS-029](/requirements/FNOS-029-dsh-021-rc3-adaptation) 在 `0.2.1-rc.3` 上的双客户端验收行为（插件管理页状态、界面区块位置、登录态与用量显示）。

CodeBuddy 插件按需求范围**排除**：不纳入本轮用例，其 `engines.dsh` 与兼容声明保持 `0.2.1-rc.3`。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-036-01、02、04 | DSH Web 与 DSH Desktop | Web：`pnpm run start -- --web`（`DSH_HOME` 指向仓库 `.dsh`，带 token 地址）；Desktop：上游检出开发态（`fork-pj/deepseek-harness`，CDP 取证） |
| FNOS-036-03 | 本地构建链路 + DSH Web | `pnpm run check`、启动日志版本核对、`dshmarket` peer 判定 |
| FNOS-036-05 | DSH Desktop | `git describe` 与启动日志版本核对 |
| FNOS-036-07 | 本地构建链路 | CLI 守卫用例 + 变异测试 |

## 测试用例

### [FNOS-036-07 插件依赖版本单一事实来源](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-036-07 | 七插件 DSH 依赖均为 catalog | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07) | 锚定改写完成 | 1.遍历七个插件 `package.json` 四类依赖 2.检索 `@deepseek-ai/dsh*` 条目 3.核对 `engines.dsh` 与 catalog | 全部为 `catalog:dsh`；`engines.dsh` 均为 `0.2.1-rc.5` | P0 | [FNOS-029-07](/requirements/FNOS-029-dsh-021-rc3-adaptation) 同口径 |
| TC-002 | FNOS-036-07 | 字面版本被门禁拒绝 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-07) | 门禁守卫在位 | 1.向半 UI 插件的 peer 注入 `0.2.1-rc.5` 字面量 2.运行基线守卫用例 3.还原后复跑 | 注入后守卫用例失败并点名该依赖；还原后全绿 | P1 | [FNOS-029-07-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-01 七个入库插件在新运行时正常加载](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-003 | FNOS-036-01 | 插件管理页七个插件无异常 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 基线迁移完成，DSH Web 以 rc.5 启动 | 1.启动 DSH Web（带 token 地址）2.打开插件管理页 3.逐个核对七个插件行 | 全部插件行正常显示、无「异常」标记、无行挂起 | P0 | [FNOS-029-01](/requirements/FNOS-029-dsh-021-rc3-adaptation) 同口径 |
| TC-004 | FNOS-036-01 | 运行日志无插件加载错误 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | TC-003 执行后 | 1.查看启动与运行日志 2.检索模块未找到、插座未声明、挂起类错误 | 仓库插件无此类错误 | P0 | [FNOS-029-01-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-005 | FNOS-036-01 | Codex Auth 登录态与用量显示 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 迁移前已有登录凭据 | 1.打开详情页 2.核对账号区 3.发起一次对话看用量 | 登录态保持；模型目录可同步；用量显示正常 | P0 | [FNOS-029 TC-003](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-006 | FNOS-036-01 | Failover Search 开关与转移 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载，既有偏好生效 | 1.核对输入区开关节 2.执行一次搜索类请求 | 开关状态与迁移前一致；搜索按配置顺序执行 | P1 | [FNOS-029 TC-004](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-007 | FNOS-036-01 | Midscene 桥接健康检查 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载 | 1.`curl` 桥接健康端点 2.核对模型目录 | 健康检查返回 ok；模型目录映射宿主提供方 | P1 | [FNOS-029 TC-005](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-008 | FNOS-036-01 | OpenCode 合并目录与后缀 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 已有 OpenCode 登录凭据 | 1.打开详情页 2.核对模型目录卡片 | 单一 `OpenCode` 分组；模型名带 `· zen` / `· go` 后缀 | P1 | [FNOS-026](/requirements/FNOS-026-dsh-opencode-plugin) |
| TC-009 | FNOS-036-01 | ZCode 登录态与额度显示 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 已有 ZCode 登录凭据 | 1.打开详情页 2.核对账号与额度卡片 | 登录态保持；额度窗口显示正常 | P1 | [FNOS-027](/requirements/FNOS-027-dsh-zcode-plugin) |
| TC-010 | FNOS-036-01 | Semi UI Showcase 渲染 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载 | 1.打开详情页 2.核对组件区块 | 各区块渲染无异常 | P2 | [FNOS-029 TC-008](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-011 | FNOS-036-01 | fnos 插件在 DSH Web 的加载状态 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-01) | 插件已加载（本地 Web 无 fnOS 宿主） | 1.核对插件管理页 fnos 行状态 | 插件包加载不报错（fnOS 专属能力按真实 NAS 口径另验） | P2 | [FNOS-029 TC-009](/tests/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-02 插件界面契约保持](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | FNOS-036-02 | 八类插座位置不变 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 插件已加载 | 1.核对插件详情区块 2.会话头部工具 3.输入区左右与浮层插槽 4.侧栏底部与设置动作 | 各区块出现在与 rc.3 基线相同的位置，无缺失、无重复 | P0 | [FNOS-029-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-013 | FNOS-036-02 | 亮暗主题渲染与切换 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 插件已加载 | 1.亮色主题走查插件区块 2.切暗色 3.再切回 | 两主题下可读；切换实时生效、无残留 | P1 | [FNOS-029-02-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-014 | FNOS-036-02 | 思考内容 Body 插座契约复核 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-02) | 已知 rc.5 新增该插座 props 变化 | 1.核对官方升级指南 2.核对插座目录 diff 3.检索七插件是否注册该插座或依赖该渲染链 | 插件未注册 `conversation.chat.reasoning.body`、未依赖 `dsh-client-ui-chat`；结论为无需适配 | P0 | 新增行为，无回归基线 |

### [FNOS-036-03 仓库运行与构建基线同步](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-015 | FNOS-036-03 | 基线多处一致 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 基线改写与重装完成 | 1.核对 catalog 三处（默认/命名/发布龄期豁免）2.核对 `install_callback` 3.核对七插件 `engines.dsh` 与 compatibility | 全部为 `0.2.1-rc.5`；仓库 `check` 通过 | P0 | [FNOS-029-04](/requirements/FNOS-029-dsh-021-rc3-adaptation) 多处同源口径 |
| TC-016 | FNOS-036-03 | DSH Web 运行时版本核对 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | TC-003 环境 | 1.读启动日志或关于页版本 2.与插件兼容声明比对 | 运行时报告 `0.2.1-rc.5`，与插件锚定一致 | P0 | [FNOS-029-04-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-017 | FNOS-036-03 | dshmarket 门禁判定 | [AC-03](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 基线已切 rc.5 | 1.semver 判定 peer 范围 2.核对三方插件版本未变 | `^0.2.1-rc.1` 包含 `0.2.1-rc.5`，安装不被拒 | P1 | [FNOS-029-04-AC-03](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-018 | FNOS-036-03 | 全插件包级验证 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-03) | 锚定改写与重装完成 | 1.仓库级 `check`（packages/plugins/tooling）2.逐插件核对 typecheck、单测与构建 | 全部退出码 0，基线一致性用例通过 | P0 | [FNOS-029-04](/requirements/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-04 用户数据兼容](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-019 | FNOS-036-04 | 既有凭据与偏好保持 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04) | 迁移前已存在凭据与偏好 | 1.迁移后启动 DSH Web 2.核对各插件登录态 3.核对模型配置与开关偏好 | 凭据、账号、偏好、模型配置全部生效，无需重新登录 | P0 | [FNOS-029-05](/requirements/FNOS-029-dsh-021-rc3-adaptation) |
| TC-020 | FNOS-036-04 | 迁移无数据改写 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-04) | TC-019 环境 | 1.比对迁移前后 `.dsh` 关键文件的内容与权限 | 用户数据文件未被迁移过程改写，权限保持 600 | P1 | [FNOS-029-05-AC-02](/requirements/FNOS-029-dsh-021-rc3-adaptation) |

### [FNOS-036-05 Desktop 联调检出更新](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-021 | FNOS-036-05 | 检出 tag 核对 | [AC-01](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | fetch 完成 | 1.在检出目录执行 `git describe --tags` 2.核对工作区干净 | HEAD 精确落在 `dsh-v0.2.1-rc.5` | P0 | [FNOS-029 TC-020](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-022 | FNOS-036-05 | Desktop 版本与插件加载 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | 检出已装依赖；项目 `.dsh` 作 `DSH_HOME` | 1.启动开发态 Desktop（渲染调试端口）2.读运行时版本 3.核对插件管理页 | 版本报告含 `0.2.1-rc.5`；七插件加载正常 | P0 | [FNOS-029 TC-021](/tests/FNOS-029-dsh-021-rc3-adaptation) |
| TC-023 | FNOS-036-05 | Desktop 界面回归 | [AC-02](/requirements/FNOS-036-dsh-021-rc5-adaptation#fnos-036-05) | TC-022 通过 | 1.CDP 走查插件详情与输入区块 2.亮暗主题切换 | 与 Web 侧结论一致：区块位置不变、切换生效 | P1 | [FNOS-029 TC-022](/tests/FNOS-029-dsh-021-rc3-adaptation) |

## 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-021 | FNOS-036-05 | DSH Desktop 检出 | 通过 | 2026-10-30 | `git fetch --tags` 后 checkout；`git describe --tags` = `dsh-v0.2.1-rc.5`（commit `b830ec950f`），`git status --porcelain` 为空 |
| TC-015 | FNOS-036-03 | 本地构建链路 | 通过 | 2026-10-30 | `pnpm-workspace.yaml` 内 `0.2.1-rc.3` 残留 0 处、`0.2.1-rc.5` 348 处（默认 catalog 1 + 命名 catalog 41 + 发布龄期豁免 305 + pnpm 自动补 1 条 `dsh-client-ui-entry-customization@0.2.1-rc.5`）；`install_callback` 的 `DSH_VERSION="0.2.1-rc.5"`；七插件 `engines.dsh` 与 compatibility 均为 rc.5（CodeBuddy 按范围保持 rc.3） |
| TC-001 | FNOS-036-07 | 本地构建链路 | 通过 | 2026-10-30 | 七插件 DSH 依赖全部为 `catalog:dsh`，无版本字面量；基线守卫用例 `keeps every plugin DSH dependency on the catalog and its engines.dsh on the runtime baseline` 通过 |
| TC-002 | FNOS-036-07 | 本地构建链路 | 通过 | 2026-10-30 | 变异测试：向 `dsh-semi-ui-showcase-plugin` 的 peer `@deepseek-ai/dsh-client-ui-slots` 注入 `0.2.1-rc.5` 字面量后，上述守卫用例由 ✓ 转为 ×；还原后复跑 100 条全绿 |
| TC-017 | FNOS-036-03 | 本地构建链路 | 通过 | 2026-10-30 | `dshmarket@1.66.47` peer `^0.2.1-rc.1` 按 semver 包含 `0.2.1-rc.5`；`published-dsh-plugins.json` 中 `dshmarket` 版本未变（仍 1.66.47） |
| TC-018 | FNOS-036-03 | 本地构建链路 | 通过 | 2026-10-30 | `pnpm run check -- --packages --plugins --tooling`：29 个 turbo 任务全部成功，0 失败；单测合计 CLI 100、gateway 147、plugin-kit 12、semi-ui 11，七插件 1366（codex-auth 137、fnos 369、failover-search 233、midscene 211、opencode 208、semi-ui-showcase 39、zcode 169），CodeBuddy 副本 1022（按范围仅构建，未纳入验收） |
| TC-014 | FNOS-036-02 | 本地构建链路 | 通过 | 2026-10-30 | 复核官方 `docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props`：`conversation.chat.reasoning.body` 的 `ReasoningBodyOwnerProps` 新增 `rawText`、`text` 改义为展示文本；插座目录 12 处改动中 11 处仅为 `source` 行号位移（`+6`），唯一契约变化即该插座；七插件未注册该插座、未依赖 `dsh-client-ui-chat` 或 `client-ui-cot-translation`，结论为无需适配 |
| TC-003 | FNOS-036-01 | DSH Web | 待执行 | — | — |
| TC-004 | FNOS-036-01 | DSH Web | 待执行 | — | — |
| TC-005～TC-011 | FNOS-036-01 | DSH Web | 待执行 | — | — |
| TC-012～TC-013 | FNOS-036-02 | DSH Web | 待执行 | — | — |
| TC-016 | FNOS-036-03 | DSH Web | 待执行 | — | — |
| TC-019～TC-020 | FNOS-036-04 | DSH Web | 待执行 | — | — |
| TC-022～TC-023 | FNOS-036-05 | DSH Desktop | 待执行 | — | — |

## Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-001 | 变异测试脚本用 `git checkout` 还原，把半 UI 插件的 `engines.dsh` 一起回退到 `0.2.1-rc.3` | P1 | 已修复 | 属于测试脚手架缺陷而非产品缺陷：首次变异脚本以 `git checkout -- <file>` 还原被注入的 manifest，连带回退了该文件上未提交的基线改动。复跑前审计七个插件时发现（仅该插件 `engines` 为 rc.3），已改回 rc.5 并复验；变异测试改为「备份文件 → 注入 → 运行 → 从备份还原」，不再触碰 git 工作区 |

## 测试结论

**执行中（包级与构建链路已通过，运行时回归待执行）**：23 条用例中 7 条通过（TC-021、TC-015、TC-001、TC-002、TC-017、TC-018、TC-014），16 条待执行，0 失败、0 阻塞。

- **执行统计**：执行 7 / 通过 7 / 失败 0 / 阻塞 0 / 待执行 16；遗留 Bug 0 个（BUG-01 已修复）。
- **一句话结论**：DSH 基线已从 `0.2.1-rc.3` 迁移到 `0.2.1-rc.5`，catalog 三处、七插件兼容锚定与安装回调四处同源一致，仓库与全部插件包级验证全绿，rc.5 唯一面向插件作者的插座契约变化经复核不落在插件能力面上；双客户端运行时回归尚待执行。
- **遗留风险**：
  1. **DSH Web 与 DSH Desktop 运行时回归未执行**（TC-003～TC-013、TC-016、TC-019～TC-020、TC-022～TC-023）：包级验证只证明「能编译、单测通过、门禁放行」，不证明插件在新运行时上加载与界面位置正确，需按计划 T03 补做。
  2. **FPK 真机安装与升级未执行**：安装回调 `DSH_VERSION` 已与 catalog 一致，但真实 fnOS NAS 上的安装/升级与 `dshmarket` 实装门禁需按发布流程验证。
  3. **CodeBuddy 副本停在 rc.3**（按需求范围排除）：它在本地 profile 中会因兼容判定被拒；如需继续使用需单独迁移，本轮不处理。
  4. **外部账号依赖**：Codex / OpenCode / ZCode 的登录态与额度显示依赖真实账号，运行时回归需沿用既有凭据。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 初始登记与包级结果回填 | 建立 FNOS-036 测试用例文档：23 条用例覆盖六项功能；回填包级与构建链路 7 条通过结果（检出 tag、基线多处一致、catalog 单一事实来源、门禁变异、三方插件判定、全插件包级验证、rc.5 插座契约复核）；登记并修复 BUG-01（变异脚本回退连带破坏锚定）。运行时回归待执行。 |
