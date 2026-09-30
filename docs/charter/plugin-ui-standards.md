---
title: 插件 UI 规范
description: DSH 插件 UI 必须优先使用 Semi Design 组件，并统一由 @tnnevol/dsh-semi-ui 维护样式主题，保证多插件样式一致。
---

# 插件 UI 规范

本规范约束 `plugins/` 下所有 DSH 插件的客户端 UI 实现。目标是让多个插件在 DSH 宿主中呈现一致的视觉与交互：同一套按钮、浮层、表单和树形选择，在亮色和深色主题下的表现完全统一，且样式只需维护一处。

## 核心原则

1. **优先使用 Semi Design 组件**：插件 UI 优先使用 Semi Design 现成组件，不重复实现按钮、弹窗、下拉、表单等 Semi 已有的能力；确实没有对应组件时才允许自定义实现。
2. **组件统一从共享包导入**：插件不直接依赖 `@douyinfe/semi-ui`。需要 Semi 组件时，一律导入 `@tnnevol/dsh-semi-ui` 导出的 `Dsh*` 组件，由共享包负责转发、封装和按需加载。
3. **样式主题统一维护**：Semi 组件的颜色、边框、圆角、浮层和选中状态映射由 `@tnnevol/dsh-semi-ui` 的主题层统一维护，插件不得自行编写 Semi 主题覆盖样式。
4. **跟随 DSH 主题变量**：所有自定义样式必须使用 DSH 语义变量（`--dsw-*`），不得硬编码颜色值，保证亮色、深色主题自动切换。
5. **一处修改，全部插件生效**：主题与通用组件的调整只在共享包中进行，调整后重建消费插件即可全局生效。

## 适用范围

| 范围 | 是否适用 |
| --- | --- |
| `plugins/*` 的 Client UI（页面、面板、弹窗、设置表单） | 适用 |
| 插件内跨页面复用的 `src/components/`、`src/client/ui/` 组件 | 适用 |
| `packages/dsh-semi-ui` 共享包自身 | 是主题的唯一维护方，见维护职责 |
| 文档站（`docs/`）的 VitePress 页面与 Vue 组件 | 不适用，遵循文档站自身样式体系 |
| Host 侧无 UI 的逻辑代码 | 不适用 |

## 组件选择优先级

新增或修改插件 UI 时，按以下顺序选择实现方式：

| 优先级 | 方式 | 条件 |
| --- | --- | --- |
| 1 | `@tnnevol/dsh-semi-ui` 已导出的 `Dsh*` 组件 | 默认选择，直接使用 |
| 2 | 在 `@tnnevol/dsh-semi-ui` 中新增封装 | Semi Design 存在对应组件但共享包尚未导出；封装并从 `src/index.ts` 导出后使用 |
| 3 | 插件内自定义组件 | Semi Design 没有对应能力；样式必须使用 DSH 语义变量，并在代码评审中说明理由 |

禁止的做法：

- 在插件 `package.json` 中新增 `@douyinfe/semi-ui`、`@douyinfe/semi-icons` 直接依赖，或从这些包导入组件与图标。
- 在插件内编写针对 Semi 类名（`.semi-*`）的主题覆盖 SCSS；同类调整应下沉到共享包。
- 绕过共享包主题层，自行调用 Semi 的主题定制机制。
- 在插件样式中硬编码颜色、圆角或阴影值。

插件常用图标由共享包随组件一并导出（文件、文件夹、关闭、设置、更新日志等），不要为此单独引入 `@douyinfe/semi-icons`。

## 配置项 UI 选择顺序

插件需要暴露配置项时，按以下顺序选择实现方式：

| 优先级 | 方式 | 条件与说明 |
| --- | --- | --- |
| 1 | **DSH 官方配置项 UI**（插件入口导出 `Config` 运行时 schema，如 Schemastery 定义） | 默认选择。官方 settings 表单自动生成、随宿主升级演进、与设置页和插件管理页的接缝天然一致；能用它表达的字段（文本、数字、布尔、枚举、列表等）必须用它 |
| 2 | **Semi UI 自定义配置区块**（`@tnnevol/dsh-semi-ui` 的 `Dsh*` 组件，注册到插件详情页座位） | 仅当官方配置 UI **不满足交互要求**时使用：需要账号卡片、列表管理、文件选择、跨区块布局、实时状态等表单控件表达不了的能力 |

判定规则：

- **先用官方，不满足才上 Semi UI**；「官方能实现但自定义更顺手」不构成绕过的理由。
- 选择 Semi UI 自定义时，必须在插件内用注释说明官方配置 UI 不满足的具体交互要求（缺什么控件、什么流程表达不了），并在代码评审中确认。
- 两者可以并存：能用官方 schema 表达的字段留在 `Config`，交互复杂的部分用自定义区块承载；不要为了统一而把简单字段也搬进自定义 UI。
- 官方 schema 的字段变更（新增、改名、默认值）会直接影响宿主表单与数据持久化，按插件契约处理并同步契约测试。

## 主题接入要求

每个插件 Client 启动时必须安装共享主题，并通过 `ctx.effect` 保证卸载时清理：

```ts
import { installSemiDshTheme } from '@tnnevol/dsh-semi-ui'

export function apply(ctx) {
  ctx.effect(() => installSemiDshTheme(), 'plugin: Semi DSH theme')
}
```

主题层基于 DSH 语义变量工作，不判断浅色或深色。接入后插件内的 `Dsh*` 组件自动获得正确的背景、文字、边框、主按钮反色和浮层表现。

气泡类浮层（Dropdown、Tooltip、Modal 等）的背景必须成对使用官方半透明变量与背景模糊，避免看穿底层内容：

```scss
background: var(--dsw-specific-menu);
backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
```

毛玻璃的层级约定（测试按此核对，见[测试用例文档规范](./tests-spec.md)的 UI 测试章节）：

- `backdrop-filter` 尽量加在**父元素**：由承载透明背景的容器统一设置模糊，子元素直接继承模糊后的视觉。
- 子元素**禁止重复叠加**：不得同时使用 `backdrop-filter` 与透明背景（两层模糊产生重影与性能损耗）；子元素需要自己的表面时用不透明或半透明纯色变量。
- 一个视觉块只允许一条模糊链路；Safari 18 之前需成对写 `-webkit-backdrop-filter`（共享包主题已处理）。

细节与已知坑见 [DSH Semi UI 共享包](/plugins/dsh-semi-ui)。

## 共享包维护职责

`@tnnevol/dsh-semi-ui` 是全部插件 Semi 组件与主题的唯一维护入口：

- 组件封装、导出清单和主题映射只在共享包内修改。
- 新增组件必须从 `src/index.ts` 明确导出，并同步更新组件清单。
- 主题调整需同时覆盖亮色与深色表现，不得只修单侧。
- 共享包样式会被内联进消费插件产物，修改主题后必须重建消费插件，不能只构建本包。

## 插件接入检查清单

提交插件 UI 变更前逐项检查：

- [ ] 没有新增 `@douyinfe/semi-ui`、`@douyinfe/semi-icons` 直接依赖或导入。
- [ ] 使用的 Semi 能力均通过 `@tnnevol/dsh-semi-ui` 的 `Dsh*` 组件表达。
- [ ] 新增的通用组件已下沉到共享包并导出，而不是留在单个插件内。
- [ ] Client 启动安装了 `installSemiDshTheme()`，且通过 `ctx.effect` 清理。
- [ ] 配置项 UI 按[配置项 UI 选择顺序](#配置项-ui-选择顺序)选择：能用官方 `Config` schema 表达的字段未搬进自定义 UI；使用 Semi UI 自定义时已注明官方 UI 不满足的具体交互要求。
- [ ] 自定义样式只使用 DSH 语义变量，没有硬编码颜色。
- [ ] 亮色与暗色主题下的文本、阴影、border 与背景对比都成立，主题切换后无残留单侧样式。
- [ ] 相邻元素的 padding/margin 叠加与 BFC 行为符合预期；需要隔离时优先 `display: flow-root`。
- [ ] 毛玻璃 `backdrop-filter` 加在承载透明背景的父元素上，子元素没有重复叠加模糊与透明背景。
- [ ] 没有插件内的 `.semi-*` 主题覆盖样式；主题调整已提交到共享包。
- [ ] 涉及共享包或主题修改时，已重建并验证所有消费插件。

## 例外流程

确需绕过本规范（例如宿主注入的特殊容器、与 Semi 视觉体系无关的画布类 UI）时：

1. 在插件内用注释和评审记录说明原因与影响范围。
2. 自定义样式仍然只使用 DSH 语义变量，保证主题切换不受影响。
3. 一旦共享包补齐对应能力，应及时替换回 `Dsh*` 组件并删除例外实现。

## 相关页面

- [DSH Semi UI 共享包](/plugins/dsh-semi-ui)
- [组件预览（文档站）](/plugins/semi-ui)
- [组件总览（展示插件）](/plugins/dsh-semi-ui-showcase)
- [插件开发](/development/plugin-development)
- [目录结构规范](/charter/directory-structure)
