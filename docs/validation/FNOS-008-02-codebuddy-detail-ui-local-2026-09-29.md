---
feature: FNOS-008-02
acceptance: FNOS-008-02-AC-02, FNOS-008-02-AC-03
environment: 本机 DSH Web（`dsh web`，profile `web`）+ 探针 profile 无头渲染
fnosVersion: 不适用
appVersion: 0.1.7-rc.2
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-29
status: blocked
---

# FNOS-008-02 CodeBuddy 详情页与设置浮层本地验证记录（2026-09-29）

本记录补登 FNOS-008-02 在 `7944d3b` 之后的三处界面调整（`12568e8` / `01f3274`）：

1. 配置内容迁入组合包详情页的「包含的组件」之后；
2. 账号管理与积分总览的先后顺序对调；
3. 设置浮层改为 tip 图标承载说明，并改为左右布局。

仍是**本地与运行时级证据**，不是 fnOS/目标机验收，状态 `blocked`。

## 一、区块顺序

与 FNOS-008-01 同源：用 `plugins.detail.section` 座位，其在上游 `PackageDetail` 的
`detailSections` 子节点数组中**排在 `RowsSection`（「包含的组件」）之后**。硬顺序
见 [FNOS-008-01 记录](/validation/FNOS-008-01-fnos-detail-section-local-2026-09-29)。

运行时可视证据（探针 profile + 无头渲染器，`getBoundingClientRect()` 实测）：

| 元素 | top |
| --- | --- |
| 「包含的组件」列表 | **264** |
| CodeBuddy 配置卡片 | **408** |

`rowsTop < cardTop` 即「卡片在组件列表之下」，与源码顺序一致；展开交互正常。

## 二、账号管理 → 积分总览的顺序

同一渲染实例实测三段 top 值：

| 区块 | top |
| --- | --- |
| 账号管理区块头（`accountsHead`） | 450 |
| 账号卡片（`cards`） | 496 |
| 积分总览（`credits`） | 1258 |

即顺序为 **区块头 → 账号卡片 → 积分总览**。调整前积分总览在区块头之前（约 200 上下），
改后落在账号卡片之后。

契约用例（`tests/accounts-head.spec.ts`，3 条）：

- `积分总览排在账号卡片之后`；
- `积分总览不再出现在区块头之前`；
- `账号为空时积分总览自己不渲染`——空列表下不出现全 0 的卡片。

第三条同样是反向断言：只钉顺序的话，把积分总览整体删掉也能全绿。

## 三、设置浮层：tip 图标 + 左右布局

改造点：

- 每个设置项的说明从**平铺在标题下的第二行文字**收进**标题右侧的 tip 图标**，
  悬浮/聚焦显示；因此删除了「自动化」「显示」两个分组标题与全部行内说明文字
  （`settingsAutomation` / `settingsDisplay` 两个 i18n 键一并移除）；
- 行布局改为**左右两栏**：标签在左、控件在右并靠右对齐，右侧自动撑满；
- tip 图标鼠标样式为 `pointer`。

运行时实测（探针 profile + 无头渲染器）：

| 断言 | 实测值 |
| --- | --- |
| 设置项行数 | `rowCount = 5` |
| 每行均为左右布局 | `allLeftRight = true` |
| tip 图标数 | `tipCount = 5`（每行一个） |
| tip 鼠标样式 | `tipCursor = 'pointer'` |
| tip 可键盘聚焦 | `tipTabIndex = '0'` |
| 行内说明文字数量 | `inlineDescs = 0`（说明已全部收进 tip） |
| 残留分组标题数 | `groupTitles = 0` |
| 标签文案 | `['自动切换', '切换阈值', '自动签到', '自动旅行', '显示额度余量']` |
| 浮层内边距 / 最大高度 / 滚动 | `padding 16px` / `max-height 320px` / `overflow-y auto`，内容 523px > 320px，`scrollable = true` |
| 滚动容器右侧内缩 | `16px`（滚动条不贴边） |

**tip 文案一致性用真实鼠标事件验证**：Semi 的 Tooltip 不响应合成 `MouseEvent`
（实测 `popoverFound: false`），必须用 CDP `Input.dispatchMouseEvent` 派发
`mouseMoved`。实测 `tooltipCount = 1`，且浮层文本与图标 `aria-label` **逐字相同**。

## 契约测试

`tests/accounts-head.spec.ts` 37 条测试全绿，其中直接覆盖上述改造的：

- `说明文字收进标题右侧的 tip 图标，不平铺`；
- `tip 图标可被键盘与读屏访问（说明不能只存在于悬浮层里）`——这条防的是「只做鼠标
  悬浮」：读屏与键盘用户拿不到说明；
- 骨架屏与真实结构对齐（`AccountsSkeleton` 顺序改为 区块头 → 卡片 → 额度，与真实页一致）。

以上每条都做过**反转验证**：逐一还原改动并确认对应用例转红（tip、顺序、骨架顺序、
`pointer` 样式）。仅靠「测试是绿的」不足以说明测试真的在守这些约束。

## 门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @tnnevol/dsh-codebuddy run test` | 68 文件 / 896 测试通过 |
| `pnpm run check -- --packages --plugins` | 13/13 任务通过 |

## 未完成部分（状态 blocked 的原因）

- 未在**真实 fnOS NAS** 与目标发行环境验收；本记录依据本机 DSH Web 与探针 profile。
- 探针渲染证据产生于已清理的临时 profile，**未在生成时留存为证据文件**；本记录中的
  数值来自当轮实测输出。可随时复验的部分（上游源码顺序、契约测试）已在正文给出
  复验方式，数值类结论需重建探针环境后才能复核。
- `FNOS-008-02-AC-01`（登录、增删账号、自动签到/旅行、额度刷新等交互）与
  `AC-04`（单文档持久化与迁移脚本）不在本记录范围：前者需真实账号交互，
  后者见 `storage.spec.ts` 与 `migrate-storage.mjs`。

## 回滚

还原 `CodeBuddySettingsPopover.tsx` 的 `SettingRow`、`panel.tsx` 的积分总览位置与
`add-account-modal.scss` 的布局规则即可。**不涉及持久化数据**，回退无数据风险。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：三处界面调整均有运行时实测数值与契约测试，且逐条做过反转验证；
  真实 NAS 与交互走查待补，状态 `blocked`。
