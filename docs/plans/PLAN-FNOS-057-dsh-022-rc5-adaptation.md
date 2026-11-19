---
id: PLAN-FNOS-057
title: PLAN-FNOS-057 DSH 0.2.2-rc.5 基线升级
description: 把运行基线从 0.2.2-rc.4 推进到 0.2.2-rc.5：四处承载处同源改写、七插件锚定、安装期补丁复核、文案同步，再在 DSH Web 与真实 fnOS NAS 上验收。
status: in-progress
owner: tnnevol
planDate: 2026-11-19
targetVersion: 8.3.0
lastVerified: 2026-11-19
---

# PLAN-FNOS-057 DSH 0.2.2-rc.5 基线升级

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-057 |
| 计划日期 | 2026-11-19 |
| 对应需求 | [FNOS-057](/requirements/FNOS-057-dsh-022-rc5-adaptation) |
| 计划状态 | 实施中 |

## 背景与判断

FNOS-056 跨 rc.2、rc.3、rc.4 三个版本，需要逐个版本做契约复核。本次只跨 rc.5 一个
版本，且产物级比对显示**改动面为 7 个文件、全部是文档与版本号，没有代码变更**
（见需求文档「调研结论」），因此计划的重心从「适配契约变化」转为「确认无变化并把
基线安全推进」。

可以直接复用的既有资产：

| 资产 | 位置 | 复用方式 |
| --- | --- | --- |
| 四处承载处一致性守卫 | `tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts` | 原样复用，目标值自动跟随 catalog |
| 七插件锚定流程 | FNOS-056 阶段三 | 同流程，目标值改 rc.5 |
| 安装回调基线识别 | `apps/fn-deepseek-harness/cmd/install_callback` | 沿用，验证 rc.4 → rc.5 替换 |
| `attachment-local` 补丁 | `packages/fnos-gateway/src/install-callback-helper/attachment-patch.ts` | 已在 rc.5 产物上验证三锚点各命中一次 |

## 阶段划分

### 阶段一：基线承载处改写

**T01 改写三处 catalog 承载**

- 用 `pnpm run version -- major --baseline 0.2.2-rc.5` 驱动，不手改。
- 该命令以 `readDshBaselineFromCatalog()` 读 `pnpm-workspace.yaml` 第 16 行为事实源，
  同步默认 catalog、命名 catalog `catalogs.dsh`、豁免清单 `minimumReleaseAgeExclude`
  三段。
- 验证：`grep -c '0.2.2-rc.5' pnpm-workspace.yaml` 与改写前 `rc.4` 的计数一致
  （rc.4 时为 388）。

**T02 同步安装回调常量**

- `apps/fn-deepseek-harness/cmd/install_callback` 的 `DSH_VERSION` 改为
  `"0.2.2-rc.5"`。
- `DSH_MIN_NODE_VERSION` **保持不变**（`24.9.0`）：rc.5 的 `engines.node` 仍是
  `>=24.9.0`。

**T03 运行四处一致性守卫**

- `pnpm exec vitest run tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts`。
- 该用例断言「默认 catalog / 命名 catalog / 豁免清单三者，以及 install_callback 的
  常量，全部等于 catalog 基线」，漏改一处即报红。
- 补一次变异验证：手动把某个命名 catalog 项改回 rc.4，确认守卫报错，再还原。

### 阶段二：插件锚定同步

**T04 七插件 `engines.dsh`**

- 七个 `plugins/*/package.json` 的 `engines.dsh` 改为 `"0.2.2-rc.5"`。
- 只改这一个字段：`peerDependencies` 里的 `catalog:dsh` 引用不动（那是 workspace
  catalog 别名，跟着 catalog 走）。
- 验证：每个包 `git diff` 恰好 1 行。

**T05 七插件 `compatibility.json`**

- `plugins/*/compatibility.json` 的 `dshPluginApi.version` 改为 `0.2.2-rc.5`。

**T06 守卫：插件锚定与基线一致**

- 复用 FNOS-056 补的断言，确认七插件的 `engines.dsh` 与 `compatibility.json`
  都等于 catalog 基线。

### 阶段三：安装期补丁与文案

**T07 `attachment-local` 补丁复核**

- 已在 rc.5 产物上验证：`package/lib/index.js` 的三个锚点
  （`path imports`、`durability boundary`、`attachment root and cache`）各命中
  **恰好一次**，补丁可原样使用。
- 该补丁按 `package.json.version` 严格校验，`DSH_ATTACHMENT_LOCAL_VERSION` 随基线
  自动变化，无需改代码。
- 记录到测试文档：rc.5 的 `lib/index.js` 与 rc.4 的锚点命中情况一致。

**T08 文案同步**

- `apps/fn-deepseek-harness/i18n/*`（9 语言）的 `desc` 中「运行基线为 DSH 0.2.2-rc.4」
  改为 rc.5。
- `plugins/*/README.md` 中「要求 DSH `0.2.2-rc.4`」改为 rc.5（6 个文件）。
- `docs/build/versioning.md` 里作为示例出现的基线字样不改（那是历史示例）。

**T09 changelog 撰写**

- 九语言同步更新 `changelog`，说明本次为纯基线升级、无功能变化。

### 阶段四：本地验证

**T10 全量测试**

- `pnpm run test`：确认无回归。FNOS-056 基线为 2124 条通过 + 3 条
  `bundled-plugin-install` 预存失败（在 `42fc2c63` 上可复现，非本次引入）。
- typecheck 全绿。

**T11 DSH Web 本地验收**

- `pnpm run start -- --web`，确认插件加载、会话可用。
- 注意：必须用 `pnpm run start -- --web`（注入 `DSH_HOME`），不能用
  `pnpm exec dsh web`（会写 `~/.dsh` 报 EPERM）。

### 阶段五：真实 fnOS NAS 验收

**T12 构建 FPK**

- `pnpm run build -- --fpk --app fn-deepseek-harness --platform x86 --bundle-dsh-plugins`。
- 产物命名应为 `fn-deepseek-harness-x86-v<版本>-dsh-0.2.2-rc.5.fpk`。

**T13 安装并观察**

- 走应用中心的「手动安装 → 从电脑上传」。
- **必须一边操作一边看界面**：注入后看安全提示、点同意后看服务配置向导、点下一步后
  看「更新中 NN%」进度条。不能只轮询安装日志。
- 判据：`input.files` 归 0 + 出现「未经验证应用的安全提示」。

**T14 三处对齐核验**

- `/var/apps/fn-deepseek-harness/manifest` 的 `version`
- 插件实际加载版本（`profiles/web/node_modules/@tnnevol/dsh-fnos/package.json`）
- 运行时基线（`@deepseek-ai/dsh/package.json` 的 `version` 应为 `0.2.2-rc.5`）
- 安装日志应出现「Local @deepseek-ai/dsh@0.2.2-rc.4 does not match required
  0.2.2-rc.5; reinstalling the required version.」

**T15 双入口验收**

- fnOS 桌面 iframe（`env=embedded`）与独立 DSH Web（`env=standalone`）两种形态，
  确认 `isFnosHosted() === true` 且 DS UI 正常。

### 阶段六：发版与回填

**T16 测试文档**

- 新建 `docs/tests/FNOS-057-dsh-022-rc5-adaptation.md`，含完整 frontmatter
  （id/status/owner/targetVersion/lastVerified）与关联需求、计划链接。
- 更新 `docs/requirements/index.md`、`docs/plans/index.md`、`docs/tests/index.md`。

**T17 文档站侧边栏**

- 在 `docs/.vitepress/config.mts` 的 requirements/plans/tests 三处登记 FNOS-057。

**T18 发版**

- `pnpm run version -- major --baseline 0.2.2-rc.5`（若 T01 已执行则此处只补版本）。
- 检查 `git log <上一个 tag>..HEAD --no-merges` 的业务提交同属 FNOS-057。
- tag 只留本地，推送由发布者手动执行。

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 只改 catalog 未改 install_callback | 安装期解析到旧基线，插件装错版本 | T03 守卫 + T14 三处对齐 |
| 插件 `engines.dsh` 漏改某个 | 该插件在 rc.5 上被拒装 | T06 守卫 |
| `attachment-local` 锚点漂移 | 安装期补丁失败，附件耐久性回退 | T07 已在 rc.5 产物上验证三锚点命中 |
| NAS 上旧插件目录属主被污染 | 安装回调 remove 步骤 EACCES | FNOS-056 期间已知：`chown -R` 修正后重装 |

回滚方式：基线升级集中在少量文件的版本号替换，`git revert` 对应提交即可回到 rc.4
状态，不涉及数据迁移。

## 任务清单

| 编号 | 任务 | 状态 |
| --- | --- | --- |
| T01 | 改写三处 catalog 承载 | 待开始 |
| T02 | 同步安装回调常量 | 待开始 |
| T03 | 运行四处一致性守卫 + 变异验证 | 待开始 |
| T04 | 七插件 `engines.dsh` | 待开始 |
| T05 | 七插件 `compatibility.json` | 待开始 |
| T06 | 守卫：插件锚定与基线一致 | 待开始 |
| T07 | `attachment-local` 补丁复核 | ✅ 已完成（rc.5 产物三锚点各命中一次） |
| T08 | 文案同步 | 待开始 |
| T09 | changelog 撰写 | 待开始 |
| T10 | 全量测试 | 待开始 |
| T11 | DSH Web 本地验收 | 待开始 |
| T12 | 构建 FPK | 待开始 |
| T13 | 安装并观察界面 | 待开始 |
| T14 | 三处对齐核验 | 待开始 |
| T15 | 双入口验收 | 待开始 |
| T16 | 测试文档与索引 | 待开始 |
| T17 | 文档站侧边栏 | 待开始 |
| T18 | 发版 | 待开始 |
