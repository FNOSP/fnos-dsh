---
id: FNOS-034
title: FNOS-034 测试用例
description: FNOS-034 fnOS 授权目录选择器改为输入卡片宽浮层的测试用例与执行结果。
requirement: /requirements/FNOS-034-fnos-input-dock-picker
plan: /plans/PLAN-FNOS-034-fnos-input-dock-picker
status: 部分通过
lastVerified: 2026-10-28
verifiedAt: 2026-10-28
---

# FNOS-034 测试用例

## 测试范围与需求分析

被测对象是 fnOS 授权目录选择器的**承载形式**：从工具栏 28px 按钮上的 TreeSelect 下拉，改为 `conversation.input.overlay` 里贴齐输入卡片的浮层。选择语义（父子独立勾选、勾选即插入引用、取消即移除）必须原样保持。

执行任务见 [PLAN-FNOS-034](/plans/PLAN-FNOS-034-fnos-input-dock-picker)，覆盖[需求功能](/requirements/FNOS-034-fnos-input-dock-picker#功能列表)：

| 覆盖功能 | 关键风险点 |
| --- | --- |
| [FNOS-034-01](/requirements/FNOS-034-fnos-input-dock-picker#fnos-034-01) 选择器改为输入卡片宽浮层 | 是否仍写死像素宽度；是否与指令面板共用锚点；高度是否越出视口 |
| [FNOS-034-02](/requirements/FNOS-034-fnos-input-dock-picker#fnos-034-02) 保持原有选择语义 | 父子勾选是否被折叠；取消勾选是否漏删引用；会话间是否串状态 |
| [FNOS-034-03](/requirements/FNOS-034-fnos-input-dock-picker#fnos-034-03) 浮层有明确收起出口 | 点外部/Esc/再点图标是否都能关；点卡片内部是否误关 |

## 测试环境

| 环境 | 用途 | 是否作为验收依据 |
| --- | --- | --- |
| 包级测试（vitest） | 几何规则、槽位注册形状、树数据搬运、开关 store | **是**（逻辑层） |
| 构建 | `pnpm --filter @tnnevol/dsh-fnos run build` 产出 `lib/client.js` | **是**（产物） |
| FPK + 真实 fnOS NAS | 浮层在真实输入卡片上的呈现、真实授权目录树的勾选与引用增删 | **是**（验收依据） |

::: warning 本地 DSH Web 不作为验收依据
`@tnnevol/dsh-fnos` 注册 fnOS 设置命名空间、fnOS JS SDK 桥和网关前缀路由，脱离 fnOS 宿主没有可提供的能力，因此按[本地 DSH Web](/development/local-dsh-web)的约定**不进本地 profile**。

本需求的验收一律以 **FPK 在真实 NAS 安装后**的表现为准。开发期间若需观察前端几何，只能作为实现自检，不能计入验收结论。
:::

包级：`pnpm --filter @tnnevol/dsh-fnos run check`（typecheck + vitest 270 条）。

FPK：`pnpm run build` 后在应用中心安装，按 TC-101 起的真机用例执行。

## 测试用例

### FNOS-034-01 选择器改为输入卡片宽浮层

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-001 | FNOS-034-01-AC-01 | 用真实 `SlotCore` 注册浮层条目，读 `conversation.input.overlay` 的条目列表 | 官方 `slash-menu`/`command-popup`/`feedback-dialog` 原样保留，新条目排在最后 | 包级 |
| TC-002 | FNOS-034-01-AC-01 | 重复注册同一 id 与 priority | 抛出 `already has an entry`，证明必须用自有 id | 包级 |
| TC-003 | FNOS-034-01-AC-02 | 断言样式源码 | 面板规则内没有 `px` 宽度、没有 `560px`、没有 `100vw` | 包级 |
| TC-004 | FNOS-034-01-AC-02 | 断言面板规则 `left: 0` / `right: 0` / `bottom: calc(100% + 4px)` | 与上游斜杠菜单同一套几何 | 包级 |
| TC-005 | FNOS-034-01-AC-03 | 断言面板使用 `useAnchoredMaxHeight` 且顶部留 84 | 高度按视口上方可用空间钳制，与斜杠菜单同值 | 包级 |
| TC-006 | FNOS-034-01-AC-03 | 读树区与标题栏样式 | 树区 `overflow: auto` 自己滚，标题栏 `flex: none` 固定 | 包级 |
| TC-101 | FNOS-034-01-AC-02 | 真实 NAS 打开选择器，量面板与输入框的 `getBoundingClientRect` | 左右偏差为 0，宽度相等 | 真实 NAS |
| TC-102 | FNOS-034-01-AC-02 | 真实 NAS 上把浏览器窗口拉窄，再量一次 | 面板跟随输入框收窄，左右仍齐边，无横向滚动 | 真实 NAS |

### FNOS-034-02 保持原有选择语义

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-007 | FNOS-034-02-AC-01 | `selectedPaths(['/vol1', '/vol1/media'])` | 两条都保留，不做父子折叠 | 包级 |
| TC-008 | FNOS-034-02-AC-01 | `selectedPaths` 传入非绝对路径、重复项、空值 | 只留绝对路径并去重；空值归一为空数组 | 包级 |
| TC-009 | FNOS-034-02-AC-01 | 懒加载子节点后 `updateChildren` 并回父节点 | 子节点挂上、父节点 `isLeaf` 置 false、兄弟节点引用不变 | 包级 |
| TC-010 | FNOS-034-02-AC-02 | 断言引用插入仍走 `slash/input-insert-reference` 与官方 chip 占位 | 插入路径未变，草稿投影与 CAS 跨度数学保持原样 | 包级 |
| TC-011 | FNOS-034-02-AC-03 | store 上展开 A 会话后读 B 会话 | A 为 true、B 为 false | 包级 |
| TC-012 | FNOS-034-02-AC-03 | toggle 交叉翻转两个会话；重复 set 同一状态 | 各自独立翻转；重复设置不重复通知 | 包级 |
| TC-013 | FNOS-034-02-AC-03 | `closeAll` 后读各会话；退订后再变更 | 全部关闭且只通知一次；退订后不再通知 | 包级 |
| TC-014 | FNOS-034-02-AC-01 | 读树节点 `key`/`value` | 用内部路径而非可读语义路径（Host 路由只认内部路径） | 包级 |
| TC-103 | FNOS-034-02-AC-01 | 真实 NAS 勾选父目录与子目录各一 | 两条都被勾选并各自插入引用 | 真实 NAS |
| TC-104 | FNOS-034-02-AC-01 | 真实 NAS 取消一个已勾选目录 | 对应引用从草稿中移除，其余引用不变 | 真实 NAS |
| TC-105 | FNOS-034-02-AC-02 | 真实 NAS 勾选后发送消息 | 模型收到 `@/path/` 形式的 NAS 路径 | 真实 NAS |

### FNOS-034-03 浮层有明确收起出口

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-015 | FNOS-034-03-AC-01 | 断言点卡片外的关闭逻辑与卡片内豁免 | 命中 `[data-composer-card]` 时不关闭，否则关闭 | 包级 |
| TC-016 | FNOS-034-03-AC-02 | 断言 `Escape` 的 keydown 处理 | 存在 Esc 关闭分支 | 包级 |
| TC-017 | FNOS-034-03-AC-03 | 断言按钮走同一个 store 的 `toggle` | 再点图标关闭，`aria-expanded` 同步 | 包级 |
| TC-018 | FNOS-034-03-AC-01/02 | 断言收起后两个全局监听器都被移除 | 无残留 `pointerdown`/`keydown` 监听 | 包级 |

### FNOS-034-04 层级始终低于指令面板

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-019 | FNOS-034-04-AC-01 | 读面板规则里的 `z-index` | 为 99（低于指令面板的 100），且没有写回 100 | 包级 |
| TC-110 | FNOS-034-04-AC-01 | 真实 NAS 同时打开指令面板与选择器 | 指令面板显示在上，选择器不被遮挡 | 真实 NAS |

### FNOS-034-05 面板不提供搜索

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-020 | FNOS-034-05-AC-01 | 断言面板源码 | 不含 `filterTreeNode` 与 `searchPlaceholder` | 包级 |
| TC-111 | FNOS-034-05-AC-01 | 真实 NAS 打开选择器 | 面板内没有搜索框，目录树完整展示 | 真实 NAS |

### FNOS-034-06 面板内新建文件夹与空文件

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-021 | FNOS-034-06-AC-01 | 断言入口形态 | 标题栏没有新建按钮；菜单含文件夹与文件两项 | 包级 |
| TC-022 | FNOS-034-06-AC-02 | 断言右键处理 | 目录右键弹出上下文菜单（不是直接开弹框）；命中文件时不弹菜单 | 包级 |
| TC-023 | FNOS-034-06-AC-03 | 断言成功后的树更新 | 用 `updateChildren` 并入当前层，不整树重取 | 包级 |
| TC-024 | FNOS-034-06-AC-04 | `parseCreateRequest` 合法请求 | 返回规范化的 `{parent,name,kind}` | 包级 |
| TC-025 | FNOS-034-06-AC-04 | 父目录为相对路径 / `../` / 空串 | 相对与空串拒绝；`..` 被规范化且仍为绝对路径 | 包级 |
| TC-026 | FNOS-034-06-AC-04 | `kind` 传非 directory/file，或缺失 | 一律拒绝 | 包级 |
| TC-027 | FNOS-034-06-AC-04 | 名称含 `/`、`\`、`/abs`、`../escape` | 全部拒绝 | 包级 |
| TC-028 | FNOS-034-06-AC-04 | 名称含 `: * ? " < > \|` | 全部拒绝（SMB 兼容） | 包级 |
| TC-029 | FNOS-034-06-AC-04 | 名称含控制字符（NUL/BEL/换行） | 全部拒绝 | 包级 |
| TC-030 | FNOS-034-06-AC-04 | 名称为 `.`、`..`、空串、纯空白、超 255 字符 | 全部拒绝；255 字符通过 | 包级 |
| TC-031 | FNOS-034-06-AC-04 | 名称含中文、空格、点、短横线、前导点 | 接受（去首尾空白后） | 包级 |
| TC-032 | FNOS-034-06-AC-05 | 断言错误码到文案的映射 | 已存在/权限不足/空间不足/只读各有独立文案 | 包级 |
| TC-037 | FNOS-034-06-AC-06 | 断言弹层打开时的豁免条件 | 存在 `floatingOpen`（弹框或菜单打开）；两条全局关闭监听均带该守卫 | 包级 |
| TC-038 | FNOS-034-06-AC-07 | 断言菜单定位方式 | 自绘菜单，`position: fixed` + 鼠标坐标；落点经 `clampMenuPosition` 收进视口 | 包级 |
| TC-039 | FNOS-034-06-AC-07 | 断言菜单收起条件 | 点击菜单外或 Esc 时 `setContextMenu(undefined)` | 包级 |
| TC-040 | FNOS-034-08-AC-01 | 断言右键与菜单项可见性 | 文件也能右键；新建项只对目录显示 | 包级 |
| TC-041 | FNOS-034-08-AC-02 | 断言菜单项图标 | 三个菜单项各带语义图标；删除项用 `is-danger` | 包级 |
| TC-042 | FNOS-034-08-AC-03 | 断言删除确认形态 | 用 Popconfirm 就地确认（不再弹 Modal）；确认按钮 danger | 包级 |
| TC-043 | FNOS-034-08-AC-05 | 断言删除后的本地清理 | `removeNode`、`entries.delete`、勾选过滤 | 包级 |
| TC-044 | FNOS-034-08-AC-04 | `parseDeleteRequest` 校验 | 绝对路径通过；相对/空/NUL 拒绝；`..` 规范化 | 包级 |
| TC-120 | FNOS-034-08-AC-01/02 | 真实 NAS 右键文件与目录 | 文件菜单只有删除；目录有新建两项 + 删除；图标正常 | 真实 NAS |
| TC-121 | FNOS-034-08-AC-03/05 | 真实 NAS 删除一个自建文件夹 | 先弹确认；确认后条目消失，勾选与引用一并清除 | 真实 NAS |
| TC-122 | FNOS-034-08-AC-04 | 真实 NAS 尝试删除授权根 | 提示根目录不可删除，条目仍在 | 真实 NAS |
| TC-118 | FNOS-034-06-AC-07 | 真实 NAS 在树中段右键 | 菜单出现在光标附近（不是面板角落） | 真实 NAS |
| TC-045 | FNOS-034-06-AC-08 | 断言菜单渲染位置 | 用 `createPortal` 挂到 `document.body`；面板规则含 `backdrop-filter` | 包级 |
| TC-046 | FNOS-034-08-AC-06 | 断言浮层守卫覆盖所有 portal 浮层 | `floatingOpen` 含 `createTarget` 与 `contextMenu`；新增浮层漏加即失败 | 包级 |
| TC-047 | FNOS-034-09-AC-01 | 断言授权入口与 SDK 路径 | 标题栏含 `authorizeDirectory`，走 `pickAuthorizedDirectory` | 包级 |
| TC-048 | FNOS-034-09-AC-02/03 | 断言授权成功后的两个后续动作 | 同时调用 `applyEntries` 与 `requestPersistAuthorizedDirectories` | 包级 |
| TC-049 | FNOS-034-10-AC-01/03 | settings 为空、缓存有值 | settings 被回填为缓存值；缓存文件未被清空 | 包级 |
| TC-050 | FNOS-034-10-AC-02 | settings 已有值、缓存是旧的 | 以 settings 为准写文件；不回填 settings | 包级 |
| TC-051 | FNOS-034-11-AC-01/02 | GET 返回内置前缀 | 响应含 `builtin` 三项；设置页渲染只读区 | 包级 |
| TC-119 | FNOS-034-06-AC-07 | 真实 NAS 打开菜单后点面板其他位置 | 菜单收起，面板保持打开 | 真实 NAS |
| TC-117 | FNOS-034-06-AC-06 | 真实 NAS 打开新建弹框后点击各处 | 面板保持打开；关闭弹框后面板仍在 | 真实 NAS |
| TC-112 | FNOS-034-06-AC-01/03 | 真实 NAS 从右键菜单新建文件夹并填名 | 弹框可提交，新文件夹出现在该层，其它已展开节点保持展开 | 真实 NAS |
| TC-113 | FNOS-034-06-AC-02 | 真实 NAS 在目录上右键 | 先弹出上下文菜单（新建文件夹/新建文件），选一项后进入命名弹框，父目录为该目录 | 真实 NAS |
| TC-114 | FNOS-034-06-AC-05 | 真实 NAS 用已存在的名字新建 | 提示「同名文件或文件夹已存在」，不覆盖原条目 | 真实 NAS |

### FNOS-034-07 气泡提示只在被省略时出现

| ID | 覆盖验收 | 步骤 | 预期 | 执行环境 |
| --- | --- | --- | --- | --- |
| TC-033 | FNOS-034-07-AC-01/03 | 断言承载方式 | 用 `Typography.Text` + <code v-pre>ellipsis={{ showTooltip: true, rows: 1 }}</code>，不手写宽度测量 | 包级 |
| TC-034 | FNOS-034-07-AC-03 | 断言不再自行判定 | 源码里没有 `scrollWidth >`、`ResizeObserver`、`loadingdone` | 包级 |
| TC-035 | FNOS-034-07-AC-03 | 断言 children 为纯文本 | `Typography.Text` 内是 `{name}`（Semi 的 `ellipsis` 只支持 string） | 包级 |
| TC-036 | FNOS-034-07-AC-01/02 | 断言标签样式 | 容器 `min-width: 0`（不撑开）；文本不自定义 `text-overflow`/`white-space`（交给 Typography） | 包级 |
| TC-115 | FNOS-034-07-AC-01 | 真实 NAS：悬停一个名字较短、未被截断的目录 | 不出现气泡提示 | 真实 NAS |
| TC-116 | FNOS-034-07-AC-02 | 真实 NAS：把窗口拉窄使名字被省略号截断，再悬停 | 出现气泡提示并显示完整路径 | 真实 NAS |
| TC-106 | FNOS-034-03-AC-01 | 真实 NAS 打开面板后点页面空白处 | 面板收起 | 真实 NAS |
| TC-107 | FNOS-034-03-AC-01 | 真实 NAS 打开面板后点回输入框 | 面板**保持打开** | 真实 NAS |
| TC-108 | FNOS-034-03-AC-02 | 真实 NAS 打开面板后按 Esc | 面板收起 | 真实 NAS |
| TC-109 | FNOS-034-03-AC-03 | 真实 NAS 连点 fnOS 图标两次 | 先开、再关 | 真实 NAS |

## 测试执行结果

### 已执行（包级）

| ID | 结果 | 执行日期 | 证据/备注 |
| --- | --- | --- | --- |
| TC-001 | 通过 | 2026-10-28 | `tests/client/input-picker-panel.spec.ts`「浮层注册在 conversation.input.overlay，且排在官方条目之后」 |
| TC-002 | 通过 | 2026-10-28 | 同文件「使用自有 id，不替换指令面板与命令选择」 |
| TC-003 | 通过 | 2026-10-28 | `tests/client/input-picker-geometry.spec.ts`「不写任何固定像素宽度」 |
| TC-004 | 通过 | 2026-10-28 | 同文件「左右对齐锚点」「浮在输入卡片上沿之上」 |
| TC-005 | 通过 | 2026-10-28 | 同文件「面板用锚定的最大高度」「顶部留出会话头部的安全距离」 |
| TC-006 | 通过 | 2026-10-28 | 同文件「树区自己滚动，标题栏固定」 |
| TC-007 | 通过 | 2026-10-28 | `input-picker-panel.spec.ts`「保留父子同时勾选的路径」 |
| TC-008 | 通过 | 2026-10-28 | 同文件「丢弃非绝对路径并去重」「空值归一成空数组」 |
| TC-009 | 通过 | 2026-10-28 | 同文件两条 `updateChildren` 用例 |
| TC-010 | 通过 | 2026-10-28 | `tests/contracts/package-contract.spec.ts`「keeps fnOS file and folder references in the native input draft」 |
| TC-011 | 通过 | 2026-10-28 | `input-picker-panel.spec.ts`「展开一个会话不影响另一个会话」 |
| TC-012 | 通过 | 2026-10-28 | 同文件 toggle 交叉与「重复设置同一状态不触发通知」 |
| TC-013 | 通过 | 2026-10-28 | 同文件 `closeAll` 与退订两条 |
| TC-014 | 通过 | 2026-10-28 | 同文件「节点 key 与 value 都用内部路径」 |
| TC-015 | 通过 | 2026-10-28 | `input-picker-geometry.spec.ts`「点击输入卡片外部收起」 |
| TC-016 | 通过 | 2026-10-28 | 同文件「按 Esc 收起」 |
| TC-017 | 通过 | 2026-10-28 | 同文件「再点工具栏图标收起」 |
| TC-018 | 通过 | 2026-10-28 | 同文件「收起时监听器被移除」 |
| TC-019 | 通过 | 2026-10-28 | `input-picker-geometry.spec.ts`「面板 z-index 必须比指令面板的 100 低一级」 |
| TC-020 | 通过 | 2026-10-28 | 同文件「Tree 不开启 filterTreeNode，也不带搜索占位符」 |
| TC-021 | 通过 | 2026-10-29 | 同文件「标题栏没有新建入口，新建只从右键菜单进入」 |
| TC-022 | 通过 | 2026-10-28 | 同文件「右键目录可打开新建弹框；命中文件不提供新建」 |
| TC-023 | 通过 | 2026-10-28 | 同文件「创建成功后把新条目并进已展开的那一层」 |
| TC-024 | 通过 | 2026-10-28 | `tests/host/authorized-create-request.spec.ts`「接受合法请求」 |
| TC-025 | 通过 | 2026-10-28 | 同文件「父目录必须是绝对路径」「父目录里的 .. 会被规范化」 |
| TC-026 | 通过 | 2026-10-28 | 同文件「kind 只接受 directory 与 file」 |
| TC-027 | 通过 | 2026-10-28 | 同文件「拒绝任何路径分隔符（含反斜杠）」 |
| TC-028 | 通过 | 2026-10-28 | 同文件「拒绝 SMB 下非法的保留字符」 |
| TC-029 | 通过 | 2026-10-28 | 同文件「拒绝控制字符」 |
| TC-030 | 通过 | 2026-10-28 | 同文件「拒绝 . 与 ..」「拒绝空名与纯空白」「拒绝超长名称」 |
| TC-031 | 通过 | 2026-10-28 | 同文件「去掉首尾空白后接受常见名字」「允许中文、空格、点与短横线」 |
| TC-032 | 通过 | 2026-10-28 | `input-picker-geometry.spec.ts`「错误按原因给出可操作文案」 |
| TC-037 | 通过 | 2026-10-29 | `input-picker-geometry.spec.ts`「弹层打开时不因点外部销毁整个面板」等三条 |
| TC-038 | 通过 | 2026-10-29 | 同文件「菜单自绘并落在鼠标坐标上」「菜单落点被收进视口」 |
| TC-045 | 通过 | 2026-10-29 | `input-picker-geometry.spec.ts`「菜单经 Portal 挂到 body」 |
| TC-046 | 通过 | 2026-10-29 | 同文件「每个 portal 浮层的开关状态都纳入了 floatingOpen 守卫」 |
| TC-047 | 通过 | 2026-10-29 | `input-picker-geometry.spec.ts`「标题栏提供授权入口，走 fnOS 原生选择器」 |
| TC-048 | 通过 | 2026-10-29 | 同文件「授权成功同时刷新树与持久化」 |
| TC-049 | 通过 | 2026-10-29 | `gateway-proxy-route.spec.ts`「restores settings from the cached allowlist」 |
| TC-050 | 通过 | 2026-10-29 | 同文件「keeps settings authoritative when they already carry paths」 |
| TC-051 | 通过 | 2026-10-29 | 同文件「returns the built-in prefixes alongside the editable snapshot」 |
| TC-039 | 通过 | 2026-10-29 | 同文件「点击菜单外或按 Esc 自动收起菜单」 |
| TC-040 | 通过 | 2026-10-29 | `input-picker-geometry.spec.ts`「文件也能右键（可删除），新建项只对目录显示」 |
| TC-041 | 通过 | 2026-10-29 | 同文件「菜单项带图标」「菜单含删除项，且用危险色区分」 |
| TC-042 | 通过 | 2026-10-29 | 同文件「删除用 Popconfirm 就地确认，不再弹整块 Modal」 |
| TC-043 | 通过 | 2026-10-29 | 同文件「删除成功后把条目从树与勾选中摘掉」 |
| TC-044 | 通过 | 2026-10-29 | `tests/host/authorized-create-request.spec.ts`「删除条目：请求体校验」5 条 |
| TC-033 | 通过 | 2026-10-28 | `input-picker-geometry.spec.ts`「用 Semi Typography 的 ellipsis 承载省略与提示」 |
| TC-034 | 通过 | 2026-10-28 | 同文件「不再自己量 scrollWidth，也不手写 Tooltip 分支」 |
| TC-035 | 通过 | 2026-10-28 | 同文件「ellipsis 的 children 必须是纯文本」 |
| TC-036 | 通过 | 2026-10-28 | 同文件「容器允许收缩」「不自定义 text-overflow」 |

包级总量：36 个测试文件 / 318 条全绿（`pnpm --filter @tnnevol/dsh-fnos run check`）；`run build` 产出 `lib/client.js` 2.14 MB。

### 待执行（真实 NAS）

| ID | 结果 | 阻塞原因 |
| --- | --- | --- |
| TC-101 ~ TC-109 | 未执行 | 需先构建 FPK 并在真实 NAS 走应用中心安装 |
| TC-110 ~ TC-122 | 未执行 | 同上；另需 NAS 上已有可写的授权目录才能验证新建 |

## 未覆盖与后续验证

| 项 | 原因 | 后续动作 |
| --- | --- | --- |
| 浮层在真实输入卡片上的宽度对齐 | 包级只能断言样式规则，无法测出运行时的 `--dsh-composer-card-max-width` | 按 TC-101/TC-102 在真实 NAS 上量 |
| 真实授权目录树的勾选与引用增删 | 需要 fnOS 生命周期环境变量提供的授权路径 | 按 TC-103 ~ TC-105 在真实 NAS 上验证 |
| 三个关闭出口的实际手感 | 依赖真实事件与焦点行为 | 按 TC-106 ~ TC-109 在真实 NAS 上验证 |
| 与指令面板的真实叠放 | 需要真实打开两个面板 | 按 TC-110 在真实 NAS 上验证 |
| 新建条目真的落到磁盘 | 包级只覆盖请求校验与树更新，未触碰真实文件系统 | 按 TC-112 ~ TC-114 在真实 NAS 上验证 |

## 最终结论

包级 53 条用例全部通过；**验收尚未完成**——浮层呈现、层级叠放、新建条目的真实落盘都需在真实 NAS 上按 TC-101 ~ TC-117 执行后回填。按仓库约定，本地 DSH Web 的观感不作为验收依据。
