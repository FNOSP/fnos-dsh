---
id: FNOS-040
title: FNOS-040 测试用例
description: FNOS-040 面板右键打开与重命名、状态保持与入口文案的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-040-picker-entry-actions
plan: /plans/PLAN-FNOS-040-picker-entry-actions
status: 部分通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-040 测试用例

## 测试范围与需求分析

被测对象分三块：右键「打开」按类型分流、重命名全链路（请求体校验 → 宿主路由 → 客户端封装 → 面板弹框）、面板展开与滚动的跨收起保持，以及输入区入口文案。执行任务见 [PLAN-FNOS-040](/plans/PLAN-FNOS-040-picker-entry-actions)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-040-01](/requirements/FNOS-040-picker-entry-actions#fnos-040-01) | 打开按类型分流、carrier 未就绪时失败 | 目录被交给 `openFile`（目录没有默认应用） |
| [FNOS-040-02](/requirements/FNOS-040-picker-entry-actions#fnos-040-02) | 名字校验、根目录保护、不覆盖同名 | POSIX 覆盖静默销毁用户数据 |
| [FNOS-040-03](/requirements/FNOS-040-picker-entry-actions#fnos-040-03) | 展开/滚动跨收起保留、勾选仍重置 | 记错滚动层，位置永远回到 0 |
| [FNOS-040-04](/requirements/FNOS-040-picker-entry-actions#fnos-040-04) | 气泡与无障碍名为「文件管理」 | 中英文只改一边 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-040-01 | 包级（Node / vitest） | `file-opener.spec.ts` 注入假 SDK |
| FNOS-040-02 | 包级 | `authorized-rename-request.spec.ts`（解析）；`authorized-directories-client.spec.ts`（封装） |
| FNOS-040-01 ~ 04 | 源码契约 | `entry-actions-contract.spec.ts`（菜单、路由、状态、文案） |
| FNOS-040-01 ~ 03 | 真实 fnOS NAS | 构建 FPK → 应用中心安装 → 逐项走查（**未执行**） |

## 测试用例

### [FNOS-040-01 打开按类型分流](/requirements/FNOS-040-picker-entry-actions#fnos-040-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-040-01 | 目录交给文件管理器 | AC-01 | 假 SDK | 1.`openFnosEntry(dir,'directory')` | 调用 `openFileManager`，不调用 `openFile` | P0 | 目录无默认应用 |
| TC-002 | FNOS-040-01 | 文件交给 fnOS 打开 | AC-02 | 假 SDK | 1.`openFnosEntry(file,'file')` | 调用 `openFile` | P0 | 预览走默认应用 |
| TC-003 | FNOS-040-01 | 先等 carrier 就绪 | AC-01 | 假 SDK | 1.检查调用顺序 | 首个调用为 `ready` | P1 | SDK 未就绪会静默无效 |
| TC-004 | FNOS-040-01 | standalone/非 web 显式失败 | AC-03 | 假 SDK | 1.`isStandaloneWeb=true` 调用 | 抛出 `web carrier` 错误且未打开 | P0 | 回退到原生打开会藏错 |
| TC-005 | FNOS-040-01 | 失败可见 | AC-03 | 源码 | 1.断言面板 toast `openEntryFailed` | 存在 | P1 | 静默失败无从排查 |
| TC-006 | FNOS-040-01 | 真机打开目录/文件 | AC-01、AC-02 | 已装 FPK | 1.右键目录「打开」2.右键文件「打开」 | 分别进入文件管理器与该文件的预览 | P0 | 本轮未执行 |

### [FNOS-040-02 重命名](/requirements/FNOS-040-picker-entry-actions#fnos-040-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-007 | FNOS-040-02 | 合法请求解析 | AC-01 | 无 | 1.`parseRenameRequest({path,name})` | 返回规范化后的 `{path,name}` | P0 | 与新建同一套规则 |
| TC-008 | FNOS-040-02 | 名字不得含分隔符或 `..` | AC-04 | 无 | 1.传 `../b`、`x/y`、`x\\y`、`.`、`..` | 全部为 `null` | P0 | 防越权挪目录 |
| TC-009 | FNOS-040-02 | 拒绝 SMB 禁名字符与控制字符 | AC-04 | 无 | 1.传 `a:b`、`a*b`、`a?b`、`a"b`、`a<b`、`a>b`、`a|b`、控制字符 | 全部为 `null` | P1 | 共享目录可被 SMB 访问 |
| TC-010 | FNOS-040-02 | 缺字段与非法体一律拒绝 | AC-04 | 无 | 1.传 `{}`、`null`、缺 `name`、缺 `path` | 全部为 `null` | P1 | 客户端先行不构成保证 |
| TC-011 | FNOS-040-02 | 客户端返回改名后的条目 | AC-02 | fetch 替身 | 1.`renameAuthorizedEntry('/a/old','new')` | 返回宿主给的 `{path,semanticPath,kind}` | P0 | — |
| TC-012 | FNOS-040-02 | 宿主错误码原样抛出 | AC-03 | fetch 替身 409 | 1.触发重名 | 抛出 `fnos-entry-exists` | P0 | 弹框据此给原因 |
| TC-013 | FNOS-040-02 | 响应缺字段不算成功 | AC-03 | fetch 替身 200 缺 `kind` | 1.解析响应 | 抛出 `invalid-rename-response` | P1 | 防止树里出现半截条目 |
| TC-014 | FNOS-040-02 | 宿主禁止改授权根、不覆盖同名 | AC-03 | 源码 | 1.断言 `fnos-rename-root-forbidden` 2.断言 `rename` 前 `stat(target)` | 两条都在 | P0 | POSIX 静默覆盖 |
| TC-015 | FNOS-040-02 | 成功后只重取父目录层 | AC-02 | 源码 | 1.断言 `applyEntries(await requestAuthorizedEntries(parent), parent)` | 存在，且未整树重取 | P0 | 整树重取会收起已展开分支 |
| TC-016 | FNOS-040-02 | 真机重命名 | AC-01、AC-02、AC-03 | 已装 FPK | 1.右键「重命名」改名为已存在名 2.改成合法新名 3.对授权根右键 | 重名报错、合法名就地生效、根不可改名 | P0 | 本轮未执行 |

### [FNOS-040-03 展开与滚动状态保持](/requirements/FNOS-040-picker-entry-actions#fnos-040-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-017 | FNOS-040-03 | 展开状态受控 | AC-01 | 源码 | 1.断言 `expandedKeys`/`onExpand` 传给 Tree | 都在 | P0 | 内部状态收起即丢 |
| TC-018 | FNOS-040-03 | 滚动记在正确的一层 | AC-01 | 源码 + 样式 | 1.断言取 `.dsh-fnos-path-panel-tree` 2.断言该规则含 `overflow: auto` | 两处一致 | P0 | 内层 list 只做横向 |
| TC-019 | FNOS-040-03 | 勾选仍每次重置 | AC-02 | 源码 | 1.断言 `setDesiredPaths(EMPTY_TREE_VALUE)` 与 `setDesiredPaths(undefined)` | 都在 | P1 | 提出人要求保持现状 |
| TC-020 | FNOS-040-03 | 改名/删除清掉展开记录 | AC-03 | 源码 | 1.断言两处 `forgetExpandedKeys(...)` | 都在 | P1 | 防残留失效 key |
| TC-021 | FNOS-040-03 | 真机展开与滚动还原 | AC-01 | 已装 FPK | 1.展开多层并滚动 2.收起 3.重新展开 | 展开与滚动位置还原 | P0 | 本轮未执行 |
| TC-022 | FNOS-040-03 | 真机勾选重置 | AC-02 | 同上 | 1.勾选两项 2.收起再展开 | 勾选为空 | P1 | 本轮未执行 |

### [FNOS-040-04 入口文案](/requirements/FNOS-040-picker-entry-actions#fnos-040-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-023 | FNOS-040-04 | 按钮取 `inputPicker` 键 | AC-01 | 源码 | 1.断言 `FnosInputPickerButton` 用该键 | 都在（`title` 与 `aria-label`） | P1 | 一处改两处生效 |
| TC-024 | FNOS-040-04 | 中英文都已改 | AC-01 | 源码 | 1.断言旧文案不存在、新文案存在 | `文件管理`/`File manager` | P1 | 只改一边会漏 |
| TC-025 | FNOS-040-04 | 真机悬停气泡 | AC-01 | 已装 FPK | 1.悬停输入区图标 | 气泡与读屏均为「文件管理」 | P1 | 本轮未执行 |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 ~ TC-005、TC-007 ~ TC-015、TC-017 ~ TC-020、TC-023、TC-024 | 通过 | 新增 4 个测试文件 / 30 条用例；全量 `vitest run` 43 文件 / 410 条通过 |
| TC-006、TC-016、TC-021、TC-022、TC-025 | 未执行 | 需构建 FPK 后在真实 fnOS NAS 走应用中心安装验证 |

构建与静态检查：

- `tsc -p tsconfig.json`：通过。
- `eslint src tests`：0 error（14 条既有 warning，与本次改动无关）。
- `tsdown`：`lib/client.js` 与 `lib/style.css` 重建成功；产物中可见 `rename-entry`、`openFnosEntry`、菜单分隔线与「打开 / 重命名 / 文件管理」文案。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| BUG-040-01 | 滚动位置最初记在 `.semi-tree-option-list` 上 | 该元素只负责横向（`overflow-x: auto`，`max-height: none`），纵向滚动在树根元素 | 改为 `.dsh-fnos-path-panel-tree`，并补样式断言把两者钉在一起 |
| BUG-040-02 | 宿主重命名路由初版引用 `AuthorizedCreateKind` 未导入 | 复用条目类型时漏了 type import | 补 import，typecheck 通过 |

## 最终结论

包级契约已验证：打开动作按类型分流且 carrier 未就绪时显式失败；重命名的名字规则与新建一致、根目录不可改、同名不覆盖、成功后只刷新父目录层；展开与滚动收归面板状态且滚动层与样式一致；入口文案中英文都已替换。

真机交互待补：TC-006、TC-016、TC-021、TC-022、TC-025 需构建 FPK 后在真实 fnOS NAS 验证，届时回填本节与 `docs/validation/` 证据。
