---
id: FNOS-039
title: FNOS-039 新建条目弹框对齐 fnOS 文件管理样式
description: 把插件里「新建文件夹 / 新建文件」弹框的排版与按钮色调对齐 fnOS「文件管理」的同名弹框；按钮配色只在本插件内覆盖，不下沉到共享包主题。
status: in-progress
owner: tnnevol
targetVersion: 7.0.12
lastVerified: 2026-10-30
---

# FNOS-039 新建条目弹框对齐 fnOS 文件管理样式

| 项目 | 内容 |
| --- | --- |
| 需求编号 | FNOS-039 |
| 提出日期 | 2026-10-30 |
| 需求状态 | 实施中（包级用例、typecheck、lint 与 client 产物重建通过；真实 NAS 验收待执行） |
| 关联计划 | [PLAN-FNOS-039 新建条目弹框对齐 fnOS 文件管理样式](/plans/PLAN-FNOS-039-create-dialog-style) |
| 适用范围 | `@tnnevol/dsh-fnos` 输入卡片选择器内的新建条目弹框（`src/components/FnosAuthorizedPathPicker.tsx`、`src/styles/index.scss`、`src/client/locales.ts`） |

## 需求背景

输入卡片选择器的右键菜单可以新建文件夹与空文件（[FNOS-034-06](/requirements/FNOS-034-fnos-input-dock-picker)），弹框由 Semi `Modal` 承载。提出人对照 fnOS 自带的「文件管理」同名弹框后指出：**这个弹框和自己的产品风格不一致**，尤其「确定」按钮——DSH 亮色主题的主按钮是反色（深底白字），fnOS 用的是品牌蓝。

提出人同时明确了改动边界：**按钮色调在插件内改，不要改共享包**。`@tnnevol/dsh-semi-ui` 的主题被全部插件共用，把 fnOS 品牌色写进主题会让其它插件的主按钮一起变色。

参考样式（fnOS「文件管理」新建文件夹弹框）：标题左对齐加粗、右上角关闭；标签「文件夹名称」带红色必填星号；输入框圆角、占位文案同标题；底部右对齐「取消」（白底描边）+「确定」（品牌蓝实心）。

## 调研结论

| 结论 | 出处 | 影响的功能 | 状态 |
| --- | --- | --- | --- |
| fnOS 的品牌蓝取档位 `--semi-brand-5`：亮色 `rgb(0,102,255)`（`#0066FF`），hover/active 分别对应 `--semi-brand-6` `rgb(0,94,235)` 与 `--semi-brand-7` `rgb(0,67,184)` | fnOS Web UI 运行时样式表快照（`192.168.0.17:5666`，2026-10-30） | FNOS-039-01 | 已核实 |
| 共享包把 Semi 主色映射到 DSH 语义变量 `--dsw-alias-button-primary-fill`，亮色主题下即反色主按钮；因此 fnOS 蓝不能从主题层获得，只能局部覆盖 | `packages/dsh-semi-ui/src/theme.scss` 第 24-27 行（2026-10-30） | FNOS-039-01 | 已核实 |
| `DshModal` 是 Semi `Modal` 的直接再导出，`className` 会落到 `.semi-modal` 外层，`.semi-modal-header/body/footer` 都在其内部，因此可用插件类名把覆盖收在一个弹框内 | `packages/dsh-semi-ui/src/components.ts` 与 semi-ui 2.90.2 `modal/ModalContent.js`（2026-10-30） | FNOS-039-01 | 已核实 |
| 弹框经 Semi portal 渲染到 body，插件根节点不在其祖先链上，样式必须以弹框类名作作用域，否则会外溢到 DSH 自身的弹框 | 现有插件 SCSS 的同类约定（如 `.dsh-fnos-path-panel-*`）（2026-10-30） | FNOS-039-01 | 已核实 |
| 现有标签文案是「名称」、确认文案是「新建」，与 fnOS 的「文件夹名称」「确定」不一致 | `src/client/locales.ts` 改动前取值（2026-10-30） | FNOS-039-02 | 已核实 |

## 需求目标

- 弹框的标题、标签、输入框与底部按钮排版对齐 fnOS「文件管理」同名弹框。
- 「确定」按钮使用 fnOS 品牌蓝，「取消」按钮为白底描边并排其左。
- 标签按条目类型显示「文件夹名称」/「文件名称」，并带红色必填星号；确认文案统一为「确定」。
- 配色覆盖只存在于本插件，作用域限定在该弹框；共享包主题不出现 fnOS 品牌色。

## 功能列表

| 编号 | 优先级 | 功能 | 用户可观察结果 | 状态 |
| --- | --- | --- | --- | --- |
| FNOS-039-01 | P1 | 新建弹框对齐 fnOS 样式 | 弹框圆角、标题字号、输入框高度、「取消/确定」的排布与配色与 fnOS 文件管理一致，「确定」为品牌蓝 | <Badge type="warn" text="待验证" /> |
| FNOS-039-02 | P1 | 标签与确认文案对齐 | 新建文件夹时标签为「文件夹名称」、新建文件时为「文件名称」并带红色星号；按钮文案为「取消」「确定」 | <Badge type="warn" text="待验证" /> |
| FNOS-039-03 | P2 | 配色不外溢到共享包 | 其它插件与 DSH 自身的主按钮颜色不变；共享包主题文件里没有 fnOS 品牌色 | <Badge type="warn" text="待验证" /> |

## 行为约束

- 只改视觉与文案：新建流程、宿主路由调用（`createAuthorizedEntry`）、成功后并树（`updateChildren`）、错误码文案与焦点行为都不变。
- 颜色覆盖必须限定在弹框类名之下，不改共享包 `packages/dsh-semi-ui` 的任何主题文件。
- 颜色只使用两种来源：DSH 语义变量（背景、边框、文字）与插件内定义的 fnOS 品牌档位；不在半路写死其它色值。
- 名称规则提示（`createDialogHint`）保留：它是功能性说明，与视觉调整无关。

## 不在本次范围内

- 删除确认（`Popconfirm`）与右键菜单的视觉调整。
- 选择器主面板、树、工具栏的样式调整。
- 把 fnOS 品牌色提升为共享主题或 DSH 语义变量。
- 输入框校验规则、错误码与后端接口的变更。

## 既有功能变更关系

弹框的结构、流程与错误处理沿用 [FNOS-034-06](/requirements/FNOS-034-fnos-input-dock-picker)，本次只覆盖外观与两处文案；配色覆盖方式与 [FNOS-038](/requirements/FNOS-038-workspace-shortcut-tooltip) 一致——改动收在插件内，不动共享包。

## 验收条件与完成状态

### FNOS-039-01

- `FNOS-039-01-AC-01`：弹框「确定」按钮为 fnOS 品牌蓝 `#0066FF`，悬停变浅、按下加深；「取消」为白底描边且位于「确定」左侧。
- `FNOS-039-01-AC-02`：弹框宽度、圆角、标题字号与输入框高度与参考样式一致（440 / 12px / 18px 600 / 40px）。
- `FNOS-039-01-AC-03`：弹框在亮色与暗色主题下文字、边框、背景均有对比，不出现某个主题下按钮不可读。

### FNOS-039-02

- `FNOS-039-02-AC-01`：标签随条目类型切换为「文件夹名称」/「文件名称」，并带红色必填星号（星号对读屏隐藏）。
- `FNOS-039-02-AC-02`：确认按钮文案为「确定」，取消为「取消」；英文切换到 `Folder name`/`File name` 与 `Confirm`/`Cancel` 语义一致。

### FNOS-039-03

- `FNOS-039-03-AC-01`：`packages/dsh-semi-ui` 的主题文件不出现 fnOS 品牌色或 `dsh-fnos-create-brand`。
- `FNOS-039-03-AC-02`：配色覆盖选择器以弹框类名为前缀，不外溢到其它 Semi 按钮；由源码守卫用例固定。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 初始登记 | 建立 FNOS-039。提出人给出 fnOS「文件管理」新建文件夹弹框截图，要求插件同名弹框对齐，并明确「按钮色调在插件内改、不进共享包」。品牌蓝从 fnOS Web UI 的 `--semi-brand-5/6/7` 取值；另登记标签与确认文案的对齐项。5 条调研结论，关联 PLAN-FNOS-039。 |
| 2026-10-30 | 修正配色未生效与间距过大 | 提出人真机截图显示「确定」仍是 DSH 深色主按钮、取消是浅灰实心、输入框是灰底，且弹框上下有多余空白。定位两处：①共享主题给按钮写的是 <code>body[data-dsh-semi-theme] … .semi-button-primary.semi-button-solid:not(…)</code>（特异性 0,6,1）且使用固定 token，插件常规选择器压不过，作用域内改 token 又会把「取消」文字一起染蓝；②<code>.semi-modal-content</code> 默认内边距与我加的三段内边距叠加。改为给两个按钮挂显式类名（<code>dsh-fnos-create-confirm</code>/<code>-cancel</code>）在弹框作用域内用 <code>!important</code> 落色，content 内边距归零后由 header/body/footer 各自控制，输入框改白底细描边，宽度由 440 收到 420。<code>targetVersion</code> 更新为 7.0.7。 |
| 2026-10-30 | 按真机实测收敛版式 | 在真机页面（`/app/fn-deepseek-harness`，`192.168.0.17:5666`）注入同结构 DOM 实测：共享主题给 `.semi-modal-header` / `.semi-modal-footer` **各加 24px 上下 margin**，弹框因此 326px 高（header 高 46 却占 94、footer 高 72 却占 120）；`.semi-modal-close` 另有 `--semi-color-fill-0` 底色，在 DSH 主题里渲染成灰色方块。改为 margin 归零 + 三段自管内边距（header 20/24、body 12/24、footer 16/24/20），关闭按钮去底色去边框，常驻说明行改为只在出错时出现（名称规则并入「名称不可用」文案）。同一页面注入构建产物 CSS 复测：**326px → 196px**，确定按钮 `rgb(0,102,255)`、取消白底描边、输入框白底 40px，亮/暗两套主题均正确。<code>targetVersion</code> 更新为 7.0.8。 |
| 2026-10-30 | 以 fnOS 原生弹框为基准逐项对齐 | 在真机打开 fnOS「文件管理」的新建文件夹弹框，直接量取原生实现：弹框 **454** 宽、输入框 **36** 高/圆角 6/内部上下各 **1px**、按钮 **88×36**/圆角 8/字重 600/间距 **12**、取消为**透明底 + 描边 + 次级文字色**、placeholder 与标题一致（「新建文件夹」）。据此修正三处不符：①输入框原来 40 高且内层 `.semi-input` 只有 30 且贴顶（上 1 / 下 9），改为 36 高并让内层撑满（上下各 1）；②按钮由 72×32/r6/400 改为 88×36/r8/600；③新建弹框补 placeholder（与标题一致），重命名弹框以原名作 placeholder。同一页面注入构建产物 CSS 复测结果与基准逐项一致。<code>targetVersion</code> 更新为 7.0.9。 |
| 2026-10-30 | 去外描边、按钮间距改 15px | 提出人指出弹框外圈描边难看、两个按钮之间没有间距。定位两处基础样式：①`.semi-modal-content` 自带 `border: 1px solid var(--semi-color-border)`（Semi 基础样式，不是主题）；②`.semi-modal-footer` 在 Semi 里**只是 `text-align: right`，不是 flex**，此前只写 `display: flex; gap` 未加 `!important`，被基础样式压住后 `gap` 不生效，按钮实测贴在一起。改为 `border: 0 !important`（阴影沿用主题，不另加）、footer `display: flex !important` + `gap: 15px !important`，并保留相邻按钮 `margin-left: 0 !important` 防叠加。真机注入构建产物 CSS 复测：边框 `0px none`、阴影保留、实际按钮间距 **15px**。<code>targetVersion</code> 更新为 7.0.10。 |
| 2026-10-30 | 按钮间距真正生效 + NAS 弹框同套处理 | 提出人从 DevTools 指出：真正的 DOM 是 `.semi-modal-footer > div > button + button`——按钮外面还有一层包裹节点，`gap` 写在外层只作用于「外层与它唯一的孩子」，按钮之间仍是 0；而此前又把 Semi 自带的相邻 `margin-left` 归零，于是彻底贴在一起（我之前是用自己复刻的扁平结构自测的，结构不对，属于验证方法有误）。改为把 `display:flex + gap:15px` 写进 `.semi-modal-footer > div`。同时「导出 Session log 到 NAS」弹框按同一套处理：去描边（保留主题阴影）、标题带与按钮带的内边距各比新建弹框再收 5px（header 20/24→15/19、body 12/24→7/19、footer 16/24/20→11/19/15），并同样修正按钮间距。真机注入产物 CSS 复刻**真实嵌套结构**（含 tertiary light 取消按钮）复测：包裹层 flex、`gap` 15px、实测按钮间距 **15px**、边框 0、阴影保留。<code>targetVersion</code> 更新为 7.0.12。 |
