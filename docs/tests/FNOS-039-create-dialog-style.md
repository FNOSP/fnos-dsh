---
id: FNOS-039
title: FNOS-039 测试用例
description: FNOS-039 新建条目弹框对齐 fnOS 样式的测试用例、执行结果与遗留项。
requirement: /requirements/FNOS-039-create-dialog-style
plan: /plans/PLAN-FNOS-039-create-dialog-style
status: 部分通过
lastVerified: 2026-10-30
verifiedAt: 2026-10-30
---

# FNOS-039 测试用例

## 测试范围与需求分析

被测对象是输入卡片选择器的「新建文件夹 / 新建文件」弹框：排版与按钮配色是否对齐 fnOS「文件管理」，文案是否随条目类型切换，以及配色覆盖是否被限制在本插件内。执行任务见 [PLAN-FNOS-039](/plans/PLAN-FNOS-039-create-dialog-style)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-039-01](/requirements/FNOS-039-create-dialog-style#fnos-039-01) | 排版与按钮配色对齐 fnOS | 覆盖外溢到 DSH 其它弹框；暗色主题下按钮不可读 |
| [FNOS-039-02](/requirements/FNOS-039-create-dialog-style#fnos-039-02) | 标签/确认文案随类型切换并带必填星号 | 文案与「新建」旧词混用 |
| [FNOS-039-03](/requirements/FNOS-039-create-dialog-style#fnos-039-03) | 配色只在插件内、不进共享包 | 共享包主题被改，所有插件主按钮变色 |

缺陷基线（修复前）：主按钮继承 DSH 反色主题（深底白字）、标签为「名称」、确认按钮为「新建」、弹框宽 420 且输入框沿用主题默认高度。

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-039-01、02、03 | 包级（Node / vitest） | `pnpm --filter @tnnevol/dsh-fnos test`；源码守卫用例 |
| FNOS-039-01、03 | 类型与风格 | `tsc -p tsconfig.json`、`eslint` |
| FNOS-039-01 | 产物 | `tsdown` 重建并核对 `lib/style.css` 中的作用域规则 |
| FNOS-039-01、02 | 真实 fnOS NAS | 构建 FPK → 应用中心正常安装 → 亮色与暗色主题各打开一次新建弹框（**未执行**） |

## 测试用例

### [FNOS-039-01 新建弹框对齐 fnOS 样式](/requirements/FNOS-039-create-dialog-style#fnos-039-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-039-01 | Modal 带上隔离类名 | AC-02 | 已读取组件源码 | 1.断言 `className="dsh-fnos-create-dialog"` | 存在 | P0 | portal 到 body，必须靠类名隔离 |
| TC-002 | FNOS-039-01 | 品牌蓝定义在弹框作用域内 | AC-01 | 已读取插件样式 | 1.取 `.dsh-fnos-create-dialog` 规则体 2.断言三个品牌变量 | `#06f` / `#005eeb` / `#0043b8` 均在块内 | P0 | fnOS `--semi-brand-5/6/7` |
| TC-003 | FNOS-039-01 | 确定按钮覆盖收在弹框之下 | AC-01 | 同上 | 1.断言内层选择器 `.semi-modal-footer .semi-button-primary` 2.断言背景取品牌变量 | 选择器带弹框前缀，背景为品牌蓝 | P0 | 覆盖外溢会让其它按钮变色 |
| TC-004 | FNOS-039-01 | 取消按钮白底描边 | AC-01 | 同上 | 1.断言 `:not(.semi-button-primary)` 规则 | 背景 `--dsw-alias-bg-layer-1`、边框 `--dsw-alias-border-l2` | P1 | 参考样式 |
| TC-005 | FNOS-039-01 | 产物含作用域规则 | AC-02 | 已完成构建 | 1.在 `lib/style.css` 中查找弹框选择器 | 出现 `.dsh-fnos-create-dialog` 与主按钮规则 | P0 | 构建链会把 SCSS 内联进 client |
| TC-006 | FNOS-039-01 | 亮色主题下的实际观感 | AC-01、AC-03 | 已安装含本改动的 FPK | 1.打开新建弹框并悬停/按下「确定」 | 品牌蓝 → hover 变浅 → 按下加深；标题、输入框尺寸与参考一致 | P0 | 本轮未执行 |
| TC-007 | FNOS-039-01 | 暗色主题下可读 | AC-03 | 同上 | 1.切到暗色主题 2.打开新建弹框 | 文字、边框、按钮均有对比，不出现深底深字 | P1 | 本轮未执行 |

### [FNOS-039-02 标签与确认文案对齐](/requirements/FNOS-039-create-dialog-style#fnos-039-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | FNOS-039-02 | 标签按条目类型切换 | AC-01 | 已读取组件源码 | 1.断言引用 `createDialogFolderLabel` 与 `createDialogFileLabel` 2.断言星号类名 | 两个键都被引用，存在 `dsh-fnos-create-required` | P1 | 参考样式「文件夹名称」 |
| TC-009 | FNOS-039-02 | 中文用词与 fnOS 一致 | AC-02 | 已读取文案表 | 1.断言中文 `createDialogFolderLabel`/`createDialogFileLabel`/`createDialogConfirm` | 「文件夹名称」「文件名称」「确定」 | P1 | fnOS 用词 |
| TC-010 | FNOS-039-02 | 星号对读屏隐藏 | AC-01 | 同上 | 1.断言星号节点带 `aria-hidden="true"` | 存在 | P2 | 避免读屏念出「星号」 |
| TC-011 | FNOS-039-02 | 两种类型各打开一次弹框 | AC-01 | 已安装含本改动的 FPK | 1.右键目录新建文件夹 2.右键目录新建文件 | 标题、标签分别对应类型，按钮均为「取消」「确定」 | P0 | 本轮未执行 |

### [FNOS-039-03 配色不外溢到共享包](/requirements/FNOS-039-create-dialog-style#fnos-039-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-012 | FNOS-039-03 | 共享包主题没有品牌色 | AC-01 | 已读取共享包 | 1.扫描 `theme.scss` 与 `theme.ts` | 不含 `#06f`、`0066ff`、`dsh-fnos-create-brand` | P0 | 提出人明确要求 |
| TC-013 | FNOS-039-03 | 其它插件与 DSH 弹框不受影响 | AC-02 | 已安装含本改动的 FPK | 1.打开 DSH 自带设置弹框 2.打开其它插件的主按钮 | 主按钮仍为 DSH 主题色 | P0 | 本轮未执行 |

## 执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001 ~ TC-005、TC-008 ~ TC-010、TC-012 | 通过 | `tests/client/input-picker-geometry.spec.ts`（新增 5 条守卫）；全量 `vitest run` 40 文件 / 379 条通过 |
| TC-005 | 通过 | `lib/style.css` 中可见 `.dsh-fnos-create-dialog` 变量声明与 `.semi-modal-footer .semi-button-primary` 规则 |
| TC-006、TC-007、TC-011、TC-013 | 未执行 | 需构建 FPK 后在真实 fnOS NAS 走应用中心安装验证 |

构建与静态检查：

- `tsc -p tsconfig.json`：通过。
- `eslint`（改动文件）：0 error（既有警告与本次改动无关）。
- `tsdown`：`lib/client.js` 与 `lib/style.css` 重建成功，样式体积 148.76 kB → 150.34 kB。

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| BUG-039-01 | 既有用例 `弹框收集名称并走宿主路由创建` 断言 `createDialogLabel` 失败 | 标签改为按类型取值后旧键不再被组件引用 | 用例改为断言 `createDialogFolderLabel`/`createDialogFileLabel` 与必填星号类名，契约随之更新 |
| BUG-039-02 | 全量测试曾出现 1 条失败（bundle 用例） | `client-bundle.spec.ts` 读的是上一次构建的 `lib/client.js` | 先 `tsdown` 再跑测试即通过；该用例本来就依赖产物，顺序问题不是回归 |
| BUG-039-03 | 真机：确定按钮仍是 DSH 深色、取消浅灰、输入框灰底、上下空白过大 | 共享主题按钮规则特异性 (0,6,1) 且用固定 token；content 默认内边距叠加 | 改用显式按钮类名 + 作用域内 `!important` 落色，content 内边距归零，输入框白底细描边，宽度 440→420；守卫用例同步改为断言类名与 `!important` |

## 最终结论

包级契约已验证：弹框带隔离类名，品牌蓝只定义在弹框作用域内，确定/取消按钮的覆盖均以弹框类名开头，共享包主题未混入 fnOS 品牌色与变量名；文案键按条目类型切换并带必填星号。

真机观感待补：TC-006、TC-007、TC-011、TC-013 需构建 FPK 后在真实 fnOS NAS 验证亮色/暗色两套主题与实际配色，届时回填本节与 `docs/validation/` 证据。
