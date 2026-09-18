# 路径与编码

本页汇总仓库级的编码约束。这些是硬性要求，违反的改动不应提交。

## 禁止绝对路径

**受版本管理的文件不得写入开发者本机绝对路径**，包括 `/Users/<name>/...`、`/home/<name>/...`、Windows 盘符路径，以及指向其他检出的路径。

这类路径只在写入它的机器和检出目录下成立：换机器、换目录或仓库改名后立即失效；若指向其他检出，本仓库的检查结果还会随那个仓库的状态变化，表现为「时好时坏」而看不出原因。

按场景选择替代方式：

| 场景 | 做法 | 示例 |
| --- | --- | --- |
| 同包或相邻模块 | 相对导入 | `import { x } from '../src/foo.ts'` |
| 跨 workspace 引用 | 包名别名，由 `workspace:*` 解析 | `import { y } from '@tnnevol/dsh-semi-ui'` |
| 需要绝对路径定位文件 | 基于当前模块位置运行时解析 | 见下 |
| fnOS 应用脚本 | 平台提供的环境变量 | `${TRIM_PKGVAR}`、`${TRIM_APPDEST}` |

测试中读取源码做结构断言时，用运行时解析而不是写死路径：

```ts
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcPath = (...segments: string[]) => join(here, '..', 'src', ...segments)
```

配置文件可直接用 `import.meta.dirname`（Node 20.11+，本项目 Node 24 满足）。

例外与边界：

- 被忽略的目录（`node_modules/`、`.turbo/`、`docs/.vitepress/dist`）不在约束范围内。
- 描述该规则本身时不可避免要写出被禁形态；判据以真实用户名为准，占位写法（`/Users/<name>/...`）属说明性文本，不算违规。
- 文档中作为外部示例的绝对路径不受限，但不要使用真实个人主目录。

## 类型定义策略

类型依赖采用 pnpm catalog 统一版本（`pnpm-workspace.yaml` 的 `catalog`），不在每个 workspace 随意锁定版本。

各 workspace 的 `tsconfig.json` 只声明运行时确实需要的全局类型：Node workspace 使用 `node`，含 React/Client 代码的插件和包使用 `node`、`react`。新增类型包时先确认是否已在 catalog 中；优先复用根目录版本，并在对应 workspace 的 `tsconfig.json` 最小化 `compilerOptions.types`。

共享业务类型应放在实际拥有它的 package 并通过公开入口导出，避免复制声明或依赖另一个 workspace 的内部路径。类型策略变更（新增全局类型、改变共享类型归属或 catalog 版本）须在 PR 描述中说明影响，并至少运行受影响 workspace 的 `typecheck` 和 `test`。

## 测试布局

仓库中的六个可发布 TypeScript workspace（`plugins/*` 四个插件、`packages/*` 两个包）采用一致约定：源码放在 workspace 自己的 `src/`，单元测试集中放在同级 `tests/`，通过 `test` 调用该 workspace 的 `vitest.config.ts`。

新增测试应优先放入对应 workspace 的 `tests/`，按被测模块组织文件；不要把跨 workspace 的测试复制到根目录，也不要把测试混入 `apps/` 下的 fnOS 应用目录。

`tooling/fn-os-apps-cli` 遵循同一 `tests/` + Vitest 布局，但它是仓库工具 workspace，不计入上述六个可发布包。`docs` 是 VitePress 文档 workspace，不承担 TypeScript 单元测试。应用目录是 fnOS 打包输入，主要通过 `pnpm run check -- --all`、脚本语法检查、JSON 校验和设备上的 `install-local` 验证，而不是强行引入 Vitest。

根目录通过 Turbo 执行 `pnpm test`。只有确实需要构建前置产物的 workspace（例如 `packages/fnos-gateway`）才在 `pretest` 中生成测试所需 bridge；新增前置步骤应说明原因并保持可重复执行。

## 文档编写

应用和插件说明统一维护在文档站中。配置较多时优先增加现有文档章节，只有在内容确实独立且篇幅较大时才拆分页面。

Mermaid 图使用 ` ```mermaid ` 代码块。注意 `graph` 是 Mermaid 的保留字，不能用作节点 id，否则该图会静默渲染失败。

## 相关页面

- [SDD 维护规范](../guide/sdd-workflow)
- [贡献指南](/contributing)
- [开发环境](./environment)
