---
feature: FNOS-008-02
acceptance: FNOS-008-02-AC-06
environment: 本机 DSH Web（profile `web`，127.0.0.1:8070）+ 运行中实例的产物抓取
fnosVersion: 不适用
appVersion: 0.1.7-rc.2
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-29
status: passed
---

# FNOS-008-02 CodeBuddy 详情页 Token 统计移除折叠本地验证记录（2026-09-29）

本记录补登 FNOS-008-02-AC-06：详情页内「Token 统计」不再被折叠面板包住，
与「账号管理」同级以常驻区块标题呈现。

## 现象

实机截图显示详情页里两块内容的呈现层级不一致：

- 「账号管理」是常驻区块标题（`账号管理  0  [添加账号] [完成任务]  …`）；
- 「Token 统计」被 `<details open>` 包住，标题左侧带一个自绘展开箭头。

后果有两层。一是层级误读：同一页两个一级区块，其中一个带展开箭头，读者会以为
它归属上一块（视觉上像是「账号管理」的下级内容）。二是折叠本身没有收益：它写成
`<details ... open>`，默认就是展开的，进入页面并不需要多点一次，只是多包了一层
容器与一套 caret 样式。这与 fnOS 详情页此前的处理结论一致（见 FNOS-008
变更记录「fnOS 详情页配置区呈现调整」：**移除折叠，内容常驻**）。

## 本次实现

`panel.tsx`：Token 统计区块的 `<details>`/`<summary>` 换成与账号管理相同的
`dsh-codebuddy-panel-section-head` + `dsh-codebuddy-panel-section-title` 结构，
标题仍取 `t('tokenTitle')`（中英两份文案未动）。

`panel-shell.scss`：删除已无引用的 `.dsh-codebuddy-detail-collapse` 与
`.dsh-codebuddy-detail-summary` 全部规则，含自绘 caret 的 `::before`、
`[open]` 旋转、`::-webkit-details-marker` 与 `prefers-reduced-motion` 分支。
`.dsh-codebuddy-detail` 与 `.dsh-codebuddy-detail-section` 保留（前者负责区块间距，
后者仍是两块内容的共同容器）。

## 验证证据

### 一、契约测试（`tests/panel-layout.spec.ts`）

新增 2 条，替换原先断言「折叠样式存在」的 1 条（该断言与本次改动直接冲突）：

| 用例 | 断言 |
| --- | --- |
| `Token 统计与账号管理同级呈现，不被折叠面板包住` | 剥注释后详情页不含 `<details>` / `<summary>` / `detail-collapse` / `detail-summary`；Token 区块走 `dsh-codebuddy-panel-section-title` 且标题为 `<strong>{t('tokenTitle')}</strong>` |
| `折叠容器样式已删除（含 caret 与 reduced-motion 分支）` | `panel-shell.scss` 不再匹配 `.dsh-codebuddy-detail-collapse` / `.dsh-codebuddy-detail-summary` |

**逐条反转验证**（按验收规范，断言必须可证伪）：

| 反转项 | 结果 |
| --- | --- |
| 把 `<details>/<summary>` 结构加回 `panel.tsx` | `Token 统计与账号管理同级呈现…` **变红**（1 failed / 8 passed） |
| 把 `.dsh-codebuddy-detail-collapse` / `-summary` 规则加回 scss | `折叠容器样式已删除…` **变红**（1 failed / 8 passed） |
| 两项均还原 | 9 passed |

剥注释后断言是必要的：`panel.tsx` 里保留了一段解释「这里曾用 `<details open>` 折起来」
的历史注释，直接断言会把它误判成残留标签（与 `panel-layout.spec.ts` 前面几例同一做法）。

### 二、运行中实例的产物抓取（决定性）

本机 `web` profile 的 DSH 实例（127.0.0.1:8070）在改动期间**保持运行**，因此可用它
直接验证「浏览器最终拿到的是什么」，而不是只验证源码：

```text
GET /plugins/events                      → HTTP 200，SSE 首帧给出各产物 rev
  graph.entries[@tnnevol/dsh-codebuddy]  → rev = 2f037f1c57c5
GET /plugins/??@tnnevol/dsh-codebuddy/client.js&rev=2f037f1c57c5
                                         → HTTP 200, 6,420,160 bytes
```

对该响应的实测：

| 判据 | 服务中的产物 | 说明 |
| --- | --- | --- |
| `detail-collapse` 出现次数 | **0** | 折叠容器类已消失 |
| `detail-summary` 出现次数 | **0** | 同上 |
| `panel-section-title` 出现次数 | **7** | 常驻标题结构在位（含 Token 区块） |

磁盘产物同项对照：`detail-collapse` 0、`panel-section-title` 7；
`lib/style.css` 中折叠规则为 0。

浏览器侧**不需要重启 Host**：`dsh-client-hmr` 的 `client-hmr` 以
`pollIntervalMs`（默认 500ms）stat 轮询每个产物，元数据变化时调用
`clientModules.rebuilt(id)` 重算与重发 graph（源码位置：
`@deepseek-ai/dsh-client-hmr/lib/index.js` 的 `watchRow`/`publish`）。
本次抓取正是走的这条路径——Host 未重启，取回的 bundle 已是新版本。
刷新页面或等待 SSE 帧即可。

### 三、验收条件对照

| 验收条件 | 证据 | 结果 |
| --- | --- | --- |
| FNOS-008-02-AC-06 | 契约测试 2 条（逐条反转验证）；运行中实例抓取的 bundle 中折叠类为 0、常驻标题结构在位 | 通过 |

## 命令与结果

```text
pnpm --filter @tnnevol/dsh-codebuddy run check     # 68 files, 898 tests 全部通过
pnpm --filter @tnnevol/dsh-codebuddy run build     # lib/client.js 6.42 MB, lib/style.css 475 kB
pnpm exec eslint plugins/dsh-codebuddy-plugin      # 0 errors（68 个既有 warning 在未改动文件）
pnpm exec vitepress build docs                      # 通过
git diff --check                                   # 干净
```

## 未完成部分

- 未做**人眼**视觉走查（本次以运行中实例的产物抓取 + 契约测试为证据）；`getBoundingClientRect()`
  类的运行时几何数值未复测，本记录不主张任何布局数值。
- 真实 fnOS NAS 与目标发行环境未验收（本记录只覆盖本机 DSH Web）。Desktop 复用同一
  web 载体与同一 Host，产物同源，但未单独在 Desktop 走查。
- 未改动官方插件管理页自身的区块样式与「包含的组件」列表；本次只调整本插件注册进
  详情页的内容。

## 回滚

还原 `panel.tsx` 的 Token 区块为 `<details open>` 结构并恢复 `panel-shell.scss`
的折叠规则即可；不涉及数据、凭据或持久化状态。
