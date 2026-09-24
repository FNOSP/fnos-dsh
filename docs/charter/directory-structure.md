---
title: 目录结构规范
description: fnOS DSH Monorepo 的目录职责、文件归属、命名和新增目录约束。
---

# 目录结构规范

本规范用于约束仓库目录和文件的归属，避免功能代码、测试、文档和构建产物在错误目录中堆积。

本仓库是 `pnpm Workspace + Turborepo` Monorepo，不直接套用单体前端项目的目录结构。新增目录前必须先判断它属于应用、可复用包、DSH 插件、内部工具还是文档。

## 核心原则

1. **先归属，后创建**：优先放入已有职责目录，不因为方便就在根目录或任意模块下新建目录。
2. **一个目录一个职责**：目录名称必须能说明其内容边界，禁止使用 `misc`、`common`、`other`、`temp` 等兜底目录收集无关文件。
3. **源码、测试、文档、产物分离**：源码放 `src/`，测试放 `tests/`，文档放 `docs/`，构建产物放被 Git 忽略的输出目录。
4. **按模块边界组织**：优先按运行边界、业务职责和发布单元划分，而不是按文件扩展名或修改方便程度划分。
5. **不保留空目录**：目录只有在包含实际文件或代表明确的运行时边界时才创建；不提交空目录占位。
6. **新目录必须可追踪**：新增顶层目录、文档模块或新的源码分区时，必须同步更新本规范、仓库结构说明或对应模块文档。

## 根目录白名单

根目录只允许放置以下类别。新的功能代码不得直接放在根目录。

| 目录 | 职责 | 允许放置的内容 |
| --- | --- | --- |
| `apps/` | fnOS 可安装应用 | Manifest、生命周期脚本、应用资源、运行时配置和 FPK 输入 |
| `packages/` | 可复用 workspace 包 | 网关、共享 UI、公共运行时能力和可独立构建的库 |
| `plugins/` | DSH 客户端插件 | Host、Client、组件、契约、插件配置和插件测试 |
| `tooling/` | 仓库内部工具 | CLI、检查器、版本、构建和发布辅助工具 |
| `docs/` | 文档站源文件 | 章程、指南、应用说明、插件说明、需求、计划、验收和静态资源 |
| `scripts/` | 仓库级脚本 | 同时服务多个 workspace 或无法归属单个包的脚本 |
| `types/` | 根级类型声明 | 仅供根工程或多个 workspace 使用的全局声明 |
| `patches/` | 依赖补丁 | pnpm patch 文件，不放源码和业务逻辑 |

根目录中的 `package.json`、`pnpm-workspace.yaml`、`turbo.json`、TypeScript 配置、Lint 配置和 CI 配置属于仓库级入口，不应复制到功能子目录中。

以下目录属于本地或构建产物，禁止提交业务源码和配置：`node_modules/`、`lib/`、`.turbo/`、`tmp/`、`data/`、`.dsh/`、`docs/.vitepress/dist/` 以及应用构建生成的 `app/native/`、插件归档等目录。

## fnOS 应用目录：`apps/`

每个应用使用 `apps/<app-name>/`，应用目录名使用小写短横线命名，例如 `fn-deepseek-harness`。

```text
apps/<app-name>/
├── manifest                 # fnOS 应用 Manifest，保持 INI 格式
├── app/                     # 运行时文件、UI、网关输出和应用配置
├── cmd/                     # 安装、启动、升级、卸载等生命周期入口
├── config/                  # privilege、resource 等 fnOS 配置
├── wizard/                  # install、upgrade、config、uninstall 向导
├── ICON.PNG                 # 平台要求的应用图标
└── README.md                # 历史或实现参考，不作为现行用户文档入口
```

约束：

- 运行时文件必须进入 `app/`，不能散落在应用根目录。
- 生命周期脚本必须进入 `cmd/`，向导脚本必须进入 `wizard/`。
- fnOS 平台要求的固定文件名（例如 `manifest`、`ICON.PNG`、`cmd/main`）保留平台命名，不套用通用文件命名规则。
- 网关、native 文件和插件归档等构建生成物必须由构建脚本写入，并保持在 `.gitignore` 约定的目录内。

## workspace 包目录：`packages/`

每个公共包使用 `packages/<package-name>/`，目录名与 npm 包职责保持一致。

```text
packages/<package-name>/
├── src/                     # 包源码
├── tests/                   # 包测试
├── package.json             # 包入口、依赖、脚本和发布配置
├── tsconfig.json            # 包级 TypeScript 配置
├── tsdown.config.ts         # 包构建配置
├── vitest.config.ts         # 存在测试时使用
└── README.md                # 包的实现或发布参考
```

`src/` 内按职责建立子目录。当前仓库使用的典型职责包括：`client/`、`server/`、`config/`、`constants/`、`middleware/`、`types/` 和 `install-callback-helper/`。只有出现明确的模块边界时才新增子目录，不为单个工具函数创建目录。

## DSH 插件目录：`plugins/`

每个插件使用 `plugins/<plugin-name>/`，插件目录名使用小写短横线命名，并保持包名、文档名和发布名一致。

```text
plugins/<plugin-name>/
├── src/
│   ├── client/              # DSH Client 注册、页面和交互
│   ├── host/                # Host 服务、权限、持久化和外部调用
│   ├── contracts/           # Host/Client 共享契约和常量
│   ├── components/          # 跨页面复用的 UI 组件，按需创建
│   ├── hooks/               # React Hooks，按需创建
│   ├── styles/              # 插件样式
│   └── index.ts             # 插件主入口
├── tests/                   # 插件测试，与源码职责对应
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts
├── compatibility.json       # 插件兼容性声明，存在时保留在包根目录
└── cordis.patch.yml         # DSH Bundle patch，存在时保留在包根目录
```

插件内部约束：

- Client 代码只能放在 `src/client/`，Host 代码只能放在 `src/host/`。
- Host 和 Client 共享的数据结构放在 `src/contracts/`，不要从任意一侧反向导入实现文件。
- React 组件文件使用 PascalCase，例如 `AddAccountModal.tsx`；普通 TypeScript 模块使用小写短横线，例如 `usage-visibility.ts`。
- 测试文件放在 `tests/`，使用 `*.spec.ts` 或 `*.spec.tsx` 命名，不与源码混放。
- Slot、Service、Bundle patch 等宿主契约配置必须靠近插件根目录或对应契约目录，不放入临时目录。

## 内部工具目录：`tooling/`

内部工具按工具名称建立 workspace，例如 `tooling/fn-os-apps-cli/`。

```text
tooling/<tool-name>/
├── src/
│   ├── commands/            # 用户可调用的命令模块
│   ├── config/              # 路径、workspace 和目标配置
│   ├── core/                # 进程、Turbo、参数等通用实现
│   ├── sdd/                 # SDD 检查和追踪逻辑
│   └── ui/                  # 交互提示和终端输出
├── tests/
└── package.json
```

工具内部目录按职责拆分。新增命令放入 `src/commands/`，不要直接堆在 `src/index.ts`；新增通用能力放入已有的 `config/` 或 `core/`，不要创建 `src/misc/`。

## 文档目录：`docs/`

文档必须按内容类型归档到以下目录，不能在 `docs/` 根目录随意新增页面：

| 目录 | 文档类型 |
| --- | --- |
| `charter/` | 项目章程、SDD 规范和维护治理规则 |
| `guide/` | 快速开始、仓库结构和问题排查等使用入口 |
| `development/` | 开发环境、应用、插件、任务和协作指南 |
| `apps/` | 应用面向用户的说明 |
| `plugins/` | 插件和共享 UI 面向用户的说明 |
| `requirements/` | 正式需求规格 |
| `plans/` | 已进入实施阶段的计划 |
| `validation/` | NAS、客户端和发布环境验收证据 |
| `build/` | 打包、版本、CI 和发布说明 |
| `public/` | 文档站静态资源 |
| `components/` | VitePress 文档组件 |
| `prompts/` | 项目维护所需的提示词或模板 |

文档归档规则：

- 规范性内容进入 `charter/`；操作说明进入 `guide/` 或 `development/`，不要混放。
- 需求、计划和验收证据必须分别进入 `requirements/`、`plans/` 和 `validation/`。
- 文档页面使用小写短横线命名；需求和计划使用既定的 `FNOS-###`、`PLAN-FNOS-###` 前缀。
- 图片、Logo 和其他静态文件进入 `public/`，不要放在 Markdown 页面旁边。
- 一篇文档只能有一个权威位置；移动或拆分文档时必须同步更新侧边栏和全部引用。

## 新增目录的判断流程

新增文件或目录前按以下顺序判断：

1. 是否可以放入已有目录？可以则不新建目录。
2. 它属于应用、公共包、插件、工具、文档还是仓库脚本？放入对应顶层目录。
3. 它是否形成稳定的职责边界、需要独立构建/测试，或已有至少两个同类文件？否则优先放在父目录。
4. 新目录是否会产生新的文档类型、构建入口或运行边界？如果会，先补充本规范和相关索引。
5. 新增后运行相关检查，确认没有把源码、测试、文档或构建产物放错位置。

禁止以下做法：

- 在根目录新建 `src/`、`components/`、`utils/`、`common/`、`temp/` 等无归属目录。
- 在包根目录直接堆积大量源码文件，绕过已有的 `src/` 分层。
- 把测试、截图、日志、构建输出或本地凭据放进源码目录。
- 为了复用而提前创建空的 `api/`、`hooks/`、`store/` 等目录。
- 把不同插件、应用或 workspace 的代码放到一个共享目录；真正共享的能力应进入 `packages/`。

## 验证要求

目录结构调整后至少运行：

```bash
pnpm run check -- --sdd --docs
pnpm run build -- --docs
git diff --check
```

涉及 workspace 源码移动时，还需要运行对应包或插件的 `typecheck`、`test` 和 `build`。
