---
feature: FNOS-008-01
acceptance: FNOS-008-01-AC-01, FNOS-008-01-AC-03, FNOS-008-01-AC-04
environment: 本机 DSH Web（`dsh web`，profile `web`）+ DSH 0.1.7-rc.2 安装包源码
fnosVersion: 不适用
appVersion: 0.1.7-rc.2
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-29
status: blocked
---

# FNOS-008-01 fnOS 授权目录迁入插件详情页本地验证记录（2026-09-29）

本记录补登 FNOS-008-01 的实现证据。此前该功能只有提交（`7944d3b`）与单测，
没有 `docs/validation/` 记录，属流程缺失；本次补齐。

它仍是**本地与源码级证据**，不是真实 fnOS NAS 验收，因此状态为 `blocked`。

## 验收项与证据

### AC-01：区块位置在「包含的组件」列表**之后**

位置不是靠渲染截图断言的，而是**上游源码的硬顺序**——这是比截图更强的证据，
因为截图只能证明「这一次渲染对了」，源码能证明「结构上不可能排错」。

DSH 0.1.7-rc.2 的 `@deepseek-ai/dsh-client-ui-plugin-manager`（`lib/client.js`）
中 `PackageDetail` 的 `detailSections` 子节点数组，**按数组顺序渲染**：

```js
jsxs("div", { className: ….detailSections, children: [
  configured ? jsx("section", { "data-plugin-config": true,
      children: renderSlot("plugins.bundle.config", { view: "page" }, …) }) : null,
  jsx(RowsSection, { rows: pkg.rows, … }),               // ← 「包含的组件」
  renderSlot("plugins.detail.section", { subject })       // ← 本插件座位
]})
```

`plugins.detail.section` 是数组的**最后一个**元素，且 `RowsSection` 在其之前。
换言之：**只要用 `plugins.detail.section`，位置必然在组件列表之后**；此前用的
`plugins.bundle.config` 则被硬排在组件列表**之前**，这正是当初需要迁移的原因。

复验命令（无需构建，读已安装的包）：

```bash
grep -o 'renderSlot("plugins.detail.section", { subject })' \
  node_modules/.pnpm/@deepseek-ai+dsh-web-app@0.1.7-rc.2_*/node_modules/\
@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js
```

该命令返回 **3 处**（组合包页、组件页、组件配置页各一处），是本座位的三个宿主；
三处都在各自 `detailSections` 数组的**最后**，因此无论从哪个页面进入，本插件区块
都排在组件列表之后。判断「与 `RowsSection` 的相对位置」时看**同一处**的兄弟顺序，
不要把 3 处当成重复注册。

### AC-03：设置侧栏不再有授权目录标签页

- 客户端座位声明为 `plugins.detail.section`，`package.json` 的
  `dsh.client.inject` 与 `peerDependencies` 已**移除**
  `@deepseek-ai/dsh-client-ui-settings-plugins`；
- `compatibility.json` 同步移除该条目；
- `tests/contracts/package-contract.spec.ts` 的
  `keeps the fnOS authorization card on the plugin detail page` 断言座位为
  `plugins.detail.section` 且**不含** `settings.plugins.tab`。

### AC-04：只在 fnOS 自己的详情页渲染（自筛）

`plugins.detail.section` 是 **list** 座位、不按包名分派，同一页面的所有注册者都会
被渲染，因此**必须自筛**。`AuthorizedDirectoriesDetailSection` 校验三项后
才渲染：`subject.kind === 'bundle'`、`subject.pkg.name === '@tnnevol/dsh-fnos'`、
subject 存在。缺少任一即返回 `null`。

四条用例（`tests/client/settings-migration.spec.ts`，逐条覆盖一个失真方向）：

| 用例 | 防的失真 |
| --- | --- |
| 非 bundle 主题一律不渲染 | 串到「组件（row）」详情页 |
| 包名不匹配一律不渲染 | 串到别的组合包详情页 |
| subject 缺失时返回 `null` | 页面未给主题时的崩溃 |
| 包名与 package.json 一致 | 常量写错导致**永远不渲染** |

第四条是反向断言：它不检查「筛掉了别人」，而检查「自己没被筛掉」——只写前三条
时，把包名写成任意错误值都会全绿，而功能完全不出现。

## 门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @tnnevol/dsh-fnos exec vitest run tests/client/settings-migration.spec.ts tests/contracts/package-contract.spec.ts` | 2 文件 / 24 测试通过 |
| `pnpm --filter @tnnevol/dsh-fnos run check` | 159 测试通过 |

## 未完成部分（状态 blocked 的原因）

- 未在**真实 fnOS NAS** 与目标发行环境验收；本记录依据的是本机 DSH Web 与已安装
  的 0.1.7-rc.2 包源码，不是 NAS 运行时。
- `AC-02`（在区块内添加/删除授权目录、编辑网关代理路径并保存，行为与原设置卡片一致）
  有单测与契约测试，但**未做真实 NAS 上的交互走查**（需要真实授权目录与网关）。
- 早期一次探针渲染实测曾得到「卡片位于组件列表之后」的运行时可视证据，但该探针
  环境已清理、过程未随即登记为证据文件，故**不作为本记录的依据**（无留存即不可复核）。
  本次改用可随时复验的上游源码顺序，见 AC-01。
- fnOS 侧改动未提交到本仓库的只有 `pnpm-lock.yaml` 依赖变更，无需数据回滚。

## 回滚

还原 `plugins/dsh-fnos-plugin/src/client/index.ts` 的座位声明与
`AuthorizedDirectoriesCard.tsx` 的 `AuthorizedDirectoriesDetailSection`，
并把 `package.json` / `compatibility.json` 的 `dsh-client-ui-settings-plugins`
依赖加回即可。**不涉及持久化数据结构变更**，回退无数据风险。

## 验收人

- 执行：CodeBuddy（DSH 会话 Agent）
- 结论：AC-01 有上游源码级硬顺序证据，AC-03/AC-04 有契约与单测证据；
  真实 NAS 与交互走查待补，状态 `blocked`。
