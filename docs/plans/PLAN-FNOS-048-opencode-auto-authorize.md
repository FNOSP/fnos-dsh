---
id: PLAN-FNOS-048
title: PLAN-FNOS-048 OpenCode 登录授权页自动打开
description: 把设备码登录改为点登录即自动打开授权页的实施计划：开窗编排、Desktop 壳差异、复制兜底与验证。
status: in-review
owner: tnnevol
planDate: 2026-11-06
targetVersion: 8.1.2
lastVerified: 2026-11-06
---

# PLAN-FNOS-048 OpenCode 登录授权页自动打开

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-FNOS-048 |
| 计划日期 | 2026-11-06 |
| 对应需求 | [FNOS-048 OpenCode 登录授权页自动打开](/requirements/FNOS-048-opencode-auto-authorize) |
| 计划状态 | 待验收 |

## 计划目标

按 [FNOS-048](/requirements/FNOS-048-opencode-auto-authorize) 的四个功能编号，把「点登录 → 出现链接 → 再点一次」改为「点登录即自动打开授权页」，并在自动打开不可用时给出可复制、可手动选取的地址兜底。

技术边界：只改 `plugins/dsh-opencode-plugin` 的客户端（账号卡片、开窗编排、剪贴板、文案）；不改宿主壳、不改上游设备码协议。

## 当前实现与目标设计

| 领域 | 当前实现 | 目标实现 | 影响 |
| --- | --- | --- | --- |
| 打开授权页 | 卡片里渲染 `<a target="_blank">`，用户点第二次才打开 | 点击登录时在手势内自动打开；Desktop 由壳交给系统浏览器 | 少一步操作，窄侧栏里不再需要找链接 |
| 开窗时机 | 无开窗逻辑 | 手势内先开 `about:blank` 占位页，拿到地址后导航 | `window.open` 必须在任何 `await` 之前调用 |
| Desktop 差异 | 未处理 | 壳只放行 `http:`/`https:`，占位页被 deny；改用直接开真实地址 | `null` 句柄不等于失败，不得据此中断登录 |
| 验证码 | 用户手抄 | 打开 `verification_uri_complete`（自带 `user_code`） | 已有实现即取该字段，无需新增网络逻辑 |
| 入口 | 「打开验证页面」链接 | 移除，改为「复制授权地址」按钮 | 九语言文案同步增删 |
| 复制兜底 | 无 | `navigator.clipboard` → `execCommand` 回落 → 失败时显示地址原文 | 复制被拦截时用户仍有出路 |

## 关键约束

- **`window.open` 返回 `null` 不代表没打开**：Desktop 壳在主窗口装了 `setWindowOpenHandler`，对 http/https 调 `shell.openExternal` 后返回 `deny`。把 `null` 判成「被拦截」会让 Desktop 上授权页开着、设备码却不请求，登录完全中断（Codex 插件踩过这个坑）。
- **占位页与真实页的协议不同**：`about:` 被壳 deny，`https:` 放行，因此两条路径都要保留。
- **开窗失败不阻断登录**：设备码照常轮询，界面保留复制入口。

## 实施任务

| 编号 | 任务 | 对应功能 | 写入范围 |
| --- | --- | --- | --- |
| T1 | 新增开窗编排 `authorization-window.ts`：占位页、导航、直接开窗、收回 | FNOS-048-01 | `src/client/services/authorization-window.ts` |
| T2 | 新增剪贴板 `clipboard.ts`：`navigator.clipboard` + `execCommand` 回落 | FNOS-048-04 | `src/client/services/clipboard.ts` |
| T3 | 账号卡接入：手势内开占位页、导航失败改用直接开窗、取消时收回 | FNOS-048-01 | `src/components/OpenCodeAccountCard.tsx` |
| T4 | 移除「打开验证页面」链接，改为复制授权地址按钮与失败兜底展示 | FNOS-048-03、04 | 同上 + `src/styles/index.scss` |
| T5 | 九语言文案：删旧键、加复制键与失败键、提示语改为「已自动打开」 | 全部 | `src/client/locales*.ts` |
| T6 | 测试与文档：开窗单测、接线断言、需求/计划/用例回填 | 全部 | `tests/client/`、`docs/` |

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 浏览器拦截弹窗 | 授权页不自动打开 | 用户可点「复制授权地址」自行打开；设备码流程不受影响 |
| 用户中途关掉占位页 | 导航失败 | `navigateAuthorizationPlaceholder` 返回 false，改用直接开窗 |
| 壳行为变化（未来放行 `about:` 或收紧 https） | 某条路径失效 | 两条路径互不依赖，任一条可用即可 |
| 剪贴板被策略禁用 | 复制失败 | 渲染地址原文供手动选中 |

回滚：删除开窗编排与复制入口即可回到「链接式」实现，账号卡与文案一并回退。

## 验证计划

| 层次 | 方式 |
| --- | --- |
| 单元 | `tests/client/authorization-window.spec.ts`（浏览器 / Desktop / 被拦截 / 抛错四条路径） |
| 接线 | `tests/client/catalog-presentation.spec.ts` 的源码级断言（手势顺序、旧键移除、复制失败展示地址） |
| 类型与构建 | `pnpm run typecheck`、`pnpm run build` |
| 界面 | 两个客户端（DSH Web / DSH Desktop）点登录观察授权页是否自动打开、复制按钮是否生效 |
