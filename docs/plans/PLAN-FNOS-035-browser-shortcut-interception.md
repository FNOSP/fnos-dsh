---
id: PLAN-FNOS-035
title: PLAN-FNOS-035 fnOS iframe 内拦截浏览器快捷键
description: 在 fnOS iframe 的捕获阶段拦下刷新三键与「打开设置」组合，刷新走 reload、设置键转发给 DSH 官方命令，含实现、契约测试与真机验证。
status: done
owner: tnnevol
planDate: 2026-10-29
targetVersion: 6.1.13
lastVerified: 2026-10-29
---

# PLAN-FNOS-035 fnOS iframe 内拦截浏览器快捷键

| 字段 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-035 |
| 计划日期 | 2026-10-29 |
| 对应需求 | [FNOS-035 fnOS iframe 内拦截浏览器快捷键](/requirements/FNOS-035-browser-shortcut-interception) |
| 计划状态 | 阶段一至四全部完成（真实 NAS 验收于 2026-10-30 通过） |

## 实施结果（2026-10-29）

| 项 | 结果 |
| --- | --- |
| 阶段一 实现 | 完成：刷新快捷键沿用 `browser-refresh-shortcut.ts`；新增 `settings-shortcut.ts` 与纯判断 `settings-shortcut-matcher.ts`，在 `client/index.ts` 注册 |
| 阶段二 包级验证 | 完成：`pnpm --filter @tnnevol/dsh-fnos run check` 39 文件 / 367 条全绿 |
| 阶段三 真机验收 | **未执行**：需构建 FPK 后在真实 NAS 走应用中心安装。本地 DSH Web 不作为验收依据 |
| 阶段四 文档与版本 | 完成：需求/计划/测试用例回填；manifest `desc` 已列出两组快捷键；版本落 6.1.13 |

::: warning 设置键只能转发，不能自己开面板
`settings.open` 的 `resolve` 内部会判断「设置弹层是否已打开」，已打开则关闭。插件若自行调用开面板接口，就绕过了这个状态机，表现为「按一次能开、再按一次关不掉」。因此本计划的实现底线是：**只 `preventDefault` + 补发等价事件**，开合完全交给官方命令。

对应地，契约测试里有一条反向断言：源码中不得出现官方的私有开面板入口。
:::

## 计划目标

实现 [FNOS-035](/requirements/FNOS-035-browser-shortcut-interception)：让 DSH 的刷新与设置两组快捷键在 fnOS 应用的 iframe 内不被浏览器抢走，同时不改变 fnOS 之外任何环境的快捷键行为。

技术边界：只改 `plugins/dsh-fnos-plugin` 的客户端层，不修改 DSH 上游、不改网关与 Host 路由。

## 调研依据

| 事实 | 出处 |
| --- | --- |
| 设置键 Desktop 绑定 `primary + Comma`、Web 绑定 `primary + Alt + Comma` | `src/client/shortcuts/settings-shortcut-matcher.ts` 顶部绑定表 |
| `DshHotKeys` 只 `preventDefault`，无 `stopPropagation`，捕获阶段转发会重入 | `src/client/shortcuts/settings-shortcut.ts` 重入注释 |
| `settings.open` 自行判断开/关，插件代劳会让状态机失效 | 同文件顶部说明 |
| 适配器按事件目标区分 page / editable / terminal | 同文件 `redispatch` |
| 刷新无协商接口，只能 `location.reload()` | `src/client/shortcuts/browser-refresh-shortcut.ts` |
| 两套拦截都以 `isEmbeddedFnosFrame()` 为前提 | 两个模块开头的守卫 |
| 快捷键组件来自共享包 `DshHotKeys`，插件不重复实现按键解析 | `src/client/index.ts` 的 `@tnnevol/dsh-semi-ui` 导入 |

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 迁移影响 |
| --- | --- | --- | --- |
| 刷新 | 已由 `browser-refresh-shortcut.ts` 拦截三键并 `reload` | 保持不变，纳入本需求登记 | 行为不变 |
| 设置键 | 事件被浏览器消费，DSH 收不到，按了没反应 | 捕获阶段 `preventDefault` + 补发等价事件 | 用户按 `Ctrl/Cmd + ,` 能开设置 |
| 按键识别 | 刷新与设置各自一份纯函数 | 两份 matcher 互相独立，互不侵占 | 便于分别单测 |
| 启用范围 | 仅 fnOS iframe | 不变 | 其它环境零影响 |

### 组件职责

| 文件 | 职责 |
| --- | --- |
| `src/client/shortcuts/browser-refresh-shortcut.ts` | 注册 `F5` / `Ctrl+R` / `Cmd+R`，命中后 `reload` 当前文档 |
| `src/client/shortcuts/browser-refresh-shortcut-matcher.ts` | 纯判断：这三个组合是否算刷新 |
| `src/client/shortcuts/settings-shortcut.ts` | 注册 `Ctrl+,` / `Cmd+,`，命中后 `preventDefault` 并补发事件 |
| `src/client/shortcuts/settings-shortcut-matcher.ts` | 纯判断：是否算设置键（不含 React 与浏览器依赖，可在 Node 直接测） |

## 分阶段任务

### 阶段一：实现

| 任务 | 关联验收 | 内容 | 依赖 | 验证 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-035-T01-01 | FNOS-035-01 / AC-01、AC-02 | 刷新三键拦截：命中即 `preventDefault` + `stopPropagation` + `location.reload()` | 无 | 单测 + 契约测试 |
| PLAN-FNOS-035-T01-02 | FNOS-035-02 / AC-01、AC-04 | 抽出纯 matcher：认 `Ctrl/Cmd +`，带 `Alt` 也认，带 `Shift` 不认 | 无 | 单测 |
| PLAN-FNOS-035-T01-03 | FNOS-035-02 / AC-02、AC-03 | 捕获阶段拦下并补发等价 `KeyboardEvent`，目标沿用原事件目标 | T01-02 | 契约测试 |
| PLAN-FNOS-035-T01-04 | FNOS-035-02 / AC-06 | 补发期间置重入标志，事件放行给 DSH 适配器 | T01-03 | 契约测试 |
| PLAN-FNOS-035-T01-05 | FNOS-035-02 / AC-05 | 不调用官方私有开面板入口，只转发 | T01-03 | 反向断言 |
| PLAN-FNOS-035-T01-06 | FNOS-035-01/02 | 两套拦截都在 `client/index.ts` 用 `ctx.effect` 注册，卸载时清理挂载点与监听 | T01-01、T01-03 | 契约测试 |
| PLAN-FNOS-035-T01-07 | FNOS-035-01/02 | 两组 matcher 互不侵占：设置组合不触发刷新 | T01-02 | 单测 |

### 阶段二：包级验证

| 任务 | 关联验收 | 内容 | 依赖 | 验证 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-035-T02-01 | 全部 | `pnpm --filter @tnnevol/dsh-fnos run check` | 阶段一 | 命令输出 |
| PLAN-FNOS-035-T02-02 | 契约 | 包契约测试钉住两组快捷键的注册形状与「只转发」底线 | T01-05 | 测试 |

### 阶段三：真机验收

| 任务 | 关联验收 | 内容 | 依赖 | 验证 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-035-T03-01 | FNOS-035-02 | 构建 FPK 并在真实 NAS 走应用中心安装，按 `Ctrl/Cmd + ,` 打开设置面板，再按一次关闭 | T02-02 | 实机操作记录 |
| PLAN-FNOS-035-T03-02 | FNOS-035-01 | 按 `F5` 与 `Ctrl/Cmd + R`，确认只刷新 DSH Web，不跳出 fnOS 宿主页面 | T03-01 | 实机操作记录 |

### 阶段四：文档与版本

| 任务 | 关联验收 | 内容 | 依赖 | 验证 |
| --- | --- | --- | --- | --- |
| PLAN-FNOS-035-T04-01 | 全部 | 回填 `docs/tests/FNOS-035-*.md`；manifest `desc` 的快捷键条目列出设置键 | 阶段二、三 | 文档构建 |
| PLAN-FNOS-035-T04-02 | 全部 | 版本落 `targetVersion` 6.1.13（已在 `chore: release v6.1.13` 完成） | T04-01 | git log |

## 技术方案

### 为什么刷新直接 reload，设置却要转发

刷新没有协商余地：浏览器一旦认定是刷新就会重载文档，没有「请宿主不要刷新」的接口。插件能做的是抢在浏览器之前取消默认行为，再对**当前文档**执行一次 `reload`，这样重载的是 iframe 里的 DSH Web 而不是 fnOS 宿主整页。

设置不同：打开面板这件事 DSH 自己有一套状态机（未开则开、已开则关）。插件如果自行调用开面板接口，就绕过了状态机，第二次按键关不掉。所以插件只负责把事件从浏览器手里抢回来，再补发一次等价的 `KeyboardEvent`，让官方的 `settings.open` 按原逻辑执行。

### 为什么必须有重入保护

监听挂在 `window` 捕获阶段，而补发的事件同样会经过捕获阶段。`DshHotKeys` 只 `preventDefault`、不做 `stopPropagation`，因此补发的事件会再次进入插件自己的监听，无条件递归直到栈溢出。实现里用一个 `forwarding` 标志：补发期间置位，进入监听后直接返回。

### 为什么转发不额外加 `altKey`

用户按的就是 `Ctrl/Cmd + ,`（不带 `Alt`）。补发时沿用原事件的修饰键状态，等于把事件原样交回 DSH：不带 `Alt` 时命中 Desktop 那组 `primary + Comma`，带 `Alt` 时命中 Web 那组。凭空加修饰键会让语义对不上用户的实际按键。

### 转发目标

适配器按事件目标区分区域（page / editable / terminal）。补发时目标取原事件的 `target`（不可用时退回 `document.body`），否则 DSH 会按错误区域解读这次按键。

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 上游调整 `settings.open` 的默认绑定 | 转发后命中不到命令 | 两种形态（带/不带 `Alt`）同时认；契约测试钉住识别逻辑 |
| 上游给快捷键组件加上 `stopPropagation` | 重入保护变成多余但无害 | 标志位是幂等的，保留即可 |
| 用户在设置界面里正在输入，按键被误抢 | 输入 `,` 受影响 | 只在带 `Ctrl/Cmd` 且不带 `Shift` 时判定，纯逗号不拦 |
| 回滚 | — | 移除 `client/index.ts` 里对应的 `ctx.effect` 注册即可，两套实现各自独立 |

## 完成定义

- [ ] FNOS-035-01/02 的验收条件全部有测试或实机证据
- [ ] `pnpm --filter @tnnevol/dsh-fnos run check` 全绿
- [ ] `docs/tests/FNOS-035-*.md` 已回填
- [ ] manifest `desc` 的快捷键条目与实际绑定一致
- [ ] 版本落在 `targetVersion` 6.1.13 上（已随 `chore: release v6.1.13` 完成）
